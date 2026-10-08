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
// floating-point tolerance; `mempty` is compared as the identity of the
// other side's shape, and functions/Endo extensionally on sample points.
import { concreteMempty, isClosure, isData, isMempty, MEMPTY, showValue } from './evaluator.js'
import { classClosure, entails } from './prelude.js'
import { pred, showType } from './typeSystem.js'

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
    if (type.name === '()') return [{ kind: 'data', type: '()', ctor: '()', ctorIndex: 0, args: [] }]
    const decl = types[type.name]
    if (!decl || depth > 2) return null
    const out = []
    decl.constructors.forEach((c, ctorIndex) => {
      const fieldSamples = c.fields.map((f) => samplesOf(f.type, types, fns, depth + 1))
      if (fieldSamples.some((fs) => !fs || !fs.length)) return
      // A few combinations: the i-th sample of every field, rotating.
      const count = c.fields.length ? Math.max(...fieldSamples.map((fs) => fs.length)) : 1
      for (let i = 0; i < count; i++) out.push({ kind: 'data', type: decl.name, ctor: c.name, ctorIndex, args: fieldSamples.map((fs, k) => fs[(i + k) % fs.length]) })
    })
    return out.length ? spread(out) : null
  }
  if (type.kind === 'fun') return fns && sameType(type.from, type.to) ? fns(type.from) : null
  if (type.kind === 'app') {
    const h = head(type)
    const inner = samplesOf(argOf(type), types, fns, depth + 1)
    if (!inner) return null
    if (isCon(h, 'List')) return [nilV, consV(inner[0], nilV), consV(inner[1 % inner.length], consV(inner[2 % inner.length], nilV))]
    if (isCon(h, 'Maybe')) return [nothingV, ...inner.slice(0, 3).map(justV)]
    if (isCon(h, 'Sum') || isCon(h, 'Product')) return inner.map((x) => ({ kind: 'data', type: h.name, ctor: h.name, ctorIndex: 0, args: [x] }))
    if (isCon(h, 'Endo')) {
      const f = fns?.(argOf(type))
      return f ? f.map((g) => ({ kind: 'data', type: 'Endo', ctor: 'Endo', ctorIndex: 0, args: [g] })) : null
    }
  }
  return null
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
 * Structural equality with a relative tolerance for floating point. MEMPTY
 * equals the identity of the other side's shape; closures and Endo values
 * are compared by applying them to `points`.
 */
export function equalValues(a, b, ctx, points = []) {
  if (isMempty(a) && isMempty(b)) return true
  if (isMempty(a)) return isData(b) ? equalValues(concreteMempty(b), b, ctx, points) : false
  if (isMempty(b)) return equalValues(b, a, ctx, points)
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) || (Number.isNaN(a) && Number.isNaN(b))
  if (typeof a === 'number' && isData(b)) return b.args.every((f) => equalValues(a, f, ctx, points)) // a broadcast number
  if (typeof b === 'number' && isData(a)) return equalValues(b, a, ctx, points)
  if (isClosure(a) || isClosure(b)) return points.every((p) => equalValues(ctx.ev.apply(a, [p]), ctx.ev.apply(b, [p]), ctx, points))
  if (isData(a) && isData(b)) {
    if (a.type !== b.type || a.ctorIndex !== b.ctorIndex || a.args.length !== b.args.length) return false
    return a.args.every((x, i) => equalValues(x, b.args[i], ctx, points))
  }
  return a === b
}

const show = (v, ctx) => showValue(v, ctx.types)

