// A derived instance written out as graphs. `deriving (Eq, Show)` makes
// methods the evaluator runs structurally; to change one, the instance is
// turned into a hand-written one (typeDecls.js) whose methods are custom
// functions — and those functions start as exactly what deriving did, as
// node graphs the user can then edit:
//
//   eq x y   = clicks x == clicks y && rate x == rate y            -- a record: its projections πᵢ
//   eq x y   = caseShape (\r -> caseShape (\r' -> r == r') (\_ _ -> False) y) … x
//                                                                  -- otherwise: the copairing and λs
//   geq      = lexicographic, constructors in declaration order
//   show x   = "Model {clicks = " ++ show (clicks x) ++ … ++ "}"   -- positional fields: showsPrec 11
//   plus x y = Model (clicks x + clicks y) (rate x + rate y)       -- the pointwise structures (anyclass,
//   addZero  = Model addZero addZero                               --   via Generically, newtype): the
//   k *^ v   = Model (k *^ clicks v) (k *^ rate v)                 --   product of the fields' structures
//
// Each is a real graph, not a folded expression: every application is its own
// node with its arguments wired into its slots and unfolded onto the canvas
// (an expression tree read right to left, Output last), a parameter used
// again is shared through references (Δ), and a λ's body is a graph too.
// Projections and the copairing are the type's derived functions — their
// primitives (`clicks#`) where the user has customized them, since deriving
// means the structural meaning. λs are lambda-lifted hidden functions, as the
// editor makes them (captured values in their leading slots).
import { CLASS_METHODS, METHOD_LABEL, METHOD_PARAMS } from './classMethods.js'
import { PRIM_PREFIX, primLabel, shape } from './typeEdits.js'

// Where each method or helper a generated graph calls lives, and its label.
const CALLEE = {
  and: 'prelude:and', eq: 'eq', geq: 'geq', plus: 'plus', negate: 'negate', times: 'times', addZero: 'addZero', mulOne: 'mulOne', divide: 'divide', select: 'select',
  show: 'prelude:show', showsPrec: 'prelude:showsPrec', append: 'prelude:append', mappend: 'prelude:mappend', mempty: 'prelude:mempty',
  leq: 'prelude:leq', join: 'prelude:join', meet: 'prelude:meet', scale: 'prelude:scale',
}
const LABEL = { ...METHOD_LABEL, and: '(&&)', select: 'select', showsPrec: 'showsPrec', append: '(++)' }

// How each method is derived: compared field by field (`all`, combined with
// &&), ordered lexicographically, shown, or a pointwise operation of some
// arity (`k` for scale: a scalar first).
const SHAPE = {
  eq: 'all', leq: 'all', geq: 'lex', show: 'show',
  plus: 'binary', times: 'binary', divide: 'binary', mappend: 'binary', join: 'binary', meet: 'binary',
  negate: 'unary', scale: 'scalar', addZero: 'nullary', mulOne: 'nullary', mempty: 'nullary',
}

/** The classes of declaration `d` whose derived instance can be written out as graphs: `[{ cls, strategy }]`. */
export function graphableDerivings(d) {
  return d.deriving.flatMap((c) => c.classes.filter((cls) => CLASS_METHODS[cls]?.length && CLASS_METHODS[cls].every((m) => SHAPE[m])).map((cls) => ({ cls, strategy: c.strategy })))
}

/**
 * Builds one function body. Values are node ids or `{ lit }` (inline slot
 * text). A node used more than once is used again through a reference (Δ).
 */
function bodyBuilder(fnId, paramNames) {
  const graph = {}
  let k = 0
  const params = paramNames.map((name, i) => {
    const id = `input-${fnId}-${i}`
    graph[id] = { id, type: 'parameter', label: name, value: name, color: '#4f8ef7' }
    return id
  })
  const used = new Set()
  const use = (v) => {
    if (typeof v !== 'string') return v
    if (!used.has(v)) { used.add(v); return v }
    const id = `ref-${++k}`
    graph[id] = { id, type: 'ref', target: v, label: `↪ ${graph[v].label}` }
    return id
  }
  const call = (callee, label, slots, color = '#5fa8e8') => {
    const id = `n-${++k}`
    const vs = slots.map((s) => (s === null ? null : use(s)))
    graph[id] = {
      id, type: 'function', sourceFunctionId: callee, label, scope: 'local', color,
      params: vs.map((v) => (v && typeof v === 'object' ? v.lit : '')),
      mounted: vs.map((v) => (typeof v === 'string' ? v : null)),
      paramScopes: vs.map(() => 'local'),
    }
    return id
  }
  const finish = (v) => {
    let source = use(v)
    if (typeof v !== 'string') {
      // A constant result: a Bool or text node.
      source = `n-${++k}`
      graph[source] = /^(True|False)$/.test(v.lit)
        ? { id: source, type: 'boolean', typeName: 'Bool', label: v.lit, value: v.lit === 'True' ? 'true' : 'false', color: '#ed6b84' }
        : { id: source, type: 'text', label: 'text', value: v.lit.slice(1, -1), color: '#e8b23c' }
    }
    graph.output = { id: 'output', type: 'output', label: 'Output', value: 'ƒ', color: '#2fbf8f', source }
    layout(graph)
    return graph
  }
  return { params, call, finish }
}

