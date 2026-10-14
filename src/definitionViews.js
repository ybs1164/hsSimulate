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
// definition carries the function's real type (`scheme`), so the signature and
// the DEFINITION show exactly the type the editor uses.
//
// Views are pure data: `{ defs, bodies, viewId }`, in the same shape as
// main.js's `nodes` and `functionBodies`, never saved.
//
// A Prelude function written as a graph can be taken over: its view becomes
// a custom function under the Prelude id (overrideFromView), which shadows
// the library definition the way a customized derived function does
// (typeEdits.js) — every call runs it.
import { builtinSchemes, listOfScheme } from './builtinSchemes.js'
import { typeText } from './typeExpr.js'

/** Library definitions that can be taken over as graphs: the Prelude's (derived ones are customized through typeEdits.js). */
export const isEditableLibraryId = (id) => /^prelude:/.test(id)

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
  showsPrec: 'primitive · a method of the class Show: rendering a value as text at a precedence',
  plus: METHOD('AddSemigroup'), negate: METHOD('AddGroup'), minus: METHOD('AddGroup'), times: METHOD('MulSemigroup'),
  addZero: METHOD('AddMonoid'), mulOne: METHOD('MulMonoid'), divide: METHOD('Field'), sqrt: METHOD('Transcendental'),
  toRational: METHOD('OrderedRing'),
  fromInteger: 'primitive · the unique ring map ℤ → a (ℤ is the initial ring), fixed by the Ring dictionary of a',
  toInteger: 'primitive · a method of the class EuclideanRing: the embedding of an integral type in ℤ',
  fromRational: 'primitive · the unique field map ℚ → a, fixed by the Field dictionary of a', properFraction: 'primitive · a method of the class OrderedField: x = n + r with n integral and r between -1 and 1, of the sign of x',
  div: 'primitive · a method of the class EuclideanRing: the quotient, rounded down', mod: 'primitive · a method of the class EuclideanRing: the remainder of div, of the sign of the divisor',
  geq: METHOD('Ord'), eq: METHOD('Eq'), neq: METHOD('Eq'), compare: METHOD('Ord'), le: METHOD('Ord'), lt: METHOD('Ord'), gt: METHOD('Ord'), max: METHOD('Ord'), min: METHOD('Ord'),
  traverse: METHOD('Traversable'), pure: METHOD('Applicative'), ap: METHOD('Applicative'), bind: METHOD('Monad'),
  nil: CONSTRUCTOR('[a]'), cons: CONSTRUCTOR('[a]'),
  foldr: 'primitive · the recursor of the inductive type [a] (its catamorphism)',
  nothing: CONSTRUCTOR('Maybe a'), just: CONSTRUCTOR('Maybe a'),
  pair: 'primitive · the pairing of the product (a, b)', fst: 'primitive · the first projection π₁ of the product (a, b)', snd: 'primitive · the second projection π₂ of the product (a, b)',
  mappend: METHOD('Semigroup'), mempty: METHOD('Monoid'), fmap: METHOD('Functor'), foldMap: METHOD('Foldable'),
  leq: METHOD('PartialOrd'), join: METHOD('Lattice'), meet: METHOD('Lattice'), scale: METHOD('VectorSpace'),
  show: METHOD('Show'), showFFloat: 'primitive · decimal rendering of a floating-point number', showCompact: 'primitive · compact rendering of a number (1.2K, 3.4M)',
  mkStdGen: 'primitive · a random generator from a seed', randomR: 'primitive · a uniform random number in a range, and the next generator', randomRInt: 'primitive · a uniform random integer in a range, and the next generator',
}

