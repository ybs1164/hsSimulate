// The law checker. A class instance is only meaningful if its laws hold —
// associativity, identity, inverses, distributivity, the lattice and
// vector-space axioms, the functor laws — and a game object only behaves
// (order-independent stacking, exact offline progress, irreversible
// achievements) if the functions on it are monoid homomorphisms, monoid
// actions, or inflationary. The type checker can't see any of that; this
// module tests it on samples, by actually running the evaluator.
//
// Samples come from the type's structure (fields of a product, each
// constructor of a sum, short lists, Maybe, newtypes, and builtin functions
// for function-typed positions). Values are compared structurally with a
// floating-point tolerance, functions/Endo extensionally on sample points.
// Every operation runs at the type being checked — with that type's
// dictionaries, as a call in a graph would (`op`).
import { isClosure, isData, showValue } from './evaluator.js'
import { builtinSchemes } from './builtinSchemes.js'
import { classArity, classClosure, entails, evidence } from './prelude.js'
import { applySubst, pred, showType, tapp, tcon } from './typeSystem.js'

const MAX_SAMPLES = 5

const head = (t) => (t.kind === 'app' ? head(t.fn) : t)
const argOf = (t) => t.arg
const isCon = (t, name) => t.kind === 'con' && t.name === name

const NUMBERS = {
  Natural: [0, 1, 2, 5],
  Int: [0, 1, -2, 5, -7],
  Integer: [0, 1, -2, 5, -7],
  Word: [0, 1, 2, 7],
  Double: [0, 1, -2.5, 3.25, 10],
  Float: [0, 1, -2.5, 3.25, 10],
  Rational: [0, 1, -0.5, 2.25, 4],
}

/**
 * Up to MAX_SAMPLES runtime values of `type` (null if it can't be sampled).
 * `fns` supplies function samples: closures `a → a` over builtins.
 */
export function samplesOf(type, types, fns, depth = 0) {
  if (type.kind === 'con') {
    if (NUMBERS[type.name]) return NUMBERS[type.name]
    if (type.name === 'Bool') return [false, true]
    if (type.name === 'Char') return ['a', 'z', ' ']
    if (type.name === 'StdGen') return [1, 99, 2026].map((seed) => ({ kind: 'data', type: 'StdGen', ctor: 'StdGen', ctorIndex: 0, args: [seed] }))
    if (type.name === 'Color') return [[1, 0, 0], [0, 0.5, 1]].map((rgb) => ({ kind: 'data', type: 'Color', ctor: 'RGB', ctorIndex: 0, args: rgb }))
    if (type.name === '()') return [{ kind: 'data', type: '()', ctor: '()', ctorIndex: 0, args: [] }]
    return declSamples(types[type.name], [], types, fns, depth)
  }
  if (type.kind === 'fun') return fns && sameType(type.from, type.to) ? fns(type.from) : null
  if (type.kind === 'app') {
    const h = head(type)
    if (h.kind === 'con' && types[h.name]) {
      const args = []
      for (let u = type; u.kind === 'app'; u = u.fn) args.unshift(u.arg)
      return declSamples(types[h.name], args, types, fns, depth)
    }
    if (isCon(h, '(,)') && type.fn.kind === 'app') { // pairs: the i-th sample of each side, rotating
      const left = samplesOf(type.fn.arg, types, fns, depth + 1)
      const right = samplesOf(type.arg, types, fns, depth + 1)
      if (!left || !right) return null
      return spread(Array.from({ length: Math.max(left.length, right.length) }, (_, i) => ({ kind: 'data', type: '(,)', ctor: '(,)', ctorIndex: 0, args: [left[i % left.length], right[(i + 1) % right.length]] })))
    }
    if (isCon(h, 'Either') && type.fn.kind === 'app') { // a Left or two, then Rights
      const left = samplesOf(type.fn.arg, types, fns, depth + 1)
      const right = samplesOf(type.arg, types, fns, depth + 1)
      if (!left || !right) return null
      return spread([...left.slice(0, 1).map((v) => ({ kind: 'data', type: 'Either', ctor: 'Left', ctorIndex: 0, args: [v] })), ...right.slice(0, 3).map((v) => ({ kind: 'data', type: 'Either', ctor: 'Right', ctorIndex: 1, args: [v] }))])
    }
    const inner = samplesOf(argOf(type), types, fns, depth + 1)
    if (!inner) return null
    if (isCon(h, 'List')) return [nilV, consV(inner[0], nilV), consV(inner[1 % inner.length], consV(inner[2 % inner.length], nilV))]
    if (isCon(h, 'Maybe')) return [nothingV, ...inner.slice(0, 3).map(justV)]
  }
  return null
}

