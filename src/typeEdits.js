// What a type declaration owns besides its own text: the functions derived
// from it (typeDecls.js) as they are *used* — call nodes all over the
// project — and as they may be *customized*.
//
// Customizing. Every derived function (constructor, projection, set/over,
// case, fold) is a definition like any other and can be redefined: a
// custom function stored under the derived id, so every existing call
// resolves to it (`nodes` shadow derived definitions — see main.js's
// `definitions`). Its body starts as a call to the primitive it replaces,
// `wallet#` (GHC's MagicHash convention for primitives): the universal
// morphism of the product/coproduct, which stays reachable under
// `prim:<id>` so a custom `set clicks` can still build the record, a smart
// constructor can still construct, and a custom `show`-like projection can
// still project. "Reset" deletes the customization.
//
// Migrating. Editing a declaration renames and reshapes what it derives —
// renaming a field renames its projection, adding a field adds a
// constructor argument, adding a constructor adds a case branch. The type
// editor tracks each constructor and field by a stable key across edits;
// from the old and new declaration and those keys, `migrateTypeEdit`
// rewires every call (id, label, slots: kept slots keep their contents,
// new slots start empty, dropped slots unplug what they held) and moves
// customizations along.
import { derivedDefinitions } from './typeDecls.js'

export const PRIM_PREFIX = 'prim:'

/** The primitive's label: `wallet#`, `set# clicks`, `Model#`. */
export function primLabel(label) {
  const space = label.indexOf(' ')
  return space < 0 ? `${label}#` : `${label.slice(0, space)}#${label.slice(space)}`
}

/** The primitive definitions behind derived definitions `defs` (keyed `prim:<id>`). */
export function primitiveDefinitions(defs) {
  return defs.map((def) => ({ ...def, id: PRIM_PREFIX + def.id, label: primLabel(def.label), primitive: true, params: [...def.params], mounted: [...def.mounted], paramScopes: [...def.paramScopes] }))
}

const graphs = (project) => [project.nodes, ...Object.values(project.functionBodies)]

/** Point each mounted child's `mountedTo` at its (possibly moved) slot. */
export function syncMountedTo(graph, node) {
  node.mounted?.forEach((childId, i) => {
    const child = childId && graph[childId]
    if (child) child.mountedTo = `${node.id}:${i}`
  })
}

/** The body a customization starts with: `f x₁ … xₙ = f# x₁ … xₙ`. */
export function defaultOverrideBody(def) {
  const body = {}
  def.params.forEach((name, i) => {
    const id = `input-${def.id}-${i}`
    body[id] = { id, type: 'parameter', label: name, value: name, color: '#4f8ef7', x: 110, y: 150 + i * 160, connected: true, mountedTo: `prim:${i}` }
  })
  body.prim = {
    id: 'prim', type: 'function', sourceFunctionId: PRIM_PREFIX + def.id, label: primLabel(def.label), scope: 'local', color: def.color,
    params: def.params.map(() => ''), mounted: def.params.map((_, i) => `input-${def.id}-${i}`), paramScopes: def.params.map(() => 'local'),
    x: 520, y: 255, connected: true,
  }
  body.output = { id: 'output', type: 'output', label: 'Output', value: 'ƒ', color: '#2fbf8f', source: 'prim', x: 980, y: 255 }
  return body
}

/** Make derived definition `def` editable: a custom function under its id, defined by its primitive. */
export function customizeDerived(project, def) {
  if (project.nodes[def.id]) return project.nodes[def.id]
  const node = {
    id: def.id, type: 'function', label: def.label, params: [...def.params], mounted: def.params.map(() => null), paramScopes: def.params.map(() => 'local'),
    scope: 'main', color: def.color, custom: true, override: def.derived.type, x: -9999, y: -9999,
  }
  project.nodes[def.id] = node
  project.functionBodies[def.id] = defaultOverrideBody(def)
  return node
}

/** Drop the customization of derived function `id` (calls fall back to the derived definition). */
export function resetDerived(project, id) {
  if (!project.nodes[id]?.override) return false
  delete project.nodes[id]
  delete project.functionBodies[id]
  return true
}

