// Hand-written type schemes for the 7 read-only builtin nodes.
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
// The 8 entries below bring in the numeric type-class hierarchy (Num, Real,
// Integral, Fractional, Floating, RealFrac, RealFloat — see
// src/numericClasses.js) — one representative Prelude function per class,
// each a genuine *qualified* type (`Num a => ...`), not a plain polymorphic
// one. `plus`/`negate` : Num, `divide` : Fractional, `sqrt` : Floating,
// `toRational` : Real, `fromIntegral` : Integral -> Num, `round` :
// RealFrac -> Integral, `isNaN` : RealFloat.
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

  plus: scheme(['a'], [pred('Num', a)], tfun(a, tfun(a, a))),
  negate: scheme(['a'], [pred('Num', a)], tfun(a, a)),
  divide: scheme(['a'], [pred('Fractional', a)], tfun(a, tfun(a, a))),
  sqrt: scheme(['a'], [pred('Floating', a)], tfun(a, a)),
  toRational: scheme(['a'], [pred('Real', a)], tfun(a, Rational)),
  fromIntegral: scheme(['a', 'b'], [pred('Integral', a), pred('Num', b)], tfun(a, b)),
  round: scheme(['a', 'b'], [pred('RealFrac', a), pred('Integral', b)], tfun(a, b)),
  isNaN: scheme(['a'], [pred('RealFloat', a)], tfun(a, Bool)),
}
