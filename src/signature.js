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
  body[id] = { id, type: 'parameter', label, value: label, color: '#4f8ef7', x: last ? last.x : 110, y: last ? last.y + 120 : 180 }
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
  }
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
