// How the classes are shown to a person: grouped by what you want to do
// (not by the hierarchy), and the numeric tower under the Haskell Report's
// names. The names are display aliases only — the solver, stored projects
// and error messages keep the structural names (numericClasses.js).
//
//   Num ≈ Ring, Real ≈ OrderedRing, Integral ≈ EuclideanRing,
//   Fractional ≈ Field, RealFrac ≈ OrderedField, Floating ≈ Transcendental,
//   RealFloat ≈ IEEEFloat
//
// Semiring keeps its name: Haskell has no class for "Num without negate",
// which is what a plain number literal needs.

/** The Haskell name a builtin class is shown under (the class itself if it has none). */
export const CLASS_ALIAS = { Ring: 'Num', OrderedRing: 'Real', EuclideanRing: 'Integral', Field: 'Fractional', OrderedField: 'RealFrac', Transcendental: 'Floating', IEEEFloat: 'RealFloat' }
const BY_ALIAS = Object.fromEntries(Object.entries(CLASS_ALIAS).map(([cls, alias]) => [alias, cls]))

/** The name class `cls` is shown under. */
export const classLabel = (cls) => CLASS_ALIAS[cls] || cls
/** The class a written name means: a Haskell alias (`Num`) is its structural class (`Ring`). */
export const canonicalClass = (name) => BY_ALIAS[name] || name

/** The palette's groups, by task; `advanced` ones start folded. */
export const CLASS_GROUPS = [
  { group: 'Comparing', names: ['Eq', 'Ord'] },
  { group: 'Numbers', names: ['Ring', 'EuclideanRing', 'Field', 'OrderedRing', 'OrderedField', 'Transcendental', 'IEEEFloat', 'Semiring'] },
  { group: 'Combining', names: ['Semigroup', 'Monoid'] },
  { group: 'Vectors', names: ['VectorSpace'] },
  { group: 'Containers', names: ['Functor', 'Foldable', 'Traversable'] },
  { group: 'Chained computations', names: ['Applicative', 'Monad'] },
  { group: 'Display', names: ['Show'] },
  { group: 'Advanced · order', names: ['PartialOrd', 'Lattice'], advanced: true },
  { group: 'Advanced · algebraic structure', names: ['AddSemigroup', 'AddMonoid', 'AddCommutativeMonoid', 'AddGroup', 'AddAbelianGroup', 'MulSemigroup', 'MulMonoid'], advanced: true },
]
