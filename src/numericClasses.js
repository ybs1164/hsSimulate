// Declarations of the numeric type-class hierarchy, built along
// group-theoretic lines — monoids and groups being one-object categories,
// this is the algebra the category-theoretic type structure (CLAUDE.md)
// rests on. The solver that uses these declarations is src/classEnv.js.
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
import { declareClass, declareInstance } from './classEnv.js'
import { tcon } from './typeSystem.js'

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
}
const auxiliary = { Eq: [], Ord: ['Eq'], Show: [] }

for (const [name, supers] of Object.entries(superclasses)) declareClass(name, supers, { numeric: true })
for (const [name, supers] of Object.entries(auxiliary)) declareClass(name, supers)

const closure = (cls) => [...new Set([cls, ...(superclasses[cls] || auxiliary[cls] || []).flatMap(closure)])]

/**
 * Which classes each concrete type instantiates, given only by its most
 * specific classes and closed upward — so "has C ⇒ has every superclass of
 * C" holds by construction, never by hand-maintenance.
 */
const instanceTable = {
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
}
for (const [type, most] of Object.entries(instanceTable)) {
  for (const cls of new Set(most.flatMap(closure))) declareInstance(cls, tcon(type))
}

/** The concrete numeric types a literal or annotation may name, in display order. */
export const numericTypes = ['Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational']

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
