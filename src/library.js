// The library every project starts with, beyond the builtins on the main
// canvas: the Prelude — functions on lists, Maybe and text (dataTypes.js),
// monoids, games and pictures — by their Haskell names. Each is a
// definition in the same shape as main.js's `nodes` entries, with id
// `prelude:<name>`; they're listed in the sidebar rather than drawn on the
// main canvas, and each can be opened (and edited) as a graph — see
// definitionViews.js.
export const PRELUDE = [
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
