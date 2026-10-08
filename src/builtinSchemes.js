// Hand-written type schemes for the read-only builtin nodes.
// Keyed by `node.builtin` (see src/main.js's `nodes` object).
//
// `identity`, `apply`, `compose` are genuinely polymorphic — this is the
// point of the whole exercise: ∀a. a -> a, ∀a b. (a -> b) -> a -> b,
// ∀a b c. (b -> c) -> (a -> b) -> a -> c.
//
// `isZero` and `ifThenElse` are intentionally left concrete/pinned per
// CLAUDE.md project rules (isZero : Int -> Bool, ifThenElse :
// Bool -> Int -> Int -> Int) even though Haskell's real `if` is
// `Bool -> a -> a -> a`. Do not generalize these two.
//
// The entries below bring in the group-theoretic numeric hierarchy (see
// src/numericClasses.js), each a genuine *qualified* type
// (`AddGroup a => ...`), not a plain polymorphic one. Every function demands
// only the weakest structure it actually needs: `(+)` is just a semigroup
// operation, `negate`/`(-)` need additive inverses (AddGroup), `(*)` a
// multiplicative semigroup, `addZero`/`mulOne` the two monoid identities,
// `(/)` a Field, `sqrt` Transcendental, `toRational` OrderedRing,
// `fromIntegral` EuclideanRing -> Ring (ℤ is the initial ring), `round`
// OrderedField -> EuclideanRing, `isNaN` IEEEFloat. `geq`/`eq` use the
// auxiliary Ord/Eq classes, and `select` is the polymorphic `if` that the
// pinned `ifThenElse` deliberately is not.
import { pred, scheme, tcon, tfun, tvar } from './typeSystem.js'

const a = tvar('a')
const b = tvar('b')
const c = tvar('c')
const Int = tcon('Int')
const Bool = tcon('Bool')
const Rational = tcon('Rational')

export const builtinSchemes = {
  zero: scheme([], [], Int),
  succ: scheme([], [], tfun(Int, Int)), // the `add` node (label "add", builtin: 'succ') — Church successor, Int-specific
  identity: scheme(['a'], [], tfun(a, a)),
  apply: scheme(['a', 'b'], [], tfun(tfun(a, b), tfun(a, b))),
  compose: scheme(['a', 'b', 'c'], [], tfun(tfun(b, c), tfun(tfun(a, b), tfun(a, c)))),
  isZero: scheme([], [], tfun(Int, Bool)),
  ifThenElse: scheme([], [], tfun(Bool, tfun(Int, tfun(Int, Int)))),

  plus: scheme(['a'], [pred('AddSemigroup', a)], tfun(a, tfun(a, a))),
  negate: scheme(['a'], [pred('AddGroup', a)], tfun(a, a)),
  minus: scheme(['a'], [pred('AddGroup', a)], tfun(a, tfun(a, a))),
  times: scheme(['a'], [pred('MulSemigroup', a)], tfun(a, tfun(a, a))),
  addZero: scheme(['a'], [pred('AddMonoid', a)], a),
  mulOne: scheme(['a'], [pred('MulMonoid', a)], a),
  divide: scheme(['a'], [pred('Field', a)], tfun(a, tfun(a, a))),
  sqrt: scheme(['a'], [pred('Transcendental', a)], tfun(a, a)),
  toRational: scheme(['a'], [pred('OrderedRing', a)], tfun(a, Rational)),
  fromIntegral: scheme(['a', 'b'], [pred('EuclideanRing', a), pred('Ring', b)], tfun(a, b)),
  round: scheme(['a', 'b'], [pred('OrderedField', a), pred('EuclideanRing', b)], tfun(a, b)),
  isNaN: scheme(['a'], [pred('IEEEFloat', a)], tfun(a, Bool)),
  geq: scheme(['a'], [pred('Ord', a)], tfun(a, tfun(a, Bool))),
  eq: scheme(['a'], [pred('Eq', a)], tfun(a, tfun(a, Bool))),
  select: scheme(['a'], [], tfun(Bool, tfun(a, tfun(a, a)))),
}