/** A graph's meaning, without its layout: what each node is and how it's wired. */
export function shape(graph) {
  const keep = ['type', 'sourceFunctionId', 'params', 'mounted', 'target', 'source', 'value']
  return JSON.stringify(Object.keys(graph).sort().map((id) => [id, ...keep.map((k) => graph[id][k] ?? null)]))
}

/** Is the customization of `def` still exactly its starting body (nothing the user changed)? */
export function isPristineOverride(project, def) {
  const body = project.functionBodies[def.id]
  return !!body && shape(body) === shape(defaultOverrideBody(def))
}

/**
 * How declaration `oldDecl` became `newDecl`, as a rename/reshape of each
 * derived definition: Map old id -> { def (the new definition), slotMap }
 * where slotMap[k] is the old slot that new slot k takes its contents from
 * (null: a new, empty slot). A definition with no counterpart is absent.
 * Constructors and fields are matched by `keys`: `{ ctors: [oldIndex ->
 * newIndex], fields: [oldCtorIndex -> [oldFieldIndex -> newFieldIndex]] }`.
 */
export function derivedRenames(oldDecl, newDecl, keys) {
  const oldDefs = derivedDefinitions({ [oldDecl.name]: oldDecl })
  const newDefs = derivedDefinitions({ [newDecl.name]: newDecl })
  const newCtorOf = (i) => keys.ctors[i]
  const oldCtorOf = (j) => keys.ctors.indexOf(j)
  const newFieldOf = (i, fi) => keys.fields[i]?.[fi]
  const oldFieldOf = (j, fk) => {
    const i = oldCtorOf(j)
    return i < 0 ? -1 : (keys.fields[i] || []).indexOf(fk)
  }
  const renames = new Map()
  for (const def of oldDefs) {
    const d = def.derived
    let found = null
    if (d.op === 'construct') {
      const j = newCtorOf(d.ctorIndex)
      found = j === undefined ? null : newDefs.find((x) => x.derived.op === 'construct' && x.derived.ctorIndex === j)
      if (found) renames.set(def.id, { def: found, slotMap: newDecl.constructors[j].fields.map((_, k) => { const o = oldFieldOf(j, k); return o < 0 ? null : o }) })
      continue
    }
    if (['get', 'set', 'over'].includes(d.op)) {
      // Projections exist only for a single-constructor record, so both sides are constructor 0.
      if (newCtorOf(0) !== 0) continue
      const fk = newFieldOf(0, d.fieldIndex)
      found = fk === undefined ? null : newDefs.find((x) => x.derived.op === d.op && x.derived.fieldIndex === fk)
      if (found) renames.set(def.id, { def: found, slotMap: def.params.map((_, k) => k) })
      continue
    }
    if (d.op === 'case' || d.op === 'fold') {
      found = newDefs.find((x) => x.derived.op === d.op)
      if (!found) continue
      const branches = newDecl.constructors.map((_, j) => { const i = oldCtorOf(j); return i < 0 ? null : i })
      renames.set(def.id, { def: found, slotMap: [...branches, oldDecl.constructors.length] })
    }
  }
  return renames
}

/** Give call `node` (in `graph`) the slots of `slotMap`, unplugging whatever sat in a dropped slot. */
function reshapeSlots(graph, node, slotMap) {
  const kept = new Set(slotMap.filter((i) => i !== null))
  node.mounted?.forEach((childId, i) => {
    const child = childId && graph[childId]
    if (child && !kept.has(i)) {
      child.mountedTo = null
      child.connected = false
      child.unfolded = false
      child.x = (node.x ?? 0) + 150 + i * 40
      child.y = (node.y ?? 0) + 120
    }
  })
  const take = (list, empty) => slotMap.map((i) => (i === null ? empty : list?.[i] ?? empty))
  node.params = take(node.params, '')
  node.mounted = take(node.mounted, null)
  node.paramScopes = take(node.paramScopes, 'local')
  syncMountedTo(graph, node)
}

