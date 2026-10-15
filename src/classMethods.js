// The builtin classes' declarations, as Haskell writes a class: its methods
// (keyed by the builtin that carries each — `eq` is `(==)`) and its minimal
// complete definition, the sets of methods an instance may give, the rest
// following from the class's defaults:
//
//   class Eq a where
//     (==), (/=) :: a -> a -> Bool
//     x /= y = not (x == y);  x == y = not (x /= y)
//     {-# MINIMAL (==) | (/=) #-}
//
// The defaults themselves are run by the evaluator (evaluator.js, "class
// defaults"). A method's type is its builtin's scheme (builtinSchemes.js).
// Classes with no methods of their own (AddAbelianGroup, Semiring, …) only
// add laws: an instance of them is a claim, checked by the law checker.
//
// The conversions out of the numeric tower are methods too, written on the
// source side, where the value says which instance to use: OrderedRing's
// toRational, EuclideanRing's toInteger (with div and mod) and
// OrderedField's properFraction (as Haskell's RealFrac: polymorphic in its
// EuclideanRing part). The way *in* is not a method: ℤ is the initial ring,
// so `fromInteger :: Integer → b` is the unique ring map, fixed by b's Ring
// dictionary (n · mulOne), and fromRational follows by b's (/). Hence
// `fromIntegral = fromInteger . toInteger`, and round, floor … are written
// with properFraction (definitionViews.js).
export const BUILTIN_CLASSES = {
  Eq: { methods: ['eq', 'neq'], minimal: [['eq'], ['neq']] },
  // (>=) alone is enough too: x <= y = y >= x (older projects wrote Ord that way).
  Ord: { methods: ['compare', 'le', 'lt', 'geq', 'gt', 'max', 'min'], minimal: [['compare'], ['le'], ['geq']] },
  Show: { methods: ['show', 'showsPrec'], minimal: [['show'], ['showsPrec']] },
  AddSemigroup: { methods: ['plus'] },
  AddMonoid: { methods: ['addZero'] },
  AddCommutativeMonoid: { methods: [] },
  AddGroup: { methods: ['negate'] },
  AddAbelianGroup: { methods: [] },
  MulSemigroup: { methods: ['times'] },
  MulMonoid: { methods: ['mulOne'] },
  Semiring: { methods: [] },
  Ring: { methods: [] },
  OrderedRing: { methods: ['toRational'] },
  EuclideanRing: { methods: ['toInteger', 'div', 'mod'] },
  Field: { methods: ['divide'] },
  OrderedField: { methods: ['properFraction'] },
  Transcendental: { methods: ['sqrt'] },
  IEEEFloat: { methods: [] },
  Semigroup: { methods: ['mappend'] },
  Monoid: { methods: ['mempty'] },
  PartialOrd: { methods: ['leq'] },
  Lattice: { methods: ['join', 'meet'] },
  VectorSpace: { methods: ['scale'] },
  Functor: { methods: ['fmap'] },
  Foldable: { methods: ['foldMap'] },
  Traversable: { methods: ['traverse'] },
  Applicative: { methods: ['pure', 'ap'] },
  Monad: { methods: ['bind'] },
}

/** Each builtin class's methods. */
export const CLASS_METHODS = Object.fromEntries(Object.entries(BUILTIN_CLASSES).map(([cls, c]) => [cls, c.methods]))

/** The minimal complete definitions of builtin class `cls` (every method, when the class has no defaults). */
export function minimalOf(cls) {
  const c = BUILTIN_CLASSES[cls]
  return c ? c.minimal || [c.methods] : []
}

/** Why the methods `given` aren't a complete definition of builtin class `cls` ('' if they are). */
export function minimalProblem(cls, given) {
  const sets = minimalOf(cls)
  if (!sets.length || sets.some((set) => set.every((m) => given.includes(m)))) return ''
  return `define ${sets.map((set) => set.map((m) => METHOD_LABEL[m]).join(' and ')).join(', or ')}`
}

/** Constructor classes: their instances are for a type constructor (`Functor Pair`), so the type needs a parameter. */
export const CONSTRUCTOR_CLASSES = ['Functor', 'Foldable', 'Traversable', 'Applicative', 'Monad']

/** The class a method builtin belongs to. */
export const METHOD_CLASS = Object.fromEntries(Object.entries(CLASS_METHODS).flatMap(([cls, ms]) => ms.map((m) => [m, cls])))

/** Haskell names of the methods (for labels and generated function names). */
export const METHOD_LABEL = { eq: '(==)', neq: '(/=)', compare: 'compare', le: '(<=)', lt: '(<)', geq: '(>=)', gt: '(>)', max: 'max', min: 'min', show: 'show', showsPrec: 'showsPrec', plus: '(+)', addZero: 'addZero', negate: 'negate', times: '(*)', mulOne: 'mulOne', divide: '(/)', toRational: 'toRational', toInteger: 'toInteger', div: 'div', mod: 'mod', properFraction: 'properFraction', sqrt: 'sqrt', mappend: '(<>)', mempty: 'mempty', leq: 'leq', join: '(\\/)', meet: '(/\\)', scale: '(*^)', fmap: 'fmap', foldMap: 'foldMap', traverse: 'traverse', pure: 'pure', ap: '(<*>)', bind: '(>>=)' }

/** Parameter names for a function implementing each method. */
export const METHOD_PARAMS = { eq: ['x', 'y'], neq: ['x', 'y'], compare: ['x', 'y'], le: ['x', 'y'], lt: ['x', 'y'], geq: ['x', 'y'], gt: ['x', 'y'], max: ['x', 'y'], min: ['x', 'y'], show: ['x'], showsPrec: ['d', 'x'], plus: ['x', 'y'], addZero: [], negate: ['x'], times: ['x', 'y'], mulOne: [], divide: ['x', 'y'], toRational: ['x'], toInteger: ['x'], div: ['x', 'y'], mod: ['x', 'y'], properFraction: ['x'], sqrt: ['x'], mappend: ['x', 'y'], mempty: [], leq: ['x', 'y'], join: ['x', 'y'], meet: ['x', 'y'], scale: ['k', 'v'], fmap: ['f', 'xs'], foldMap: ['f', 'xs'], traverse: ['f', 'xs'], pure: ['x'], ap: ['fs', 'xs'], bind: ['m', 'k'] }
