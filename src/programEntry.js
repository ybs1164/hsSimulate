// A new project's entry is ordinary graph data, marked separately from old
// projects' custom functions named main (including the game templates).
// main :: IO () — like a Haskell executable's main, an action the IO runtime
// (ioRuntime.js) performs: output with putStrLn/print, input with getLine, a
// game with play. Calculations stay in pure functions that main calls.
export const MAIN_TYPE = 'IO ()'
export const MAIN_GUIDANCE = 'main :: IO () 의 Output에 실행할 동작을 연결하세요. 계산 결과는 print(또는 putStrLn . show)로 출력하고, 여러 동작은 (>>)·(>>=)로 순서대로 이으며, 게임은 play (program …)로 실행합니다.'
export const MAIN_PROTECTION = '기본 main은 프로그램 시작점이므로 삭제·이름 변경·매개변수 추가를 할 수 없고, 결과 타입은 IO ()로 고정됩니다. 동작 내용은 편집할 수 있습니다.'
export const MAIN_TYPE_LOCKED = 'main의 결과 타입은 IO ()로 고정됩니다. 다른 타입의 계산은 별도 함수로 만들고 main에서 print나 putStrLn으로 출력하세요.'

export const isManagedMain = (node) => node?.type === 'function' && node.custom === true && node.programEntry === true && !node.sourceFunctionId
export const managedMain = (nodes) => Object.values(nodes).find(isManagedMain) || null

/** Only for a NEW project/full Reset. Never called while restoring/importing. */
export function createBlankProject(builtinNodes, builtinBodies) {
  return {
    nodes: {
      main: { id: 'main', type: 'function', label: 'main', custom: true, programEntry: true, params: [], mounted: [], paramScopes: [], scope: 'main', color: '#6c5ce7', x: 300, y: -40 },
      ...structuredClone(builtinNodes),
    },
    functionBodies: {
      ...structuredClone(builtinBodies),
      main: { output: { id: 'output', type: 'output', label: 'Output', value: 'open', color: '#2fbf8f', x: 570, y: 255, annotation: MAIN_TYPE } },
    },
    types: {}, classes: {}, instances: {}, entry: 'main', outputId: 0,
  }
}

/** Resolve, without evaluating or changing a graph. Legacy entries stay intact. */
export function programRunTarget(project) {
  const fn = managedMain(project.nodes) || project.nodes[project.entry]
  if (!fn || fn.type !== 'function') return null
  const graph = project.nodes
  if (!isManagedMain(fn)) return { fn, graph, displayGraph: graph, anchor: fn, problem: null }
  const displayGraph = project.functionBodies[fn.id]
  const output = Object.values(displayGraph || {}).find((n) => n.type === 'output')
  const connected = output?.source && displayGraph[output.source]
  const problem = fn.params?.length ? '기본 main은 입력 없이 실행합니다. 입력을 받는 계산은 별도 함수로 만들고 main에서 호출하세요.' : connected ? null : MAIN_GUIDANCE
  return { fn, graph, displayGraph, anchor: output || fn, problem }
}

// Inspect the already inferred type; probing every entry by evaluating it
// would run a pure program twice (once for game detection, once for Play).
export const returnsProgram = (type) => type?.kind === 'app' && type.fn?.kind === 'app' && type.fn.fn?.kind === 'con' && type.fn.fn.name === 'Program'

/**
 * How an entry of type `type` runs: 'io' (an IO action the IO runtime
 * performs), 'game' (an older entry whose value is a Program — played as
 * `play` would), 'value' (an older pure entry — its value is shown), or
 * 'function' (still waiting for arguments).
 */
export function entryKind(type) {
  if (type?.kind === 'fun') return 'function'
  if (type?.kind === 'app' && type.fn?.kind === 'con' && type.fn.name === 'IO') return 'io'
  if (returnsProgram(type)) return 'game'
  return 'value'
}

/** What wraps a non-IO main's result to make it an IO action: `play` for a Program, `print` for a value. */
export const ioWrapperFor = (type) => (entryKind(type) === 'game' ? 'play' : entryKind(type) === 'value' ? 'print' : null)

/** Why an old managed main is not IO () yet (or null), with what to do about it. */
export function legacyMainNotice(type) {
  const kind = entryKind(type)
  if (kind === 'game') return 'main이 Program 값입니다. 지금은 게임으로 실행하지만, Haskell처럼 main :: IO ()가 되도록 “IO로 감싸기”로 play를 붙이세요.'
  if (kind === 'value') return 'main이 IO가 아닌 순수 값입니다. 지금은 값을 보여 주지만, Haskell처럼 main :: IO ()가 되도록 “IO로 감싸기”로 print를 붙이세요.'
  return null
}
