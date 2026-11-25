// IO: evaluating an action performs nothing; the IO runtime (ioRuntime.js)
// performs it in order — output, input, and handing a game to the runtime.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { continueIO, isIOType, MAX_IO_ACTIONS, outputLines, performIO } from '../src/ioRuntime.js'
import { showType } from '../src/typeSystem.js'
import { isProgram } from '../src/runtime.js'
import { body } from '../src/examples/build.js'

const fn = (id, label, params) => ({ id, type: 'function', builtin: id, label, params, mounted: params.map(() => null) })
const library = {
  ...preludeDefs, ...preludeTypeDefs,
  plus: fn('plus', '(+)', ['x', 'y']), times: fn('times', '(*)', ['x', 'y']), identity: fn('identity', 'identity', ['x']),
}
const call = (id, callee, slots) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const graphOf = (...ns) => Object.fromEntries(ns.map((x) => [x.id, x]))
const ev = (registry = { nodes: library, functionBodies: {} }) => createEvaluator(registry)
function perform(graph, out = 'out', registry) {
  let text = ''
  const result = ev(registry).runIO(graph, out, { onEffect: (e) => { text += e.text } })
  return { text, result }
}
const typeOf = (graph, id = 'out') => {
  const entry = inferGraph(library, {}, graph).perNode.get(id)
  return entry && showType(valueTypeOfEntry(entry))
}

test('putStrLn and print are IO () and write in order through (>>)', () => {
  const g = graphOf(
    call('hello', 'prelude:putStrLn', ['"hello"']), call('n', 'plus', ['20', '22']), call('p', 'prelude:print', [{ node: 'n' }]),
    call('out', 'prelude:thenM', [{ node: 'hello' }, { node: 'p' }]))
  assert.equal(typeOf(g), 'IO ()')
  const { text, result } = perform(g)
  assert.equal(text, 'hello\n42\n')
  assert.equal(result.status, 'done')
})

test('evaluating an IO value performs nothing; only the runtime does', () => {
  const g = graphOf(call('out', 'prelude:putStrLn', ['"once"']))
  const value = ev().run(g, 'out')
  assert.equal(value.type, 'IO')
  assert.equal(value.ctor, 'PutStr')
  let text = ''
  ev().performIO(value, { onEffect: (e) => { text += e.text } })
  assert.equal(text, 'once\n')
})

test('mapM_ print over a list, return and when — through the Monad IO dictionary', () => {
  const g = graphOf(
    call('xs', 'prelude:enumFromTo', ['1', '3']), call('pr', 'prelude:print', ['']),
    call('out', 'prelude:mapM_', [{ node: 'pr' }, { node: 'xs' }]))
  assert.equal(typeOf(g), 'IO ()')
  assert.equal(perform(g).text, '1\n2\n3\n')
  const w = graphOf(call('say', 'prelude:putStr', ['"no"']), call('out', 'prelude:when', ['False', { node: 'say' }]))
  assert.equal(perform(w).text, '')
})

test('a long chain of actions runs without growing the JS stack', () => {
  // mapM_ putStr (replicate 20000 ".")
  const g = graphOf(
    call('xs', 'prelude:replicate', ['20000', '"."']), call('pr', 'prelude:putStr', ['']),
    call('out', 'prelude:mapM_', [{ node: 'pr' }, { node: 'xs' }]))
  const { text, result } = perform(g)
  assert.equal(result.status, 'done')
  assert.equal(text.length, 20000)
})

test('getLine waits; resuming hands the line to (>>=)', () => {
  const g = graphOf(
    call('line', 'prelude:getLine', []), call('echo', 'prelude:putStrLn', ['']),
    call('out', 'prelude:bind', [{ node: 'line' }, { node: 'echo' }]))
  assert.equal(typeOf(g), 'IO ()')
  let text = ''
  const waiting = ev().runIO(g, 'out', { onEffect: (e) => { text += e.text } })
  assert.equal(waiting.status, 'waiting')
  assert.equal(waiting.effect, 'getLine')
  const done = waiting.resume('hi there', { onEffect: (e) => { text += e.text } })
  assert.equal(done.status, 'done')
  assert.equal(text, 'hi there\n')
})

test('fmap and <*> on IO', () => {
  // fmap (+ 1) (pure 41) >>= print
  const g = graphOf(
    call('p', 'prelude:pure', ['41']), call('inc', 'plus', ['', '1']), call('m', 'prelude:fmap', [{ node: 'inc' }, { node: 'p' }]),
    call('pr', 'prelude:print', ['']), call('out', 'prelude:bind', [{ node: 'm' }, { node: 'pr' }]))
  assert.equal(perform(g).text, '42\n')
})

test('play hands its Program to the game runtime and waits', () => {
  // main = play (program 0 (wText . show) (+) step)  where step dt m = m
  const graph = graphOf(
    call('sh', 'prelude:show', ['']), call('wt', 'prelude:wText', ['']), call('view', 'compose', [{ node: 'wt' }, { node: 'sh' }, '']),
    call('handle', 'plus', ['', '']), call('st', 'step', ['', '']),
    call('prog', 'prelude:program', ['0', { node: 'view' }, { node: 'handle' }, { node: 'st' }]),
    call('out', 'prelude:play', [{ node: 'prog' }]))
  const registry = {
    nodes: { ...library, compose: fn('compose', 'compose', ['f', 'g', 'x']), step: { id: 'step', type: 'function', custom: true, label: 'step', params: ['dt', 'm'], mounted: [null, null] } },
    functionBodies: { step: body('step', ['dt', 'm'], [], 'm', ['Double', 'Int', 'Int']) },
  }
  const r = ev(registry).runIO(graph, 'out')
  assert.equal(r.status, 'waiting')
  assert.equal(r.effect, 'play')
  assert.ok(isProgram(r.program))
})

test('the interpreter: types, limits and output lines', () => {
  assert.ok(isIOType({ kind: 'app', fn: { kind: 'con', name: 'IO' }, arg: { kind: 'con', name: '()' } }, { unitOnly: true }))
  assert.ok(!isIOType({ kind: 'app', fn: { kind: 'con', name: 'IO' }, arg: { kind: 'con', name: 'Int' } }, { unitOnly: true }))
  assert.ok(!isIOType({ kind: 'con', name: 'Int' }))
  assert.deepEqual(outputLines('a\nb\n'), ['a', 'b'])
  assert.deepEqual(outputLines('a\nb'), ['a', 'b'])
  // A bare interpreter over plain JS values: forever (putStr "x") stops at the limit.
  const ops = { force: (t) => (typeof t === 'function' ? t() : t), apply: (k, x) => () => k(x), text: (s) => s, unit: null, show: String, fail: (m) => { throw new Error(m) } }
  const io = (ctor, ...args) => ({ kind: 'data', type: 'IO', ctor, args })
  const forever = () => io('Bind', io('PutStr', 'x'), () => forever())
  let n = 0
  assert.throws(() => performIO(ops, forever(), { onEffect: () => n++, maxActions: 1000 }), /1000단계/)
  assert.ok(n > 100 && n < 1000)
  assert.ok(MAX_IO_ACTIONS >= 100000)
  // continueIO with nothing left is done at once
  assert.equal(continueIO(ops, [], 5).status, 'done')
  assert.throws(() => performIO(ops, 3), /IO 동작이 필요한/)
})
