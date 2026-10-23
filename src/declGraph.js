// Declarations as graphs. A type declaration and a class declaration are
// edited on a canvas of their own, one level up from the value graph, the
// way a function body is: the declaration is still what's stored and
// checked (typeDecls.js' draft, classDecls.js' `{ name, param, supers,
// methods, instances }`), and this module turns it into nodes and edges and
// back, losslessly — so every check, rename and call migration keeps working
// on the declaration, and the canvas only shows (and edits) its structure.
//
// A data declaration is a coproduct of products (category-theoretically,
// typeDecls.js): the type is the node everything points at, each
// constructor is an injection into it (an edge `ιᵢ`, the order of the sum)
// holding its fields (the product), each type parameter feeds the type and
// the constructors whose fields mention it, and a field that mentions the
// type itself is an edge back from the type — the inductive structure. What
// the declaration derives (constructors, projections, `caseT`, `foldT`)
// leaves the type as arrows out.
//
// A class is a predicate on types: its methods point at it, its
// superclasses imply it (`Eq a ⇒ Ord a`), and an instance is a dictionary —
// the class's record of methods applied to one implementation per method —
// so each implementing function is a node wired into the methods it
// implements (a default into its method, an instance's into the instance).
//
// Node ids are names (`ctor:Circle`, `method:pretty`, `instance:Maybe`), so
// positions — kept per declaration in the project's `layouts` — find their
// node again after a reload; the editor's keys ride along on the nodes.

/** Graph of type draft `draft` (typeDecls.js' declToDraft). `derived`: what it derives, `[{ id, label, op }]`, drawn a node per kind of op. */
export function typeGraph(draft, { derived = [] } = {}) {
  const nodes = [{ id: 'type', kind: 'type', name: draft.name, keyword: draft.keyword, params: [...(draft.params || [])], deriving: structuredClone(draft.deriving) }]
  const edges = []
  ;(draft.params || []).forEach((v, index) => {
    nodes.push({ id: `param:${v}`, kind: 'param', name: v, index })
    edges.push({ from: `param:${v}`, to: 'type', kind: 'param' })
  })
  const self = new RegExp(`(?<![\\w'])${escapeRe(draft.name)}(?![\\w'])`)
  const ctorIds = uniqueIds(draft.constructors.map((c) => `ctor:${c.name}`))
  draft.constructors.forEach((c, index) => {
    const id = ctorIds[index]
    nodes.push({ id, kind: 'ctor', index, name: c.name, key: c.key, fields: c.fields.map((f) => ({ ...f })) })
    edges.push({ from: id, to: 'type', kind: 'inject', label: `ι${subscript(index + 1)}` })
    for (const v of draft.params || []) {
      const re = new RegExp(`(?<![\\w'])${escapeRe(v)}(?![\\w'])`)
      c.fields.forEach((f, field) => { if (re.test(f.type)) edges.push({ from: `param:${v}`, to: id, kind: 'uses', field }) })
    }
    c.fields.forEach((f, field) => { if (self.test(f.type)) edges.push({ from: 'type', to: id, kind: 'recursive', field }) })
  })
  // One arrow out per kind of morphism (the projections, the updates, the copairing, the recursor), listing each one.
  const ops = []
  for (const d of derived) {
    const op = DERIVED_GROUP[d.op] ?? d.op
    let group = ops.find((g) => g.op === op)
    if (!group) {
      ops.push(group = { id: `derived:${op}`, kind: 'derived', op, index: ops.length, fns: [] })
      nodes.push(group)
      edges.push({ from: 'type', to: group.id, kind: 'derive' })
    }
    group.fns.push({ fnId: d.id, label: d.label })
  }
  return { nodes, edges }
}

/** The type draft a type graph shows (the inverse of typeGraph). */
export function typeDraftOf(graph) {
  const t = graph.nodes.find((n) => n.kind === 'type')
  const params = graph.nodes.filter((n) => n.kind === 'param').sort((a, b) => a.index - b.index).map((n) => n.name)
  const constructors = graph.nodes.filter((n) => n.kind === 'ctor').sort((a, b) => a.index - b.index).map((n) => ({ ...(n.key === undefined ? {} : { key: n.key }), name: n.name, fields: n.fields.map((f) => ({ ...f })) }))
  return { name: t.name, keyword: t.keyword, params, constructors, deriving: structuredClone(t.deriving) }
}

