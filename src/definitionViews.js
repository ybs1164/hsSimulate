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
  toRational: METHOD('OrderedRing'),
  fromInteger: 'primitive · a method of the class Ring: the unique ring map ℤ → a (ℤ is the initial ring)',
  toInteger: 'primitive · a method of the class EuclideanRing: the embedding of an integral type in ℤ',
  fromRational: METHOD('Field'), properFraction: 'primitive · a method of the class OrderedField: x = n + r with n integral and r between -1 and 1, of the sign of x',
  div: 'primitive · a method of the class EuclideanRing: the quotient, rounded down', mod: 'primitive · a method of the class EuclideanRing: the remainder of div, of the sign of the divisor',
  isNaN: METHOD('IEEEFloat'), geq: METHOD('Ord'), eq: METHOD('Eq'),
  nil: CONSTRUCTOR('[a]'), cons: CONSTRUCTOR('[a]'),
  foldr: 'primitive · the recursor of the inductive type [a] (its catamorphism)',
  nothing: CONSTRUCTOR('Maybe a'), just: CONSTRUCTOR('Maybe a'),
  pair: 'primitive · the pairing of the product (a, b)', fst: 'primitive · the first projection π₁ of the product (a, b)', snd: 'primitive · the second projection π₂ of the product (a, b)',
  mappend: METHOD('Semigroup'), mempty: METHOD('Monoid'), fmap: METHOD('Functor'), foldMap: METHOD('Foldable'),
  leq: METHOD('PartialOrd'), join: METHOD('Lattice'), meet: METHOD('Lattice'), scale: METHOD('VectorSpace'),
  mkSum: CONSTRUCTOR('Sum a'), mkProduct: CONSTRUCTOR('Product a'), mkEndo: CONSTRUCTOR('Endo a'),
  show: 'primitive · rendering a value as text (Show)', showFFloat: 'primitive · decimal rendering of a floating-point number', showCompact: 'primitive · compact rendering of a number (1.2K, 3.4M)',
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
// getSum s = caseSum (\x -> x) s
const unwrap = (type) => (g) => g.call(`type:${type}:case${type}`, [g.lambda(['x'], (l) => l.param(0)), g.param(0)])
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
  maybe: (g) => g.call('type:Maybe:caseMaybe', [g.param(0), g.param(1), g.param(2)]),
  getSum: unwrap('Sum'),
  getProduct: unwrap('Product'),
  // appEndo e x = caseEndo (\x f -> apply f x) e
  appEndo: (g) => g.call('type:Endo:caseEndo', [g.lambda(['x', 'f'], (l) => l.call('apply', [l.param(1), l.param(0)]), [g.param(1)]), g.param(0)]),
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
  const written = def.instance ? instanceGraph(def, g, resolve) : def.derived ? derivedGraph(def, g, resolve) : GRAPHS[def.builtin]
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

