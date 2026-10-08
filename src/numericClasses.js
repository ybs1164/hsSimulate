// The numeric type-class hierarchy, rebuilt along group-theoretic lines
// (CLAUDE.md: "숫자 타입클래스 계층은 군론을 따른다"), plus the
// constraint-solving machinery (predicate entailment, context reduction,
// defaulting) needed to actually type-check code that uses it.
//
// The solver is ported from Mark P. Jones & Simon Peyton Jones, "Typing
// Haskell in Haskell" (https://web.cecs.pdx.edu/~mpj/thih/TypingHaskellInHaskell.html):
// bySuper/byInst/entail, toHnf/toHnfs/simplify/reduce (context reduction),
// and candidates/withDefaults (defaulting).
//
// The class hierarchy is NOT the Haskell Report's Num/Real/Integral/... tower.
// A number type carries two independent algebraic structures (+ and *), so
// each gets its own single-parameter chain, in the style of numeric-prelude's
// `Algebra.*` modules:
//
//   AddSemigroup (+) → AddMonoid → AddCommutativeMonoid ─┐
//                         └→ AddGroup (negate, -) → AddAbelianGroup ─┐
//   MulSemigroup (*) → MulMonoid ─┐                    │              │
//                                 └──→ Semiring ←──────┘              │
//                                         └──→ Ring ←─────────────────┘
//   Ring (+ Ord) → OrderedRing → EuclideanRing     (div/mod, toInteger)
//   Ring → Field                                    (/, recip)
//   OrderedRing + Field → OrderedField              (round, floor: Archimedean)
//   Field → Transcendental                          (sqrt, exp — analysis, not algebra)
//   OrderedField + Transcendental → IEEEFloat       (isNaN)
//
// Rough correspondence to the Haskell Report classes this replaces:
// Num→Ring, Real→OrderedRing, Integral→EuclideanRing, Fractional→Field,
// Floating→Transcendental, RealFrac→OrderedField, RealFloat→IEEEFloat.
//
// Documented simplifications: EuclideanRing sits under OrderedRing (as
// Haskell's Integral sits under Real) even though a Euclidean domain needs no
// order; Int is modeled as ℤ (its 64-bit overflow is outside the model) and
// Float/Double as fields although IEEE arithmetic is only approximately
// associative; Transcendental is an analytic extension, not a
// group-theoretic structure. Eq/Ord/Show are auxiliary (order theory /
// display), not part of the algebraic tower, and don't count as numeric for
// defaulting.
import { pred } from './typeSystem.js'

/** Direct superclass edges. */
const superclasses = {
  AddSemigroup: [],
  AddMonoid: ['AddSemigroup'],
  AddCommutativeMonoid: ['AddMonoid'],
  AddGroup: ['AddMonoid'],
  AddAbelianGroup: ['AddGroup', 'AddCommutativeMonoid'],
  MulSemigroup: [],
  MulMonoid: ['MulSemigroup'],
  Semiring: ['AddCommutativeMonoid', 'MulMonoid'],
  Ring: ['Semiring', 'AddAbelianGroup'],
  OrderedRing: ['Ring', 'Ord'],
  EuclideanRing: ['OrderedRing'],
  Field: ['Ring'],
  OrderedField: ['OrderedRing', 'Field'],
  Transcendental: ['Field'],
  IEEEFloat: ['OrderedField', 'Transcendental'],
  Eq: [],
  Ord: ['Eq'],
  Show: [],
}

/** Every class `cls` implies, itself included. */
export function classClosure(cls) {
  return [...new Set([cls, ...(superclasses[cls] || []).flatMap(classClosure)])]
}

/**
 * Which classes each concrete type instantiates, given only by its most
 * specific classes and closed upward — so "has C ⇒ has every superclass of
 * C" holds by construction, never by hand-maintenance.
 */
const instances = Object.fromEntries(
  Object.entries({
    Int: ['EuclideanRing', 'Show'], // modeled as ℤ; overflow is outside the model (as IEEE rounding is for Float/Double)
    Integer: ['EuclideanRing', 'Show'],
    // Word genuinely is ℤ/2⁶⁴: wrapping gives additive inverses (a ring, not
    // just a semiring), but its order isn't compatible with + (0 ≤ 1 yet
    // 0 + max > 1 + max), so it is NOT an OrderedRing — and hence not a
    // EuclideanRing either. It can't feed fromIntegral/toRational or be
    // round's result.
    Word: ['Ring', 'Ord', 'Show'],
    Natural: ['Semiring', 'Ord', 'Show'], // ℕ: no additive inverse — a semiring, not a ring
    Rational: ['OrderedField', 'Show'],
    Float: ['IEEEFloat', 'Show'],
    Double: ['IEEEFloat', 'Show'],
    Bool: ['Ord', 'Show'],
  }).map(([type, classes]) => [type, [...new Set(classes.flatMap(classClosure))]]),
)