/** Reorder/add/drop custom function `fnId`'s parameters by `slotMap` (its definition, body parameters and nothing else). */
function reshapeParameters(project, fnId, slotMap) {
  const def = project.nodes[fnId]
  const body = project.functionBodies[fnId]
  const params = Object.values(body).filter((n) => n.type === 'parameter')
  const dropped = params.filter((_, i) => !slotMap.includes(i))
  const doomed = new Set([...dropped.map((p) => p.id), ...Object.values(body).filter((n) => n.type === 'ref' && dropped.some((p) => p.id === n.target)).map((n) => n.id)])
  for (const n of Object.values(body)) {
    if (n.type === 'function') n.mounted?.forEach((m, i) => { if (doomed.has(m)) { n.mounted[i] = null; n.params[i] = '' } })
    if (n.type === 'output' && doomed.has(n.source)) { n.source = null; n.value = 'open' }
  }
  doomed.forEach((id) => delete body[id])
  let k = params.length
  const ordered = slotMap.map((i, pos) => {
    if (i !== null) return params[i]
    while (body[`input-${fnId}-${k}`]) k++
    const id = `input-${fnId}-${k++}`
    return { id, type: 'parameter', label: def.params[pos] || `x${pos + 1}`, value: def.params[pos] || `x${pos + 1}`, color: '#4f8ef7', x: 110, y: 150 + pos * 160 }
  })
  // Parameters are positional in insertion order: rebuild the body with them first, in the new order.
  const rest = Object.values(body).filter((n) => n.type !== 'parameter')
  Object.keys(body).forEach((id) => delete body[id])
  for (const n of [...ordered, ...rest]) body[n.id] = n
}

/**
 * Rewire the project after declaration `oldDecl` became `newDecl` (see
 * derivedRenames for `keys`). Mutates `project` (`{ nodes, functionBodies }`).
 * Returns the number of call nodes changed.
 */
export function migrateTypeEdit(project, oldDecl, newDecl, keys) {
  const renames = derivedRenames(oldDecl, newDecl, keys)
  const customized = derivedDefinitions({ [oldDecl.name]: oldDecl }).filter((def) => project.nodes[def.id]?.override).map((def) => ({ def, pristine: isPristineOverride(project, def) }))
  // Every call — customized bodies included — first, while ids are still the old ones.
  let changed = 0
  for (const graph of graphs(project)) {
    for (const node of Object.values(graph)) {
      if (node.type !== 'function' || !node.sourceFunctionId) continue
      const isPrim = node.sourceFunctionId.startsWith(PRIM_PREFIX)
      const r = renames.get(isPrim ? node.sourceFunctionId.slice(PRIM_PREFIX.length) : node.sourceFunctionId)
      if (!r) continue
      node.sourceFunctionId = isPrim ? PRIM_PREFIX + r.def.id : r.def.id
      node.label = isPrim ? primLabel(r.def.label) : r.def.label
      reshapeSlots(graph, node, r.slotMap)
      changed++
    }
  }
  // Then customizations move with their definition. One the user never
  // changed is simply re-made for the new definition; a changed one keeps
  // its body (its parameters reshaped like every call); one whose
  // definition is gone becomes an ordinary custom function, so no work is lost.
  for (const { def, pristine } of customized) {
    const node = project.nodes[def.id]
    const body = project.functionBodies[def.id]
    const r = renames.get(def.id)
    delete project.nodes[def.id]
    delete project.functionBodies[def.id]
    if (!r) {
      if (pristine) continue
      const id = `custom-${def.id.replace(/[^\w]+/g, '-')}`
      project.nodes[id] = { ...node, id, override: undefined, x: 0, y: 0 }
      project.functionBodies[id] = body
      renameCalls(project, def.id, id, node.label)
      continue
    }
    if (pristine) { customizeDerived(project, r.def); continue }
    project.nodes[r.def.id] = { ...node, id: r.def.id, label: r.def.label, override: newDecl.name, params: r.slotMap.map((i, k) => (i === null ? r.def.params[k] : node.params[i])), mounted: r.def.params.map(() => null), paramScopes: r.def.params.map(() => 'local') }
    project.functionBodies[r.def.id] = body
    reshapeParameters(project, r.def.id, r.slotMap)
  }
  return changed
}

function renameCalls(project, from, to, label) {
  for (const graph of graphs(project)) {
    for (const node of Object.values(graph)) if (node.sourceFunctionId === from) { node.sourceFunctionId = to; node.label = label }
  }
}
