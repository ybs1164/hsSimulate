// Declarations share the main scene's positions and history with value nodes.
// Their contents remain in types/classes; scene nodes only identify and place them.
import { universeGraph } from './declGraph.js'

export const isDeclarationNode = (node) => node?.type === 'declaration'

export const declarationMain = (nodes) => Object.values(nodes).find((n) => n.type === 'function' && n.custom && n.label === 'main' && !n.lambda && !n.override && !n.sourceFunctionId)

/** Main shows references to the global declaration nodes, never separate copies. */
export function syncDeclarationBodies(nodes, functionBodies) {
  const main = declarationMain(nodes)
  for (const [id, body] of Object.entries(functionBodies)) {
    for (const [key, n] of Object.entries(body)) if (isDeclarationNode(n) && (id !== main?.id || nodes[key] !== n)) delete body[key]
    if (id === main?.id) for (const node of Object.values(nodes).filter(isDeclarationNode)) body[node.id] = node
  }
}

export function declarationNode(nodes, kind, name) {
  return Object.values(nodes).find((n) => isDeclarationNode(n) && n.declarationKind === kind && n.declarationName === name)
}

export function renameDeclarationNode(nodes, kind, from, to) {
  const node = declarationNode(nodes, kind, from)
  if (node) { node.declarationName = to; node.label = to }
}

/** Reconcile saved scene nodes with declarations, migrating old universe positions. */
export function syncDeclarationNodes(nodes, types, classes, instances = {}, layouts = {}) {
  const universe = universeGraph(types, classes, instances)
  const wanted = new Set(universe.nodes.map((n) => n.id))
  const seen = new Set()
  for (const [id, n] of Object.entries(nodes)) {
    if (!isDeclarationNode(n)) continue
    const key = `${n.declarationKind}:${n.declarationName}`
    if (!wanted.has(key) || seen.has(key)) delete nodes[id]
    else seen.add(key)
  }
  const values = Object.values(nodes).filter((n) => !isDeclarationNode(n) && !n.readonly && !n.lambda && !n.override && !n.library && Number.isFinite(n.x) && Number.isFinite(n.y))
  const right = values.length ? Math.max(...values.map((n) => n.x)) + 620 : 340
  let index = 0
  for (const d of universe.nodes) {
    let node = declarationNode(nodes, d.kind, d.name)
    if (!node) {
      const saved = layouts.universe?.[d.id]
      const x = saved && Number.isFinite(saved.x) ? right + saved.x : right + (index % 2) * 430
      const y = saved && Number.isFinite(saved.y) ? 300 + saved.y : 240 + Math.floor(index / 2) * 440
      let id = `declaration:${d.id}`, suffix = 2
      while (nodes[id]) id = `declaration:${d.id}:${suffix++}`
      node = nodes[id] = { id, type: 'declaration', declarationKind: d.kind, declarationName: d.name, label: d.name, x, y }
    }
    node.builtinDeclaration = !!d.builtin
    node.label = d.name
    index++
  }
  return universe
}

/** Universe edges and declared-type use by functions, all pointing at main-scene ids. */
export function declarationSceneEdges(nodes, types, classes, instances, functionBodies = {}, definitions = nodes) {
  const universe = universeGraph(types, classes, instances)
  const byName = new Map(Object.values(nodes).filter(isDeclarationNode).map((n) => [`${n.declarationKind}:${n.declarationName}`, n.id]))
  const edges = universe.edges.flatMap((e) => byName.has(e.from) && byName.has(e.to) ? [{ ...e, from: byName.get(e.from), to: byName.get(e.to) }] : [])
  for (const fn of Object.values(nodes).filter((n) => n.custom && !n.lambda && !n.override && !n.library)) {
    const used = new Set()
    for (const n of Object.values(functionBodies[fn.id] || {})) {
      const type = definitions[n.sourceFunctionId]?.derived?.type
      if (type && types[type]) used.add(type)
      if (n.match?.type && types[n.match.type]) used.add(n.match.type)
      for (const name of String(n.annotation || '').match(/[A-Z][\w']*/g) || []) if (types[name]) used.add(name)
    }
    for (const name of used) {
      const from = byName.get(`type:${name}`)
      if (from) edges.push({ from, to: fn.id, kind: 'function-type' })
    }
  }
  return edges
}
