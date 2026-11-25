// The IO runtime: performs an `IO a` value, the way GHC's runtime performs
// `main :: IO ()`.
//
// Evaluating `main` performs nothing — an IO value is lazy data describing
// effects (evaluator.js' builtins):
//
//   Pure x       finish with x                (pure / return)
//   Bind m k     perform m, then k's action    (>>=, and >>, fmap, <*> through it)
//   PutStr s     write s to standard output    (putStr, putStrLn, print)
//   GetLine      wait for one line of input    (getLine)
//   Play p       hand the Program p to the game runtime (runtime.js)
//
// i.e. the free monad over those effects, read here by an interpreter. The
// loop keeps its own continuation stack, so a long `mapM_ print [1..n]` or
// a left-nested chain of binds runs without growing the JS stack. Only the
// left side of a Bind is forced; results are passed on as thunks.
//
// An effect that needs the outside world (a line of input, a game that runs
// until the page closes) stops the loop and returns where to go on from.
// The module knows nothing about graphs or the DOM: `ops` gives it the
// evaluator's force/apply.

export const MAX_IO_ACTIONS = 200000

/**
 * Perform `action` (a thunk or value of type IO a) until it finishes or waits.
 *
 * `ops`: { force(t), apply(k, x) → thunk of k x, text(t) → JS string of a
 * Haskell String, unit, fail(message) → throws, show(v) }.
 * `onEffect({ kind: 'output', text })` sees every output in order.
 *
 * Returns `{ status: 'done', value, actions }` or
 * `{ status: 'waiting', effect: 'getLine' | 'play', program?, continuation, actions }`
 * — pass `continuation` and the effect's result to `continueIO`.
 */
export function performIO(ops, action, options = {}) {
  return run(ops, action, [], options)
}

/** Go on from a waiting run: `value` (a thunk or value) is what its effect produced. */
export function continueIO(ops, continuation, value, options = {}) {
  const stack = [...continuation]
  if (!stack.length) return { status: 'done', value, actions: 0 }
  return run(ops, ops.apply(stack.pop(), value), stack, options)
}

function run(ops, action, stack, { onEffect = () => {}, maxActions = MAX_IO_ACTIONS } = {}) {
  let current = action
  let actions = 0
  for (;;) {
    if (++actions > maxActions) ops.fail(`IO 실행이 ${maxActions}단계를 넘었습니다 (끝나지 않는 반복인지 확인하세요)`)
    const io = ops.force(current)
    if (io?.kind !== 'data' || io.type !== 'IO') ops.fail(`IO 동작이 필요한 곳에 ${ops.show(io)} 값이 왔습니다`)
    let value
    if (io.ctor === 'Bind') {
      stack.push(io.args[1])
      current = io.args[0]
      continue
    } else if (io.ctor === 'Pure') {
      value = io.args[0]
    } else if (io.ctor === 'PutStr') {
      onEffect({ kind: 'output', text: ops.text(io.args[0]) })
      value = ops.unit
    } else if (io.ctor === 'GetLine') {
      return { status: 'waiting', effect: 'getLine', continuation: stack, actions }
    } else if (io.ctor === 'Play') {
      return { status: 'waiting', effect: 'play', program: io.args[0], continuation: stack, actions }
    } else {
      ops.fail(`알 수 없는 IO 동작: ${io.ctor}`)
    }
    if (!stack.length) return { status: 'done', value, actions }
    current = ops.apply(stack.pop(), value)
  }
}

/** Whether a type is `IO a` (and, with `unitOnly`, `IO ()`). */
export function isIOType(type, { unitOnly = false } = {}) {
  if (type?.kind !== 'app' || type.fn?.kind !== 'con' || type.fn.name !== 'IO') return false
  return !unitOnly || (type.arg?.kind === 'con' && type.arg.name === '()')
}

/** Standard output as lines, for display: the last line may be unfinished (putStr). */
export function outputLines(text) {
  const lines = String(text).split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines
}