// Every node plugged into a slot is unfolded: drawn on the canvas with a
// link into its slot. A rough tree layout (arguments to the left of the call
// using them, each subtree in its own band) — the editor lays it out again
// with the real block widths (main.js's layoutTree).
const ROW = 140
const COLUMN = 300
function layout(graph) {
  const kids = (n) => (n.mounted || []).filter((m) => m && graph[m]).map((m) => graph[m])
  const height = (n) => Math.max(ROW, kids(n).reduce((sum, k) => sum + height(k), 0))
  const place = (n, x, top) => {
    n.x = x
    n.y = top + height(n) / 2
    let y = top
    kids(n).forEach((k) => {
      k.mountedTo = `${n.id}:${n.mounted.indexOf(k.id)}`
      k.connected = true
      k.unfolded = true
      place(k, x - COLUMN, y)
      y += height(k)
    })
  }
  const root = graph[graph.output.source]
  const depth = (n) => 1 + Math.max(0, ...kids(n).map(depth))
  const rootX = 110 + COLUMN * ((root ? depth(root) : 1) - 1)
  if (root) { place(root, rootX, 0); root.connected = true }
  Object.assign(graph.output, { x: rootX + COLUMN + 120, y: root ? root.y : 255 })
  // Anything not in the tree (an unused parameter) goes below it.
  let y = (root ? height(root) : 0) + ROW
  for (const n of Object.values(graph)) if (n.x === undefined) { n.x = 110; n.y = y; y += ROW }
}

/**
 * Derived instance `cls` of declaration `d` as custom functions, one per
 * method, plus the λs they use. `opts`:
 *   - `newId(hint)`: a fresh function id
 *   - `label(method)`: the name for the method's function (`eqModel`)
 *   - `customized(id)`: whether derived function `id` has been redefined
 * Returns `{ functions: [{ node, body }], methods: { method: fnId } }`;
 * the method functions are ordinary custom functions (placed by the
 * caller), the λs hidden ones.
 */
