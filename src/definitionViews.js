// Read-only definition views: every function the editor didn't let you
// build — the builtins, the Prelude, the functions derived from a type
// declaration — shown as a graph, the same way a custom function's body is.
//
// A function that *can* be written in terms of more basic ones gets its
// definition as a real body graph (the lambda calculus, CLAUDE.md):
//
//   map f xs   = foldr (\f x acc -> apply f x : acc) f [] xs   (f captured)
//   length xs  = foldr (\x n -> n + 1) 0 xs
//   xs ++ ys   = foldr (:) ys xs
//   clicks m   = caseModel (\clicks perClick -> clicks) m       (a projection
//                 is the copairing applied to one product projection)
//   foldNat z s n = caseNat z (\z s m -> apply s (foldNat z s m)) n
//
// Anything else is a primitive of the language — a constructor (an
// injection ιⱼ of a coproduct of products), an eliminator (a copairing, or
// the recursor of an inductive type), a class method, or a runtime
// primitive — and its view is just its parameters applied to it, with a
// note saying which kind of primitive it is. Either way, the view's own
// definition carries the function's real type (`scheme`), so the header and
// the DEFINITION show exactly the type the editor uses.
//
// Views are pure data: `{ defs, bodies, viewId }`, in the same shape as
// main.js's `nodes` and `functionBodies`, never saved.
import { builtinSchemes, listOfScheme } from './builtinSchemes.js'
import { isOverridableId } from './evaluator.js'

/** The id of the view of function `defId` (of the list literal with `slots` elements). */
export const viewIdOf = (defId, slots = null) => `view:${defId}${slots === null ? '' : `/${slots}`}`

// Notes for primitives, by builtin name. Anything not listed (and not
// written as a graph below) is a runtime primitive.
const CONSTRUCTOR = (of) => `primitive · a constructor of ${of} (an injection into it)`
const METHOD = (cls) => `primitive · a method of the class ${cls}`
const PRIMITIVE_NOTES = {
  succ: 'primitive · the Church successor λn f x. f (n f x)',
  zero: 'primitive · the Church numeral λf x. x',
  apply: 'primitive · application itself: apply f x = f x',
  ifThenElse: 'primitive · the eliminator of Bool (Int-only, by design)',
  select: 'primitive · the eliminator of Bool: select c a b = if c then a else b',
  plus: METHOD('AddSemigroup'), negate: METHOD('AddGroup'), minus: METHOD('AddGroup'), times: METHOD('MulSemigroup'),
  addZero: METHOD('AddMonoid'), mulOne: METHOD('MulMonoid'), divide: METHOD('Field'), sqrt: METHOD('Transcendental'),
  toRational: METHOD('OrderedRing'), fromIntegral: 'primitive · the unique ring map ℤ → a (ℤ is the initial ring)', round: METHOD('OrderedField'),
  isNaN: METHOD('IEEEFloat'), geq: METHOD('Ord'), eq: METHOD('Eq'),
  nil: CONSTRUCTOR('[a]'), cons: CONSTRUCTOR('[a]'),
  foldr: 'primitive · the recursor of the inductive type [a] (its catamorphism)',
  nothing: CONSTRUCTOR('Maybe a'), just: CONSTRUCTOR('Maybe a'), maybe: 'primitive · the eliminator of Maybe a (a copairing)',
  pair: 'primitive · the pairing of the product (a, b)', fst: 'primitive · the first projection π₁ of the product (a, b)', snd: 'primitive · the second projection π₂ of the product (a, b)',
  mappend: METHOD('Semigroup'), mempty: METHOD('Monoid'), fmap: METHOD('Functor'), foldMap: METHOD('Foldable'),
  leq: METHOD('PartialOrd'), join: METHOD('Lattice'), meet: METHOD('Lattice'), scale: METHOD('VectorSpace'),
  mkSum: CONSTRUCTOR('Sum a'), getSum: 'primitive · the field of the newtype Sum a', mkProduct: CONSTRUCTOR('Product a'), getProduct: 'primitive · the field of the newtype Product a',
  mkEndo: CONSTRUCTOR('Endo a'), appEndo: 'primitive · the field of the newtype Endo a, applied',
  program: CONSTRUCTOR('Program m e'), setStepsPerSecond: 'primitive · a record update of Program m e', setMaxOffline: 'primitive · a record update of Program m e', setSubscriptions: 'primitive · a record update of Program m e',
  every: CONSTRUCTOR('Sub e'), onKey: CONSTRUCTOR('Sub e'),
  wText: CONSTRUCTOR('Widget e'), wButton: CONSTRUCTOR('Widget e'), wColumn: CONSTRUCTOR('Widget e'), wRow: CONSTRUCTOR('Widget e'), wProgress: CONSTRUCTOR('Widget e'), wHeading: CONSTRUCTOR('Widget e'), wSpacer: CONSTRUCTOR('Widget e'), wColor: CONSTRUCTOR('Widget e'), wDrawing: CONSTRUCTOR('Widget e'),
  pCircle: CONSTRUCTOR('Picture'), pCircleSolid: CONSTRUCTOR('Picture'), pRectangleSolid: CONSTRUCTOR('Picture'), pTranslate: CONSTRUCTOR('Picture'), pColor: CONSTRUCTOR('Picture'), rgb: CONSTRUCTOR('Color'),
}