/** The concrete numeric types a literal or annotation may name, in display order. */
export const numericTypes = ['Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational']

/** All classes concrete type `name` is an instance of (empty for unknown types). */
export function instancesOf(name) {
  return instances[name] || []
}

/**
 * The class a numeric literal's text demands: a non-negative integer only
 * needs `Semiring` (n = 1 + 1 + … + 1), a negative one needs additive
 * inverses (`Ring`), and a decimal needs division (`Field`).
 */
export function literalClass(text = '') {
  if (/\./.test(text)) return 'Field'
  if (/^\s*-/.test(text)) return 'Ring'
  return 'Semiring'
}

/** Same default list GHC uses when no `default` declaration is given: try Integer, then Double. */
export const defaultTypes = ['Integer', 'Double']

export class ContextError extends Error {
  constructor(p) {
    super(`No instance for ${p.cls} ${p.type.kind === 'con' ? p.type.name : '(...)'}`)
    this.pred = p
  }
}

/** `p` plus every predicate its class's superclasses also give you for the same type. */
function bySuper(p) {
  return [p, ...(superclasses[p.cls] || []).flatMap((sup) => bySuper(pred(sup, p.type)))]
}

/**
 * If `p`'s type is concrete, does it actually have this instance? Returns
 * `[]` (no sub-obligations — numeric instances here are all "base" instances)
 * if satisfied, or `null` if not. A var-headed pred can't be judged yet; a
 * fun-headed pred (e.g. `Ring (a -> b)`, a function value in a numeric slot)
 * NEVER has an instance — deliberately treated the same as an unmatched
 * concrete type, not as "undecidable", so it fails cleanly at toHnf.
 */
function byInst(p) {
  if (p.type.kind !== 'con') return null
  const classes = instances[p.type.name]
  return classes && classes.includes(p.cls) ? [] : null
}

/** Does `preds` entail `p` (via superclasses of what's already assumed, or by instance + recursively entailing its sub-obligations)? */
export function entails(preds, p) {
  if (preds.some((q) => bySuper(q).some((r) => r.cls === p.cls && sameType(r.type, p.type)))) return true
  const sub = byInst(p)
  return sub !== null && sub.every((q) => entails(preds, q))
}

function sameType(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'var') return a.id === b.id
  if (a.kind === 'con') return a.name === b.name
  return sameType(a.from, b.from) && sameType(a.to, b.to)
}

/** Head-normal form: still headed by a variable, so it can't be reduced further without knowing the concrete type. */
function inHnf(p) {
  return p.type.kind === 'var'
}

function toHnf(p) {
  if (inHnf(p)) return [p]
  const sub = byInst(p)
  if (sub === null) throw new ContextError(p)
  return toHnfs(sub)
}

function toHnfs(preds) {
  return preds.flatMap(toHnf)
}

/** Drop any predicate already implied by the rest (e.g. drop `Ring a` once `EuclideanRing a` is also present). */
export function simplify(preds) {
  const kept = []
  for (let i = 0; i < preds.length; i++) {
    const rest = [...kept, ...preds.slice(i + 1)]
    if (!entails(rest, preds[i])) kept.push(preds[i])
  }
  return kept
}

/** Full context reduction: discharge concrete-headed preds against the instance table (throws ContextError if unsatisfiable), then drop redundant ones. */
export function reduce(preds) {
  return simplify(toHnfs(preds))
}

/** The predicates (already reduced) whose type is exactly the variable `varId`. */
export function predsOnVar(preds, varId) {
  return preds.filter((p) => p.type.kind === 'var' && p.type.id === varId)
}

const auxiliaryClasses = ['Eq', 'Ord', 'Show']
const numericClasses = Object.keys(superclasses).filter((c) => !auxiliaryClasses.includes(c))

/**
 * GHC's defaulting (Haskell Report §4.3.4 / GHC docs
 * https://ghc.gitlab.haskell.org/ghc/doc/users_guide/exts/type_defaulting.html):
 * a var is defaultable only via its own class preds, at least one of which
 * must be numeric; the first type in `defaultTypes` that satisfies ALL of
 * them wins. Returns a type name (string) or null if none apply / none fit.
 */
export function pickDefault(preds, varId) {
  const qs = predsOnVar(preds, varId)
  if (!qs.length || !qs.some((p) => numericClasses.includes(p.cls))) return null
  return defaultTypes.find((t) => qs.every((p) => entails([], pred(p.cls, { kind: 'con', name: t })))) || null
}