/**
 * Graph of class draft `draft` — a user class `{ name, param, supers,
 * methods, instances }`, or a builtin class's hand-written instances
 * `{ name, instances }` with `builtin` set and its fixed `methods` given
 * (`[{ name, label }]`).
 */
export function classGraph(draft, { builtin = false, methods = null } = {}) {
  const nodes = [{ id: 'class', kind: 'class', name: draft.name, param: draft.param, builtin }]
  const edges = []
  const fns = new Map()
  const fn = (fnId) => {
    if (!fns.has(fnId)) { fns.set(fnId, `fn:${fnId}`); nodes.push({ id: `fn:${fnId}`, kind: 'fn', fnId }) }
    return fns.get(fnId)
  }
  for (const s of draft.supers || []) {
    nodes.push({ id: `super:${s}`, kind: 'super', name: s })
    edges.push({ from: `super:${s}`, to: 'class', kind: 'super' })
  }
  const shown = builtin ? methods || [] : draft.methods
  const methodIds = uniqueIds(shown.map((m) => `method:${m.name}`))
  shown.forEach((m, index) => {
    const id = methodIds[index]
    nodes.push(builtin ? { id, kind: 'method', index, name: m.name, label: m.label ?? m.name, builtin: true } : { id, kind: 'method', index, name: m.name, sig: m.sig, default: m.default ?? null, ...(m.key === undefined ? {} : { key: m.key }) })
    edges.push({ from: id, to: 'class', kind: 'method' })
    if (!builtin && m.default) edges.push({ from: fn(m.default), to: id, kind: 'default' })
  })
  const instanceIds = uniqueIds(draft.instances.map((i) => `instance:${i.head}`))
  draft.instances.forEach((inst, index) => {
    const id = instanceIds[index]
    nodes.push({ id, kind: 'instance', index, head: inst.head, context: structuredClone(inst.context || []), methods: { ...(inst.methods || {}) } })
    edges.push({ from: id, to: 'class', kind: 'instance' })
    for (const [m, fnId] of Object.entries(inst.methods || {})) if (fnId) edges.push({ from: fn(fnId), to: id, kind: 'implements', method: m })
  })
  return { nodes, edges }
}

/** The class draft a class graph shows (the inverse of classGraph). */
export function classDraftOf(graph) {
  const c = graph.nodes.find((n) => n.kind === 'class')
  const instances = graph.nodes.filter((n) => n.kind === 'instance').sort((a, b) => a.index - b.index).map((n) => ({ head: n.head, context: structuredClone(n.context), methods: { ...n.methods } }))
  if (c.builtin) return { name: c.name, instances }
  const supers = graph.nodes.filter((n) => n.kind === 'super').map((n) => n.name)
  const methods = graph.nodes.filter((n) => n.kind === 'method').sort((a, b) => a.index - b.index).map((n) => ({ ...(n.key === undefined ? {} : { key: n.key }), name: n.name, sig: n.sig, default: n.default }))
  return { name: c.name, param: c.param, supers, methods, instances }
}

/**
 * The project's declarations at a glance: each user type and class a node,
 * a type pointing at the types its fields use, a superclass at its
 * subclasses, and a type at the classes it has a written instance of.
 * `types`: declarations as stored (field types are Type values); `classes`:
 * user classes; `instances`: builtin classes' hand-written instances.
 */
export function universeGraph(types, classes, instances = {}) {
  const nodes = []
  const edges = []
  const has = new Set()
  const node = (n) => { if (!has.has(n.id)) { has.add(n.id); nodes.push(n) } }
  for (const d of Object.values(types)) node({ id: `type:${d.name}`, kind: 'type', name: d.name, params: [...(d.params || [])], constructors: d.constructors.map((c) => c.name), library: !!d.library })
  for (const c of Object.values(classes)) node({ id: `class:${c.name}`, kind: 'class', name: c.name, param: c.param })
  for (const cls of Object.keys(instances)) if (instances[cls].length && !classes[cls]) node({ id: `class:${cls}`, kind: 'class', name: cls, builtin: true })
  for (const d of Object.values(types)) {
    const used = new Set()
    for (const c of d.constructors) for (const f of c.fields) typeNames(f.type, used)
    for (const name of used) if (name !== d.name && types[name]) edges.push({ from: `type:${name}`, to: `type:${d.name}`, kind: 'field' })
    if (used.has(d.name)) edges.push({ from: `type:${d.name}`, to: `type:${d.name}`, kind: 'recursive' })
  }
  for (const c of Object.values(classes)) {
    for (const s of c.supers) if (has.has(`class:${s}`)) edges.push({ from: `class:${s}`, to: `class:${c.name}`, kind: 'super' })
    for (const i of c.instances) if (types[i.head]) edges.push({ from: `type:${i.head}`, to: `class:${c.name}`, kind: 'instance' })
  }
  for (const [cls, list] of Object.entries(instances)) for (const i of list) if (types[i.head] && has.has(`class:${cls}`)) edges.push({ from: `type:${i.head}`, to: `class:${cls}`, kind: 'instance' })
  return { nodes, edges }
}

