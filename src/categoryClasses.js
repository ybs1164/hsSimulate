// Declarations of the category-theoretic classes (CLAUDE.md: the type
// structure follows category theory), named after their Haskell homes:
//
//   Semigroup, Monoid   (base: Data.Semigroup, Data.Monoid) — a monoid object
//                       (M, μ = (<>), η = mempty) in the cartesian category
//   PartialOrd, Lattice (lattices package) — a poset is a thin category;
//                       a lattice has its products (/\, meet) and
//                       coproducts (\/, join)
//   VectorSpace         (vector-space package, scalar fixed to Double)
//   Functor, Foldable,  (base) — constructor classes over `f :: * -> *`
//   Traversable,
//   Applicative, Monad
import { declareClass, declareInstance } from './classEnv.js'
import { pred, tapp, tcon, tlist, ttuple, tvar } from './typeSystem.js'

declareClass('Semigroup', [])
declareClass('Monoid', ['Semigroup'])
declareClass('PartialOrd', ['Eq'])
declareClass('Lattice', ['PartialOrd']) // the lattices package keeps these separate; tying them makes `leq` agree with join/meet (a thin category)
declareClass('VectorSpace', ['AddAbelianGroup'])
declareClass('Functor', [], { arity: 1 })
declareClass('Foldable', [], { arity: 1 })
declareClass('Traversable', ['Functor', 'Foldable'], { arity: 1 })
declareClass('Applicative', ['Functor'], { arity: 1 })
declareClass('Monad', ['Applicative'], { arity: 1 })

const $a = tvar('$a')
const app = (name, t) => tapp(tcon(name), t)

// The free monoid: lists under (++) and [].
declareInstance('Semigroup', tlist($a))
declareInstance('Monoid', tlist($a))
// Maybe adjoins an identity to a semigroup (Nothing).
declareInstance('Semigroup', app('Maybe', $a), [pred('Semigroup', $a)])
declareInstance('Monoid', app('Maybe', $a), [pred('Semigroup', $a)])
// A product of monoids is a monoid, componentwise.
const $b = tvar('$b')
declareInstance('Semigroup', ttuple($a, $b), [pred('Semigroup', $a), pred('Semigroup', $b)])
declareInstance('Monoid', ttuple($a, $b), [pred('Monoid', $a), pred('Monoid', $b)])
// Pictures overlay: gloss's Monoid Picture.
declareInstance('Semigroup', tcon('Picture'))
declareInstance('Monoid', tcon('Picture'))
// The terminal object is the trivial monoid.
declareInstance('Semigroup', tcon('()'))
declareInstance('Monoid', tcon('()'))

// Totally ordered carriers are lattices with max/min.
for (const t of ['Bool', 'Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational']) {
  declareInstance('PartialOrd', tcon(t))
  declareInstance('Lattice', tcon(t))
}
for (const t of ['Float', 'Double']) declareInstance('VectorSpace', tcon(t))

// Subscriptions: listening to two things is their monoid product; fmap relabels messages.
declareInstance('Semigroup', app('Sub', $a))
declareInstance('Monoid', app('Sub', $a))
declareInstance('Functor', tcon('Sub'))

// The containers: lists, Maybe, `Either e` and `(,) w` (the writer, an
// applicative and a monad when w is a monoid), as in base.
const containers = [[tcon('List'), []], [tcon('Maybe'), []], [app('Either', $a), []], [app('(,)', $a), [pred('Monoid', $a)]]]
for (const [f, monoidal] of containers) {
  for (const cls of ['Functor', 'Foldable', 'Traversable']) declareInstance(cls, f)
  for (const cls of ['Applicative', 'Monad']) declareInstance(cls, f, monoidal)
}
// Ordering is a monoid (lexicographic: the first non-EQ wins), Either a semigroup (the first Right).
declareInstance('Semigroup', tcon('Ordering'))
declareInstance('Monoid', tcon('Ordering'))
declareInstance('Semigroup', tapp(app('Either', $a), $b))

// Data.Monoid's wrappers (library.js): the ways one carrier combines,
// told apart by type. Sum and Product take the additive and multiplicative
// monoids of the numeric tower; Min and Max the order (a semigroup only:
// an unbounded type has no identity — `Maybe (Max a)` adjoins one);
// First and Last keep an end; Any and All are Bool's (||) and (&&);
// Endo a is the monoid of a → a under composition (End(a) in the category).
declareInstance('Semigroup', app('Sum', $a), [pred('AddSemigroup', $a)])
declareInstance('Monoid', app('Sum', $a), [pred('AddMonoid', $a)])
declareInstance('Semigroup', app('Product', $a), [pred('MulSemigroup', $a)])
declareInstance('Monoid', app('Product', $a), [pred('MulMonoid', $a)])
for (const w of ['Min', 'Max']) declareInstance('Semigroup', app(w, $a), [pred('Ord', $a)])
for (const w of ['First', 'Last']) declareInstance('Semigroup', app(w, $a))
for (const w of ['Any', 'All']) for (const cls of ['Semigroup', 'Monoid']) declareInstance(cls, tcon(w))
for (const cls of ['Semigroup', 'Monoid']) declareInstance(cls, app('Endo', $a))
// State s: the state monad, s → (a, s) — the monad of the adjunction (− × s) ⊣ (s → −).
for (const cls of ['Functor', 'Applicative', 'Monad']) declareInstance(cls, app('State', $a))

/**
 * Classes a product (single-constructor record) may derive pointwise, by
 * the Lawvere-theory rule: a structure given by equations alone survives
 * products. Field (inverses only for non-zero elements) and anything built
 * on a total order (Ord, OrderedRing, …) does not.
 */
export const productLiftable = ['AddSemigroup', 'AddMonoid', 'AddCommutativeMonoid', 'AddGroup', 'AddAbelianGroup', 'MulSemigroup', 'MulMonoid', 'Semiring', 'Ring', 'Semigroup', 'Monoid', 'PartialOrd', 'Lattice', 'VectorSpace']
