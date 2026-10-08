// Editing a custom function's signature. A function's parameters live in
// three places that must agree: its definition node (`nodes[id].params`, one
// slot each), the parameter nodes of its body (`functionBodies[id]`, in
// order), and every call to it anywhere (`sourceFunctionId === id`, one slot
// per parameter). These operations change all three together, detaching
// whatever was plugged into or fed by a removed parameter.
//
// `project` is `{ nodes, functionBodies }` (main.js's live objects); the
// functions mutate it in place.

/** Every graph: the main graph and each function body. */
function graphs(project) {
  return [project.nodes, ...Object.values(project.functionBodies)]
}

function bodyParameters(project, fnId) {
  return Object.values(project.functionBodies[fnId] || {}).filter((n) => n.type === 'parameter')
}

/** Calls to `fnId`, with the graph each lives in. */
function callsTo(project, fnId) {
  return graphs(project).flatMap((graph) => Object.values(graph).filter((n) => n.type === 'function' && n.sourceFunctionId === fnId).map((node) => ({ graph, node })))
}

/** Unplug slot `index` of `node` in `graph`, freeing what was plugged in (placed beside it). */
function unplugSlot(graph, node, index) {
  const child = graph[node.mounted?.[index]]
  if (child) {
    child.mountedTo = null
    child.connected = false
    child.unfolded = false
    child.x = (node.x ?? 0) + 150
    child.y = (node.y ?? 0) + 120
  }
}

/** After `node`'s slots were spliced or reordered, point what's plugged into them at their new index. */
function reindexMounted(graph, node) {
  node.mounted?.forEach((id, i) => { const child = graph[id]; if (child) child.mountedTo = `${node.id}:${i}` })
}

/** Reorder `array` in place by moving the element at `from` to `to`. */
function move(array, from, to) {
  if (!array || from >= array.length) return
  const [item] = array.splice(from, 1)
  array.splice(to, 0, item)
}

/** A name not used by any of `taken`. */
function freshName(taken, base = 'p') {
  for (let i = taken.length + 1; ; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`
}

/** Append a parameter to custom function `fnId`. Returns its name. */
export function addParameter(project, fnId, name) {
  const def = project.nodes[fnId]
  const body = project.functionBodies[fnId]
  if (!def?.custom || !body) return null
  const params = bodyParameters(project, fnId)
  const label = name || freshName(params.map((p) => p.label))
  let k = params.length
  while (body[`input-${fnId}-${k}`]) k++
  const id = `input-${fnId}-${k}`
  const last = params[params.length - 1]
  body[id] = { id, type: 'parameter', label, value: label, color: '#4f8ef7', x: last ? last.x : 110, y: last ? last.y + 160 : 180 }
  def.params.push(label)
  def.mounted.push(null)
  def.paramScopes?.push('local')
  for (const { node } of callsTo(project, fnId)) {
    node.params.push('')
    node.mounted.push(null)
    node.paramScopes?.push('local')
  }
  return label
}

/** Remove parameter `index` of custom function `fnId` everywhere. */
export function removeParameter(project, fnId, index) {
  const def = project.nodes[fnId]
  const body = project.functionBodies[fnId]
  const param = bodyParameters(project, fnId)[index]
  if (!def?.custom || !body || !param) return false
  // Inside the body: whatever the parameter fed is cut off, and references to it go.
  const doomed = new Set([param.id, ...Object.values(body).filter((n) => n.type === 'ref' && n.target === param.id).map((n) => n.id)])
  for (const n of Object.values(body)) {
    if (n.type === 'function') n.mounted?.forEach((m, i) => { if (doomed.has(m)) { n.mounted[i] = null; n.params[i] = '' } })
    if (n.type === 'output' && doomed.has(n.source)) { n.source = null; n.value = 'open' }
  }
  doomed.forEach((id) => delete body[id])
  // The definition and every call lose that slot.
  for (const { graph, node } of [{ graph: project.nodes, node: def }, ...callsTo(project, fnId)]) {
    unplugSlot(graph, node, index)
    node.params.splice(index, 1)
    node.mounted.splice(index, 1)
    node.paramScopes?.splice(index, 1)
    node.holeNames?.splice(index, 1)
    reindexMounted(graph, node)
  }
  return true
}

/**
 * Move parameter `from` of custom function `fnId` to position `to` — in its
 * body (the parameters' order), its definition and every call, whose slots
 * (and whatever is plugged into them) move along.
 */
export function moveParameter(project, fnId, from, to) {
  const def = project.nodes[fnId]
  const body = project.functionBodies[fnId]
  const params = bodyParameters(project, fnId)
  if (!def?.custom || !body || from === to || from < 0 || to < 0 || from >= params.length || to >= params.length) return false
  // The order of the body's parameter nodes is their key order: re-insert
  // every key (keeping the object itself — it is shared), with the parameter
  // keys taking the new order among themselves.
  const order = params.map((p) => p.id)
  move(order, from, to)
  const entries = Object.entries(body)
  const byId = new Map(entries.map(([k, n]) => [n.id, [k, n]]))
  let next = 0
  const reordered = entries.map((entry) => (entry[1].type === 'parameter' ? byId.get(order[next++]) : entry))
  entries.forEach(([k]) => delete body[k])
  reordered.forEach(([k, n]) => { body[k] = n })
  for (const { graph, node } of [{ graph: project.nodes, node: def }, ...callsTo(project, fnId)]) {
    move(node.params, from, to)
    move(node.mounted, from, to)
    move(node.paramScopes, from, to)
    if (node.holeNames) { while (node.holeNames.length < node.params.length) node.holeNames.push(undefined); move(node.holeNames, from, to) }
    reindexMounted(graph, node)
  }
  return true
}

/**
 * Rename custom function `fnId` (not a λ — that has no name). `taken` lists
 * the labels of functions defined elsewhere (Prelude, types). Returns false
 * if the name is invalid or already taken.
 */
export function renameFunction(project, fnId, name, taken = []) {
  const def = project.nodes[fnId]
  if (!def?.custom || def.lambda || !/^[a-z_][A-Za-z0-9_']*$/.test(name)) return false
  if (name === def.label) return true
  const others = Object.values(project.nodes).filter((n) => n.type === 'function' && !n.sourceFunctionId && n.id !== fnId).map((n) => n.label)
  if ([...others, ...taken].includes(name)) return false
  def.label = name
  for (const { node } of callsTo(project, fnId)) node.label = name
  return true
}

/** Rename parameter `index` of custom function `fnId`. Returns false if the name is invalid or taken. */
export function renameParameter(project, fnId, index, name) {
  const def = project.nodes[fnId]
  const params = bodyParameters(project, fnId)
  const param = params[index]
  if (!def?.custom || !param || !/^[a-z_][A-Za-z0-9_']*$/.test(name)) return false
  if (params.some((p, i) => i !== index && p.label === name)) return false
  const old = param.label
  param.label = name
  param.value = name
  // The definition's slot shows the name until something is typed or plugged in.
  if (def.params[index] === old || def.params[index] === '') def.params[index] = name
  return true
}

/** Whether `node`'s slots can be added/removed directly: only a list literal, whose length is its slot count. */
export function hasVariadicSlots(node, definitions) {
  return definitions[node.sourceFunctionId || node.id]?.builtin === 'listOf'
}