// Samples of declared type `decl` at type arguments `args` (for its parameters).
function declSamples(decl, args, types, fns, depth) {
  if (!decl || depth > 2) return null
  const at = new Map((decl.params || []).map((p, k) => [p, args[k]]).filter(([, a]) => a))
  const out = []
  decl.constructors.forEach((c, ctorIndex) => {
    const fieldSamples = c.fields.map((f) => samplesOf(applySubst(at, f.type), types, fns, depth + 1))
    if (fieldSamples.some((fs) => !fs || !fs.length)) return
    // A few combinations: the i-th sample of every field, rotating.
    const count = c.fields.length ? Math.max(...fieldSamples.map((fs) => fs.length)) : 1
    for (let i = 0; i < count; i++) out.push({ kind: 'data', type: decl.name, ctor: c.name, ctorIndex, args: fieldSamples.map((fs, k) => fs[(i + k) % fs.length]) })
  })
  return out.length ? spread(out) : null
}

function spread(list) {
  if (list.length <= MAX_SAMPLES) return list
  const step = list.length / MAX_SAMPLES
  return Array.from({ length: MAX_SAMPLES }, (_, i) => list[Math.floor(i * step)])
}

const nilV = { kind: 'data', type: 'List', ctor: '[]', ctorIndex: 0, args: [] }
const consV = (x, xs) => ({ kind: 'data', type: 'List', ctor: ':', ctorIndex: 1, args: [x, xs] })
const nothingV = { kind: 'data', type: 'Maybe', ctor: 'Nothing', ctorIndex: 0, args: [] }
const justV = (x) => ({ kind: 'data', type: 'Maybe', ctor: 'Just', ctorIndex: 1, args: [x] })

function sameType(a, b) {
  return showType(a) === showType(b)
}

/**
 * Structural equality with a relative tolerance for floating point;
 * closures and Endo values are compared by applying them to `points`.
 */
export function equalValues(a, b, ctx, points = []) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) || (Number.isNaN(a) && Number.isNaN(b))
  if (isClosure(a) || isClosure(b)) return points.every((p) => equalValues(ctx.ev.apply(a, [p]), ctx.ev.apply(b, [p]), ctx, points))
  if (isData(a) && isData(b)) {
    if (a.type !== b.type || a.ctorIndex !== b.ctorIndex || a.args.length !== b.args.length) return false
    return a.args.every((x, i) => equalValues(x, b.args[i], ctx, points))
  }
  return a === b
}

const show = (v, ctx) => showValue(v, ctx.types)

/** A closed dictionary (plain data, as a closure carries it) from closed evidence. */
const dictOf = (e) => ({ kind: 'dict', key: e.inst, sub: e.sub.map(dictOf) })

/**
 * `op(name, ...args)` runs builtin `name` at `type`: its constraint on the
 * class variable is solved at `type`, any other (properFraction's result)
 * at Integer. Throws if `type` lacks an instance.
 */
function opAt(type, ctx) {
  return (name, ...args) => {
    const sch = builtinSchemes[name]
    const main = sch.preds[0]?.type.id
    const ev = sch.preds.map((p) => {
      const q = pred(p.cls, p.type.id === main ? type : tcon('Integer'))
      const e = evidence([], q)
      if (!e) throw new Error(`No instance for ${q.cls} ${showType(q.type)}`)
      return e
    })
    return ctx.ev.invoke(name, args, ev)
  }
}

