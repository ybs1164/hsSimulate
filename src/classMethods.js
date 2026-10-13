// The methods of each class a user may implement by hand (`instance Show
// Wallet where show = …`), keyed by the builtin that carries the method.
// Classes with no methods of their own (AddAbelianGroup, Semiring, …) only
// add laws: an instance of them is a claim, checked by the law checker.
//
// Not listed, so not hand-implementable: the classes whose methods convert
// to or from the numeric tower (OrderedRing's toRational, EuclideanRing's
// fromIntegral, OrderedField's round, Transcendental, IEEEFloat) — their
// runtime is the host's numbers, which a user type isn't.
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
  Field: ['divide'],
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
export const METHOD_LABEL = { eq: '(==)', geq: '(>=)', show: 'show', plus: '(+)', addZero: 'addZero', negate: 'negate', times: '(*)', mulOne: 'mulOne', divide: '(/)', mappend: '(<>)', mempty: 'mempty', leq: 'leq', join: '(\\/)', meet: '(/\\)', scale: '(*^)', fmap: 'fmap', foldMap: 'foldMap' }

/** Parameter names for a function implementing each method. */
export const METHOD_PARAMS = { eq: ['x', 'y'], geq: ['x', 'y'], show: ['x'], plus: ['x', 'y'], addZero: [], negate: ['x'], times: ['x', 'y'], mulOne: [], divide: ['x', 'y'], mappend: ['x', 'y'], mempty: [], leq: ['x', 'y'], join: ['x', 'y'], meet: ['x', 'y'], scale: ['k', 'v'], fmap: ['f', 'xs'], foldMap: ['f', 'xs'] }