const DERIVED_GROUP = { set: 'update', over: 'update' }

// Columns, left to right, by what feeds what: a node's inputs sit left of it.
const COLUMN = {
  param: 0, ctor: 1, type: 2, derived: 3,
  super: 0, fn: 0, method: 1, instance: 1, class: 2,
}
const COLUMN_GAP = 320
const ROW_GAP = 130

/**
 * Positions for every node of `graph`: `saved` ones (`{ [id]: { x, y } }`)
 * where kept, the rest laid out in columns by kind (a declaration graph) or
 * by depth along the edges (the universe), each column centred on y = 0.
 */
export function layoutGraph(graph, saved = {}, { universe = false } = {}) {
  const column = universe ? depths(graph) : new Map(graph.nodes.map((n) => [n.id, COLUMN[n.kind] ?? 0]))
  const byColumn = new Map()
  for (const n of graph.nodes) {
    const c = column.get(n.id)
    if (!byColumn.has(c)) byColumn.set(c, [])
    byColumn.get(c).push(n)
  }
  const out = {}
  for (const [c, list] of byColumn) {
    // A declaration's column keeps its own order (constructors, methods, instances by index).
    list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    list.forEach((n, i) => { out[n.id] = { x: c * COLUMN_GAP, y: (i - (list.length - 1) / 2) * ROW_GAP } })
  }
  const kept = new Set()
  for (const [id, at] of Object.entries(saved)) if (out[id] && Number.isFinite(at?.x) && Number.isFinite(at?.y)) { out[id] = { x: at.x, y: at.y }; kept.add(id) }
  // A node new since the layout was saved goes below the placed ones of its kind (a new constructor under the others).
  if (kept.size) {
    for (const n of graph.nodes) {
      if (kept.has(n.id)) continue
      const same = graph.nodes.filter((m) => m.kind === n.kind && kept.has(m.id))
      if (!same.length) continue
      const low = same.reduce((a, m) => (out[m.id].y > out[a.id].y ? m : a))
      out[n.id] = { x: out[low.id].x, y: out[low.id].y + ROW_GAP }
      kept.add(n.id)
    }
  }
  return out
}

// The longest path to each node (cycles — a recursive type — broken).
function depths(graph) {
  const into = new Map(graph.nodes.map((n) => [n.id, []]))
  for (const e of graph.edges) if (e.from !== e.to && into.has(e.to) && into.has(e.from)) into.get(e.to).push(e.from)
  const depth = new Map()
  const visit = (id, path) => {
    if (depth.has(id)) return depth.get(id)
    if (path.has(id)) return 0
    path.add(id)
    const d = Math.max(-1, ...into.get(id).map((from) => visit(from, path))) + 1
    path.delete(id)
    depth.set(id, d)
    return d
  }
  for (const n of graph.nodes) visit(n.id, new Set())
  return depth
}

/** Where a declaration's layout is kept in the project's `layouts`. */
export const layoutKey = (kind, name) => `${kind}:${name}`

/** A renamed node's saved position follows it (`{ [old id]: new id }`). */
export function renameLayout(layout = {}, renames) {
  return Object.fromEntries(Object.entries(layout).map(([id, at]) => [renames[id] ?? id, at]))
}

function typeNames(t, out) {
  if (!t) return out
  if (typeof t === 'string') { for (const m of t.match(/(?<![\w'])[A-Z][\w']*/g) || []) out.add(m); return out }
  if (t.kind === 'con') out.add(t.name)
  typeNames(t.fn, out); typeNames(t.arg, out); typeNames(t.from, out); typeNames(t.to, out)
  return out
}

// Ids by name (so a saved position finds its node again); a name used twice — an edit not valid yet — is told apart by its place.
function uniqueIds(ids) {
  const seen = new Map()
  return ids.map((id) => { const k = (seen.get(id) || 0) + 1; seen.set(id, k); return k > 1 ? `${id}#${k}` : id })
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const subscript = (n) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d])
