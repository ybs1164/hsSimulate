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
// `isNaN` IEEEFloat. `geq`/`eq` use the
// auxiliary Ord/Eq classes, and `select` is the polymorphic `if` that the
// pinned `ifThenElse` deliberately is not.
import { pred, scheme, tapp, tcon, tfun, tlist, ttuple, tvar } from './typeSystem.js'

const a = tvar('a')
const b = tvar('b')
const c = tvar('c')
const Int = tcon('Int')
const Bool = tcon('Bool')
const Rational = tcon('Rational')
const Integer = tcon('Integer')
const Maybe = (t) => tapp(tcon('Maybe'), t)
const String = tlist(tcon('Char'))
const f = tvar('f')
const t = tvar('t')
const m = tvar('m')
const Double = tcon('Double')
const ap = (h, x) => tapp(h, x)
const newtype = (name, x) => tapp(tcon(name), x)
const e = tvar('e')
const widget = (msg) => tapp(tcon('Widget'), msg)
const sub = (msg) => tapp(tcon('Sub'), msg)
const Picture = tcon('Picture')
const Color = tcon('Color')
const prog = (model, msg) => tapp(tapp(tcon('Program'), model), msg)

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
  isNaN: scheme(['a'], [pred('IEEEFloat', a)], tfun(a, Bool)),
  geq: scheme(['a'], [pred('Ord', a)], tfun(a, tfun(a, Bool))),
  eq: scheme(['a'], [pred('Eq', a)], tfun(a, tfun(a, Bool))),
  select: scheme(['a'], [], tfun(Bool, tfun(a, tfun(a, a)))),

  // Prelude functions on the built-in inductive types (src/dataTypes.js),
  // under their Haskell names. `foldr` and `maybe` are the recursors of
  // `[a]` and `Maybe a`. `listOf` (the `[x, y, z]` node) is variadic: its
  // scheme depends on how many slots the node has — see listOfScheme.
  nil: scheme(['a'], [], tlist(a)),
  cons: scheme(['a'], [], tfun(a, tfun(tlist(a), tlist(a)))),
  foldr: scheme(['a', 'b'], [], tfun(tfun(a, tfun(b, b)), tfun(b, tfun(tlist(a), b)))),
  map: scheme(['a', 'b'], [], tfun(tfun(a, b), tfun(tlist(a), tlist(b)))),
  length: scheme(['a'], [], tfun(tlist(a), Int)),
  append: scheme(['a'], [], tfun(tlist(a), tfun(tlist(a), tlist(a)))),
  index: scheme(['a'], [], tfun(tlist(a), tfun(Int, Maybe(a)))),
  nothing: scheme(['a'], [], Maybe(a)),
  just: scheme(['a'], [], tfun(a, Maybe(a))),
  maybe: scheme(['a', 'b'], [], tfun(b, tfun(tfun(a, b), tfun(Maybe(a), b)))),
  show: scheme(['a'], [pred('Show', a)], tfun(a, String)),
  // Numeric.showFFloat (Just digits) x "" — simplified to take the digit count directly.
  showFFloat: scheme(['a'], [pred('IEEEFloat', a)], tfun(Int, tfun(a, String))), // Haskell's RealFloat a
  // Big numbers the way idle games show them: 999, 1.2K, 3.4M, 5.6B, 7.8T, 1.2Qa …
  showCompact: scheme(['a'], [pred('IEEEFloat', a)], tfun(a, String)),

  // Numeric conversions, the Haskell Report way: the class methods
  // `fromInteger` (Ring — ℤ is the initial ring, the unique ring map out of
  // it), `toInteger` (EuclideanRing — the integral types, embedded in ℤ),
  // `fromRational` (Field),
  // `properFraction` (OrderedField: x = n + r, n integral, |r| < 1) and
  // `div`/`mod` (EuclideanRing, floored) are primitives; the conversions
  // are written with them (src/definitionViews.js) — fromIntegral =
  // fromInteger . toInteger, realToFrac = fromRational . toRational, and
  // truncate/floor/ceiling/round from properFraction.
  toInteger: scheme(['a'], [pred('EuclideanRing', a)], tfun(a, Integer)),
  fromInteger: scheme(['a'], [pred('Ring', a)], tfun(Integer, a)),
  fromRational: scheme(['a'], [pred('Field', a)], tfun(Rational, a)),
  properFraction: scheme(['a', 'b'], [pred('OrderedField', a), pred('EuclideanRing', b)], tfun(a, ttuple(b, a))),
  div: scheme(['a'], [pred('EuclideanRing', a)], tfun(a, tfun(a, a))),
  mod: scheme(['a'], [pred('EuclideanRing', a)], tfun(a, tfun(a, a))),
  abs: scheme(['a'], [pred('OrderedRing', a)], tfun(a, a)),
  fromIntegral: scheme(['a', 'b'], [pred('EuclideanRing', a), pred('Ring', b)], tfun(a, b)),
  realToFrac: scheme(['a', 'b'], [pred('OrderedRing', a), pred('Field', b)], tfun(a, b)),
  truncate: scheme(['a', 'b'], [pred('OrderedField', a), pred('EuclideanRing', b)], tfun(a, b)),
  floor: scheme(['a', 'b'], [pred('OrderedField', a), pred('EuclideanRing', b)], tfun(a, b)),
  ceiling: scheme(['a', 'b'], [pred('OrderedField', a), pred('EuclideanRing', b)], tfun(a, b)),
  round: scheme(['a', 'b'], [pred('OrderedField', a), pred('EuclideanRing', b)], tfun(a, b)),

  // Pairs — the categorical product (a, b) with its projections.
  pair: scheme(['a', 'b'], [], tfun(a, tfun(b, ttuple(a, b)))),
  fst: scheme(['a', 'b'], [], tfun(ttuple(a, b), a)),
  snd: scheme(['a', 'b'], [], tfun(ttuple(a, b), b)),
  // Pure random numbers, System.Random style: the generator is a value you
  // keep (in the model) and thread through. randomR is specialised to
  // Double and randomRInt to Int, since the evaluator is untyped.
  mkStdGen: scheme([], [], tfun(Int, tcon('StdGen'))),
  randomR: scheme([], [], tfun(ttuple(Double, Double), tfun(tcon('StdGen'), ttuple(Double, tcon('StdGen'))))),
  randomRInt: scheme([], [], tfun(ttuple(Int, Int), tfun(tcon('StdGen'), ttuple(Int, tcon('StdGen'))))),

  // Category classes (src/categoryClasses.js), Haskell names.
  mappend: scheme(['a'], [pred('Semigroup', a)], tfun(a, tfun(a, a))),
  mempty: scheme(['a'], [pred('Monoid', a)], a),
  mconcat: scheme(['a'], [pred('Monoid', a)], tfun(tlist(a), a)),
  fmap: scheme(['f', 'a', 'b'], [pred('Functor', f)], tfun(tfun(a, b), tfun(ap(f, a), ap(f, b)))),
  foldMap: scheme(['t', 'm', 'a'], [pred('Foldable', t), pred('Monoid', m)], tfun(tfun(a, m), tfun(ap(t, a), m))),
  leq: scheme(['a'], [pred('PartialOrd', a)], tfun(a, tfun(a, Bool))),
  join: scheme(['a'], [pred('Lattice', a)], tfun(a, tfun(a, a))),
  meet: scheme(['a'], [pred('Lattice', a)], tfun(a, tfun(a, a))),
  scale: scheme(['a'], [pred('VectorSpace', a)], tfun(Double, tfun(a, a))),
  mkSum: scheme(['a'], [], tfun(a, newtype('Sum', a))),
  getSum: scheme(['a'], [], tfun(newtype('Sum', a), a)),
  mkProduct: scheme(['a'], [], tfun(a, newtype('Product', a))),
  getProduct: scheme(['a'], [], tfun(newtype('Product', a), a)),
  mkEndo: scheme(['a'], [], tfun(tfun(a, a), newtype('Endo', a))),
  appEndo: scheme(['a'], [], tfun(newtype('Endo', a), tfun(a, a))),

  // A game, shaped like gloss's `play` (and Elm's Browser.element): the
  // initial model, a view, a message handler and a time step. The view is a
  // declarative widget tree over the message type, like Elm's `Html msg`.
  // The runtime (src/runtime.js) runs a Program when it is the entry point.
  program: scheme(['m', 'e'], [], tfun(m, tfun(tfun(m, widget(e)), tfun(tfun(e, tfun(m, m)), tfun(tfun(Double, tfun(m, m)), tapp(tapp(tcon('Program'), m), e)))))),
  // A Program's settings, changed like record fields (lens-style `set`):
  // how many `step` calls per second, the most time away that counts, and
  // its subscriptions (Elm's): outside events turned into messages.
  setStepsPerSecond: scheme(['m', 'e'], [], tfun(Int, tfun(prog(m, e), prog(m, e)))),
  setMaxOffline: scheme(['m', 'e'], [], tfun(Double, tfun(prog(m, e), prog(m, e)))),
  setSubscriptions: scheme(['m', 'e'], [], tfun(tfun(m, sub(e)), tfun(prog(m, e), prog(m, e)))),
  // Sub e is a Monoid (<> listens to both, mempty to nothing) and a Functor.
  every: scheme(['e'], [], tfun(Double, tfun(e, sub(e)))),
  onKey: scheme(['e'], [], tfun(tfun(String, Maybe(e)), sub(e))),
  wText: scheme(['e'], [], tfun(String, widget(e))),
  wButton: scheme(['e'], [], tfun(String, tfun(e, widget(e)))),
  wColumn: scheme(['e'], [], tfun(tlist(widget(e)), widget(e))),
  wRow: scheme(['e'], [], tfun(tlist(widget(e)), widget(e))),
  wProgress: scheme(['e'], [], tfun(Double, widget(e))),
  wHeading: scheme(['e'], [], tfun(String, widget(e))),
  wSpacer: scheme(['e'], [], tfun(Double, widget(e))),
  wColor: scheme(['e'], [], tfun(Color, tfun(widget(e), widget(e)))),
  wDrawing: scheme(['e'], [], tfun(Double, tfun(Double, tfun(Picture, widget(e))))),
  // Pictures, as in gloss: a Monoid (<> draws one over the other, mempty is
  // blank); the origin is the centre and y points up.
  pCircle: scheme([], [], tfun(Double, Picture)),
  pCircleSolid: scheme([], [], tfun(Double, Picture)),
  pRectangleSolid: scheme([], [], tfun(Double, tfun(Double, Picture))),
  pTranslate: scheme([], [], tfun(Double, tfun(Double, tfun(Picture, Picture)))),
  pColor: scheme([], [], tfun(Color, tfun(Picture, Picture))),
  rgb: scheme([], [], tfun(Double, tfun(Double, tfun(Double, Color)))),
  red: scheme([], [], Color),
  green: scheme([], [], Color),
  blue: scheme([], [], Color),
  yellow: scheme([], [], Color),
  black: scheme([], [], Color),
  white: scheme([], [], Color),
}

/** `[x₁, …, xₙ] :: a → … → a → [a]` for a list node with `n` slots. */
export function listOfScheme(n) {
  return scheme(['a'], [], Array.from({ length: n }).reduce((acc) => tfun(a, acc), tlist(a)))
}
