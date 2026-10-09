// The library every project starts with, beyond the builtins on the main
// canvas: the Prelude — functions on lists, Maybe and text (dataTypes.js),
// monoids, games and pictures — by their Haskell names. Each is a
// definition in the same shape as main.js's `nodes` entries, with id
// `prelude:<name>`; they're listed in the sidebar rather than drawn on the
// main canvas, and each can be opened (and edited) as a graph — see
// definitionViews.js.
import { declareTypes, derivedDefinitions } from './typeDecls.js'
export const PRELUDE = [
  ['Numeric', [['toInteger', 'toInteger', ['x']], ['fromInteger', 'fromInteger', ['n']], ['fromRational', 'fromRational', ['r']], ['properFraction', 'properFraction', ['x']], ['div', 'div', ['x', 'y']], ['mod', 'mod', ['x', 'y']], ['abs', 'abs', ['x']], ['fromIntegral', 'fromIntegral', ['x']], ['realToFrac', 'realToFrac', ['x']], ['truncate', 'truncate', ['x']], ['floor', 'floor', ['x']], ['ceiling', 'ceiling', ['x']], ['round', 'round', ['x']]]],
  ['Lists', [['listOf', '[ , , ]', []], ['nil', '[]', []], ['cons', '(:)', ['x', 'xs']], ['foldr', 'foldr', ['f', 'z', 'xs']], ['map', 'map', ['f', 'xs']], ['length', 'length', ['xs']], ['append', '(++)', ['xs', 'ys']], ['index', '(!?)', ['xs', 'i']]]],
  ['Maybe', [['nothing', 'Nothing', []], ['just', 'Just', ['x']], ['maybe', 'maybe', ['default', 'f', 'm']]]],
  ['Text', [['show', 'show', ['x']], ['showFFloat', 'showFFloat', ['digits', 'x']], ['showCompact', 'showCompact', ['x']]]],
  ['Pairs · Random', [['pair', '(,)', ['a', 'b']], ['fst', 'fst', ['p']], ['snd', 'snd', ['p']], ['mkStdGen', 'mkStdGen', ['seed']], ['randomR', 'randomR', ['range', 'gen']], ['randomRInt', 'randomRInt', ['range', 'gen']]]],
  ['Monoid', [['mappend', '(<>)', ['x', 'y']], ['mempty', 'mempty', []], ['mconcat', 'mconcat', ['xs']], ['mkSum', 'Sum', ['x']], ['getSum', 'getSum', ['s']], ['mkProduct', 'Product', ['x']], ['getProduct', 'getProduct', ['p']], ['mkEndo', 'Endo', ['f']], ['appEndo', 'appEndo', ['e', 'x']]]],
  ['Functor · Foldable', [['fmap', 'fmap', ['f', 'xs']], ['foldMap', 'foldMap', ['f', 'xs']]]],
  ['Lattice', [['leq', 'leq', ['x', 'y']], ['join', '(\\/)', ['x', 'y']], ['meet', '(/\\)', ['x', 'y']]]],
  ['VectorSpace', [['scale', '(*^)', ['k', 'v']]]],
  ['Game', [['program', 'program', ['initial', 'view', 'handle', 'step']], ['setStepsPerSecond', 'set stepsPerSecond', ['n', 'program']], ['setMaxOffline', 'set maxOffline', ['seconds', 'program']], ['setSubscriptions', 'set subscriptions', ['subscriptions', 'program']], ['every', 'every', ['seconds', 'msg']], ['onKey', 'onKey', ['handler']], ['wText', 'text', ['s']], ['wButton', 'button', ['label', 'msg']], ['wColumn', 'column', ['widgets']], ['wRow', 'row', ['widgets']], ['wProgress', 'progress', ['fraction']], ['wHeading', 'heading', ['s']], ['wSpacer', 'spacer', ['px']], ['wColor', 'withColor', ['color', 'widget']], ['wDrawing', 'drawing', ['width', 'height', 'picture']]]],
  ['Pictures', [['pCircle', 'circle', ['r']], ['pCircleSolid', 'circleSolid', ['r']], ['pRectangleSolid', 'rectangleSolid', ['w', 'h']], ['pTranslate', 'translate', ['x', 'y', 'picture']], ['pColor', 'color', ['color', 'picture']], ['rgb', 'rgb', ['r', 'g', 'b']], ['red', 'red', []], ['green', 'green', []], ['blue', 'blue', []], ['yellow', 'yellow', []], ['black', 'black', []], ['white', 'white', []]]],
]
export const preludeDefs = Object.fromEntries(PRELUDE.flatMap(([, fns]) => fns).map(([builtin, label, params]) => [`prelude:${builtin}`, { id: `prelude:${builtin}`, type: 'function', builtin, label, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', readonly: true, color: '#5fa8e8' }]))

// The Prelude's own data types, declared in Haskell like a project's types
// (typeDecls.js) — with the constructor order the runtime (evaluator.js,
// runtime.js) uses for their values. Each gives its constructors (the
// injections) and its eliminator `caseT` (and recursor `foldT`) as
// definitions with ids `type:<T>:<name>`; the Prelude functions on these
// types are written with them as graphs (definitionViews.js), so `text`,
// `program`, `set stepsPerSecond`, `maybe`, `getSum`, … are editable.
// Their instances stay those of dataTypes.js and categoryClasses.js.
//
// `Sub e` is abstract: `fmap` relabels a subscription with a hidden `Map`
// constructor that changes the message type (an existential, which a
// declaration can't say), so Sub has no eliminator.
export const PRELUDE_TYPES_SOURCE = `data Maybe a = Nothing | Just a
data Color = RGB Double Double Double
data Picture = Blank | Circle Double | CircleSolid Double | RectangleSolid Double Double | Translate Double Double Picture | Color Color Picture | Pictures Picture Picture
data Widget e = Text String | Button String e | Column [Widget e] | Row [Widget e] | Progress Double | Heading String | Spacer Double | Tinted Color (Widget e) | Drawing Double Double Picture
data Sub e = None | Every Double e | OnKey (String -> Maybe e) | Batch (Sub e) (Sub e)
data Program m e = Program m (m -> Widget e) (e -> m -> m) (Double -> m -> m) Int Double (m -> Sub e)
newtype Sum a = Sum a
newtype Product a = Product a
newtype Endo a = Endo (a -> a)`
export const preludeTypes = declareTypes({}, PRELUDE_TYPES_SOURCE, { builtin: true })
const ABSTRACT = new Set(['Sub'])
export const preludeTypeDefs = Object.fromEntries(derivedDefinitions(preludeTypes)
  .filter((def) => !(ABSTRACT.has(def.derived.type) && ['case', 'fold'].includes(def.derived.op)))
  .map((def) => [def.id, { ...def, color: '#5fa8e8' }]))