export function instanceGraphs(d, cls, opts) {
  const functions = [] // the λs
  const methodFunctions = []
  const methods = {}
  const T = d.name
  const derivedCall = (b, label, slots) => {
    const id = `type:${T}:${label}`
    return opts.customized?.(id) ? b.call(PRIM_PREFIX + id, primLabel(label), slots, '#3cbe9e') : b.call(id, label, slots, '#3cbe9e')
  }
  const builtin = (b, name, slots) => b.call(CALLEE[name], LABEL[name], slots)
  const record = d.constructors.length === 1 && d.constructors[0].record
  const names = (c, side) => c.fields.map((f, i) => (f.name ? `${f.name}${side ? "'" : ''}` : `${side ? 'y' : 'x'}${i + 1}`))

  // A λ with parameters `paramNames` whose body `build(b, params)` makes: returns its id.
  const lambda = (paramNames, build) => {
    const id = opts.newId('lambda')
    const b = bodyBuilder(id, paramNames)
    const body = b.finish(build(b, b.params))
    functions.push({ node: { id, type: 'function', label: 'λ', params: [...paramNames], mounted: paramNames.map(() => null), paramScopes: paramNames.map(() => 'local'), scope: 'local', color: '#8b7cf2', custom: true, lambda: true, x: -9999, y: -9999 }, body })
    return id
  }
  // Call λ `id` with `captured` in its leading slots and `open` more slots left open.
  const callLambda = (b, id, captured, open) => b.call(id, 'λ', [...captured, ...Array(open).fill(null)], '#8b7cf2')
  const caseOf = (b, branches, scrutinee) => derivedCall(b, `case${T}`, [...branches, scrutinee])

  const all = (b, m, xs, ys) => {
    if (!xs.length) return { lit: 'True' }
    return xs.slice(0, -1).reduceRight((acc, x, l) => builtin(b, 'and', [builtin(b, m, [x, ys[l]]), acc]), builtin(b, m, [xs.at(-1), ys.at(-1)]))
  }
  const lex = (b, xs, ys) => {
    if (!xs.length) return { lit: 'True' }
    return xs.slice(0, -1).reduceRight((acc, x, l) => builtin(b, 'select', [builtin(b, 'eq', [x, ys[l]]), acc, builtin(b, 'geq', [x, ys[l]])]), builtin(b, 'geq', [xs.at(-1), ys.at(-1)]))
  }
  const showCtor = (b, c, xs) => {
    if (!xs.length) return { lit: `"${c.name}"` }
    const parts = c.record
      ? xs.flatMap((x, l) => [{ lit: `"${l ? ', ' : `${c.name} {`}${c.fields[l].name} = "` }, builtin(b, 'show', [x])]).concat({ lit: '"}"' })
      : xs.flatMap((x, l) => [{ lit: l ? '" "' : `"${c.name} "` }, builtin(b, 'showsPrec', [{ lit: '11' }, x])])
    return parts.slice(0, -1).reduceRight((acc, p) => builtin(b, 'append', [p, acc]), parts.at(-1))
  }
  const pointwise = (b, m, c, ...sides) => derivedCall(b, c.name, sides[0].map((_, l) => builtin(b, m, sides.map((s) => s[l]))))

  // What the method is on constructor i's fields `xs` (and j's `ys`, when j is
  // i); for different constructors, the comparison's answer.
  const match = (m, b, i, xs, ys, extra) => {
    const c = d.constructors[i]
    switch (SHAPE[m]) {
      case 'all': return all(b, m, xs, ys)
      case 'lex': return lex(b, xs, ys)
      case 'show': return showCtor(b, c, xs)
      case 'binary': return pointwise(b, m, c, xs, ys)
      case 'unary': return pointwise(b, m, c, xs)
      case 'scalar': return pointwise(b, m, c, xs.map(() => extra[0]), xs)
    }
    throw new Error(`no derived shape for ${m}`)
  }
  const mismatch = (m, i, j) => ({ lit: SHAPE[m] === 'lex' ? (i > j ? 'True' : 'False') : 'False' })

  for (const m of CLASS_METHODS[cls]) {
    const params = SHAPE[m] === 'nullary' ? [] : METHOD_PARAMS[m]
    const fnId = opts.newId(m)
    const b = bodyBuilder(fnId, params)
    const p = b.params
    let result
    if (SHAPE[m] === 'nullary') {
      result = derivedCall(b, d.constructors[0].name, d.constructors[0].fields.map(() => builtin(b, m, [])))
    } else if (record) {
      // A record: take each field by its projection.
      const c = d.constructors[0]
      const project = (v) => c.fields.map((f) => derivedCall(b, f.name, [v]))
      const binary = ['all', 'lex', 'binary'].includes(SHAPE[m])
      if (SHAPE[m] === 'scalar') result = match(m, b, 0, project(p[1]), null, [p[0]])
      else result = match(m, b, 0, project(p[0]), binary ? project(p[1]) : null)
    } else if (['all', 'lex', 'binary'].includes(SHAPE[m])) {
      // Take x apart, then y; equal constructors compare their fields.
      const [x, y] = p
      const inner = (s, i, xs, yv) => caseOf(s, d.constructors.map((cj, j) => {
        const ys = names(cj, 1)
        if (!ys.length) return i === j ? match(m, s, i, xs, []) : mismatch(m, i, j)
        if (i !== j) return callLambda(s, lambda(ys, () => mismatch(m, i, j)), [], ys.length)
        return callLambda(s, lambda([...names(d.constructors[i], 0), ...ys], (lb, lp) => match(m, lb, i, lp.slice(0, xs.length), lp.slice(xs.length))), xs, ys.length)
      }), yv)
      result = caseOf(b, d.constructors.map((ci, i) => {
        const xs = names(ci, 0)
        if (!xs.length) return inner(b, i, [], y)
        return callLambda(b, lambda(['y', ...xs], (lb, lp) => inner(lb, i, lp.slice(1), lp[0])), [y], xs.length)
      }), x)
    } else {
      // One value taken apart (a scalar, if any, captured first).
      const extra = SHAPE[m] === 'scalar' ? [p[0]] : []
      const v = p.at(-1)
      result = caseOf(b, d.constructors.map((ci, i) => {
        const xs = names(ci, 0)
        if (!xs.length) return match(m, b, i, [], null, extra)
        const extraNames = extra.length ? [METHOD_PARAMS[m][0]] : []
        return callLambda(b, lambda([...extraNames, ...xs], (lb, lp) => match(m, lb, i, lp.slice(extra.length), null, lp.slice(0, extra.length))), extra, xs.length)
      }), v)
    }
    const body = b.finish(result)
    methodFunctions.push({ node: { id: fnId, type: 'function', label: opts.label(m), params: [...params], mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true }, body })
    methods[m] = fnId
  }
  return { functions: [...methodFunctions, ...functions], methods }
}

/** The λs custom function `fnId` uses (its own and theirs, nested). */
export function lambdasOf(nodes, functionBodies, fnId, found = new Set()) {
  for (const n of Object.values(functionBodies[fnId] || {})) {
    const callee = n.sourceFunctionId
    if (callee && nodes[callee]?.lambda && !found.has(callee)) {
      found.add(callee)
      lambdasOf(nodes, functionBodies, callee, found)
    }
  }
  return found
}

/**
 * A short fingerprint of what function `fnId` means — its body and its λs'
 * bodies, without layout — to tell later whether the user changed it.
 */
export function graphFingerprint(nodes, functionBodies, fnId) {
  const text = [fnId, ...[...lambdasOf(nodes, functionBodies, fnId)].sort()].map((id) => `${id}=${shape(functionBodies[id] || {})}`).join('|')
  let h = 0x811c9dc5 // FNV-1a
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16)
}