// A class method at a declared type (typeDecls.js's instanceDefinitions),
// written the way it is derived:
//
//   x + y   = caseT (\y x₁ … xₙ -> caseT (\x₁ … xₙ y₁ … yₙ -> C (x₁ + y₁) … (xₙ + yₙ)) y) x
//   negate x = caseT (\x₁ … xₙ -> C (negate x₁) … (negate xₙ)) x
//   k *^ v  = caseT (\k x₁ … xₙ -> C (k *^ x₁) … (k *^ xₙ)) v
//   leq x y = … the same, with leq x₁ y₁ && … && leq xₙ yₙ
//   x >= y  = lexicographic: if x₁ == y₁ then (the rest) else x₁ >= y₁
//   x == y  = the same constructor, and equal fields
//
// `&&` is `select a b False` — the eliminator of Bool.
const FIELD_OP = { plus: 'plus', negate: 'negate', minus: 'minus', times: 'times', scale: 'prelude:scale', leq: 'prelude:leq', join: 'prelude:join', meet: 'prelude:meet', mappend: 'prelude:mappend', eq: 'eq', geq: 'geq' }
function instanceGraph(def, g, resolve) {
  const { type, method } = def.instance
  const caseId = `type:${type}:case${type}`
  const caseDef = resolve(caseId)
  if (!caseDef) return null
  const ctors = caseDef.params.slice(0, -1).map((_, i) => resolve(`type:${type}:${ctorNameAt(resolve, type, i)}`))
  if (ctors.some((c) => !c)) return null
  const op = FIELD_OP[method]
  // binders for the fields of the first operand (x₁ y₁ …) and of the second (x₂ y₂ …)
  const names = (ctor, operand = 1) => (ctor?.params || []).map((p, i) => (/^[a-z_][A-Za-z0-9_']*$/.test(p) && !/^x\d+$/.test(p) ? `${p}${operand}` : `${operand === 1 ? 'a' : 'b'}${i + 1}`)) // positional fields: a₁ … / b₁ …
  // a₁ && … && aₙ, in graph `h`, from condition nodes (True when there are none)
  const all = (h, conds) => (conds.length ? conds.reduceRight((rest, c) => (rest === null ? c : h.call('select', [c, rest, { lit: 'False' }])), null) : h.bool(true))
  // the fields of x (xs) and of y (ys) of one constructor, both in scope in a λ: \xs ys -> body
  const pairwise = (h, ctor, xsOf, build) => {
    const xs = names(ctor, 1)
    const ys = names(ctor, 2)
    return h.lambda([...xs, ...ys], (m) => build(m, xs.map((_, i) => [m.param(i), m.param(xs.length + i)])), xsOf)
  }
  if (method === 'eq') {
    // caseT (branch per constructor of x: caseT (True for the same constructor with equal fields, False otherwise) y) x
    const branches = ctors.map((ci, i) => {
      const xs = names(ci, 1)
      const inner = (h, y, xsOf) => h.call(caseId, [...ctors.map((cj, j) => {
        if (j !== i) return cj.params.length ? h.lambda(names(cj, 2), (m) => m.bool(false)) : { lit: 'False' }
        return ci.params.length ? pairwise(h, ci, xsOf, (m, pairs) => all(m, pairs.map(([a, b]) => m.call('eq', [a, b])))) : { lit: 'True' }
      }), y])
      if (!xs.length) return inner(g, g.param(1), [])
      return g.lambda(['y', ...xs], (l) => inner(l, l.param(0), xs.map((_, k) => l.param(1 + k))), [g.param(1)])
    })
    return () => g.call(caseId, [...branches, g.param(0)])
  }
  if (ctors.length !== 1) return null
  const [ctor] = ctors
  const n = ctor.params.length
  const xs = names(ctor, 1)
  if (method === 'negate') return () => g.call(caseId, [g.lambda(xs, (l) => l.call(ctor.id, xs.map((_, i) => l.call(op, [l.param(i)])))), g.param(0)])
  if (method === 'scale') return () => g.call(caseId, [g.lambda(['k', ...xs], (l) => l.call(ctor.id, xs.map((_, i) => l.call(op, [l.param(0), l.param(1 + i)]))), [g.param(0)]), g.param(1)])
  // binary: \y xs -> caseT (\xs ys -> result) y, applied to x's fields
  const binary = (result) => () => {
    if (!n) return g.call(caseId, [result(g, []), g.param(0)])
    return g.call(caseId, [g.lambda(['y', ...xs], (l) => l.call(caseId, [pairwise(l, ctor, xs.map((_, i) => l.param(1 + i)), result), l.param(0)]), [g.param(1)]), g.param(0)])
  }
  if (method === 'leq') return binary((m, pairs) => all(m, pairs.map(([a, b]) => m.call(op, [a, b]))))
  if (method === 'geq') {
    // lexicographic: select (x₁ == y₁) (the rest) (x₁ >= y₁)
    const lex = (m, pairs) => (pairs.length ? pairs.reduceRight((rest, [a, b]) => (rest === null ? m.call('geq', [a, b]) : m.call('select', [m.call('eq', [a, b]), rest, m.call('geq', [m.ref(a), m.ref(b)])])), null) : m.bool(true))
    return binary(lex)
  }
  return binary((m, pairs) => (pairs.length ? m.call(ctor.id, pairs.map(([a, b]) => m.call(op, [a, b]))) : m.call(ctor.id, [])))
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

/**
 * Whether library function `def` has a definition written as a graph — the
 * functions that aren't primitives, so they can be opened and edited (the
 * same ones isEditableView accepts, decided without building the view).
 */
export function hasDefinitionGraph(def) {
  if (!def || !isOverridableId(def.id)) return false
  if (def.instance) return true // instanceDefinitions only makes the ones it can write
  if (def.derived) return ['get', 'set', 'over', 'fold'].includes(def.derived.op)
  return def.builtin !== 'listOf' && Boolean(GRAPHS[def.builtin])
}
