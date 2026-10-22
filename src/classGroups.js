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
// which is what a plain number literal needs. Neither does Haskell split
// Num into its (+) and (*) halves, as this project does so that (+) works
// wherever addition makes sense (vectors, pairs, ℕ): those pieces keep
// their names too, each explained by CLASS_NOTES.

/** The Haskell name a builtin class is shown under (the class itself if it has none). */
export const CLASS_ALIAS = { Ring: 'Num', OrderedRing: 'Real', EuclideanRing: 'Integral', Field: 'Fractional', OrderedField: 'RealFrac', Transcendental: 'Floating', IEEEFloat: 'RealFloat' }
const BY_ALIAS = Object.fromEntries(Object.entries(CLASS_ALIAS).map(([cls, alias]) => [alias, cls]))

/** The name class `cls` is shown under. */
export const classLabel = (cls) => CLASS_ALIAS[cls] || cls
/** The class a written name means: a Haskell alias (`Num`) is its structural class (`Ring`). */
export const canonicalClass = (name) => BY_ALIAS[name] || name

/** What a class is, in a phrase — the pieces of Num most of all, which Haskell has no names for. */
export const CLASS_NOTES = {
  Ring: 'numbers with +, -, * (Haskell\'s Num)',
  Semiring: 'Num without negate: +, *, 0 and 1 — all a whole-number literal needs (ℕ has it)',
  AddSemigroup: 'Num\'s (+) on its own — numbers have it, and so do vectors, pairs and records of them',
  AddMonoid: '(+) with its identity 0',
  AddCommutativeMonoid: '(+) that commutes: x + y = y + x',
  AddGroup: '(+) with negate and (-)',
  AddAbelianGroup: 'a commutative AddGroup — Num\'s additive half, and a vector\'s',
  MulSemigroup: 'Num\'s (*) on its own',
  MulMonoid: '(*) with its identity 1',
}

/** The palette's groups, by task; `advanced` ones start folded. */
export const CLASS_GROUPS = [
  { group: 'Comparing', names: ['Eq', 'Ord'] },
  { group: 'Numbers', names: ['Ring', 'EuclideanRing', 'Field', 'OrderedRing', 'OrderedField', 'Transcendental', 'IEEEFloat', 'Semiring'] },
  // What (+), (-), (*) and their identities ask for: Num, taken apart.
  { group: 'Numbers · the pieces of Num', names: ['AddSemigroup', 'AddMonoid', 'AddGroup', 'AddCommutativeMonoid', 'AddAbelianGroup', 'MulSemigroup', 'MulMonoid'] },
  { group: 'Combining', names: ['Semigroup', 'Monoid'] },
  { group: 'Vectors', names: ['VectorSpace'] },
  { group: 'Containers', names: ['Functor', 'Foldable', 'Traversable'] },
  { group: 'Chained computations', names: ['Applicative', 'Monad'] },
  { group: 'Display', names: ['Show'] },
  { group: 'Advanced · order', names: ['PartialOrd', 'Lattice'], advanced: true },
]

/**
 * The builtin functions (main.js `nodes`), grouped as the Prelude is. The
 * λ-calculus ones are fixed by CLAUDE.md; the rest are the methods of the
 * number and comparison classes, and Bool's eliminator.
 */
export const BUILTIN_GROUPS = [
  { group: 'λ-calculus · fixed', ids: ['identity', 'apply', 'compose', 'zero', 'add', 'isZero', 'ifThenElse'] },
  { group: 'Numbers · (+) (-) (*)', ids: ['plus', 'minus', 'negate', 'addZero', 'times', 'mulOne'] },
  { group: 'Numbers · Fractional, Floating, Real', ids: ['divide', 'sqrt', 'toRational'] },
  { group: 'Comparing · Eq, Ord', ids: ['eq', 'geq'] },
  { group: 'Bool', ids: ['select'] },
]
