// Helpers for building example projects as data: call nodes, references,
// function bodies (with a readable layout), and the project wrapper. Node
// ids are the app's own (`plus`, `prelude:wButton`, `type:Model:wallet`).
import { declareTypes } from '../typeDecls.js'

export const T = (type, label) => `type:${type}:${label}`
export const P = (name) => `prelude:${name}`

/** A call node; each slot is inline literal text or { node: id } for a mounted node. */
export function call(id, callee, label, slots = []) {
  return {
    id, type: 'function', sourceFunctionId: callee, label, scope: 'local', color: '#5fa8e8',
    params: slots.map((s) => (typeof s === 'string' ? s : '')),
    mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)),
    paramScopes: slots.map(() => 'local'),
  }
}
export const ref = (id, target) => ({ id, type: 'ref', target, label: `↪ ${target}` })
export const n = (id) => ({ node: id })

export function body(fnId, params, nodes, source) {
  const graph = {}
  params.forEach((name, i) => {
    const id = `input-${fnId}-${i}`
    graph[id] = { id, type: 'parameter', label: name, value: name, color: '#4f8ef7' }
  })
  const rename = (s) => (s && typeof s === 'object' ? { node: params.includes(s.node) ? `input-${fnId}-${params.indexOf(s.node)}` : s.node } : s)
  for (const node of nodes) {
    const fixed = { ...node }
    if (node.type === 'ref' && params.includes(node.target)) fixed.target = `input-${fnId}-${params.indexOf(node.target)}`
    if (node.mounted) fixed.mounted = node.mounted.map((m) => (m && params.includes(m) ? `input-${fnId}-${params.indexOf(m)}` : m))
    graph[node.id] = fixed
  }
  graph.output = { id: 'output', type: 'output', label: 'Output', value: 'ƒ', color: '#2fbf8f', source: rename(n(source)).node }
  layout(graph)
  return graph
}

// Lay out what's visible (nodes not plugged into a slot): parameters and
// references on the left, the result in the middle, Output on the right.
function layout(graph) {
  const free = Object.values(graph).filter((x) => x.type !== 'output' && !isMounted(graph, x.id))
  const output = graph.output
  free.forEach((x, i) => {
    const isResult = x.id === output.source
    x.x = isResult ? 520 : 110
    x.y = isResult ? 255 : 150 + i * 160
  })
  output.x = 980
  output.y = 255
  for (const x of Object.values(graph)) {
    if (x.x === undefined) { x.x = 300; x.y = 600 } // hidden inside a slot until detached
    const host = Object.values(graph).find((h) => h.mounted?.includes(x.id))
    if (host) { x.mountedTo = `${host.id}:${host.mounted.indexOf(x.id)}`; x.connected = true }
  }
  const src = graph[output.source]
  if (src) src.connected = true
}
const isMounted = (graph, id) => Object.values(graph).some((h) => h.mounted?.includes(id))


/** `{ types, nodes, functionBodies, entry }` from Haskell type declarations and `{ name: [params, nodes, outputSource] }`. */
export function buildProject(typeSource, functions, entry = 'main') {
  const types = declareTypes({}, typeSource)
  const nodes = {}
  const functionBodies = {}
  Object.entries(functions).forEach(([name, [params, bodyNodes, source]], i) => {
    nodes[name] = { id: name, type: 'function', label: name, params: [...params], mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true, x: 1060 + (i % 2) * 620, y: 190 + Math.floor(i / 2) * 230 }
    functionBodies[name] = body(name, params, bodyNodes, source)
  })
  return { types, nodes, functionBodies, entry, outputId: 0 }
}
