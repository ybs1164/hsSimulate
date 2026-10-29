// The library every project starts with, beyond the builtins on the main
// canvas: the Prelude — functions on lists, Maybe and text (dataTypes.js),
// monoids, games and pictures — by their Haskell names. Each is a
// definition in the same shape as main.js's `nodes` entries, with id
// `prelude:<name>`; they're listed in the sidebar rather than drawn on the
// main canvas, and each can be opened (and edited) as a graph — see
// definitionViews.js.
import { preludePrimitives } from './definitionViews.js'
import { declareTypes, derivedDefinitions } from './typeDecls.js'
import { primitiveDefinitions } from './typeEdits.js'
import { tvar } from './typeSystem.js'
export const PRELUDE = [
  ['Numeric', [['toInteger', 'toInteger', ['x']], ['fromInteger', 'fromInteger', ['n']], ['fromRational', 'fromRational', ['r']], ['properFraction', 'properFraction', ['x']], ['div', 'div', ['x', 'y']], ['mod', 'mod', ['x', 'y']], ['abs', 'abs', ['x']], ['fromIntegral', 'fromIntegral', ['x']], ['realToFrac', 'realToFrac', ['x']], ['truncate', 'truncate', ['x']], ['floor', 'floor', ['x']], ['ceiling', 'ceiling', ['x']], ['round', 'round', ['x']]]],
  ['Lists', [['listOf', '[ , , ]', []], ['nil', '[]', []], ['cons', '(:)', ['x', 'xs']], ['foldr', 'foldr', ['f', 'z', 'xs']], ['map', 'map', ['f', 'xs']], ['filter', 'filter', ['p', 'xs']], ['any', 'any', ['p', 'xs']], ['all', 'all', ['p', 'xs']], ['take', 'take', ['n', 'xs']], ['drop', 'drop', ['n', 'xs']], ['length', 'length', ['xs']], ['append', '(++)', ['xs', 'ys']], ['index', '(!?)', ['xs', 'i']]]],
  ['App helpers', [['repeatN', 'repeatN', ['n', 'f', 'x']]]],
  ['Bool', [['and', '(&&)', ['p', 'q']], ['or', '(||)', ['p', 'q']], ['not', 'not', ['p']]]],
  ['Eq · Ord', [['neq', '(/=)', ['x', 'y']], ['compare', 'compare', ['x', 'y']], ['le', '(<=)', ['x', 'y']], ['lt', '(<)', ['x', 'y']], ['gt', '(>)', ['x', 'y']], ['max', 'max', ['x', 'y']], ['min', 'min', ['x', 'y']]]],
  ['Maybe', [['nothing', 'Nothing', []], ['just', 'Just', ['x']], ['maybe', 'maybe', ['default', 'f', 'm']]]],
  ['Text', [['show', 'show', ['x']], ['showsPrec', 'showsPrec', ['d', 'x']], ['showFFloat', 'showFFloat', ['digits', 'x']], ['showCompact', 'showCompact', ['x']]]],
  ['Pairs · Random', [['pair', '(,)', ['a', 'b']], ['fst', 'fst', ['p']], ['snd', 'snd', ['p']], ['mkStdGen', 'mkStdGen', ['seed']], ['randomR', 'randomR', ['range', 'gen']], ['randomRInt', 'randomRInt', ['range', 'gen']]]],
  ['Monoid', [['mappend', '(<>)', ['x', 'y']], ['mempty', 'mempty', []]]],
  ['Functor · Foldable', [['fmap', 'fmap', ['f', 'xs']], ['foldMap', 'foldMap', ['f', 'xs']], ['traverse', 'traverse', ['f', 'xs']]]],
  ['Applicative · Monad', [['pure', 'pure', ['x']], ['ap', '(<*>)', ['fs', 'xs']], ['bind', '(>>=)', ['m', 'k']]]],
  ['Lattice', [['leq', 'leq', ['x', 'y']], ['join', '(\\/)', ['x', 'y']], ['meet', '(/\\)', ['x', 'y']]]],
  ['VectorSpace', [['scale', '(*^)', ['k', 'v']]]],
  ['Game', [['program', 'program', ['initial', 'view', 'handle', 'step']], ['setStepsPerSecond', 'set stepsPerSecond', ['n', 'program']], ['setMaxOffline', 'set maxOffline', ['seconds', 'program']], ['setSubscriptions', 'set subscriptions', ['subscriptions', 'program']], ['every', 'every', ['seconds', 'msg']], ['onKey', 'onKey', ['handler']], ['wText', 'text', ['s']], ['wButton', 'button', ['label', 'msg']], ['wColumn', 'column', ['widgets']], ['wRow', 'row', ['widgets']], ['wProgress', 'progress', ['fraction']], ['wHeading', 'heading', ['s']], ['wSpacer', 'spacer', ['px']], ['wColor', 'withColor', ['color', 'widget']], ['wDrawing', 'drawing', ['width', 'height', 'picture']]]],
  ['Pictures', [['pCircle', 'circle', ['r']], ['pCircleSolid', 'circleSolid', ['r']], ['pRectangleSolid', 'rectangleSolid', ['w', 'h']], ['pTranslate', 'translate', ['x', 'y', 'picture']], ['pColor', 'color', ['color', 'picture']], ['rgb', 'rgb', ['r', 'g', 'b']], ['red', 'red', []], ['green', 'green', []], ['blue', 'blue', []], ['yellow', 'yellow', []], ['black', 'black', []], ['white', 'white', []]]],
]
const listHelp = {
  repeatN: '앱 전용 보조 함수(Prelude 표준 아님). n: 반복 횟수(Int, 최대 100) · f: a → a 함수 · x: 시작값. 음수·0은 f를 실행하지 않고 x를 반환합니다. 같은 타입의 새 값을 순서대로 계산하며 실제 클릭·대기·화면 갱신을 일으키지 않습니다.',
  any: 'p: 원소 하나를 받아 Bool을 반환하는 함수 · xs: 리스트 또는 문자열. 처음 True가 나오면 멈추고 True를 반환하며 빈 리스트는 False입니다. (==)의 입력 하나를 비워 p에 연결할 수 있습니다.',
  all: 'p: 원소 하나를 받아 Bool을 반환하는 함수 · xs: 리스트 또는 문자열. 처음 False가 나오면 멈추고 False를 반환합니다. 빈 리스트는 조건을 어기는 원소가 없으므로 True입니다.',
  filter: 'p: 원소 하나를 받아 Bool을 반환하는 함수 · xs: 리스트 또는 문자열. True인 원소만 순서대로 남긴 새 리스트를 반환합니다. (==)의 x만 채운 부분 적용이나 사용자 함수를 p에 연결하세요. 원본은 바뀌지 않습니다.',
  take: 'n: 가져올 개수(Int) · xs: 리스트 또는 문자열. 앞에서 최대 n개를 반환하며 n ≤ 0이면 []입니다. 원본은 바뀌지 않습니다. n은 ±9007199254740991 범위의 안전한 정수만 지원합니다.',
  drop: 'n: 건너뛸 개수(Int) · xs: 리스트 또는 문자열. 앞의 n개를 제외한 나머지를 반환하며 n ≤ 0이면 원래 리스트입니다. 원본은 바뀌지 않습니다. n은 ±9007199254740991 범위의 안전한 정수만 지원합니다.',
}
export const preludeDefs = Object.fromEntries(PRELUDE.flatMap(([, fns]) => fns).map(([builtin, label, params]) => [`prelude:${builtin}`, { id: `prelude:${builtin}`, type: 'function', builtin, label, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', readonly: true, color: '#5fa8e8', ...(listHelp[builtin] ? { description: listHelp[builtin] } : {}) }]))
// The primitives behind the Prelude's own (`show#`, `foldr#`, keyed
// `prim:prelude:<name>`): what a taken-over primitive starts as.
export const preludePrimDefs = preludePrimitives(preludeDefs)

// The Prelude's own data types, declared in Haskell like a project's types
// (typeDecls.js) — with the constructor order the runtime (evaluator.js,
// runtime.js) uses for their values. Each gives its constructors (the
// injections) and its eliminator `caseT` (and recursor `foldT`) as
// definitions with ids `type:<T>:<name>`; the Prelude functions on these
// types are written with them as graphs (definitionViews.js), so `text`,
// `program`, `set stepsPerSecond`, `maybe`, … are editable.
// Their instances stay those of dataTypes.js and categoryClasses.js
// (`caseEither` is Haskell's `either`, `caseOrdering` a three-way branch on
// what `compare` gives).
//
// `Sub e` is abstract: `fmap` relabels a subscription with a hidden `Map`
// constructor that changes the message type (an existential, which a
// declaration can't say), so Sub has no eliminator.
export const PRELUDE_TYPES_SOURCE = `data Maybe a = Nothing | Just a
data Either a b = Left a | Right b
data Ordering = LT | EQ | GT
data Color = RGB Double Double Double
data Picture = Blank | Circle Double | CircleSolid Double | RectangleSolid Double Double | Translate Double Double Picture | Color Color Picture | Pictures Picture Picture
data Widget e = Text String | Button String e | Column [Widget e] | Row [Widget e] | Progress Double | Heading String | Spacer Double | Tinted Color (Widget e) | Drawing Double Double Picture
data Sub e = None | Every Double e | OnKey (String -> Maybe e) | Batch (Sub e) (Sub e)
data Program m e = Program m (m -> Widget e) (e -> m -> m) (Double -> m -> m) Int Double (m -> Sub e)`
//
// The product `(a, b)` is declared too, though its syntax isn't a
// declaration's: `data (a, b) = (,) a b`, a single constructor (the
// pairing ⟨_, _⟩) whose eliminator is Haskell's `uncurry` — so `fst` and
// `snd` are graphs, its two projections.
const PAIR = { name: '(,)', keyword: 'data', params: ['a', 'b'], constructors: [{ name: '(,)', record: false, fields: [{ name: null, type: tvar('a') }, { name: null, type: tvar('b') }] }], deriving: [], instances: [], source: 'data (a, b) = (,) a b' }
export const preludeTypes = { ...declareTypes({}, PRELUDE_TYPES_SOURCE, { builtin: true }), '(,)': PAIR }
const ABSTRACT = new Set(['Sub'])
// uncurry :: (a → b → r) → (a, b) → r — the copairing of a one-constructor type.
const relabel = (def) => (def.id === 'type:(,):case(,)' ? { ...def, id: 'type:(,):uncurry', label: 'uncurry', params: ['f', 'p'] } : def)
export const preludeTypeDefs = Object.fromEntries(derivedDefinitions(preludeTypes)
  .filter((def) => !(ABSTRACT.has(def.derived.type) && ['case', 'fold'].includes(def.derived.op)))
  .map(relabel)
  .map((def) => [def.id, { ...def, color: '#5fa8e8' }]))
// The primitives behind them (`Text#`, `caseMaybe#`, keyed `prim:type:…`):
// what a customized constructor or eliminator of a Prelude type starts as.
export const preludeTypePrimDefs = Object.fromEntries(primitiveDefinitions(Object.values(preludeTypeDefs)).map((def) => [def.id, def]))
/** Every library definition, by id: the Prelude's functions and types, and the primitives behind them. */
export const libraryDefs = { ...preludeTypePrimDefs, ...preludePrimDefs, ...preludeTypeDefs, ...preludeDefs }