// The functions written as graphs, by builtin name. Each gets a builder
// (see `graph` below) and returns the node feeding Output.
const COLOURS = { red: ['1', '0', '0'], green: ['0', '0.7', '0'], blue: ['0', '0', '1'], yellow: ['1', '0.85', '0'], black: ['0', '0', '0'], white: ['1', '1', '1'] }
const GRAPHS = {
  // [x₁, …, xₙ] = x₁ : … : xₙ : [] — syntax for the constructors of [a]
  listOf: (g, n) => Array.from({ length: n }, (_, i) => i).reduceRight((tail, i) => g.call('prelude:cons', [g.param(i), tail]), g.call('prelude:nil', [])),
  identity: (g) => g.param(0),
  // compose f g x = f (g x) — application made explicit
  compose: (g) => g.call('apply', [g.param(0), g.call('apply', [g.param(1), g.param(2)])]),
  isZero: (g) => g.call('eq', [g.param(0), { lit: '0' }]),
  map: (g) => g.call('prelude:foldr', [
    g.lambda(['f', 'x', 'acc'], (l) => l.call('prelude:cons', [l.call('apply', [l.param(0), l.param(1)]), l.param(2)]), [g.param(0)]),
    g.call('prelude:nil', []),
    g.param(1),
  ]),
  length: (g) => g.call('prelude:foldr', [g.lambda(['x', 'n'], (l) => l.call('plus', [l.param(1), { lit: '1' }])), { lit: '0' }, g.param(0)]),
  append: (g) => g.call('prelude:foldr', [g.call('prelude:cons', [null, null]), g.param(1), g.param(0)]),
  mconcat: (g) => g.call('prelude:foldr', [g.call('prelude:mappend', [null, null]), g.call('prelude:mempty', []), g.param(0)]),
  // xs !? i = foldr (\x r k -> select (k == 0) (Just x) (apply r (k - 1))) (\k -> Nothing) xs `apply` i
  index: (g) => g.call('apply', [
    g.call('prelude:foldr', [
      g.lambda(['x', 'r', 'k'], (l) => l.call('select', [
        l.call('eq', [l.param(2), { lit: '0' }]),
        l.call('prelude:just', [l.param(0)]),
        l.call('apply', [l.param(1), l.call('minus', [l.param(2), { lit: '1' }])]),
      ])),
      g.lambda(['k'], (l) => l.call('prelude:nothing', [])),
      g.param(0),
    ]),
    g.param(1),
  ]),
  ...Object.fromEntries(Object.entries(COLOURS).map(([name, rgb]) => [name, (g) => g.call('prelude:rgb', rgb.map((lit) => ({ lit })))])),
}

/**
 * The view of definition `def` (a builtin node, a Prelude definition or a
 * derived one). `resolve(id)` looks up any definition by id (for callee
 * labels and slot counts); `slots` is the element count of a list literal
 * (its definition depends on it). Returns `{ viewId, defs, bodies }`.
 */
export function buildDefinitionView(def, resolve, { slots = 0 } = {}) {
  const variadic = def.builtin === 'listOf'
  const viewId = viewIdOf(def.id, variadic ? slots : null)
  const params = variadic ? Array.from({ length: slots }, (_, i) => `x${i + 1}`) : paramNames(def)
  const defs = {}
  const bodies = {}
  const scheme = def.scheme || (def.builtin === 'listOf' ? listOfScheme(params.length) : builtinSchemes[def.builtin])
  const view = { id: viewId, type: 'function', label: def.label, params: [...params], mounted: params.map(() => null), paramScopes: params.map(() => 'local'), readonly: true, view: def.id, scheme, color: def.color }
  defs[viewId] = view
  const g = graph(viewId, params, resolve, defs, bodies)
  const written = def.derived ? derivedGraph(def, g, resolve) : GRAPHS[def.builtin]
  let root
  if (written) root = typeof written === 'function' ? written(g, params.length) : written
  else {
    // A primitive: its parameters applied to it.
    root = g.call(def.id, params.map((_, i) => g.param(i)))
    view.note = def.derived ? derivedNote(def) : PRIMITIVE_NOTES[def.builtin] || 'primitive · built into the runtime'
  }
  if (variadic) view.note = 'syntax · a list literal is sugar for the constructors (:) and []'
  g.output(root)
  return { viewId, defs, bodies }
}