// A Prelude function that is a constructor of a Prelude type under another
// name (`text s = Text s`, a smart constructor), or a record update of a
// Program written with its eliminator (src/library.js declares the types).
const viaConstructor = (type, ctor) => (g, n) => g.call(`type:${type}:${ctor}`, Array.from({ length: n }, (_, i) => g.param(i)))
const PROGRAM_FIELDS = ['initial', 'view', 'handle', 'step', 'stepsPerSecond', 'maxOffline', 'subscriptions']
// set field new p = caseProgram (\new initial view … -> Program initial … new …) p
const setProgramField = (index) => (g) => g.call('type:Program:caseProgram', [
  g.lambda(['new', ...PROGRAM_FIELDS], (l) => l.call('type:Program:Program', PROGRAM_FIELDS.map((_, i) => l.param(i === index ? 0 : i + 1))), [g.param(0)]),
  g.param(1),
])
// The integral and fractional parts of x — (n, r) = properFraction x — as
// nodes of `g`, each usable once more through g.ref.
const fraction = (g) => {
  const p = g.named(g.call('prelude:properFraction', [g.param(0)]), 'p')
  return [g.named(g.call('prelude:fst', [p]), 'n'), g.named(g.call('prelude:snd', [g.ref(p)]), 'r')]
}
const COLOURS = { red: ['1', '0', '0'], green: ['0', '0.7', '0'], blue: ['0', '0', '1'], yellow: ['1', '0.85', '0'], black: ['0', '0', '0'], white: ['1', '1', '1'] }
// The functions written as graphs, by builtin name. Each gets a builder
// (see `graph` below) and returns the node feeding Output.
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
  // The numeric conversions, as the Haskell Report defines them.
  // fromIntegral x = fromInteger (toInteger x)
  fromIntegral: (g) => g.call('prelude:fromInteger', [g.call('prelude:toInteger', [g.param(0)])]),
  // realToFrac x = fromRational (toRational x)
  realToFrac: (g) => g.call('prelude:fromRational', [g.call('toRational', [g.param(0)])]),
  // abs x = select (x >= 0) x (negate x)
  abs: (g) => g.call('select', [g.call('geq', [g.param(0), { lit: '0' }]), g.param(0), g.call('negate', [g.param(0)])]),
  // truncate x = fst (properFraction x)
  truncate: (g) => g.call('prelude:fst', [g.call('prelude:properFraction', [g.param(0)])]),
  // floor x = select (r >= 0) n (n - 1)   where p = properFraction x; n = fst p; r = snd p
  floor: (g) => {
    const [n, r] = fraction(g)
    return g.call('select', [g.call('geq', [r, { lit: '0' }]), n, g.call('minus', [g.ref(n), { lit: '1' }])])
  },
  // ceiling x = select (0 >= r) n (n + 1)
  ceiling: (g) => {
    const [n, r] = fraction(g)
    return g.call('select', [g.call('geq', [{ lit: '0' }, r]), n, g.call('plus', [g.ref(n), { lit: '1' }])])
  },
  // round x: to the nearer of n and m (the integer on r's side), and on a
  // half to the even one —
  //   select (a == 0.5) (select (n `mod` 2 == 0) n m) (select (a >= 0.5) m n)
  //   where (n, r) = properFraction x; a = abs r; m = select (r >= 0) (n + 1) (n - 1)
  round: (g) => {
    const [n, r] = fraction(g)
    const m = g.named(g.call('select', [g.call('geq', [r, { lit: '0' }]), g.call('plus', [n, { lit: '1' }]), g.call('minus', [g.ref(n), { lit: '1' }])]), 'm')
    const a = g.named(g.call('prelude:abs', [g.ref(r)]), 'a')
    const even = g.call('eq', [g.call('prelude:mod', [g.ref(n), { lit: '2' }]), { lit: '0' }])
    return g.call('select', [
      g.call('eq', [a, { lit: '0.5' }]),
      g.call('select', [even, g.ref(n), m]),
      g.call('select', [g.call('geq', [g.ref(a), { lit: '0.5' }]), g.ref(m), g.ref(n)]),
    ])
  },
  // Bool = 1 + 1: (&&), (||) and not are copairings of it — select is its eliminator.
  and: (g) => g.call('select', [g.param(0), g.param(1), { lit: 'False' }]),
  or: (g) => g.call('select', [g.param(0), { lit: 'True' }, g.param(1)]),
  not: (g) => g.call('select', [g.param(0), { lit: 'False' }, { lit: 'True' }]),
  maybe: (g) => g.call('type:Maybe:caseMaybe', [g.param(0), g.param(1), g.param(2)]),
  // program initial view handle step = Program initial view handle step 10 604800 (\model -> mempty)
  program: (g) => g.call('type:Program:Program', [g.param(0), g.param(1), g.param(2), g.param(3), { lit: '10' }, { lit: '604800' }, g.lambda(['model'], (l) => l.call('prelude:mempty', []))]),
  setStepsPerSecond: setProgramField(4),
  setMaxOffline: setProgramField(5),
  setSubscriptions: setProgramField(6),
  every: viaConstructor('Sub', 'Every'),
  onKey: viaConstructor('Sub', 'OnKey'),
  wText: viaConstructor('Widget', 'Text'), wButton: viaConstructor('Widget', 'Button'), wColumn: viaConstructor('Widget', 'Column'), wRow: viaConstructor('Widget', 'Row'),
  wProgress: viaConstructor('Widget', 'Progress'), wHeading: viaConstructor('Widget', 'Heading'), wSpacer: viaConstructor('Widget', 'Spacer'), wColor: viaConstructor('Widget', 'Tinted'), wDrawing: viaConstructor('Widget', 'Drawing'),
  pCircle: viaConstructor('Picture', 'Circle'), pCircleSolid: viaConstructor('Picture', 'CircleSolid'), pRectangleSolid: viaConstructor('Picture', 'RectangleSolid'), pTranslate: viaConstructor('Picture', 'Translate'), pColor: viaConstructor('Picture', 'Color'),
  rgb: viaConstructor('Color', 'RGB'),
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
 * slot), `named(id, name)` gives a shared node its where-name,
 * `lambda(params, build, captures)` adds a λ — a lambda-lifted
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
    /** Another use of node `id` already plugged somewhere: a reference to it. */
    ref: (id) => use(id),
    /** Node `id`, shared under `name` (`where name = …`). */
    named(id, name) {
      body[id].bindName = name
      return id
    },
    /** A Bool value node. */
    bool(value) {
      const id = fresh('bool')
      body[id] = { id, type: 'boolean', label: value ? 'True' : 'False', value: String(value), color: '#e85c9e', x: 0, y: 0 }
      used.add(id)
      return id
    },
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
 * definition: a Prelude function written as a graph. A primitive's view is
 * the primitive applied to its parameters — there is nothing to edit — and
 * the builtins on the main canvas (the protected ones of CLAUDE.md, the
 * class methods) are never overridden.
 */