// Laws per class: [name, arity, check(op, ...samples) → boolean]. `op(name, ...args)` runs a builtin at the type checked.
const LAWS = {
  Semigroup: [['associativity: (x <> y) <> z = x <> (y <> z)', 3, (op, x, y, z, eq) => eq(op('mappend', op('mappend', x, y), z), op('mappend', x, op('mappend', y, z)))]],
  Monoid: [['identity: mempty <> x = x = x <> mempty', 1, (op, x, eq) => eq(op('mappend', op('mempty'), x), x) && eq(op('mappend', x, op('mempty')), x)]],
  AddSemigroup: [['associativity: (x + y) + z = x + (y + z)', 3, (op, x, y, z, eq) => eq(op('plus', op('plus', x, y), z), op('plus', x, op('plus', y, z)))]],
  AddMonoid: [['identity: 0 + x = x', 1, (op, x, eq) => eq(op('plus', op('addZero'), x), x) && eq(op('plus', x, op('addZero')), x)]],
  AddCommutativeMonoid: [['commutativity: x + y = y + x', 2, (op, x, y, eq) => eq(op('plus', x, y), op('plus', y, x))]],
  AddGroup: [['inverse: x + negate x = 0', 1, (op, x, eq) => eq(op('plus', x, op('negate', x)), op('addZero'))]],
  AddAbelianGroup: [['commutativity: x + y = y + x', 2, (op, x, y, eq) => eq(op('plus', x, y), op('plus', y, x))]],
  MulSemigroup: [['associativity: (x * y) * z = x * (y * z)', 3, (op, x, y, z, eq) => eq(op('times', op('times', x, y), z), op('times', x, op('times', y, z)))]],
  MulMonoid: [['identity: 1 * x = x', 1, (op, x, eq) => eq(op('times', op('mulOne'), x), x) && eq(op('times', x, op('mulOne')), x)]],
  Semiring: [
    ['distributivity: x * (y + z) = x * y + x * z', 3, (op, x, y, z, eq) => eq(op('times', x, op('plus', y, z)), op('plus', op('times', x, y), op('times', x, z)))],
    ['annihilation: 0 * x = 0', 1, (op, x, eq) => eq(op('times', op('addZero'), x), op('addZero'))],
  ],
  // The conversions out of the tower are ring maps that respect the order,
  // and toInteger is ℤ's copy of the type: faithful, and agreeing with toRational.
  // (A Rational or an Integer is a host number: compared with host arithmetic.)
  OrderedRing: [
    ['toRational is a ring map: toRational (x + y) = toRational x + toRational y, and so for *', 2, (op, x, y, eq) => eq(op('toRational', op('plus', x, y)), op('toRational', x) + op('toRational', y)) && eq(op('toRational', op('times', x, y)), op('toRational', x) * op('toRational', y))],
    ['toRational is monotone: x >= y ⇒ toRational x >= toRational y', 2, (op, x, y) => !op('geq', x, y) || op('toRational', x) >= op('toRational', y)],
  ],
  EuclideanRing: [
    ['toInteger is a ring map: toInteger (x + y) = toInteger x + toInteger y, and so for *', 2, (op, x, y, eq) => eq(op('toInteger', op('plus', x, y)), op('toInteger', x) + op('toInteger', y)) && eq(op('toInteger', op('times', x, y)), op('toInteger', x) * op('toInteger', y))],
    ['toInteger is faithful: toInteger x = toInteger y ⇒ x = y', 2, (op, x, y, eq) => !eq(op('toInteger', x), op('toInteger', y)) || eq(x, y)],
    ['toRational x = fromInteger (toInteger x)', 1, (op, x, eq) => eq(op('toRational', x), op('toInteger', x))],
    ['division with remainder: (x `div` y) * y + x `mod` y = x, for y ≠ 0', 2, (op, x, y, eq) => op('toInteger', y) === 0 || eq(op('plus', op('times', op('div', x, y), y), op('mod', x, y)), x)],
  ],
  OrderedField: [['properFraction x = (n, r): x = n + r, n whole, |r| < 1', 1, (op, x) => {
    const [n, r] = op('properFraction', x).args.map((v, i) => (i ? op('toRational', v) : v)) // n: an Integer
    const v = op('toRational', x)
    return Math.abs(v - (n + r)) <= 1e-9 * Math.max(1, Math.abs(v)) && Math.abs(r) < 1
  }]],
  Transcendental: [['sqrt x * sqrt x = x, for x >= 0', 1, (op, x, eq) => !op('geq', x, op('addZero')) || eq(op('times', op('sqrt', x), op('sqrt', x)), x)]],
  Eq: [['reflexivity: x == x', 1, (op, x) => op('eq', x, x) === true]],
  PartialOrd: [
    ['reflexivity: leq x x', 1, (op, x) => op('leq', x, x) === true],
    ['antisymmetry: leq x y ∧ leq y x ⇒ x = y', 2, (op, x, y, eq) => !(op('leq', x, y) && op('leq', y, x)) || eq(x, y)],
    ['transitivity: leq x y ∧ leq y z ⇒ leq x z', 3, (op, x, y, z) => !(op('leq', x, y) && op('leq', y, z)) || op('leq', x, z)],
  ],
  Lattice: [
    ['commutativity of \\/ and /\\', 2, (op, x, y, eq) => eq(op('join', x, y), op('join', y, x)) && eq(op('meet', x, y), op('meet', y, x))],
    ['associativity of \\/ and /\\', 3, (op, x, y, z, eq) => eq(op('join', op('join', x, y), z), op('join', x, op('join', y, z))) && eq(op('meet', op('meet', x, y), z), op('meet', x, op('meet', y, z)))],
    ['absorption: x \\/ (x /\\ y) = x', 2, (op, x, y, eq) => eq(op('join', x, op('meet', x, y)), x) && eq(op('meet', x, op('join', x, y)), x)],
    ['consistency: leq x y ⇔ x \\/ y = y', 2, (op, x, y, eq) => op('leq', x, y) === eq(op('join', x, y), y)],
  ],
  VectorSpace: [
    ['k *^ (x + y) = k *^ x + k *^ y', 2, (op, x, y, eq) => [2, -0.5].every((k) => eq(op('scale', k, op('plus', x, y)), op('plus', op('scale', k, x), op('scale', k, y))))],
    ['(k + l) *^ x = k *^ x + l *^ x  and  k *^ (l *^ x) = (k l) *^ x', 1, (op, x, eq) => eq(op('scale', 3.5, x), op('plus', op('scale', 1.5, x), op('scale', 2, x))) && eq(op('scale', 2, op('scale', -0.5, x)), op('scale', -1, x))],
    ['1 *^ x = x', 1, (op, x, eq) => eq(op('scale', 1, x), x)],
  ],
}