function paramNames(def) {
  const raw = def.derived ? def.params : (def.params || [])
  const used = new Set()
  return raw.map((p, i) => {
    let name = /^[a-z_][A-Za-z0-9_']*$/.test(p) ? p : `x${i + 1}`
    while (used.has(name)) name = `${name}'`
    used.add(name)
    return name
  })
}

function derivedNote(def) {
  const d = def.derived
  if (d.op === 'construct') return `primitive · a constructor of ${d.type} (the injection of a product of its fields)`
  if (d.op === 'case') return `primitive · the eliminator of ${d.type}: the copairing of one function per constructor`
  return `primitive · derived from ${d.type}`
}

// Projections, updates and the recursor of a declared type, written with
// its eliminator caseT (and, for foldT, recursion).
function derivedGraph(def, g, resolve) {
  const d = def.derived
  const caseId = `type:${d.type}:case${d.type}`
  const caseDef = resolve(caseId)
  if (!caseDef) return null
  if (d.op === 'get' || d.op === 'set' || d.op === 'over') {
    const ctor = resolve(`type:${d.type}:${d.ctor}`)
    const fields = fieldNames(ctor, d.op === 'get' ? [] : [d.op === 'set' ? def.params[0] : 'f'])
    const scrutinee = g.param(d.op === 'get' ? 0 : 1)
    const branch = d.op === 'get'
      ? g.lambda(fields, (l) => l.param(d.fieldIndex))
      : g.lambda([fields.captured, ...fields], (l) => l.call(ctor.id, fields.map((_, i) => {
        if (i !== d.fieldIndex) return l.param(i + 1)
        return d.op === 'set' ? l.param(0) : l.call('apply', [l.param(0), l.param(i + 1)])
      })), [g.param(0)])
    return () => g.call(caseId, [branch, scrutinee])
  }
  if (d.op === 'fold') {
    const n = d.arities.length
    const branches = Array.from({ length: n }, (_, i) => i)
    return () => g.call(caseId, [...branches.map((c) => {
      if (!d.arities[c]) return g.param(c)
      const ctor = resolve(`type:${d.type}:${caseDef.params[c] ? ctorNameAt(resolve, d.type, c) : ''}`)
      const branchNames = def.params.slice(0, n)
      const fields = fieldNames(ctor, branchNames)
      // \b₁ … bₙ x₁ … xₖ -> apply (… (apply bc y₁) …) yₖ, with yᵢ = foldT b₁ … bₙ xᵢ for a recursive field
      return g.lambda([...branchNames, ...fields], (l) => {
        let acc = l.param(c)
        fields.forEach((_, i) => {
          const field = d.recursive[c][i] ? l.call(def.id, [...branchNames.map((__, b) => l.param(b)), l.param(n + i)]) : l.param(n + i)
          acc = l.call('apply', [acc, field])
        })
        return acc
      }, branchNames.map((_, b) => g.param(b)))
    }), g.param(n)])
  }
  return null
}

function ctorNameAt(resolve, type, index) {
  const caseDef = resolve(`type:${type}:case${type}`)
  // caseT's branch parameters are the constructors' names, lowercased (typeDecls.js).
  const lower = caseDef.params[index]
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

// A constructor's field names as λ binders, clear of `taken`.
function fieldNames(ctor, taken) {
  const used = new Set(taken)
  const names = (ctor?.params || []).map((p, i) => {
    let name = /^[a-z_][A-Za-z0-9_']*$/.test(p) ? p : `x${i + 1}`
    while (used.has(name)) name = `${name}'`
    used.add(name)
    return name
  })
  let captured = taken[0] || 'v'
  names.captured = captured
  return names
}

/**
 * A little builder for a body graph `fnId` with parameters `params`:
 * `param(i)` uses a parameter (a second use is a reference to it — the
 * diagonal Δ), `call(id, args)` adds a call node with `args` plugged into its
 * slots (a node id, `{ lit }` for an inline literal, or null for an open
 * slot), `lambda(params, build, captures)` adds a λ — a lambda-lifted
 * function, its first slots filled with `captures` — and `output(id)` feeds
 * Output. Every plugged node is unfolded, so the whole term is on the canvas.
 */
function graph(fnId, params, resolve, defs, bodies) {
  const body = {}
  bodies[fnId] = body
  let k = 0
  const fresh = (kind) => `${kind}-${++k}`
  const used = new Set()
  params.forEach((name, i) => { body[`input-${fnId}-${i}`] = { id: `input-${fnId}-${i}`, type: 'parameter', label: name, value: name, color: '#4f8ef7', x: 0, y: 0 } })
  const paramIds = params.map((_, i) => `input-${fnId}-${i}`)
  const use = (id) => {
    if (!used.has(id)) { used.add(id); return id }
    const ref = fresh('ref')
    body[ref] = { id: ref, type: 'ref', target: id, label: `↪ ${body[id].label}`, x: 0, y: 0 }
    return ref
  }
  const plug = (host, args) => args.forEach((arg, i) => {
    if (arg && typeof arg === 'object') { host.params[i] = arg.lit; return }
    if (!arg) return
    const child = body[arg]
    host.mounted[i] = arg
    host.params[i] = child.label
    Object.assign(child, { mountedTo: `${host.id}:${i}`, connected: true, unfolded: true })
  })
  const api = {
    param: (i) => use(paramIds[i]),
    call(defId, args) {
      const callee = resolve(defId) || defs[defId]
      const slots = callee?.builtin === 'listOf' ? args.length : (callee?.params || args).length
      const id = fresh('call')
      body[id] = { id, type: 'function', sourceFunctionId: defId, label: callee?.label ?? defId, params: Array(slots).fill(''), mounted: Array(slots).fill(null), paramScopes: Array(slots).fill('local'), scope: 'local', color: callee?.color || '#5fa8e8', x: 0, y: 0 }
      plug(body[id], args)
      used.add(id)
      return id
    },
    lambda(names, build, captures = []) {
      const lamId = `${fnId}/λ${Object.keys(defs).length}`
      defs[lamId] = { id: lamId, type: 'function', label: 'λ', params: [...names], mounted: names.map(() => null), paramScopes: names.map(() => 'local'), scope: 'local', color: '#8b7cf2', custom: true, lambda: true, readonly: true }
      const inner = graph(lamId, names, resolve, defs, bodies)
      inner.output(build(inner))
      const id = fresh('call')
      body[id] = { id, type: 'function', sourceFunctionId: lamId, label: 'λ', params: names.map(() => ''), mounted: names.map(() => null), paramScopes: names.map(() => 'local'), scope: 'local', color: '#8b7cf2', x: 0, y: 0 }
      plug(body[id], captures)
      used.add(id)
      return id
    },
    output(id) {
      body.output = { id: 'output', type: 'output', label: 'Output', value: id ? body[id].label : 'open', source: id || null, color: '#2fbf8f', x: 0, y: 0 }
      if (id) body[id].connected = true
    },
  }
  return api
}

/**
 * Whether the view `viewId` (in `defs`) can be turned into an edited
 * definition: a library function written as a graph. A primitive's view is
 * the primitive applied to its parameters — there is nothing to edit — and
 * the builtins on the main canvas (the protected ones of CLAUDE.md, the
 * class methods) are never overridden.
 */
export function isEditableView(viewId, defs) {
  const view = defs[viewId]
  return Boolean(view && !view.note && isOverridableId(view.view))
}

/**
 * The view `viewId` turned into an edited definition of the function it
 * shows: `{ body, lambdas, lambdaBodies }` — the body (header and signature
 * included, positions kept) to store under the function's own id, and its
 * λs as ordinary editable λs with ids `<function id>/λn`. Everything is a
 * fresh copy.
 */
export function overrideFromView(viewId, defs, bodies) {
  const defId = defs[viewId].view
  const lambdaIds = Object.keys(defs).filter((id) => id.startsWith(`${viewId}/λ`))
  const rename = new Map([[viewId, defId], ...lambdaIds.map((id, i) => [id, `${defId}/λ${i + 1}`])])
  const copy = (body, fnId) => {
    const out = structuredClone(body)
    for (const n of Object.values(out)) {
      if (n.sourceFunctionId && rename.has(n.sourceFunctionId)) n.sourceFunctionId = rename.get(n.sourceFunctionId)
      if (n.type === 'header') n.fn = fnId
    }
    return out
  }
  const lambdas = {}
  const lambdaBodies = {}
  for (const id of lambdaIds) {
    const to = rename.get(id)
    const { readonly, ...def } = defs[id]
    lambdas[to] = { ...structuredClone(def), id: to, x: -9999, y: -9999 }
    lambdaBodies[to] = copy(bodies[id], to)
  }
  return { body: copy(bodies[viewId], defId), lambdas, lambdaBodies }
}
