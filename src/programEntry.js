// A new project's entry is ordinary graph data, marked separately from old
// projects' custom functions named main (including the game templates).
export const MAIN_GUIDANCE = 'main의 Output에 계산 결과를 연결하세요. 왼쪽 함수 목록에서 노드를 추가하고 입력값을 채운 뒤, 결과 포트를 Output에 연결하면 됩니다.'
export const MAIN_PROTECTION = '기본 main은 프로그램 시작점이므로 삭제·이름 변경·매개변수 추가를 할 수 없습니다. 계산 내용과 Output 타입은 편집할 수 있습니다.'

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
      main: { output: { id: 'output', type: 'output', label: 'Output', value: 'open', color: '#2fbf8f', x: 570, y: 255 } },
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
