// Declarations of the category-theoretic classes (CLAUDE.md: the type
// structure follows category theory), named after their Haskell homes:
//
//   Semigroup, Monoid   (base: Data.Semigroup, Data.Monoid) — a monoid object
//                       (M, μ = (<>), η = mempty) in the cartesian category
//   PartialOrd, Lattice (lattices package) — a poset is a thin category;
//                       a lattice has its products (/\, meet) and
//                       coproducts (\/, join)
//   VectorSpace         (vector-space package, scalar fixed to Double)
//   Functor, Foldable   (base) — constructor classes over `f :: * -> *`
//
// plus the newtypes that pick one monoid structure on a carrier with
// several (`Sum`, `Product`) and the endomorphism monoid `Endo a`, whose
// (<>) and mempty are composition and the identity — the protected
// builtins `compose` and `identity`.
import { declareClass, declareInstance } from './classEnv.js'
import { pred, tapp, tcon, tlist, tvar } from './typeSystem.js'

declareClass('Semigroup', [])
declareClass('Monoid', ['Semigroup'])
declareClass('PartialOrd', ['Eq'])
declareClass('Lattice', ['PartialOrd']) // the lattices package keeps these separate; tying them makes `leq` agree with join/meet (a thin category)
declareClass('VectorSpace', ['AddAbelianGroup'])
declareClass('Functor', [])
declareClass('Foldable', [])

const $a = tvar('$a')
const app = (name, t) => tapp(tcon(name), t)

// The free monoid: lists under (++) and [].
declareInstance('Semigroup', tlist($a))
declareInstance('Monoid', tlist($a))
// The endomorphism monoid End(a): composition and the identity.
declareInstance('Semigroup', app('Endo', $a))
declareInstance('Monoid', app('Endo', $a))
// Choosing a structure on a carrier: Sum uses (+)/addZero, Product (*)/mulOne.
declareInstance('Semigroup', app('Sum', $a), [pred('AddSemigroup', $a)])
declareInstance('Monoid', app('Sum', $a), [pred('AddMonoid', $a)])
declareInstance('Semigroup', app('Product', $a), [pred('MulSemigroup', $a)])
declareInstance('Monoid', app('Product', $a), [pred('MulMonoid', $a)])
// Maybe adjoins an identity to a semigroup (Nothing).
declareInstance('Semigroup', app('Maybe', $a), [pred('Semigroup', $a)])
declareInstance('Monoid', app('Maybe', $a), [pred('Semigroup', $a)])
// The terminal object is the trivial monoid.
declareInstance('Semigroup', tcon('()'))
declareInstance('Monoid', tcon('()'))
for (const cls of ['Eq', 'Ord', 'Show']) {
  declareInstance(cls, app('Sum', $a), [pred(cls, $a)])
  declareInstance(cls, app('Product', $a), [pred(cls, $a)])
}

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

for (const f of ['List', 'Maybe']) {
  declareInstance('Functor', tcon(f))
  declareInstance('Foldable', tcon(f))
}

/**
 * Classes a product (single-constructor record) may derive pointwise, by
 * the Lawvere-theory rule: a structure given by equations alone survives
 * products. Field (inverses only for non-zero elements) and anything built
 * on a total order (Ord, OrderedRing, …) does not.
 */
export const productLiftable = ['AddSemigroup', 'AddMonoid', 'AddCommutativeMonoid', 'AddGroup', 'AddAbelianGroup', 'MulSemigroup', 'MulMonoid', 'Semiring', 'Ring', 'Semigroup', 'Monoid', 'PartialOrd', 'Lattice', 'VectorSpace']