/** Function samples `a → a` for function-typed positions: closures over numeric builtins, carrying their dictionaries. */
function functionSamples(type) {
  if (type.kind !== 'con' || !NUMBERS[type.name]) return null
  const at = (cls) => [dictOf(evidence([], pred(cls, type)))]
  const samples = [{ kind: 'closure', callee: '#plus', args: [1, null], dicts: at('AddSemigroup') }, { kind: 'closure', callee: '#times', args: [3, null], dicts: at('MulSemigroup') }]
  if (entails([], pred('AddGroup', type))) samples.splice(1, 0, { kind: 'closure', callee: '#negate', args: [null], dicts: at('AddGroup') })
  return samples
}

/**
 * Check every law of `cls` (and of its superclasses) for `type`.
 * `ctx = { ev, types }`. Returns `{ results: [{ cls, law, ok, counterexample }], skipped }`.
 */
export function checkClassLaws(cls, type, ctx) {
  if (classArity(cls) === 1) return checkConstructorLaws(cls, type, ctx)
  const samples = samplesOf(type, ctx.types, functionSamples)
  if (!samples) return { results: [], skipped: `can't build samples of ${showType(type)}` }
  // Functions (inside Endo) are compared extensionally, at samples of their domain.
  const points = isCon(head(type), 'Endo') ? samplesOf(argOf(type), ctx.types, functionSamples) || [] : []
  const eq = (a, b) => equalValues(a, b, ctx, points)
  const op = opAt(type, ctx)
  const results = []
  for (const c of classClosure(cls).reverse()) {
    for (const [law, arity, check] of LAWS[c] || []) {
      let counterexample = null
      try {
        for (const combo of combinations(samples, arity)) {
          if (!check(op, ...combo, eq)) { counterexample = combo.map((v) => show(v, ctx)).join(', '); break }
        }
      } catch (e) {
        counterexample = `error: ${e.message}`
      }
      results.push({ cls: c, law, ok: !counterexample, counterexample })
    }
  }
  return { results, skipped: null }
}