// Laws per class: [name, arity, check(op, ...samples) → boolean]. `op(name, ...args)` runs a builtin.
const LAWS = {
  Semigroup: [['associativity: (x <> y) <> z = x <> (y <> z)', 3, (op, x, y, z, eq) => eq(op('mappend', op('mappend', x, y), z), op('mappend', x, op('mappend', y, z)))]],
  Monoid: [['identity: mempty <> x = x = x <> mempty', 1, (op, x, eq) => eq(op('mappend', MEMPTY, x), x) && eq(op('mappend', x, MEMPTY), x)]],
  AddSemigroup: [['associativity: (x + y) + z = x + (y + z)', 3, (op, x, y, z, eq) => eq(op('plus', op('plus', x, y), z), op('plus', x, op('plus', y, z)))]],
  AddMonoid: [['identity: 0 + x = x', 1, (op, x, eq) => eq(op('plus', 0, x), x) && eq(op('plus', x, 0), x)]],
  AddCommutativeMonoid: [['commutativity: x + y = y + x', 2, (op, x, y, eq) => eq(op('plus', x, y), op('plus', y, x))]],
  AddGroup: [['inverse: x + negate x = 0', 1, (op, x, eq) => eq(op('plus', x, op('negate', x)), 0)]],
  AddAbelianGroup: [['commutativity: x + y = y + x', 2, (op, x, y, eq) => eq(op('plus', x, y), op('plus', y, x))]],
  MulSemigroup: [['associativity: (x * y) * z = x * (y * z)', 3, (op, x, y, z, eq) => eq(op('times', op('times', x, y), z), op('times', x, op('times', y, z)))]],
  MulMonoid: [['identity: 1 * x = x', 1, (op, x, eq) => eq(op('times', 1, x), x) && eq(op('times', x, 1), x)]],
  Semiring: [
    ['distributivity: x * (y + z) = x * y + x * z', 3, (op, x, y, z, eq) => eq(op('times', x, op('plus', y, z)), op('plus', op('times', x, y), op('times', x, z)))],
    ['annihilation: 0 * x = 0', 1, (op, x, eq) => eq(op('times', 0, x), 0)],
  ],
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

/** Function samples `a → a` for function-typed positions: closures over numeric builtins. */
function functionSamples(type) {
  if (type.kind === 'con' && NUMBERS[type.name]) return [{ kind: 'closure', callee: 'plus', args: [1, null] }, { kind: 'closure', callee: 'negate', args: [null] }, { kind: 'closure', callee: 'times', args: [3, null] }]
  return null
}

/**
 * Check every law of `cls` (and of its superclasses) for `type`.
 * `ctx = { ev, types }`. Returns `{ results: [{ cls, law, ok, counterexample }], skipped }`.
 */
export function checkClassLaws(cls, type, ctx) {
  const samples = samplesOf(type, ctx.types, functionSamples)
  if (!samples) return { results: [], skipped: `can't build samples of ${showType(type)}` }
  // Functions (inside Endo) are compared extensionally, at samples of their domain.
  const points = isCon(head(type), 'Endo') ? samplesOf(argOf(type), ctx.types, functionSamples) || [] : []
  const eq = (a, b) => equalValues(a, b, ctx, points)
  const op = (name, ...args) => ctx.ev.invokeBuiltin(name, args)
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

function monoidOps(type) {
  if (entails([], pred('Monoid', type))) return { name: '<>', mul: 'mappend', unit: MEMPTY }
  if (entails([], pred('AddMonoid', type))) return { name: '+', mul: 'plus', unit: 0 }
  return null
}

export function checkFunctionLaw(kind, fn, fnType, ctx) {
  const points = []
  const eq = (a, b) => equalValues(a, b, ctx, points)
  const op = (name, ...args) => ctx.ev.invokeBuiltin(name, args)
  const ap = (...args) => ctx.ev.apply(fn, args)
  const fail = (law, counterexample) => ({ law, ok: false, counterexample })
  const pass = (law) => ({ law, ok: true, counterexample: null })
  try {
    if (kind === 'homomorphism') {
      if (fnType.kind !== 'fun') return fail('homomorphism', 'not a function M → N')
      const [M, N] = [fnType.from, fnType.to]
      const m = monoidOps(M), n = monoidOps(N)
      if (!m || !n) return fail('homomorphism', `${showType(m ? N : M)} is not a monoid (needs Monoid or AddMonoid)`)
      const xs = samplesOf(M, ctx.types, functionSamples)
      if (!xs) return fail('homomorphism', `can't build samples of ${showType(M)}`)
      if (!eq(ap(m.unit), n.unit)) return fail(`f (identity) = identity`, `f ${show(m.unit, ctx)} = ${show(ap(m.unit), ctx)}`)
      for (const x of xs) for (const y of xs) {
        if (!eq(ap(op(m.mul, x, y)), op(n.mul, ap(x), ap(y)))) return fail(`f (x ${m.name} y) = f x ${n.name} f y`, `x = ${show(x, ctx)}, y = ${show(y, ctx)}`)
      }
      return pass(`f (x ${m.name} y) = f x ${n.name} f y`)
    }
    if (kind === 'action') {
      if (fnType.kind !== 'fun' || fnType.to.kind !== 'fun') return fail('action', 'not a function M → S → S')
      const [M, S] = [fnType.from, fnType.to.from]
      const m = monoidOps(M)
      if (!m) return fail('action', `${showType(M)} is not a monoid (needs Monoid or AddMonoid)`)
      const as = samplesOf(M, ctx.types, functionSamples)?.filter((a) => typeof a !== 'number' || a >= 0)
      const ss = samplesOf(S, ctx.types, functionSamples)
      if (!as || !ss) return fail('action', `can't build samples of ${showType(as ? S : M)}`)
      for (const s of ss) if (!eq(ap(m.unit, s), s)) return fail('f identity = id', `s = ${show(s, ctx)}`)
      for (const a of as) for (const b of as) for (const s of ss) {
        if (!eq(ap(op(m.mul, a, b), s), ap(a, ap(b, s)))) return fail(`f (a ${m.name} b) = f a ∘ f b`, `a = ${show(a, ctx)}, b = ${show(b, ctx)}, s = ${show(s, ctx)}`)
      }
      return pass(`f (a ${m.name} b) = f a ∘ f b`)
    }
    if (kind === 'inflationary') {
      if (fnType.kind !== 'fun' || !sameType(fnType.from, fnType.to)) return fail('inflationary', 'not a function S → S')
      if (!entails([], pred('PartialOrd', fnType.from))) return fail('inflationary', `${showType(fnType.from)} has no PartialOrd`)
      const ss = samplesOf(fnType.from, ctx.types, functionSamples)
      if (!ss) return fail('inflationary', `can't build samples of ${showType(fnType.from)}`)
      for (const s of ss) if (!op('leq', s, ap(s))) return fail('leq s (f s)', `s = ${show(s, ctx)}`)
      return pass('leq s (f s)')
    }
  } catch (e) {
    return fail(kind, `error: ${e.message}`)
  }
  return fail(kind, 'unknown law')
}