export function isEditableView(viewId, defs) {
  const view = defs[viewId]
  return Boolean(view && !view.note && isEditableLibraryId(view.view))
}

/**
 * The view `viewId` turned into an edited definition of the function it
 * shows: `{ body, lambdas, lambdaBodies }` — the body (positions kept) to
 * store under the function's own id, and its λs as ordinary editable λs
 * with ids `<function id>/λn`. Everything is a fresh copy.
 */
export function overrideFromView(viewId, defs, bodies) {
  const defId = defs[viewId].view
  const lambdaIds = Object.keys(defs).filter((id) => id.startsWith(`${viewId}/λ`))
  const rename = new Map([[viewId, defId], ...lambdaIds.map((id, i) => [id, `${defId}/λ${i + 1}`])])
  const copy = (body, fnId) => {
    const out = structuredClone(body)
    for (const n of Object.values(out)) {
      if (n.sourceFunctionId && rename.has(n.sourceFunctionId)) n.sourceFunctionId = rename.get(n.sourceFunctionId)
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

/**
 * Whether library function `def` has a definition written as a graph — the
 * functions that aren't primitives, so they can be opened and edited (the
 * same ones isEditableView accepts, decided without building the view).
 */
export function hasDefinitionGraph(def) {
  return Boolean(def && isEditableLibraryId(def.id) && def.builtin !== 'listOf' && GRAPHS[def.builtin])
}

/**
 * Take Prelude function `def` over as a graph: a custom function under its
 * own id (marked `library`), which shadows the library definition, so every
 * call runs it. Its body starts as the view — exactly what the function
 * does — and its parameters and Output are annotated with the library's
 * type (a partial signature, inferGraph.js), so the body is checked against
 * the type callers rely on. Its λs come along as ordinary λs. `project` is
 * `{ nodes, functionBodies }`; returns the new node, or null if `def` has no
 * graph to edit.
 */
export function takeOverDefinition(project, def, resolve) {
  if (!def || !isEditableLibraryId(def.id)) return null
  if (project.nodes[def.id]?.library) return project.nodes[def.id]
  const view = buildDefinitionView(def, resolve)
  if (!isEditableView(view.viewId, view.defs)) return null
  const { body, lambdas, lambdaBodies } = overrideFromView(view.viewId, view.defs, view.bodies)
  // The library's type, slot by slot: parameters, then Output.
  let rest = view.defs[view.viewId].scheme.type
  for (const n of Object.values(body).filter((x) => x.type === 'parameter')) {
    n.annotation = typeText(rest.from)
    rest = rest.to
  }
  body.output.annotation = typeText(rest)
  const params = view.defs[view.viewId].params
  const node = { id: def.id, type: 'function', label: def.label, params: [...params], mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: def.color, custom: true, library: true, x: -9999, y: -9999 }
  project.nodes[def.id] = node
  project.functionBodies[def.id] = body
  for (const [id, lam] of Object.entries(lambdas)) project.nodes[id] = { ...lam, scope: 'local', custom: true, lambda: true }
  Object.assign(project.functionBodies, lambdaBodies)
  return node
}

/** Drop the taken-over definition `id` and its λs: calls run the library's again. */
export function restoreDefinition(project, id) {
  if (!project.nodes[id]?.library) return false
  for (const k of Object.keys(project.nodes)) {
    if (k === id || k.startsWith(`${id}/λ`)) {
      delete project.nodes[k]
      delete project.functionBodies[k]
    }
  }
  return true
}