// ---- Laws of the constructor classes ----------------------------------------
// Functor, Applicative and Monad are about a type constructor `f`: their
// laws are checked at `f Int`, with functions Int → Int ((+ 1), negate,
// (* 3)) and Kleisli arrows Int → f Int (return . g, and \_ -> m).
// Each law: [name, check(env) → a counterexample, or null].
const CONSTRUCTOR_LAWS = {
  Functor: [
    ['identity: fmap id m = m', ({ op, eq, ms, c }) => ms.find((m) => !eq(op('fmap', c.id, m), m))],
    ['composition: fmap (g . h) m = fmap g (fmap h m)', ({ op, eq, ms, fs, c }) => {
      for (const m of ms) for (const g of fs) for (const h of fs) if (!eq(op('fmap', c.compose(g, h), m), op('fmap', g, op('fmap', h, m)))) return m
      return null
    }],
  ],
  Applicative: [
    ['identity: pure id <*> v = v', ({ op, eq, ms, c }) => ms.find((v) => !eq(op('ap', op('pure', c.id), v), v))],
    ['homomorphism: pure g <*> pure x = pure (g x)', ({ op, eq, xs, fs, ctx }) => {
      for (const g of fs) for (const x of xs) if (!eq(op('ap', op('pure', g), op('pure', x)), op('pure', ctx.ev.apply(g, [x])))) return x
      return null
    }],
    ['interchange: u <*> pure y = pure ($ y) <*> u', ({ op, eq, ms, xs, fs, c }) => {
      for (const v of ms) for (const g of fs) {
        const u = op('fmap', c.constant(g), v) // a container of functions, shaped like v
        for (const y of xs) if (!eq(op('ap', u, op('pure', y)), op('ap', op('pure', c.applyTo(y)), u))) return v
      }
      return null
    }],
    ['fmap g v = pure g <*> v', ({ op, eq, ms, fs }) => {
      for (const v of ms) for (const g of fs) if (!eq(op('fmap', g, v), op('ap', op('pure', g), v))) return v
      return null
    }],
  ],
  Monad: [
    ['left identity: return x >>= k = k x', ({ op, eq, xs, ks, ctx }) => {
      for (const k of ks) for (const x of xs) if (!eq(op('bind', op('pure', x), k), ctx.ev.apply(k, [x]))) return x
      return null
    }],
    ['right identity: m >>= return = m', ({ op, eq, ms, c }) => ms.find((m) => !eq(op('bind', m, c.pure), m))],
    ['associativity: (m >>= k) >>= h = m >>= (k >=> h)', ({ op, eq, ms, ks, c }) => {
      for (const m of ms) for (const k of ks) for (const h of ks) if (!eq(op('bind', op('bind', m, k), h), op('bind', m, c.kleisli(k, h)))) return m
      return null
    }],
  ],
}

/** Check the laws of constructor class `cls` (and its superclasses) for the type constructor `type` (`Maybe`, `Either e`, …). */
function checkConstructorLaws(cls, type, ctx) {
  const Int = tcon('Int')
  const ms = samplesOf(tapp(type, Int), ctx.types, functionSamples)
  if (!ms) return { results: [], skipped: `can't build samples of ${showType(tapp(type, Int))}` }
  const dict = (c) => [dictOf(evidence([], pred(c, type)))]
  const closure = (callee, args, dicts) => ({ kind: 'closure', callee: `#${callee}`, args, ...(dicts ? { dicts } : {}) })
  const pure = closure('pure', [null], dict('Applicative'))
  const c = {
    id: closure('identity', [null]),
    pure,
    compose: (g, h) => closure('compose', [g, h, null]),
    constant: (v) => closure('constFn', [v, null]),
    applyTo: (y) => closure('apply', [null, y]),
    kleisli: (k, h) => closure('kleisli', [k, h, null], dict('Monad')),
  }
  const fs = functionSamples(Int)
  const has = (k) => classClosure(cls).includes(k)
  const ks = has('Monad') ? [...fs.map((g) => c.compose(pure, g)), ...ms.slice(0, 2).map((m) => c.constant(m))] : []
  const env = { op: opAt(type, ctx), eq: (a, b) => equalValues(a, b, ctx), ms, xs: [0, 1, -2], fs, ks, c, ctx }
  const results = []
  for (const k of classClosure(cls).reverse()) {
    for (const [law, check] of CONSTRUCTOR_LAWS[k] || []) {
      let counterexample = null
      try {
        const bad = check(env)
        if (bad !== null && bad !== undefined) counterexample = show(bad, ctx)
      } catch (e) {
        counterexample = `error: ${e.message}`
      }
      results.push({ cls: k, law, ok: !counterexample, counterexample })
    }
  }
  return { results, skipped: null }
}

function* combinations(samples, arity) {
  if (arity === 0) { yield []; return }
  for (const x of samples) for (const rest of combinations(samples, arity - 1)) yield [x, ...rest]
}

/** The classes with laws that `type` has an instance of (Eq aside), most specific first. */
export function lawfulClassesOf(type) {
  const have = Object.keys(LAWS).filter((c) => c !== 'Eq' && entails([], pred(c, type)))
  return have.filter((c) => !have.some((d) => d !== c && classClosure(d).includes(c))) // checking a class checks its superclasses too
}

// ---- Laws about functions ---------------------------------------------------

