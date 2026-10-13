// The methods of each class a user may implement by hand (`instance Show
// Wallet where show = …`), keyed by the builtin that carries the method.
// Classes with no methods of their own (AddAbelianGroup, Semiring, …) only
// add laws: an instance of them is a claim, checked by the law checker.
//
// The conversions out of the numeric tower are methods too, written on the
// source side, where the value says which instance to use: OrderedRing's
// toRational, EuclideanRing's toInteger and OrderedField's round (as
// Haskell's RealFrac: polymorphic in its EuclideanRing result). The way *in*
// is not a method: ℤ is the initial ring, so `fromInteger :: Integer → b` is
// the unique ring map, fixed by b's Ring instance (n · mulOne; the
// evaluator's literalAt). Hence `fromIntegral = fromInteger . toInteger`.
export const CLASS_METHODS = {
  Eq: ['eq'],
  Ord: ['geq'],
  Show: ['show'],
  AddSemigroup: ['plus'],
  AddMonoid: ['addZero'],
  AddCommutativeMonoid: [],
  AddGroup: ['negate'],
  AddAbelianGroup: [],
  MulSemigroup: ['times'],
  MulMonoid: ['mulOne'],
  Semiring: [],
  Ring: [],
  OrderedRing: ['toRational'],
  EuclideanRing: ['toInteger'],
  Field: ['divide'],
  OrderedField: ['round'],
  Transcendental: ['sqrt'],
  IEEEFloat: ['isNaN'],
  Semigroup: ['mappend'],
  Monoid: ['mempty'],
  PartialOrd: ['leq'],
  Lattice: ['join', 'meet'],
  VectorSpace: ['scale'],
  Functor: ['fmap'],
  Foldable: ['foldMap'],
}

/** Constructor classes: their instances are for a type constructor (`Functor Pair`), so the type needs a parameter. */
export const CONSTRUCTOR_CLASSES = ['Functor', 'Foldable']

/** The class a method builtin belongs to. */
export const METHOD_CLASS = Object.fromEntries(Object.entries(CLASS_METHODS).flatMap(([cls, ms]) => ms.map((m) => [m, cls])))

/** Haskell names of the methods (for labels and generated function names). */
export const METHOD_LABEL = { eq: '(==)', geq: '(>=)', show: 'show', plus: '(+)', addZero: 'addZero', negate: 'negate', times: '(*)', mulOne: 'mulOne', divide: '(/)', toRational: 'toRational', toInteger: 'toInteger', round: 'round', sqrt: 'sqrt', isNaN: 'isNaN', mappend: '(<>)', mempty: 'mempty', leq: 'leq', join: '(\\/)', meet: '(/\\)', scale: '(*^)', fmap: 'fmap', foldMap: 'foldMap' }

/** Parameter names for a function implementing each method. */
export const METHOD_PARAMS = { eq: ['x', 'y'], geq: ['x', 'y'], show: ['x'], plus: ['x', 'y'], addZero: [], negate: ['x'], times: ['x', 'y'], mulOne: [], divide: ['x', 'y'], toRational: ['x'], toInteger: ['x'], round: ['x'], sqrt: ['x'], isNaN: ['x'], mappend: ['x', 'y'], mempty: [], leq: ['x', 'y'], join: ['x', 'y'], meet: ['x', 'y'], scale: ['k', 'v'], fmap: ['f', 'xs'], foldMap: ['f', 'xs'] }