/**
 * Laws a user can claim for a function `f` (a closure value) of a given
 * type, and check:
 *  - homomorphism  f :: M → N   f (x · y) = f x · f y and f e = e, for the
 *                               monoid structure both sides share (Monoid's
 *                               <>, else AddMonoid's +)
 *  - action        f :: M → S → S  for a monoid M (Sum Double, Double under +):
 *                               f e = id and f (a · b) = f a ∘ f b
 *  - inflationary  f :: S → S   leq s (f s) for a PartialOrd S
 */
export const FUNCTION_LAWS = ['homomorphism', 'action', 'inflationary']

function monoidOps(type, ctx) {
  const op = opAt(type, ctx)
  if (entails([], pred('Monoid', type))) return { name: '<>', mul: (x, y) => op('mappend', x, y), unit: op('mempty') }
  if (entails([], pred('AddMonoid', type))) return { name: '+', mul: (x, y) => op('plus', x, y), unit: op('addZero') }
  return null
}

export function checkFunctionLaw(kind, fn, fnType, ctx) {
  const points = []
  const eq = (a, b) => equalValues(a, b, ctx, points)
  const ap = (...args) => ctx.ev.apply(fn, args)
  const fail = (law, counterexample) => ({ law, ok: false, counterexample })
  const pass = (law) => ({ law, ok: true, counterexample: null })
  try {
    if (kind === 'homomorphism') {
      if (fnType.kind !== 'fun') return fail('homomorphism', 'not a function M → N')
      const [M, N] = [fnType.from, fnType.to]
      const m = monoidOps(M, ctx), n = monoidOps(N, ctx)
      if (!m || !n) return fail('homomorphism', `${showType(m ? N : M)} is not a monoid (needs Monoid or AddMonoid)`)
      const xs = samplesOf(M, ctx.types, functionSamples)
      if (!xs) return fail('homomorphism', `can't build samples of ${showType(M)}`)
      if (!eq(ap(m.unit), n.unit)) return fail(`f (identity) = identity`, `f ${show(m.unit, ctx)} = ${show(ap(m.unit), ctx)}`)
      for (const x of xs) for (const y of xs) {
        if (!eq(ap(m.mul(x, y)), n.mul(ap(x), ap(y)))) return fail(`f (x ${m.name} y) = f x ${n.name} f y`, `x = ${show(x, ctx)}, y = ${show(y, ctx)}`)
      }
      return pass(`f (x ${m.name} y) = f x ${n.name} f y`)
    }
    if (kind === 'action') {
      if (fnType.kind !== 'fun' || fnType.to.kind !== 'fun') return fail('action', 'not a function M → S → S')
      const [M, S] = [fnType.from, fnType.to.from]
      const m = monoidOps(M, ctx)
      if (!m) return fail('action', `${showType(M)} is not a monoid (needs Monoid or AddMonoid)`)
      const as = samplesOf(M, ctx.types, functionSamples)?.filter((a) => typeof a !== 'number' || a >= 0)
      const ss = samplesOf(S, ctx.types, functionSamples)
      if (!as || !ss) return fail('action', `can't build samples of ${showType(as ? S : M)}`)
      for (const s of ss) if (!eq(ap(m.unit, s), s)) return fail('f identity = id', `s = ${show(s, ctx)}`)
      for (const a of as) for (const b of as) for (const s of ss) {
        if (!eq(ap(m.mul(a, b), s), ap(a, ap(b, s)))) return fail(`f (a ${m.name} b) = f a ∘ f b`, `a = ${show(a, ctx)}, b = ${show(b, ctx)}, s = ${show(s, ctx)}`)
      }
      return pass(`f (a ${m.name} b) = f a ∘ f b`)
    }
    if (kind === 'inflationary') {
      if (fnType.kind !== 'fun' || !sameType(fnType.from, fnType.to)) return fail('inflationary', 'not a function S → S')
      if (!entails([], pred('PartialOrd', fnType.from))) return fail('inflationary', `${showType(fnType.from)} has no PartialOrd`)
      const ss = samplesOf(fnType.from, ctx.types, functionSamples)
      if (!ss) return fail('inflationary', `can't build samples of ${showType(fnType.from)}`)
      for (const s of ss) if (!opAt(fnType.from, ctx)('leq', s, ap(s))) return fail('leq s (f s)', `s = ${show(s, ctx)}`)
      return pass('leq s (f s)')
    }
  } catch (e) {
    return fail(kind, `error: ${e.message}`)
  }
  return fail(kind, 'unknown law')
}
