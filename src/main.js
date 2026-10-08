import './style.css'
import { applySubst, ftv, generalize, showQual, tcon, tfun, unify, createNamer, pred } from './typeSystem.js'
import { inferGraph, valueTypeOfEntry } from './inferGraph.js'
import { builtinSchemes, listOfScheme } from './builtinSchemes.js'
import { reduce, predsOnVar, pickDefault, entails, literalClass, numericTypes, setDynamicInstances, productLiftable } from './prelude.js'
import { createEvaluator, EvalError, isClosure, isData, showValue } from './evaluator.js'
import { DeclError, declToDraft, declareTypes, derivedDefinitions, derivedInstances, draftToSource } from './typeDecls.js'
import { FUNCTION_LAWS, checkClassLaws, checkFunctionLaw, lawfulClassesOf } from './laws.js'
import { createGame, isProgram } from './runtime.js'
import { asciiType, printDefinition } from './haskellPrint.js'
import { addParameter, hasVariadicSlots, removeParameter, renameParameter } from './signature.js'
import { ParseError, parseValue } from './valueParser.js'
import { buildClickCounter } from './examples/clickCounter.js'
import { buildBlankGame } from './examples/blankGame.js'
import { renderWidget } from './player.js'
import { PLAYER_MODULES, buildPlayerHtml } from './exportHtml.js'

// The player modules' source text, for bundling into an exported game (Vite inlines these).
const playerSources = Object.fromEntries(Object.entries(import.meta.glob(['./typeSystem.js', './classEnv.js', './dataTypes.js', './literals.js', './evaluator.js', './runtime.js', './player.js'], { query: '?raw', import: 'default', eager: true })).map(([path, code]) => [path.slice(2, -3), code]))
import { STORAGE_KEY, ProjectError, createHistory, mergeBuiltins, parseProject, serializeProject, upgradeProject } from './project.js'

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">λ</span><span>hs / simulate</span><span class="beta">BETA</span></div>
      <div class="top-actions"><span class="status-dot"></span><span>LOCAL RUNTIME</span><button class="icon-button" aria-label="Settings">⚙</button><button class="avatar">YS</button></div>
    </header>
    <section class="workspace">
      <aside class="sidebar">
        <div class="side-heading"><div><span class="eyebrow">WORKSPACE</span><h1>Untitled graph</h1></div><button class="more">•••</button></div>
        <div class="search"><span>⌕</span><input aria-label="Search nodes" placeholder="Search nodes" /><kbd>⌘ K</kbd></div>
        <nav class="node-library">
          <div class="library-title"><span>NODES</span><button class="add-node" aria-label="Add node">+</button></div>
          <div id="function-library"></div>
          <div class="library-title types-title"><span>TYPES</span><button class="add-type" aria-label="Declare a type" title="Declare a type — defined by its constructor functions">+</button></div>
          <div id="type-library"></div>
          <div class="library-title types-title"><span>PRELUDE</span></div>
          <div id="prelude-library"></div>
          <button class="library-item" data-type="number"><span class="lib-icon number-icon">#</span><span><b>Numbers</b><small>Int · Float</small></span></button>
          <button class="library-item" data-type="text"><span class="lib-icon text-icon">Aa</span><span><b>Text</b><small>String = [Char]</small></span></button>
          <button class="library-item" data-type="list"><span class="lib-icon list-icon">[ ]</span><span><b>Lists</b><small>[a, b, c]</small></span></button>
          <button class="library-item" data-type="lambda"><span class="lib-icon function-icon">λ</span><span><b>Lambda</b><small>\\x -> … (anonymous function)</small></span></button>
          <button class="library-item" data-type="boolean"><span class="lib-icon bool-icon">◉</span><span><b>Booleans</b><small>True · False</small></span></button>
        </nav>
        <div class="side-footer"><div class="tip"><span class="tip-icon">i</span><div><b>Try it out</b><p>Drag nodes and use the<br/>play button on a function.</p></div></div><div class="runtime-row"><span>Runtime</span><strong>GHC 9.6.3 <i>●</i></strong></div></div>
      </aside>
      <section class="canvas-panel">
        <div class="canvas-toolbar"><div class="breadcrumbs"><button class="crumb-back" id="back-graph" hidden>← main</button><span>GRAPH</span><span>/</span><b id="graph-name">main</b><span class="saved" id="saved-status"><i></i> <span>Saved just now</span></span></div><div class="toolbar-actions"><button class="tool-button icon-only" id="undo" title="Undo (Ctrl+Z)" disabled>↶</button><button class="tool-button icon-only" id="redo" title="Redo (Ctrl+Shift+Z)" disabled>↷</button><button class="tool-button" id="export" title="Download the project as JSON">⤓ <span>Export</span></button><button class="tool-button" id="import" title="Load a project JSON file">⤒ <span>Import</span></button><input type="file" id="import-file" accept="application/json,.json" hidden /><select class="tool-select" id="template" title="Start from a template (undoable)"><option value="">✦ Templates…</option><option value="clickCounter">Click counter</option><option value="blankGame">Blank game</option></select><button class="tool-button" id="export-game" title="Download the game as one standalone HTML file">⬇ <span>Game</span></button><button class="tool-button" id="reset">↺ <span>Reset</span></button><button class="tool-button primary" id="run">▶ <span>Run graph</span></button></div></div>
        <div class="canvas-wrap"><div id="play-panel" hidden></div><div id="type-panel" hidden></div><canvas id="graph-canvas"></canvas><div id="port-editor"></div><div class="canvas-hint"><span class="mouse-icon">⌖</span><span>Drag to pan · Nodes snap together like magnets</span></div><div class="zoom-control"><button id="zoom-out">−</button><span id="zoom-level">100%</span><button id="zoom-in">+</button><button id="fit">⌗</button><button id="unfold-all" title="Unfold every plugged-in expression onto the canvas">⤢</button><button id="fold-all" title="Fold every expression back into its slot">⤡</button></div></div>
        <footer class="canvas-footer"><span><b id="node-count">2</b> nodes</span><span><b id="connection-count">0</b> connections</span><span class="footer-spacer"></span><span class="shortcut"><kbd>⌘</kbd><kbd>↵</kbd> Run graph</span></footer>
      </section>
      <aside class="inspector"><div class="inspector-title"><span>INSPECTOR</span><button class="close-inspector">×</button></div><div id="inspector-content"></div></aside>
    </section>
  </main>
`

const canvas = document.querySelector('#graph-canvas')
const ctx = canvas.getContext('2d')
const editor = document.querySelector('#port-editor')
const inspector = document.querySelector('#inspector-content')
const state = { functionStack: [], zoom: 1, offset: { x: 0, y: 0 }, selected: 'add', running: false, drag: null, pan: null, snapTarget: null, activeFunction: null, suppressClick: false }
const nodes = {
  add: { id: 'add', type: 'function', x: 300, y: 190, label: 'add', params: ['n'], mounted: [null], paramScopes: ['local'], color: '#6c5ce7', scope: 'main', builtin: 'succ', readonly: true, expression: 'λn f x. f (n f x)' },
  identity: { id: 'identity', type: 'function', x: 820, y: 190, label: 'identity', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#4f8ef7', scope: 'main', builtin: 'identity', readonly: true, expression: 'λx. x' },
  zero: { id: 'zero', type: 'function', x: 300, y: 410, label: 'zero', params: [], mounted: [], paramScopes: [], color: '#a96ef0', scope: 'main', builtin: 'zero', readonly: true, expression: 'λf x. x' },
  apply: { id: 'apply', type: 'function', x: 820, y: 410, label: 'apply', params: ['f', 'x'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#f0954a', scope: 'main', builtin: 'apply', readonly: true, expression: 'λf x. f x' },
  compose: { id: 'compose', type: 'function', x: 300, y: 630, label: 'compose', params: ['f', 'g', 'x'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#2bb8b0', scope: 'main', builtin: 'compose', readonly: true, expression: 'λf g x. f (g x)' },
  isZero: { id: 'isZero', type: 'function', x: 820, y: 630, label: 'isZero', params: ['n'], mounted: [null], paramScopes: ['local'], color: '#ed6b84', scope: 'main', builtin: 'isZero', readonly: true, expression: 'λn. n == 0' },
  ifThenElse: { id: 'ifThenElse', type: 'function', x: 820, y: 850, label: 'ifThenElse', params: ['condition', 'whenTrue', 'whenFalse'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#c77dd6', scope: 'main', builtin: 'ifThenElse', readonly: true, expression: 'λc a b. c ? a : b' },
  // Group-theoretic numeric hierarchy builtins (see src/numericClasses.js) —
  // each demands only the weakest algebraic structure it needs.
  plus: { id: 'plus', type: 'function', x: 300, y: 1070, label: '(+)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#e8b23c', scope: 'main', builtin: 'plus', readonly: true, expression: 'x + y' },
  negate: { id: 'negate', type: 'function', x: 820, y: 1070, label: 'negate', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#8c7cf2', scope: 'main', builtin: 'negate', readonly: true, expression: '-x' },
  divide: { id: 'divide', type: 'function', x: 300, y: 1290, label: '(/)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#35b4e0', scope: 'main', builtin: 'divide', readonly: true, expression: 'x / y' },
  sqrt: { id: 'sqrt', type: 'function', x: 820, y: 1290, label: 'sqrt', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#3cbe84', scope: 'main', builtin: 'sqrt', readonly: true, expression: 'sqrt x' },
  toRational: { id: 'toRational', type: 'function', x: 300, y: 1510, label: 'toRational', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#d66bd1', scope: 'main', builtin: 'toRational', readonly: true, expression: 'toRational x' },
  fromIntegral: { id: 'fromIntegral', type: 'function', x: 820, y: 1510, label: 'fromIntegral', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#ec7550', scope: 'main', builtin: 'fromIntegral', readonly: true, expression: 'fromIntegral x' },
  round: { id: 'round', type: 'function', x: 300, y: 1730, label: 'round', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#86c24c', scope: 'main', builtin: 'round', readonly: true, expression: 'round x' },
  isNaN: { id: 'isNaN', type: 'function', x: 820, y: 1730, label: 'isNaN', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#e85c9e', scope: 'main', builtin: 'isNaN', readonly: true, expression: 'isNaN x' },
  minus: { id: 'minus', type: 'function', x: 300, y: 1950, label: '(-)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#5fa8e8', scope: 'main', builtin: 'minus', readonly: true, expression: 'x - y' },
  times: { id: 'times', type: 'function', x: 820, y: 1950, label: '(*)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#f0954a', scope: 'main', builtin: 'times', readonly: true, expression: 'x * y' },
  addZero: { id: 'addZero', type: 'function', x: 300, y: 2170, label: 'addZero', params: [], mounted: [], paramScopes: [], color: '#4fc2c2', scope: 'main', builtin: 'addZero', readonly: true, expression: '0 (additive identity)' },
  mulOne: { id: 'mulOne', type: 'function', x: 820, y: 2170, label: 'mulOne', params: [], mounted: [], paramScopes: [], color: '#b98fef', scope: 'main', builtin: 'mulOne', readonly: true, expression: '1 (multiplicative identity)' },
  geq: { id: 'geq', type: 'function', x: 300, y: 2390, label: '(>=)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#ed8fa8', scope: 'main', builtin: 'geq', readonly: true, expression: 'x >= y' },
  eq: { id: 'eq', type: 'function', x: 820, y: 2390, label: '(==)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#3cbe9e', scope: 'main', builtin: 'eq', readonly: true, expression: 'x == y' },
  select: { id: 'select', type: 'function', x: 820, y: 2610, label: 'select', params: ['condition', 'whenTrue', 'whenFalse'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#c77dd6', scope: 'main', builtin: 'select', readonly: true, expression: 'λc a b. c ? a : b' },
}
function activeNodes() { return state.activeFunction ? functionBodies[state.activeFunction] : nodes }
function activeName() { return state.activeFunction ? [...state.functionStack, state.activeFunction].map((id) => nodes[id]?.label || '?').join(' / ') : 'main' }
const functionBodies = {
  add: {
    inputX: { id: 'add-input-x', type: 'parameter', typeName: 'Int', x: 110, y: 180, label: 'x', value: 'x', color: '#4f8ef7' },
    output: { id: 'add-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'x + 1', expression: 'x + 1', color: '#2fbf8f' },
  },
  identity: {
    inputX: { id: 'identity-input-x', type: 'parameter', typeName: 'Int', x: 110, y: 255, label: 'x', value: 'x', color: '#4f8ef7' },
    output: { id: 'identity-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'x', expression: '\\x -> x', color: '#2fbf8f' },
  },
  zero: {
    output: { id: 'zero-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: '0', expression: '0', color: '#2fbf8f' },
  },
  apply: {
    output: { id: 'apply-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'f x', expression: 'f x', color: '#2fbf8f' },
  },
  compose: {
    output: { id: 'compose-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'f (g x)', expression: 'f (g x)', color: '#2fbf8f' },
  },
  isZero: {
    inputN: { id: 'isZero-input-n', type: 'parameter', typeName: 'Int', x: 110, y: 255, label: 'n', value: 'n', color: '#4f8ef7' },
    output: { id: 'isZero-output', type: 'output', typeName: 'Bool', x: 570, y: 255, label: 'Output', value: 'n == 0', expression: 'n == 0', color: '#2fbf8f' },
  },
  ifThenElse: {
    inputCondition: { id: 'ifThenElse-input-condition', type: 'parameter', typeName: 'Bool', x: 110, y: 150, label: 'condition', value: 'condition', color: '#ed6b84' },
    inputTrue: { id: 'ifThenElse-input-true', type: 'parameter', typeName: 'Int', x: 110, y: 255, label: 'whenTrue', value: 'whenTrue', color: '#4f8ef7' },
    inputFalse: { id: 'ifThenElse-input-false', type: 'parameter', typeName: 'Int', x: 110, y: 360, label: 'whenFalse', value: 'whenFalse', color: '#4f8ef7' },
    output: { id: 'ifThenElse-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'condition ? whenTrue : whenFalse', expression: 'condition ? whenTrue : whenFalse', color: '#2fbf8f' },
  },
}
let outputId = 0
// The function `Run graph` (and Ctrl+Enter) plays — a node id in `nodes`.
let entryId = 'add'
// Everything in `nodes`/`functionBodies` at startup is a builtin; kept so a
// loaded project can be reconciled with this version's builtins.
const builtinNodes = structuredClone(nodes)
const builtinBodies = structuredClone(functionBodies)
// User type declarations (see typeDecls.js) and the read-only functions
// derived from them — constructors, field projections and updates, and
// each type's eliminator. Derived definitions don't live in `nodes` (that
// would put them on the main canvas); `definitions` is the lookup the type
// pass and the evaluator use: every function definition, real or derived.
let types = {}
const derivedDefs = {}
// Prelude functions on lists, Maybe and text (src/dataTypes.js), by their
// Haskell names. Like derived definitions they're listed in the sidebar
// rather than drawn on the main canvas.
const PRELUDE = [
  ['Lists', [['listOf', '[ , , ]', ['x1', 'x2', 'x3']], ['nil', '[]', []], ['cons', '(:)', ['x', 'xs']], ['foldr', 'foldr', ['f', 'z', 'xs']], ['map', 'map', ['f', 'xs']], ['length', 'length', ['xs']], ['append', '(++)', ['xs', 'ys']], ['index', '(!?)', ['xs', 'i']]]],
  ['Maybe', [['nothing', 'Nothing', []], ['just', 'Just', ['x']], ['maybe', 'maybe', ['default', 'f', 'm']]]],
  ['Text', [['show', 'show', ['x']], ['showFFloat', 'showFFloat', ['digits', 'x']], ['showCompact', 'showCompact', ['x']]]],
  ['Pairs · Random', [['pair', '(,)', ['a', 'b']], ['fst', 'fst', ['p']], ['snd', 'snd', ['p']], ['mkStdGen', 'mkStdGen', ['seed']], ['randomR', 'randomR', ['range', 'gen']], ['randomRInt', 'randomRInt', ['range', 'gen']]]],
  ['Monoid', [['mappend', '(<>)', ['x', 'y']], ['mempty', 'mempty', []], ['mconcat', 'mconcat', ['xs']], ['mkSum', 'Sum', ['x']], ['getSum', 'getSum', ['s']], ['mkProduct', 'Product', ['x']], ['getProduct', 'getProduct', ['p']], ['mkEndo', 'Endo', ['f']], ['appEndo', 'appEndo', ['e', 'x']]]],
  ['Functor · Foldable', [['fmap', 'fmap', ['f', 'xs']], ['foldMap', 'foldMap', ['f', 'xs']]]],
  ['Lattice', [['leq', 'leq', ['x', 'y']], ['join', '(\\/)', ['x', 'y']], ['meet', '(/\\)', ['x', 'y']]]],
  ['VectorSpace', [['scale', '(*^)', ['k', 'v']]]],
  ['Game', [['program', 'program', ['initial', 'view', 'handle', 'step']], ['setStepsPerSecond', 'set stepsPerSecond', ['n', 'program']], ['setMaxOffline', 'set maxOffline', ['seconds', 'program']], ['setSubscriptions', 'set subscriptions', ['subscriptions', 'program']], ['every', 'every', ['seconds', 'msg']], ['onKey', 'onKey', ['handler']], ['wText', 'text', ['s']], ['wButton', 'button', ['label', 'msg']], ['wColumn', 'column', ['widgets']], ['wRow', 'row', ['widgets']], ['wProgress', 'progress', ['fraction']]]],
]
const preludeDefs = Object.fromEntries(PRELUDE.flatMap(([, fns]) => fns).map(([builtin, label, params]) => [`prelude:${builtin}`, { id: `prelude:${builtin}`, type: 'function', builtin, label, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', readonly: true, color: '#5fa8e8' }]))
const definitions = new Proxy({}, { get: (_, id) => nodes[id] ?? derivedDefs[id] ?? preludeDefs[id] })
function applyTypes(next) {
  types = next
  Object.keys(derivedDefs).forEach((id) => delete derivedDefs[id])
  derivedDefinitions(types).forEach((def) => { derivedDefs[def.id] = def })
  setDynamicInstances(derivedInstances(types))
}
const evaluator = createEvaluator({ nodes: definitions, functionBodies, get types() { return types } })
const history = createHistory()
const functionLibrary = document.querySelector('#function-library')

function renderFunctionLibrary() {
  functionLibrary.innerHTML = Object.values(nodes).filter((n) => isFunction(n) && !n.lambda).map((node) => `
    <button class="library-item function-library-item ${state.activeFunction === node.id ? 'active' : ''}" data-function-id="${node.id}">
      <span class="lib-icon function-icon">ƒ</span>
      <span><b>${node.label}</b><small>${functionSignature(node, nodes)}</small></span>
    </button>
  `).join('')
  functionLibrary.querySelectorAll('.function-library-item').forEach((item) => {
    item.addEventListener('click', () => onLibraryFunction(item.dataset.functionId))
  })
  renderTypeLibrary()
  applySearch()
}
// A λ (anonymous function), by lambda lifting: a hidden custom function
// owned by the graph it was made in, plus a call node to it — which *is* the
// λ on the canvas. Its slots are the λ's parameters; plugging an outer value
// into one captures it (a lifted capture is just an applied argument), and
// slots left open are what the λ still takes.
let lambdaCount = 0
function createLambda() {
  const graph = activeNodes()
  const id = `lambda-${Date.now()}-${++lambdaCount}`
  nodes[id] = { id, type: 'function', label: 'λ', params: ['x'], mounted: [null], paramScopes: ['local'], scope: 'local', color: '#8b7cf2', custom: true, lambda: true, x: -9999, y: -9999 }
  functionBodies[id] = createFunctionBody(id, ['x'])
  addFunctionCall(id)
  renderFunctionLibrary()
  showToast('λ added — double-click it (or Open body) to define it; plug outer values into its slots to capture them')
}
// Clicking a function in the library: a custom function opens its body when
// you're on `main`; anything else (or inside a body) drops a call to it.
function onLibraryFunction(id) {
  if (!state.activeFunction && nodes[id]?.custom) enterFunction(id)
  else addFunctionCall(id)
}
function renderPreludeLibrary() {
  document.querySelector('#prelude-library').innerHTML = PRELUDE.map(([group, fns]) => `<div class="prelude-group">${group}</div>${fns.map(([builtin]) => {
    const def = preludeDefs[`prelude:${builtin}`]
    const sch = builtin === 'listOf' ? listOfScheme(3) : builtinSchemes[builtin]
    return `<button class="derived-item" data-function-id="${def.id}" title="Add to the canvas"><b>${def.label}</b><small>${showQual(sch.preds, sch.type)}</small></button>`
  }).join('')}`).join('')
  document.querySelectorAll('#prelude-library .derived-item').forEach((item) => { item.onclick = () => addFunctionCall(item.dataset.functionId) })
  applySearch()
}
// --- Search ---------------------------------------------------------------
// Filters every sidebar entry — functions, functions derived from types,
// the Prelude — by name or signature. Enter adds the first hit to the graph
// you're looking at (a custom function on `main` opens its body instead).
const searchInput = document.querySelector('.search input')
function searchHits() {
  return [...document.querySelectorAll('.function-library-item, #type-library .derived-item, #prelude-library .derived-item')].filter((item) => !item.hidden)
}
function applySearch() {
  const q = searchInput.value.trim().toLowerCase()
  const matches = (el) => !q || el.textContent.toLowerCase().includes(q)
  document.querySelectorAll('.function-library-item, #prelude-library .derived-item').forEach((item) => { item.hidden = !matches(item) })
  document.querySelectorAll('#type-library .type-entry').forEach((entry) => {
    const typeHit = matches(entry.querySelector('.type-item'))
    const items = [...entry.querySelectorAll('.derived-item')]
    items.forEach((item) => { item.hidden = !(typeHit || matches(item)) })
    entry.hidden = !typeHit && items.every((item) => item.hidden)
  })
  // A Prelude group heading shows only while one of its entries does.
  document.querySelectorAll('#prelude-library .prelude-group').forEach((heading) => {
    let el = heading.nextElementSibling
    let any = false
    while (el && !el.classList.contains('prelude-group')) { if (!el.hidden) any = true; el = el.nextElementSibling }
    heading.hidden = !any
  })
}
searchInput.addEventListener('input', applySearch)
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const hit = searchHits()[0]
    if (!hit) return showToast(`Nothing matches "${searchInput.value}"`)
    hit.click()
    searchInput.value = ''
    applySearch()
    searchInput.blur()
  } else if (event.key === 'Escape') {
    searchInput.value = ''
    applySearch()
    searchInput.blur()
  }
})
const typeLibrary = document.querySelector('#type-library')
function renderTypeLibrary() {
  const byType = Object.groupBy(Object.values(derivedDefs), (def) => def.derived.type)
  typeLibrary.innerHTML = Object.values(types).map((d) => `
    <div class="type-entry">
      <button class="library-item type-item" data-type-name="${d.name}" title="Edit declaration">
        <span class="lib-icon type-icon">T</span>
        <span><b>${d.name}</b><small>${d.constructors.map((c) => c.name).join(' | ')}${d.deriving.length ? ` · deriving (${d.deriving.flatMap((c) => c.classes).join(', ')})` : ''}</small></span>
      </button>
      ${(byType[d.name] || []).map((def) => `<button class="derived-item" data-function-id="${def.id}" title="Add to the canvas"><b>${def.label}</b><small>${showQual(def.scheme.preds, def.scheme.type)}</small></button>`).join('')}
    </div>`).join('')
  typeLibrary.querySelectorAll('.type-item').forEach((item) => { item.onclick = () => openTypeEditor(item.dataset.typeName) })
  typeLibrary.querySelectorAll('.derived-item').forEach((item) => { item.onclick = () => addFunctionCall(item.dataset.functionId) })
}
// The laws of every algebraic instance a declared type has, checked on
// samples by actually running them (src/laws.js).
function lawReport(typeName) {
  const classes = lawfulClassesOf(tcon(typeName))
  if (!classes.length) return ''
  const rows = classes.flatMap((cls) => {
    const { results, skipped } = checkClassLaws(cls, tcon(typeName), { ev: evaluator, types })
    if (skipped) return [`<li class="law skipped">${cls}: ${escapeAttr(skipped)}</li>`]
    return results.map((r) => `<li class="law ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} <b>${r.cls}</b> ${escapeAttr(r.law)}${r.ok ? '' : ` — <em>${escapeAttr(r.counterexample)}</em>`}</li>`)
  })
  return `<div class="law-report"><label>LAWS (checked on samples)</label><ul>${rows.join('')}</ul></div>`
}
// --- Type editor -------------------------------------------------------------
// A type is shown and edited as what defines it: its constructor functions.
// Each constructor is drawn like a function block whose fields are written
// inside it (`clicks :: Double`), with the resulting signature underneath
// (`Model :: Double → Model`). Every edit is turned back into a Haskell
// declaration (typeDecls.js' draftToSource) and checked by declareTypes; a
// valid edit applies at once (undoable), an invalid one shows why and waits.
const typePanel = document.querySelector('#type-panel')
let typeEditor = null // { original: name of the declaration being edited (null until first applied), draft }
const STOCK_CLASSES = ['Eq', 'Ord', 'Show']
const GENERICALLY_CLASSES = ['Semigroup', 'Monoid']
const NEWTYPE_CLASSES = ['Eq', 'Ord', 'Show', 'AddSemigroup', 'AddMonoid', 'AddCommutativeMonoid', 'AddGroup', 'AddAbelianGroup', 'MulSemigroup', 'MulMonoid', 'Semiring', 'Ring', 'OrderedRing', 'EuclideanRing', 'Field', 'OrderedField', 'Transcendental', 'IEEEFloat', 'PartialOrd', 'Lattice', 'Semigroup', 'Monoid']

function openTypeEditor(name = null) {
  stopGame()
  if (!name) {
    // A new type: one constructor without fields, under a free name — valid at once.
    let n = 1
    while (types[`NewType${n === 1 ? '' : n}`]) n++
    const draft = declToDraft(null)
    draft.name = draft.constructors[0].name = `NewType${n === 1 ? '' : n}`
    typeEditor = { original: null, draft }
    applyTypeDraft()
  } else typeEditor = { original: name, draft: declToDraft(types[name]) }
  typePanel.hidden = false
  renderTypeEditor()
}

function closeTypeEditor() {
  typeEditor = null
  typePanel.hidden = true
  typePanel.innerHTML = ''
}

// Check the draft; apply it if valid. Returns the error message, or ''.
function applyTypeDraft() {
  try {
    const labels = [...Object.values(nodes).filter((n) => isFunction(n) && !n.sourceFunctionId), ...Object.values(preludeDefs)].map((n) => n.label)
    const next = declareTypes(types, draftToSource(typeEditor.draft), { replacing: typeEditor.original, functionLabels: labels })
    applyTypes(next)
    typeEditor.original = typeEditor.draft.name
    renderFunctionLibrary(); updateInspector(); draw()
    return ''
  } catch (e) {
    if (!(e instanceof DeclError)) throw e
    return e.message
  }
}

function renderTypeEditor(error = '') {
  if (!typeEditor) return
  const d = typeEditor.draft
  const applied = typeEditor.original && types[typeEditor.original]
  const sigOf = (ctorName) => {
    const def = derivedDefs[`type:${typeEditor.original}:${ctorName}`]
    return def ? showQual(def.scheme.preds, def.scheme.type) : ''
  }
  const check = (group, cls) => `<label class="te-check"><input type="checkbox" data-group="${group}" value="${cls}" ${d.deriving[group].includes(cls) ? 'checked' : ''}/> ${cls}</label>`
  const anyclass = productLiftable.filter((c) => !GENERICALLY_CLASSES.includes(c))
  const derived = applied ? Object.values(derivedDefs).filter((def) => def.derived.type === typeEditor.original) : []
  typePanel.innerHTML = `
    <div class="play-bar type-bar"><b>TYPE</b>
      <select class="te-keyword" title="data: any constructors · newtype: exactly one constructor with one field"><option ${d.keyword === 'data' ? 'selected' : ''}>data</option><option ${d.keyword === 'newtype' ? 'selected' : ''}>newtype</option></select>
      <input class="te-name" value="${escapeAttr(d.name)}" title="Type name" spellcheck="false" />
      <span class="te-status ${error ? 'bad' : 'ok'}">${error ? escapeAttr(error) : applied ? '✓ applied' : ''}</span>
      <button class="tool-button" data-te="delete">Delete type</button>
      <button class="tool-button icon-only" data-te="close" title="Back to the canvas">×</button>
    </div>
    <div class="type-body">
      <p class="te-hint">A type is its constructors. Each constructor is a function; write its fields inside it as <code>name :: Type</code> (name them all for a record, or none). The functions below are made from it.</p>
      ${d.constructors.map((c, ci) => `
        <div class="te-ctor" data-ci="${ci}">
          <span class="te-head">ƒ</span>
          <input class="te-cname" value="${escapeAttr(c.name)}" title="Constructor name" spellcheck="false" />
          ${c.fields.map((f, fi) => `<span class="te-field"><input class="te-fname" data-fi="${fi}" value="${escapeAttr(f.name)}" placeholder="name" spellcheck="false" /><i>::</i><input class="te-ftype" data-fi="${fi}" value="${escapeAttr(f.type)}" placeholder="Type" spellcheck="false" /><button class="te-x" data-te="drop-field" data-fi="${fi}" title="Remove field">−</button></span>`).join('')}
          <button class="te-add" data-te="add-field" title="Add a field">+</button>
          ${d.constructors.length > 1 ? '<button class="te-x te-drop-ctor" data-te="drop-ctor" title="Remove constructor">×</button>' : ''}
          <div class="te-sig">${escapeAttr(sigOf(c.name) ? `${c.name} :: ${sigOf(c.name)}` : '')}</div>
        </div>`).join('')}
      <button class="use-again te-add-ctor" data-te="add-ctor">+ constructor (a sum type: one of these)</button>
      <div class="property"><label>DERIVING</label>
        <div class="te-group"><small>stock</small>${STOCK_CLASSES.map((c) => check('stock', c)).join('')}</div>
        <div class="te-group"><small>pointwise (anyclass, product only)</small>${anyclass.map((c) => check('anyclass', c)).join('')}</div>
        <div class="te-group"><small>via Generically (product only)</small>${GENERICALLY_CLASSES.map((c) => check('via', c)).join('')}</div>
        ${d.keyword === 'newtype' ? `<div class="te-group"><small>newtype (from the wrapped type)</small>${NEWTYPE_CLASSES.map((c) => check('newtype', c)).join('')}</div>` : ''}
      </div>
      ${derived.length ? `<div class="property"><label>MADE FROM IT</label>${derived.map((def) => `<div class="te-derived"><b>${escapeAttr(def.label)}</b> <small>${escapeAttr(showQual(def.scheme.preds, def.scheme.type))}</small></div>`).join('')}</div>` : ''}
      ${applied ? lawReport(typeEditor.original) : ''}
    </div>`
  const update = (mutate) => { mutate(d); renderTypeEditor(applyTypeDraft()) }
  const $ = (sel) => typePanel.querySelector(sel)
  $('.te-keyword').onchange = (e) => update(() => { d.keyword = e.target.value; if (d.keyword !== 'newtype') d.deriving.newtype = [] })
  $('.te-name').onchange = (e) => update(() => {
    const old = d.name
    d.name = e.target.value.trim()
    // a lone constructor named after the type follows its rename (the Haskell convention)
    if (d.constructors.length === 1 && d.constructors[0].name === old) d.constructors[0].name = d.name
  })
  typePanel.querySelectorAll('.te-ctor').forEach((row) => {
    const c = d.constructors[Number(row.dataset.ci)]
    row.querySelector('.te-cname').onchange = (e) => update(() => { c.name = e.target.value.trim() })
    row.querySelectorAll('.te-fname').forEach((input) => { input.onchange = () => update(() => { c.fields[Number(input.dataset.fi)].name = input.value.trim() }) })
    row.querySelectorAll('.te-ftype').forEach((input) => { input.onchange = () => update(() => { c.fields[Number(input.dataset.fi)].type = input.value.trim() }) })
    row.querySelectorAll('[data-te="drop-field"]').forEach((b) => { b.onclick = () => update(() => { c.fields.splice(Number(b.dataset.fi), 1) }) })
    row.querySelector('[data-te="add-field"]').onclick = () => update(() => {
      const record = c.fields.some((f) => f.name)
      let k = c.fields.length + 1
      while (c.fields.some((f) => f.name === `field${k}`)) k++
      c.fields.push({ name: record || !c.fields.length ? `field${k}` : '', type: 'Double' })
    })
    row.querySelector('[data-te="drop-ctor"]')?.addEventListener('click', () => update(() => { d.constructors.splice(Number(row.dataset.ci), 1) }))
  })
  $('[data-te="add-ctor"]').onclick = () => update(() => {
    let k = d.constructors.length + 1
    while (d.constructors.some((c) => c.name === `${d.name}${k}`)) k++
    d.constructors.push({ name: `${d.name}${k}`, fields: [] })
  })
  typePanel.querySelectorAll('.te-check input').forEach((box) => {
    box.onchange = () => update(() => {
      const list = d.deriving[box.dataset.group]
      if (box.checked) list.push(box.value)
      else list.splice(list.indexOf(box.value), 1)
    })
  })
  $('[data-te="close"]').onclick = closeTypeEditor
  $('[data-te="delete"]').onclick = () => {
    const name = typeEditor.original
    if (!name) return closeTypeEditor()
    const prefix = `type:${name}:`
    const calls = [nodes, ...Object.values(functionBodies)].flatMap((g) => Object.values(g)).filter((n) => n.sourceFunctionId?.startsWith(prefix)).length
    const usedIn = Object.values(types).filter((t) => t.name !== name && JSON.stringify(t.constructors).includes(`"name":"${name}"`)).map((t) => t.name)
    if (calls || usedIn.length) return renderTypeEditor(`${name} is still used${calls ? ` by ${calls} call node${calls > 1 ? 's' : ''}` : ''}${usedIn.length ? ` in ${usedIn.join(', ')}` : ''}`)
    const next = { ...types }
    delete next[name]
    applyTypes(next)
    closeTypeEditor()
    renderFunctionLibrary(); updateInspector(); draw()
    showToast(`Deleted type ${name} (undo to bring it back)`)
  }
}

function addFunctionCall(sourceId) {
  const source = definitions[sourceId]
  if (!source) return
  const graph = activeNodes()
  const id = `call-${sourceId}-${Date.now()}`
  graph[id] = {
    id, type: 'function', sourceFunctionId: sourceId,
    ...freePosition(graph, 120 + source.params.length * SLOT_STRIDE),
    label: source.label, params: source.params.map(() => ''),
    mounted: source.params.map(() => null), paramScopes: source.params.map(() => 'local'),
    scope: 'local', color: source.color,
  }
  state.selected = id
  updateInspector()
  draw()
}

function createFunctionBody(id, params) {
  const body = {}
  params.forEach((name, index) => {
    body[`input-${id}-${index}`] = {
      id: `input-${id}-${index}`, type: 'parameter',
      x: 110, y: 180 + index * 120, label: name, value: name, color: '#4f8ef7',
    }
  })
  body.output = {
    id: 'output', type: 'output', x: 570, y: 255,
    label: 'Output', value: params[0] || '0', color: '#2fbf8f',
  }
  if (params.length) body.output.source = `input-${id}-0`
  return body
}

function createCustomFunction() {
  if (document.querySelector('#function-dialog')) return
  const dialog = document.createElement('div')
  dialog.id = 'function-dialog'
  dialog.innerHTML = `<form class="function-form"><h2>새 커스텀 함수</h2><label>함수 이름<input name="label" value="customFn" required /></label><label>매개변수 <small>(쉼표로 구분)</small><input name="params" value="x, y" /></label><p>생성 후 함수 본체에서 노드를 Output에 연결하세요.</p><div><button type="button" data-cancel>취소</button><button class="tool-button primary">생성</button></div></form>`
  document.body.append(dialog)
  const form = dialog.querySelector('form')
  dialog.querySelector('[data-cancel]').onclick = () => dialog.remove()
  form.onsubmit = (event) => {
    event.preventDefault()
    const label = new FormData(form).get('label').toString().trim()
    const params = new FormData(form).get('params').toString().split(',').map(param => param.trim()).filter(Boolean)
    if (Object.values(nodes).some(node => node.label === label)) return window.alert(`이미 존재하는 함수 이름입니다: ${label}`)
    if (new Set(params).size !== params.length) return window.alert('매개변수 이름은 중복될 수 없습니다.')
    const id = `custom-${Date.now()}`
    nodes[id] = { id, type: 'function', ...freePosition(nodes, 120 + params.length * SLOT_STRIDE), label, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true }
    functionBodies[id] = createFunctionBody(id, params)
    state.selected = id
    dialog.remove()
    renderFunctionLibrary()
    functionLibrary.querySelector(`[data-function-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    updateInspector()
    draw()
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (canvas.clientWidth < 760) {
    nodes.add.x = 220
  }
  draw()
}
// --- Node geometry --------------------------------------------------------
// A function IS a value in this language, so a function block and a value
// chip are drawn as the exact same shape: a white stadium/pill with a
// neutral outline, a flat offset shadow, one small round head badge on the
// left, and a label underneath. A function block is just the wide version
// with embedded holes; a value chip is the same pill with no holes because
// every one of its arguments is already filled in (down to zero of them).
// World-space units; screen coordinates always come from `point()`/
// `toScreen()` (zoom + pan applied).
//
// Every embedded parameter slot is, likewise, one plain circle regardless of
// what it expects — deliberately NOT Scratch's shape-per-concrete-type
// convention (oval for numbers, hexagon for booleans, ...): this app's types
// are Hindley-Milner, so a slot can just as easily expect an open type
// variable (`a`) as a concrete `Int`/`Bool`, and a fixed shape set has
// nothing sensible to draw for "any type that unifies".
//
// Color is spent deliberately narrowly, to keep the canvas reading as one
// calm, mostly-monochrome surface: every pill's big surfaces (fill, border,
// shadow) are neutral ink/white, with violet reserved for selection/brand,
// and color only appears in the one small head badge per node — a violet ƒ
// for anything function-shaped, a TYPE-colored dot (colorForType below) for
// everything else. Two slots/badges sharing a color still means "same
// type", including a still-open type variable colored by its own display
// letter (e.g. apply's `f :: a -> b` and its `x :: a` read as the same
// color even though neither is pinned to a concrete type yet) — that part
// is unchanged, just confined to a smaller footprint now.
const FN_H = 96          // function block height
const FN_LEFT = 46       // world px from node.x (head badge center) to the block's left edge
const SLOT_START = 118   // world px from node.x to the first parameter slot's center
const SLOT_STRIDE = 94   // world px between consecutive slot centers
const SLOT_D = 64        // embedded parameter slot circle diameter
const FN_TAIL = 52       // right padding after the last slot before the block's right edge — room for the ▶ badge on the top border, clear of the last slot's tag
const TAG_MIN_ZOOM = .45 // below this zoom slot tags are hidden (too small to read)
const TAG_GAP = 8        // world px kept free between neighbouring slot tags (a tag is at most SLOT_STRIDE - TAG_GAP wide)
const CHIP_W = 132       // value/boolean/output/curried chip width — same pill language as the function block, just shorter
const CHIP_H = 64        // chip height — matches SLOT_D so a standalone chip reads as the same unit as an embedded slot
const SNAP_RADIUS = 130  // world-space magnet radius: highlight + auto-connect distance
const TYPE_COLORS = { Int: '#4f8ef7', Integer: '#e8b23c', Word: '#35b4e0', Float: '#3cbe84', Double: '#a96ef0', Rational: '#d66bd1', Natural: '#e07a5f', Bool: '#ed6b84' }
const VAR_PALETTE = ['#8b7cf2', '#5fa8e8', '#3cbe9e', '#e8b23c', '#ed8fa8', '#4fc2c2', '#b98fef', '#f0954a']
const FN_TYPE_COLOR = '#6c5ce7'
const NEUTRAL_BORDER = '#d6d1e8'  // shared, undecorated outline for every pill — function block or value chip alike
const ACCENT = '#6c5ce7'
function colorForType(type, namer) {
  if (!type) return '#9691a8'
  if (type.kind === 'fun') return FN_TYPE_COLOR
  if (type.kind === 'con') return TYPE_COLORS[type.name] || '#9691a8'
  if (type.kind === 'app') return colorForType(type.fn, namer) // `Maybe Int` reads as its head, `Maybe`
  return VAR_PALETTE[namer(type.id).charCodeAt(0) % VAR_PALETTE.length]
}
// Still worth flagging that a slot wants a function specifically — not as a
// shape, just placeholder text ("ƒ" vs "?") so the affordance stays legible.
function slotExpectsFunction(node, index, pass) { return pass.perNode.get(node.id)?.paramTypes?.[index]?.kind === 'fun' }
function point(node) { return { x: node.x * state.zoom + state.offset.x, y: node.y * state.zoom + state.offset.y } }
function toScreen(world) { return { x: world.x * state.zoom + state.offset.x, y: world.y * state.zoom + state.offset.y } }
function slotWorldCenter(node, index) { return { x: node.x + SLOT_START + index * SLOT_STRIDE, y: node.y } }
function slotScreenCenter(node, index) { return toScreen(slotWorldCenter(node, index)) }
function functionBlockLeft(node) { return node.x - FN_LEFT }
function functionBlockRight(node) {
  return node.params.length > 0
    ? node.x + SLOT_START + (node.params.length - 1) * SLOT_STRIDE + SLOT_D / 2 + FN_TAIL
    : node.x + 78
}
function functionBlockWidth(node) { return functionBlockRight(node) - functionBlockLeft(node) }
function functionBlockScreenRect(node) {
  const p = point(node)
  return {
    left: p.x + (functionBlockLeft(node) - node.x) * state.zoom,
    right: p.x + (functionBlockRight(node) - node.x) * state.zoom,
    top: p.y - (FN_H / 2) * state.zoom,
    height: FN_H * state.zoom,
  }
}
function pointInFunctionBlock(node, x, y) { return x >= functionBlockLeft(node) && x <= functionBlockRight(node) && Math.abs(y - node.y) <= FN_H / 2 }
// Value/boolean/output/curried chip geometry — the same rect-plus-stadium-
// radius recipe as the function block above, just fixed-width since these
// never grow embedded slots.
function valueBlockScreenRect(node) {
  const p = point(node)
  return {
    left: p.x - (CHIP_W / 2) * state.zoom,
    right: p.x + (CHIP_W / 2) * state.zoom,
    top: p.y - (CHIP_H / 2) * state.zoom,
    height: CHIP_H * state.zoom,
  }
}
function pointInValueBlock(node, x, y) { return Math.abs(x - node.x) <= CHIP_W / 2 && Math.abs(y - node.y) <= CHIP_H / 2 }
// World-space bounding box of every node currently on screen (skips anything
// mounted into a slot, same filter draw() uses) — the block/chip's own rect
// widened with fixed padding for what draw() puts just outside that rect:
// the param-tag pills above a function block's slots, and the two label
// lines below every block/chip.
function graphBounds(graphNodes = Object.values(activeNodes()).filter(isVisible)) {
  if (!graphNodes.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  graphNodes.forEach((n) => {
    const isFn = n.type === 'function'
    const left = isFn ? functionBlockLeft(n) : n.x - CHIP_W / 2
    const right = isFn ? functionBlockRight(n) : n.x + CHIP_W / 2
    const halfH = (isFn ? FN_H : CHIP_H) / 2
    minX = Math.min(minX, left); maxX = Math.max(maxX, right)
    minY = Math.min(minY, n.y - halfH - 40); maxY = Math.max(maxY, n.y + halfH + 50)
  })
  return { minX, minY, maxX, maxY }
}
// Real "fit to content": zooms/pans so every node on the active graph sits
// inside the canvas viewport, instead of the old #fit handler which just
// reset to a hardcoded zoom/offset and left anything below the fold (e.g.
// the lower rows of the 15-node main graph) cut off below the canvas edge.
function fitToView() {
  const w = canvas.clientWidth, h = canvas.clientHeight
  const bounds = graphBounds()
  const PAD = 36
  if (!bounds) { state.zoom = 1; state.offset = { x: 0, y: 0 } } else {
    const boundsW = bounds.maxX - bounds.minX, boundsH = bounds.maxY - bounds.minY
    const zoom = Math.min((w - PAD * 2) / boundsW, (h - PAD * 2) / boundsH, 1.4)
    state.zoom = Math.max(.15, zoom)
    state.offset.x = PAD - bounds.minX * state.zoom + Math.max(0, (w - PAD * 2 - boundsW * state.zoom)) / 2
    state.offset.y = PAD - bounds.minY * state.zoom + Math.max(0, (h - PAD * 2 - boundsH * state.zoom)) / 2
  }
  document.querySelector('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`
  draw()
}
// Where to put a newly added node of roughly `width` world px: the free spot
// nearest the middle of what's on screen, searched outward ring by ring so
// it lands visible and clear of existing nodes.
function freePosition(graph, width) {
  const view = { left: -state.offset.x / state.zoom, top: -state.offset.y / state.zoom, right: (canvas.clientWidth - state.offset.x) / state.zoom, bottom: (canvas.clientHeight - state.offset.y) / state.zoom }
  const cx = (view.left + view.right) / 2 - width / 2
  const cy = (view.top + view.bottom) / 2
  const overlaps = (x, y) => Object.values(graph).some((n) => {
    if (!isVisible(n)) return false
    const left = n.type === 'function' ? functionBlockLeft(n) : n.x - CHIP_W / 2
    const right = n.type === 'function' ? functionBlockRight(n) : n.x + CHIP_W / 2
    return Math.abs(n.y - y) < FN_H + 40 && x - FN_LEFT - 40 < right && x + width + 40 > left
  })
  const inside = (x, y) => x - FN_LEFT >= view.left + 30 && x + width <= view.right - 30 && y - FN_H / 2 >= view.top + 30 && y + FN_H / 2 + 50 <= view.bottom - 30
  const stepX = width + 80, stepY = FN_H + 50
  // Prefer a free spot on screen; zoomed in on a small body there may be
  // none, so then take the nearest free spot anywhere (and bring it into
  // view) — never stack a node on top of another.
  for (const mustBeVisible of [true, false]) {
    for (let ring = 0; ring < 14; ring++) {
      for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const x = cx + dx * stepX, y = cy + dy * stepY
        if ((!mustBeVisible || inside(x, y)) && !overlaps(x, y)) {
          if (!mustBeVisible) requestAnimationFrame(() => fitToView())
          return { x, y }
        }
      }
    }
  }
  return { x: cx, y: cy }
}
function roundedRectPath(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r)
  c.closePath()
}
// One inferGraph() pass over `graph` (defaults to whatever's on screen). Not
// cached — cheap for this app's graph sizes, and always fresh so a
// connect/disconnect is reflected on the very next call, no invalidation needed.
function typePass(graph = activeNodes()) { return inferGraph(definitions, functionBodies, graph) }
// Shared per-draw() letter assignment (a, b, c, ...) so every node label and
// port-type badge drawn in the same pass agrees on which variable is which —
// reset at the top of draw(). A caller outside that pass (e.g. the sidebar
// library list) omits `namer` and gets its own fresh lettering, which is
// fine: it's a separate inferGraph() pass with its own fresh type variables
// anyway, so there's nothing to stay consistent with across passes.
let labelNamer = createNamer()
// `pass` defaults to a fresh typePass() when not given, so every existing
// caller keeps working unchanged. Pass one in explicitly (as draw() does)
// when several nodes/ports need to be read from the SAME inference pass —
// otherwise e.g. `plus`'s two ports, which genuinely share one type
// variable, would each trigger their own independent inferGraph() call and
// get unrelated fresh ids for what should display as the same letter.
function functionSignature(node, graph = activeNodes(), namer, pass = typePass(graph)) {
  const entry = pass.perNode.get(node.id)
  return entry?.paramTypes ? showQual(entry.preds || [], entry.paramTypes.reduceRight((acc, t) => tfun(t, acc), entry.resultType), namer) : '?'
}
function isFunction(node) { return node.type === 'function' }
function expectedParamType(node, index, graph = activeNodes(), namer, pass = typePass(graph)) {
  const entry = pass.perNode.get(node.id)
  const t = entry?.paramTypes?.[index]
  if (!t) return '?'
  const relevant = t.kind === 'var' ? predsOnVar(entry.preds || [], t.id) : []
  return showQual(relevant, t, namer)
}
// The (preds, Type) of `node` as a value — a function node folds to its
// arrow type, so it can be unified against a Function-shaped slot (e.g.
// apply's `f`). Preds are whatever's still pending on that value (e.g. an
// unconnected numeric literal carries `Semiring a` until something pins it).
function resolvedValueQual(node, graph = activeNodes(), pass = typePass(graph)) {
  const entry = pass.perNode.get(node.id)
  return { preds: entry?.preds || [], type: valueTypeOfEntry(entry) }
}
function canConnect(source, target, index) {
  const pass = typePass()
  const expected = pass.perNode.get(target.id)?.paramTypes?.[index]
  if (!expected) return false
  try {
    const s2 = unify(valueTypeOfEntry(pass.perNode.get(source.id)), expected, pass.subst)
    // Unification alone doesn't know about classes — it would happily let a
    // function value (e.g. identity :: x -> x) bind to a `Semiring a` slot.
    // Re-check every outstanding predicate against the hypothetical result;
    // reduce() throws if any of them turns out unsatisfiable (wrong concrete
    // type, or a fun-headed type where a numeric one was required).
    reduce(pass.preds.map((p) => pred(p.cls, applySubst(s2, p.type))))
    return true
  } catch {
    return false
  }
}
function nodeTypeLabel(node) { return node.type === 'boolean' ? 'Boolean · Bool' : node.type === 'curried' ? 'Curried function' : node.type === 'ref' ? 'Reference · another use (Δ)' : node.type === 'parameter' ? 'Parameter' : node.type === 'value' ? `Value · ${node.data?.type ?? '?'}` : node.type === 'text' ? 'Text · String' : `Number · ${node.annotation || 'literal'}` }
// The short text a node shows inside its chip / a slot's nested chip. A
// reference shows what it refers to, so it always reads the same as its
// original even after the original's value is edited.
function nodeDisplayText(node, graph = activeNodes()) {
  if (!node) return '?'
  if (node.type === 'ref') return `↪ ${nodeDisplayText(graph[node.target], graph)}`
  if (node.type === 'function') return `ƒ ${node.label}`
  if (node.type === 'curried') return node.value || 'ƒ'
  if (node.type === 'output') return node.value ?? 'Output'
  if (node.type === 'value') return showValue(node.data, types)
  if (node.type === 'text') return JSON.stringify(String(node.value ?? ''))
  return String(node.value ?? node.label)
}
// Another use of `n`'s value — the diagonal Δ : A → A × A. A node can only be
// plugged into one slot, so to use a value twice (say a parameter `m` read by
// two calls), plug in references to it.
function useAgain(n) {
  const graph = activeNodes()
  const original = n.type === 'ref' ? graph[n.target] : n
  if (!original) return
  const id = `ref-${Date.now()}`
  graph[id] = { id, type: 'ref', target: original.id, label: `↪ ${original.label}`, x: n.x + 40, y: n.y + 90 }
  state.selected = id
  updateInspector(); draw()
}
// A node plugged into a slot normally lives inside that slot's chip. It can
// be *unfolded*: drawn on the canvas as well, with a link into its slot, so
// its own slots can be seen and edited. Purely a view — it stays plugged in.
function isVisible(n) { return !n.lambda && (!n.mountedTo || n.unfolded) } // a λ's (lifted) definition is never drawn — its call node is the λ
function slotHost(n) {
  const [hostId, index] = String(n.mountedTo || '').split(':')
  const host = activeNodes()[hostId]
  return host && host.type === 'function' ? { host, index: Number(index) } : null
}
function drawUnfoldedLinks() {
  ctx.save()
  ctx.strokeStyle = '#b8b2cf'; ctx.lineWidth = 1.5
  Object.values(activeNodes()).filter((n) => n.mountedTo && n.unfolded).forEach((n) => {
    const at = slotHost(n)
    if (!at || !isVisible(at.host)) return
    const from = toScreen({ x: n.type === 'function' ? functionBlockRight(n) : n.x + CHIP_W / 2, y: n.y })
    const to = slotScreenCenter(at.host, at.index)
    const mid = (from.x + to.x) / 2
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.bezierCurveTo(mid, from.y, mid, to.y, to.x, to.y + (SLOT_D / 2) * state.zoom); ctx.stroke()
  })
  ctx.restore()
}
function setUnfolded(n, unfolded) {
  n.unfolded = unfolded
  if (unfolded) { layoutTree(slotHost(n)?.host || n); fitToView() } // keep what was just unfolded in view
  else draw()
}
// Unfold everything plugged into a slot in the current graph and lay each
// expression tree out right-to-left from its root (arguments to the left of
// the call that uses them), or fold everything back into its slots.
function setAllUnfolded(unfolded) {
  const graph = activeNodes()
  Object.values(graph).forEach((n) => { if (n.mountedTo) n.unfolded = unfolded })
  if (unfolded) Object.values(graph).filter((n) => !n.mountedTo && n.type === 'function').forEach(layoutTree)
  draw(); fitToView()
}
const TREE_ROW = FN_H + 70
const TREE_GAP = 70
function nodeWidth(n) { return n.type === 'function' ? functionBlockWidth(n) : CHIP_W }
function rightEdge(n) { return n.type === 'function' ? functionBlockRight(n) : n.x + CHIP_W / 2 }
function setRightEdge(n, right) { n.x = n.type === 'function' ? right - (functionBlockRight(n) - n.x) : right - CHIP_W / 2 }
function unfoldedKids(n) {
  const graph = activeNodes()
  return (n.mounted || []).map((id) => graph[id]).filter((k) => k && k.unfolded)
}
function treeHeight(n) {
  const kids = unfoldedKids(n)
  return kids.length ? Math.max(TREE_ROW, kids.reduce((sum, k) => sum + treeHeight(k), 0)) : TREE_ROW
}
// Keep `root` where it is; place its unfolded arguments in a column to its
// left, each subtree stacked in its own band, recursively.
function layoutTree(root) {
  const place = (n, right, top) => {
    const h = treeHeight(n)
    setRightEdge(n, right)
    n.y = top + h / 2
    const left = n.type === 'function' ? functionBlockLeft(n) : n.x - CHIP_W / 2
    let y = top
    unfoldedKids(n).forEach((k) => { place(k, left - TREE_GAP, y); y += treeHeight(k) })
  }
  place(root, rightEdge(root), root.y - treeHeight(root) / 2)
}
// A solid link from whatever feeds a function body's Output into it.
function drawOutputLink() {
  const output = activeNodes().output
  const source = output?.source && activeNodes()[output.source]
  if (!source || !isVisible(source)) return
  const from = toScreen({ x: source.type === 'function' ? functionBlockRight(source) : source.x + CHIP_W / 2, y: source.y })
  const to = toScreen({ x: output.x - CHIP_W / 2, y: output.y })
  ctx.save()
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke()
  ctx.beginPath(); ctx.arc(to.x, to.y, 4, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill()
  ctx.restore()
}
// A dashed hairline from each free-standing reference back to its original.
function drawReferenceLinks() {
  const graph = activeNodes()
  ctx.save()
  ctx.setLineDash([4 * state.zoom, 4 * state.zoom]); ctx.strokeStyle = '#b8b2cf'; ctx.lineWidth = 1
  Object.values(graph).filter((n) => n.type === 'ref' && isVisible(n)).forEach((ref) => {
    const target = graph[ref.target]
    if (!target || !isVisible(target)) return
    const a = point(ref), b = point(target)
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  })
  ctx.restore()
}
function draw() {
  labelNamer = createNamer()
  const pass = typePass() // shared by every node label and port badge below, so nodes/ports that truly share a type variable display the same letter
  const w = canvas.clientWidth, h = canvas.clientHeight
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#f8f7fc'; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#ecebf5'; ctx.lineWidth = 1
  for (let x = state.offset.x % 24; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = state.offset.y % 24; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  drawReferenceLinks()
  drawOutputLink()
  drawUnfoldedLinks()
  Object.values(activeNodes()).filter(isVisible).forEach(n => {
    const selected = state.selected === n.id
    const snapHighlight = n.type === 'output' && state.snapTarget?.kind === 'output'
    if (n.type === 'function') drawFunctionBlock(n, pass, selected)
    else drawValueChip(n, pass, selected, snapHighlight)
  })
  updatePortEditor(pass)
  document.querySelector('#node-count').textContent = Object.keys(activeNodes()).length
  document.querySelector('#connection-count').textContent = Object.values(activeNodes()).filter(n => n.connected).length
  document.querySelector('#graph-name').textContent = activeName()
  document.querySelector('#back-graph').hidden = !state.activeFunction
  // Every mutation ends in a draw(), so this is the one place that notices
  // them — debounced, and skipped mid-drag so a drag records one step.
  if (!state.drag) scheduleCheckpoint()
}
// A function node renders as one unified stadium block — the ƒ head badge
// and every parameter slot live inside the SAME silhouette (no separate
// satellite circles/connecting line), so the block's proportions stay clean
// regardless of how many parameters it has. Corner radius is exactly half
// the block's height, i.e. a true stadium/pill — the same silhouette
// drawValueChip below draws at a smaller size, so "function" and "value"
// are visibly the same shape family, differing only in whether the pill has
// holes in it.
function drawFunctionBlock(node, pass, selected) {
  const rect = functionBlockScreenRect(node), p = point(node)
  ctx.save()
  ctx.shadowColor = selected ? `${ACCENT}40` : '#211d3414'; ctx.shadowBlur = 0; ctx.shadowOffsetY = selected ? 4 : 3
  roundedRectPath(ctx, rect.left, rect.top, rect.right - rect.left, rect.height, (FN_H / 2) * state.zoom)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.shadowColor = 'transparent'; ctx.lineWidth = selected ? 3 : 2; ctx.strokeStyle = selected ? ACCENT : NEUTRAL_BORDER; ctx.stroke()
  ctx.beginPath(); ctx.arc(p.x, p.y, 23 * state.zoom, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = `700 ${22 * state.zoom}px 'Space Grotesk', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ƒ', p.x, p.y + 1)
  const playX = rect.right - 24 * state.zoom, playY = rect.top + 2 * state.zoom
  ctx.beginPath(); ctx.arc(playX, playY, 13 * state.zoom, 0, Math.PI * 2); ctx.fillStyle = '#211d34'; ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = `${11 * state.zoom}px sans-serif`; ctx.fillText('▶', playX + 1, playY + 1)
  label(node, p, rect.top + rect.height, pass)
  ctx.restore()
}
// Value/boolean/output/curried chips share the function block's exact
// stadium silhouette above (white fill, neutral outline, flat offset
// shadow) — a value is just a function with every hole already filled, so
// it gets the same pill, only shorter. The one place color still lives is
// the small head badge on the left: a violet ƒ for anything function-shaped
// (a curried partial application, or a function value plugged in), a
// TYPE-colored dot (see colorForType) for everything else — the sidebar's
// own glyphs (#, ◉, →) carry over so the badge reads consistently with the
// node library.
function drawValueChip(node, pass, selected, snapHighlight) {
  const rect = valueBlockScreenRect(node), p = point(node)
  const isFunctionValued = node.type === 'curried'
  const typeColor = colorForType(resolvedValueQual(node, activeNodes(), pass).type, labelNamer)
  const badgeColor = isFunctionValued ? ACCENT : typeColor
  const glyph = isFunctionValued ? 'ƒ' : node.type === 'output' ? '→' : node.type === 'boolean' ? '◉' : node.type === 'ref' ? '↪' : node.type === 'value' ? '◆' : node.type === 'text' ? '"' : '#'
  ctx.save()
  ctx.shadowColor = snapHighlight ? `${ACCENT}66` : selected ? `${ACCENT}40` : '#211d3414'
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 3
  roundedRectPath(ctx, rect.left, rect.top, rect.right - rect.left, rect.height, (CHIP_H / 2) * state.zoom)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = snapHighlight ? 4 : selected ? 3 : 2
  ctx.strokeStyle = snapHighlight || selected ? ACCENT : NEUTRAL_BORDER
  ctx.stroke()
  const badgeX = rect.left + 30 * state.zoom
  ctx.beginPath(); ctx.arc(badgeX, p.y, 15 * state.zoom, 0, Math.PI * 2); ctx.fillStyle = badgeColor; ctx.fill()
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'
  ctx.font = isFunctionValued ? `700 ${14 * state.zoom}px 'Space Grotesk', sans-serif` : `700 ${11 * state.zoom}px ui-monospace, monospace`
  ctx.fillText(glyph, badgeX, p.y + 1)
  const content = nodeDisplayText(node)
  ctx.save() // clip long content (e.g. a wired-up output's "ƒ compose") to the pill so it can't bleed past the rounded right cap
  roundedRectPath(ctx, rect.left, rect.top, rect.right - rect.left, rect.height, (CHIP_H / 2) * state.zoom)
  ctx.clip()
  ctx.textAlign = 'left'; ctx.fillStyle = '#211d34'; ctx.font = `600 ${12 * state.zoom}px ui-monospace, monospace`
  ctx.fillText(content, badgeX + 24 * state.zoom, p.y + 1, rect.right - (badgeX + 24 * state.zoom) - 10 * state.zoom)
  ctx.restore()
  label(node, p, rect.top + rect.height, pass)
  ctx.restore()
}
function label(node, p, baseY, pass) {
  ctx.fillStyle = '#2b2640'; ctx.font = `600 ${13 * state.zoom}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.fillText(node.label, p.x, baseY + 20 * state.zoom)
  const q = node.type === 'function' ? null : resolvedValueQual(node, activeNodes(), pass)
  const signature = node.type === 'function' ? functionSignature(node, activeNodes(), labelNamer, pass) : showQual(q.preds, q.type, labelNamer)
  if (signature) { ctx.fillStyle = '#9691a8'; ctx.font = `${11 * state.zoom}px ui-monospace, monospace`; ctx.fillText(signature, p.x, baseY + 37 * state.zoom) }
}
// The declared parameter name at this call site's index (e.g. `n`, `x`,
// `condition`) when known, so a slot can label itself meaningfully instead
// of a generic "input N".
// A canonical definition node's `params` double as its slot *contents* (type
// `3` into add's slot and params[0] becomes '3'), so the declared name comes
// from the builtin as shipped, or a custom function's body parameter nodes.
function paramDisplayName(node, index) {
  const sourceId = node.sourceFunctionId || node.id
  const declared = builtinNodes[sourceId]?.params?.[index]
    ?? Object.values(functionBodies[sourceId] || {}).filter((n) => n.type === 'parameter')[index]?.label
  return declared || definitions[sourceId]?.params?.[index] || `#${index + 1}`
}
// Unmounts whatever is plugged into `node`'s slot `index` and returns it
// (or null) — used by both the "−" remove-parameter button and the
// drag-to-detach gesture on a filled slot's chip. Always clears BOTH sides
// of the connection so a moving node never comes back stuck with a stale
// mountedTo pointing at a slot that no longer references it.
function detachMounted(node, index) {
  const mountedId = node.mounted[index]
  const moving = mountedId ? activeNodes()[mountedId] : null
  node.params[index] = ''
  node.mounted[index] = null
  if (moving) { moving.mountedTo = null; moving.connected = false; moving.unfolded = false }
  return moving
}
// 'signature' for a custom function's own definition, 'elements' for a list literal, else false.
function isSignatureEditable(node) {
  if (nodes[node.id] === node && node.custom) return 'signature'
  if (nodes[node.sourceFunctionId]?.lambda) return 'signature'
  if (hasVariadicSlots(node, definitions)) return 'elements'
  return false
}
function updatePortEditor(pass = typePass()) {
  // The overlay is rebuilt from scratch on every draw(), including the one a
  // keystroke in a slot triggers — remember which slot had focus (and the
  // caret) so typing `12` doesn't lose focus after the `1`.
  const focused = editor.contains(document.activeElement) && document.activeElement.classList.contains('param-value')
    ? { fn: document.activeElement.closest('.param-slot').dataset.functionId, index: document.activeElement.closest('.param-slot').dataset.index, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : null
  editor.innerHTML = ''
  // A function node plugged into a slot is hidden (it lives in that slot's
  // nested chip), so its own slots aren't shown either.
  const visibleFunctions = Object.values(activeNodes()).filter((n) => isFunction(n) && isVisible(n))
  visibleFunctions.forEach(node => node.params.forEach((rawValue, index) => {
    const center = slotScreenCenter(node, index)
    const mountedId = node.mounted[index]
    const mountedNode = mountedId ? activeNodes()[mountedId] : null
    const expectedType = pass.perNode.get(node.id)?.paramTypes?.[index]
    const slotColor = colorForType(expectedType, labelNamer)
    const isSnapTarget = state.snapTarget?.kind === 'param' && state.snapTarget.targetId === node.id && state.snapTarget.index === index
    const slot = document.createElement('div')
    slot.className = `param-slot ${mountedNode ? 'filled' : ''} ${isSnapTarget ? 'snap-target' : ''}`
    slot.style.left = `${center.x - (SLOT_D / 2) * state.zoom}px`; slot.style.top = `${center.y - (SLOT_D / 2) * state.zoom}px`
    slot.style.width = `${SLOT_D * state.zoom}px`; slot.style.height = `${SLOT_D * state.zoom}px`
    slot.style.borderColor = mountedNode ? 'transparent' : slotColor
    slot.style.borderWidth = `${Math.max(1, 2 * state.zoom)}px`
    slot.dataset.functionId = node.id; slot.dataset.index = index
    // One small pill above the slot reads exactly like a Haskell type
    // annotation — `n :: Int` — so the slot is self-explanatory without
    // digging into the inspector: which parameter this is, and what it
    // expects (or, once filled, what actually got unified in). Kept as a
    // single always-present tag (rather than the old separate name label +
    // an inside-the-circle type badge that only showed up while empty and
    // visually clashed with the dashed border) so a slot reads the same way
    // whether it's empty or plugged.
    const tag = document.createElement('span')
    tag.className = 'param-tag'
    const tagName = document.createElement('b')
    tagName.className = 'param-tag-name'; tagName.textContent = paramDisplayName(node, index)
    const tagSep = document.createElement('i')
    tagSep.className = 'param-tag-sep'; tagSep.textContent = '::'
    // The tag only gets one slot's worth of width, so a class context
    // (`AddSemigroup g ⇒ g`) would spill into the neighbouring tag — show
    // just the type itself (the context is still in the signature under the
    // block) and keep the full annotation in the tooltip; anything still too
    // long is ellipsized by CSS.
    const fullType = expectedParamType(node, index, activeNodes(), labelNamer, pass)
    const tagType = document.createElement('span')
    tagType.className = 'param-tag-type'; tagType.textContent = fullType.split(' ⇒ ').pop()
    tagType.style.color = slotColor
    tag.append(tagName, tagSep, tagType)
    tag.title = `${paramDisplayName(node, index)} :: ${fullType}`
    // Plain DOM elements laid over the canvas, not canvas-drawn text — the
    // slot's own width/height already scale with state.zoom above, but this
    // tag's font-size/spacing need the same treatment explicitly or it stays
    // pinned at its CSS default size while the slot around it grows/shrinks,
    // drifting out of place at anything but 100% zoom.
    tag.style.fontSize = `${10 * state.zoom}px`
    tag.style.padding = `${2 * state.zoom}px ${7 * state.zoom}px`
    tag.style.marginBottom = `${5 * state.zoom}px`
    tag.style.gap = `${3 * state.zoom}px`
    tag.style.maxWidth = `${(SLOT_STRIDE - TAG_GAP) * state.zoom}px`
    // Zoomed far out the tag is a few px of unreadable text (or, under a
    // browser minimum font size, a full-size pill piling onto its
    // neighbours) — leave it to the tooltip until it can be read.
    if (state.zoom >= TAG_MIN_ZOOM) slot.append(tag)
    else slot.title = tag.title
    if (mountedNode) {
      // Snapped-in: render the plugged node as a nested chip — colored by
      // its resolved TYPE (not the slot's own decorative node color), so a
      // slot and whatever's plugged into it always agree — grabbing it
      // pulls it back out, magnet-style, as a free node under the cursor.
      const chip = document.createElement('div')
      chip.className = 'param-chip'
      chip.style.background = colorForType(resolvedValueQual(mountedNode, activeNodes(), pass).type, labelNamer)
      chip.textContent = nodeDisplayText(mountedNode)
      chip.style.fontSize = `${11 * state.zoom}px`
      chip.style.padding = `0 ${10 * state.zoom}px`
      chip.title = '드래그해서 떼어내기'
      const unfold = document.createElement('button')
      unfold.className = 'chip-unfold'; unfold.type = 'button'
      unfold.textContent = mountedNode.unfolded ? '⤡' : '⤢'
      unfold.title = mountedNode.unfolded ? 'Fold back into the slot' : 'Unfold onto the canvas (it stays plugged in)'
      unfold.style.width = unfold.style.height = `${16 * state.zoom}px`
      unfold.style.left = unfold.style.top = '0'
      unfold.style.fontSize = `${11 * state.zoom}px`; unfold.style.lineHeight = `${16 * state.zoom}px`
      unfold.addEventListener('pointerdown', (event) => { event.stopPropagation(); event.preventDefault() })
      unfold.addEventListener('click', (event) => { event.stopPropagation(); setUnfolded(mountedNode, !mountedNode.unfolded) })
      slot.append(unfold)
      chip.addEventListener('pointerdown', (event) => {
        event.preventDefault(); event.stopPropagation()
        const world = canvasPoint(event)
        const moving = detachMounted(node, index)
        if (!moving) return
        moving.x = world.x; moving.y = world.y
        beginDrag(moving, world, { moved: true })
        state.selected = moving.id
        updateInspector(); draw()
      })
      slot.append(chip)
    } else {
      const input = document.createElement('input')
      input.className = 'param-value'; input.type = 'text'
      input.placeholder = slotExpectsFunction(node, index, pass) ? 'ƒ' : '?'
      input.value = rawValue; input.title = `Parameter ${index + 1}`
      if (pass.perNode.get(node.id)?.invalidSlots?.includes(index)) { input.classList.add('invalid'); input.title = `"${rawValue}" doesn't fit ${paramDisplayName(node, index)} :: ${expectedParamType(node, index, activeNodes(), labelNamer, pass)}` }
      input.style.fontSize = `${11 * state.zoom}px`
      input.style.paddingTop = `${4 * state.zoom}px`
      input.addEventListener('input', () => { node.params[index] = input.value; state.selected = node.id; updateInspector(); draw() })
      slot.append(input)
    }
    // Slots can only be added/removed where that means something: a custom
    // function's definition (its signature — synced to its body and every
    // call, see signature.js) or a list literal (its length). Everywhere else
    // the slots are the callee's parameters.
    const editable = isSignatureEditable(node)
    if (!editable) { editor.append(slot); return }
    const remove = document.createElement('button')
    remove.className = 'param-remove'; remove.type = 'button'; remove.textContent = '−'; remove.title = editable === 'signature' ? `Remove parameter ${paramDisplayName(node, index)} (from the body and every call)` : 'Remove this element'
    remove.style.width = remove.style.height = `${16 * state.zoom}px`
    remove.style.right = remove.style.top = '0'
    remove.style.fontSize = `${12 * state.zoom}px`; remove.style.lineHeight = `${16 * state.zoom}px`
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      if (editable === 'signature') removeParameter({ nodes, functionBodies }, nodes[node.sourceFunctionId]?.lambda ? node.sourceFunctionId : node.id, index)
      else {
        const moving = detachMounted(node, index)
        if (moving) { moving.x = node.x + 150; moving.y = node.y + 110 }
        node.params.splice(index, 1); node.mounted.splice(index, 1); node.paramScopes.splice(index, 1)
      }
      state.selected = node.id; renderFunctionLibrary(); updateInspector(); draw()
    })
    slot.append(remove)
    editor.append(slot)
  }))
  visibleFunctions.forEach(node => {
    const editable = isSignatureEditable(node)
    if (!editable) return
    const add = document.createElement('button')
    add.className = 'param-add'; add.type = 'button'; add.textContent = '+'; add.title = editable === 'signature' ? 'Add a parameter (to the body and every call)' : 'Add an element'
    // Just past the block's right edge (not at the next slot's would-be
    // center, which lands on the edge itself once the tail is wider).
    const center = toScreen({ x: functionBlockRight(node) + 22, y: node.y })
    const addSize = 26 * state.zoom
    add.style.width = add.style.height = `${addSize}px`
    add.style.fontSize = `${18 * state.zoom}px`; add.style.lineHeight = `${20 * state.zoom}px`
    add.style.left = `${center.x - addSize / 2}px`; add.style.top = `${point(node).y - addSize / 2}px`
    add.addEventListener('click', () => {
      if (editable === 'signature') addParameter({ nodes, functionBodies }, nodes[node.sourceFunctionId]?.lambda ? node.sourceFunctionId : node.id)
      else { node.params.push(''); node.mounted.push(null); node.paramScopes.push('local') }
      state.selected = node.id; renderFunctionLibrary(); updateInspector(); draw()
    })
    editor.append(add)
  })
  if (focused) {
    const input = editor.querySelector(`.param-slot[data-function-id="${CSS.escape(focused.fn)}"][data-index="${focused.index}"] .param-value`)
    if (input) { input.focus(); input.setSelectionRange(focused.start, focused.end) }
  }
}
// After a `number` node's type annotation changes, any existing wire into it
// may no longer type-check (e.g. it was plugged into an Int-only port, then
// re-annotated Double). inferGraph's per-edge catch would otherwise leave the
// wire visibly connected while silently no longer constraining anything —
// actually clear it so the canvas reflects reality.
function invalidateStaleWires(node) {
  const graph = activeNodes()
  Object.values(graph).filter(isFunction).forEach((fn) => {
    fn.mounted?.forEach((mountedId, i) => {
      if (mountedId === node.id && !canConnect(node, fn, i)) {
        fn.mounted[i] = null
        fn.params[i] = ''
        node.mountedTo = null
        node.connected = false
      }
    })
  })
}
function escapeAttr(text) { return String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') }
function renderValueInspector(n) {
  const q = resolvedValueQual(n)
  const isNumber = n.type === 'number'
  const defaultType = q.type.kind === 'var' ? pickDefault(q.preds, q.type.id) : null
  const defaultRow = defaultType ? `<div class="property"><label>DEFAULT</label><div class="connection-tag">${defaultType} <em>(디폴팅: Integer → Double)</em></div></div>` : ''
  // Only offer annotations whose type actually has the structure the literal's
  // text demands (e.g. `-3` needs Ring, so Natural isn't offered) — keeping
  // the current choice listed even if a later edit made it unfit.
  const litPred = (t) => pred(literalClass(n.value ?? ''), tcon(t))
  const annotateRow = isNumber
    ? `<div class="property"><label>ANNOTATE TYPE</label><select class="type-annotate"><option value="">자동 (추론)</option>${numericTypes.filter((t) => n.annotation === t || entails([], litPred(t))).map((t) => `<option ${n.annotation === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`
    : ''
  return `<div class="selected-node"><span class="selected-icon number">#</span><div><b>${n.label}</b><small>${nodeTypeLabel(n)}</small></div><span class="live">VALUE</span></div><div class="property"><label>TYPE</label><code>${showQual(q.preds, q.type)}</code></div>${defaultRow}${annotateRow}<div class="property"><label>VALUE</label>${n.type === 'boolean' ? `<select class="bool-input"><option ${n.value === 'true' ? 'selected' : ''}>true</option><option ${n.value !== 'true' ? 'selected' : ''}>false</option></select>` : `<input class="value-input" value="${escapeAttr(n.type === 'ref' || n.type === 'value' ? nodeDisplayText(n) : n.value ?? 'partial')}" ${isNumber || n.type === 'text' ? '' : 'readonly'} />`}</div>${useAgainButton(n)}${deleteButton(n)}`
}
// Why `n` can't be deleted, or null if it can. Builtins are the language
// itself; a function's Output and parameters are its signature, changed
// through the function's own ports instead; a custom function still called
// from some body would leave those calls dangling.
function deleteBlocker(n) {
  if (n.readonly) return "Builtin functions can't be deleted"
  if (n.type === 'output' || n.type === 'parameter') return "A function's Output and parameters can't be deleted"
  if (n.custom && nodes[n.id] === n) {
    const callers = Object.values(functionBodies).flatMap((body) => Object.values(body)).filter((m) => m.sourceFunctionId === n.id).length
    if (callers) return `${n.label} is still called ${callers} time${callers > 1 ? 's' : ''} — delete those calls first`
  }
  return null
}
// Laws a custom function can be checked against: a monoid homomorphism (e.g.
// production :: Owned → Wallet), a monoid action (tick :: Double → Model →
// Model — then offline progress is one step), or inflationary on a
// partial order (achievements never go backwards).
const lawResults = new Map() // function id -> { [law]: result }
function functionLawsPanel(n) {
  const results = lawResults.get(n.id) || {}
  const rows = FUNCTION_LAWS.map((law) => {
    const r = results[law]
    const status = !r ? '' : r.ok ? `<span class="law ok">✓ ${escapeAttr(r.law)}</span>` : `<span class="law bad">✗ ${escapeAttr(r.law)} — <em>${escapeAttr(r.counterexample)}</em></span>`
    return `<div class="law-row"><button class="law-check" data-law="${law}">${law}</button>${status}</div>`
  })
  return `<div class="property"><label>LAWS</label>${rows.join('')}</div>`
}
function runFunctionLaw(n, law) {
  const entry = typePass(nodes).perNode.get(n.id)
  const arity = Object.values(functionBodies[n.id] || {}).filter((m) => m.type === 'parameter').length
  let fnType = entry?.paramTypes ? entry.paramTypes.reduceRight((acc, t) => tfun(t, acc), entry.resultType) : null
  // Samples need concrete types: default each type variable the way GHC
  // resolves an ambiguous one (Semiring a → Integer, Field a → Double).
  const unresolved = []
  if (fnType) {
    const defaults = new Map()
    ftv(fnType).forEach((v) => { const d = pickDefault(entry.preds || [], v); if (d) defaults.set(v, tcon(d)); else unresolved.push(v) })
    fnType = applySubst(defaults, fnType)
  }
  const result = !fnType ? { law, ok: false, counterexample: 'no type' }
    : unresolved.length ? { law, ok: false, counterexample: `${showQual(entry.preds || [], fnType)} is polymorphic — use it at a concrete type to check its laws` }
    : checkFunctionLaw(law, { kind: 'closure', callee: n.id, args: Array(arity).fill(null) }, fnType, { ev: evaluator, types })
  lawResults.set(n.id, { ...(lawResults.get(n.id) || {}), [law]: result })
  updateInspector()
}
// The custom function `id` as Haskell: its signature and its definition,
// read back from the body graph (src/haskellPrint.js).
function definitionBlock(id) {
  const def = nodes[id]
  if (!def) return ''
  const code = printDefinition(id, definitions, functionBodies)
  if (!code) return ''
  const signature = `${def.label} :: ${asciiType(functionSignature(def, nodes))}`
  return `<div class="property"><label>DEFINITION</label><pre class="haskell">${escapeAttr(signature)}\n${escapeAttr(code)}</pre></div>`
}
function useAgainButton(n) {
  return n.type === 'output' ? '' : '<button class="use-again" id="use-again" title="Make a reference to plug this value into another slot">↪ Use again <small>(Δ)</small></button>'
}
function deleteButton(n) {
  return deleteBlocker(n) ? '' : '<button class="delete-node" id="delete-node">Delete node <kbd>Del</kbd></button>'
}
// Removes `id` from the active graph, unplugging it from wherever it was
// mounted and freeing whatever was mounted into it (placed beside it). A
// custom function's definition takes its body with it.
function deleteNode(id) {
  const graph = activeNodes()
  const n = graph[id]
  if (!n) return
  const blocker = deleteBlocker(n)
  if (blocker) return showToast(blocker)
  // References to a deleted node would dangle — they go with it.
  Object.values(graph).filter((m) => m.type === 'ref' && m.target === id).forEach((ref) => deleteNode(ref.id))
  Object.values(graph).forEach((other) => {
    if (other.type === 'function') other.mounted?.forEach((mountedId, i) => { if (mountedId === id) { other.mounted[i] = null; other.params[i] = '' } })
    if (other.type === 'output' && other.source === id) { other.source = null; other.value = 'open' }
  })
  ;(n.mounted || []).forEach((mountedId, i) => {
    const child = mountedId && graph[mountedId]
    if (child) { child.mountedTo = null; child.connected = false; child.x = n.x + 150 + i * 40; child.y = n.y + 120 }
  })
  delete graph[id]
  if (graph === nodes && n.custom) delete functionBodies[id]
  // The last call to a λ is the λ: take its hidden definition and body with it.
  const lambdaId = n.sourceFunctionId
  if (nodes[lambdaId]?.lambda && ![nodes, ...Object.values(functionBodies)].some((g) => Object.values(g).some((m) => m.sourceFunctionId === lambdaId))) {
    delete nodes[lambdaId]
    delete functionBodies[lambdaId]
  }
  if (entryId === id) entryId = null
  state.selected = state.activeFunction ? 'output' : 'add'
  renderFunctionLibrary(); updateInspector(); draw()
}
function updateInspector() {
  const n = activeNodes()[state.selected]
  if (!n) return
  inspector.innerHTML = n.type === 'output'
    ? `<div class="selected-node"><span class="selected-icon output-icon">→</span><div><b>Output</b><small>Function result</small></div><span class="live">TARGET</span></div><div class="property"><label>OUTPUT VALUE</label><div class="connection-tag">${n.source ? `ƒ ${activeNodes()[n.source]?.label || n.value}` : 'Drop a node here'}</div></div>${state.activeFunction ? definitionBlock(state.activeFunction) : ''}${n.source ? '<button class="delete-node" id="disconnect-output">Disconnect</button>' : ''}<div class="inspector-note">This node defines what the function returns.</div>`
    : n.type === 'function'
    ? `<div class="selected-node"><span class="selected-icon">ƒ</span><div><b>${n.label}</b><small>Function · ${n.scope || 'main'}</small></div><span class="live">COMPOSABLE</span></div><div class="property"><label>TYPE SIGNATURE</label><code>${functionSignature(n)}</code></div>${nodes[n.sourceFunctionId || n.id]?.custom ? definitionBlock(n.sourceFunctionId || n.id) : (() => { const expr = n.expression || definitions[n.sourceFunctionId]?.expression; return expr ? `<div class="property"><label>DEFINITION</label><div class="connection-tag">${escapeAttr(expr)}</div></div>` : '' })()}<div class="property"><label>PARAMETERS</label>${n.params.map((value, i) => `<div class="port-row"><span class="port ${value ? 'filled' : 'hollow'}"></span>${nodes[n.id] === n && n.custom ? `<input class="param-rename" data-index="${i}" value="${escapeAttr(paramDisplayName(n, i))}" title="Rename this parameter" spellcheck="false" />` : `<span>${escapeAttr(paramDisplayName(n, i))}${value && value !== paramDisplayName(n, i) ? ` = ${escapeAttr(value)}` : ''}</span>`}<select class="param-scope" data-index="${i}"><option ${n.paramScopes[i] === 'local' ? 'selected' : ''}>local</option><option ${n.paramScopes[i] === 'main' ? 'selected' : ''}>main</option><option ${n.paramScopes[i] === 'shared' ? 'selected' : ''}>shared</option></select><strong>${n.mounted[i] ? `ƒ ${activeNodes()[n.mounted[i]]?.label || 'function'}` : 'open'}</strong></div>`).join('')}</div><div class="property"><label>FUNCTION SCOPE</label><select class="scope-select" id="function-scope"><option ${n.scope === 'local' ? 'selected' : ''}>local</option><option ${n.scope === 'main' ? 'selected' : ''}>main</option><option ${n.scope === 'shared' ? 'selected' : ''}>shared</option></select></div>${nodes[n.id] === n && n.custom ? functionLawsPanel(n) : ''}${nodes[n.id] === n ? `<div class="property"><label>ENTRY POINT</label><button class="entry-toggle ${entryId === n.id ? 'on' : ''}" id="entry-toggle">${entryId === n.id ? '● Run graph plays this function' : '○ Make this the Run graph entry'}</button></div>` : ''}<button class="evaluate" id="evaluate">▶ &nbsp; Play function</button>${nodes[n.sourceFunctionId]?.lambda || (!state.activeFunction && nodes[n.sourceFunctionId || n.id]?.custom) ? '<button class="use-again" id="open-body">Open body →</button>' : ''}${useAgainButton(n)}${deleteButton(n)}<div class="inspector-note">The canvas is the function body.<br/>Connect any declared function to Output.</div>`
    : renderValueInspector(n)
  const evaluate = document.querySelector('#evaluate')
  if (evaluate) evaluate.onclick = () => executeFunction(n)
  const entryToggle = document.querySelector('#entry-toggle')
  if (entryToggle) entryToggle.onclick = () => { entryId = entryId === n.id ? null : n.id; updateInspector(); draw() }
  document.querySelectorAll('.param-rename').forEach((input) => {
    input.onchange = () => {
      if (!renameParameter({ nodes, functionBodies }, n.id, Number(input.dataset.index), input.value.trim())) showToast(`"${input.value}" can't be a parameter name here (lowercase identifier, not already used)`)
      renderFunctionLibrary(); updateInspector(); draw()
    }
  })
  const disconnectOutput = document.querySelector('#disconnect-output')
  if (disconnectOutput) disconnectOutput.onclick = () => { const source = activeNodes()[n.source]; if (source) source.connected = false; n.source = null; n.value = 'open'; updateInspector(); draw() }
  document.querySelectorAll('.law-check').forEach((button) => { button.onclick = () => runFunctionLaw(n, button.dataset.law) })
  const openBody = document.querySelector('#open-body')
  if (openBody) openBody.onclick = () => enterFunction(n.sourceFunctionId || n.id)
  const useAgainNode = document.querySelector('#use-again')
  if (useAgainNode) useAgainNode.onclick = () => useAgain(n)
  const deleteNodeButton = document.querySelector('#delete-node')
  if (deleteNodeButton) deleteNodeButton.onclick = () => deleteNode(n.id)
  const boolInput = document.querySelector('.bool-input')
  if (boolInput) boolInput.onchange = () => { n.value = boolInput.value; updateInspector(); draw() }
  const scopeSelect = document.querySelector('#function-scope')
  if (scopeSelect) scopeSelect.onchange = () => { n.scope = scopeSelect.value; updateInspector(); draw() }
  document.querySelectorAll('.param-scope').forEach((select) => {
    select.onchange = () => { n.paramScopes[Number(select.dataset.index)] = select.value; updateInspector(); draw() }
  })
  const typeAnnotate = document.querySelector('.type-annotate')
  if (typeAnnotate) typeAnnotate.onchange = () => { n.annotation = typeAnnotate.value || null; invalidateStaleWires(n); updateInspector(); draw() }
  const valueInput = document.querySelector('.value-input')
  // Don't call updateInspector() here — it would tear down and recreate this
  // very input on every keystroke and steal focus/cursor position. draw()
  // alone is enough to keep the canvas label live; the inspector's own TYPE
  // line catches up next time something reselects this node.
  if (valueInput && (n.type === 'number' || n.type === 'text')) valueInput.oninput = () => { n.value = valueInput.value; draw() }
}
// Plays `fn`: evaluates it as a value (callee applied to its applied slots —
// see src/evaluator.js) and drops the result next to it. A fully-applied
// call yields a number/boolean node; anything with open slots yields a
// curried node carrying both its residual type and its runtime closure, so it
// can be plugged in and played again later.
function executeFunction(fn) {
  if (!isFunction(fn)) return
  const graph = activeNodes()
  const entry = typePass(graph).perNode.get(fn.id)
  const bad = entry?.invalidSlots?.[0]
  if (bad !== undefined) return showToast(`"${fn.params[bad]}" doesn't fit ${paramDisplayName(fn, bad)} :: ${expectedParamType(fn, bad, graph)}`)
  let result
  try {
    result = evaluator.run(graph, fn.id)
  } catch (error) {
    if (error instanceof EvalError) return showToast(error.message)
    throw error
  }
  state.running = true
  const id = `output-${++outputId}`
  const position = { x: functionBlockRight(fn) + 90, y: fn.y + (outputId % 2) * 45 }
  const valueType = entry ? valueTypeOfEntry(entry) : null
  if (isClosure(result)) {
    const appliedCount = entry?.applied?.filter(Boolean).length ?? 0
    // Keep the residual's class constraints with it (`Semiring a ⇒ a → a`,
    // not a bare `a → a`), generalized so each later pass instantiates it fresh.
    const resolvedScheme = valueType ? generalize((entry.preds || []).filter((p) => [...ftv(p.type)].some((v) => ftv(valueType).has(v))), valueType) : undefined
    graph[id] = { id, type: 'curried', typeName: valueType ? showQual(resolvedScheme.preds, valueType) : functionSignature(fn), resolvedScheme, closure: result, ...position, label: `${fn.label} · ${appliedCount}/${fn.params.length}`, value: 'ƒ', remaining: result.args.filter((a) => a === null).length, color: '#a96ef0' }
  } else if (isData(result) || typeof result === 'string') {
    // A data value (a declared type, a list, a Maybe — e.g. `Model {clicks = 1, perClick = 2}`) or a Char.
    const resolvedScheme = valueType ? generalize((entry.preds || []).filter((p) => [...ftv(p.type)].some((v) => ftv(valueType).has(v))), valueType) : undefined
    graph[id] = { id, type: 'value', data: result, resolvedScheme, ...position, label: 'result', color: '#3cbe9e' }
  } else {
    const booleanResult = typeof result === 'boolean'
    // Inherit the function's actual resolved result type when it's concrete
    // (e.g. Play `sqrt` on a Double literal → the result node is Double too,
    // not a hardcoded Int) via the same annotation mechanism a literal uses.
    const concreteType = !booleanResult && valueType?.kind === 'con' ? valueType.name : undefined
    graph[id] = { id, type: booleanResult ? 'boolean' : 'number', typeName: booleanResult ? 'Bool' : (concreteType || 'Int'), annotation: concreteType, ...position, label: 'result', value: String(result), color: booleanResult ? '#ed6b84' : '#8c7cf2' }
  }
  state.selected = id; updateInspector(); draw()
  setTimeout(() => { state.running = false; draw() }, 300)
}
// Nodes currently snapped into a slot have no meaningful standalone
// position/hitbox on the open canvas — they're only reachable through the
// slot's own nested chip (see updatePortEditor's detach handler).
function hitNode(x, y) {
  return Object.values(activeNodes()).find(n => {
    if (!isVisible(n)) return false
    return n.type === 'function' ? pointInFunctionBlock(n, x, y) : pointInValueBlock(n, x, y)
  })
}
// The nearest empty, type-compatible slot (or the function body's Output)
// within magnet range of `dragged`'s current (world-space) position — the
// single source of truth for both the "what should glow right now" snap
// highlight and the "what do we connect to on release" decision, so the two
// always agree.
// Landing right on a slot's own footprint (PRECISE_RADIUS) connects even if
// its text currently shows something else — e.g. a builtin's param starts
// pre-filled with its own declared name ('n', 'x', ...) as a display
// placeholder, not literal emptiness, so a precise drop must be able to
// override it. Merely drifting into the wider magnet radius while heading
// toward the function in general only grabs slots that are genuinely blank
// ('' — the case for a fresh function-call node), so a loose drop can't
// clobber a slot that already reads as meaningfully filled.
const PRECISE_SLOT_RADIUS = 60
function findSnapTarget(dragged) {
  if (!dragged || dragged.type === 'output' || dragged.mountedTo) return null // an unfolded node stays plugged where it is
  let best = null, bestDist = SNAP_RADIUS
  Object.values(activeNodes()).filter(isFunction).forEach((target) => {
    if (target.id === dragged.id) return
    target.params.forEach((value, index) => {
      if (target.mounted[index]) return // already has a node plugged in — detach it first
      const c = slotWorldCenter(target, index)
      const dist = Math.hypot(dragged.x - c.x, dragged.y - c.y)
      if ((value !== '' && dist >= PRECISE_SLOT_RADIUS) || !canConnect(dragged, target, index)) return
      if (dist < bestDist) { bestDist = dist; best = { kind: 'param', targetId: target.id, index } }
    })
  })
  if (state.activeFunction) {
    const output = activeNodes().output
    if (output && output.id !== dragged.id) {
      const dist = Math.hypot(dragged.x - output.x, dragged.y - output.y)
      if (dist < bestDist) { bestDist = dist; best = { kind: 'output' } }
    }
  }
  return best
}
// Applies state.snapTarget (computed live while dragging) on release. Shared
// by every drag origin — a loose canvas node or a value pulled out of a
// slot — so "snap to the thing that was glowing" is a single code path.
function finishConnection(dragged) {
  const target = state.snapTarget
  if (!target) return false
  if (target.kind === 'output') {
    const output = activeNodes().output
    // Unlike a slot, Output doesn't swallow the node: it stays on the canvas
    // (still editable, its own slots still reachable), parked just left of
    // Output with a link line drawn between them.
    const previous = activeNodes()[output.source]
    if (previous) previous.connected = false
    output.source = dragged.id
    output.value = nodeDisplayText(dragged)
    dragged.connected = true
    const width = dragged.type === 'function' ? functionBlockRight(dragged) - dragged.x : CHIP_W / 2
    dragged.x = output.x - CHIP_W / 2 - 70 - width
    dragged.y = output.y
    state.selected = output.id
    return true
  }
  const targetNode = activeNodes()[target.targetId]
  if (!targetNode) return false
  targetNode.params[target.index] = nodeDisplayText(dragged)
  targetNode.mounted[target.index] = dragged.id
  dragged.mountedTo = `${targetNode.id}:${target.index}`
  dragged.connected = true
  if (dragged.type === 'function') dragged.composedInto = targetNode.id
  state.selected = targetNode.id
  return true
}
// A drag that starts on the DOM slot overlay (detach) is still, physically,
// a mousedown-then-move across ordinary text-bearing elements (sidebar,
// inspector) — `preventDefault()` on the originating pointerdown alone isn't
// reliably enough to stop the browser from turning that into a native text
// selection as the pointer crosses those elements. Suppressing selection
// page-wide for the duration of any drag (canvas-native or slot-detach
// alike) sidesteps that regardless of the exact event path.
function beginDrag(node, worldPoint, { moved = false } = {}) {
  state.drag = { node, dx: worldPoint.x - node.x, dy: worldPoint.y - node.y, moved }
  document.body.classList.add('dragging')
}
function endDrag() { state.drag = null; document.body.classList.remove('dragging') }
function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left - state.offset.x) / state.zoom, y: (event.clientY - rect.top - state.offset.y) / state.zoom } }
function setZoom(nextZoom, clientX = canvas.clientWidth / 2, clientY = canvas.clientHeight / 2) {
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left, y = clientY - rect.top
  const worldX = (x - state.offset.x) / state.zoom, worldY = (y - state.offset.y) / state.zoom
  state.zoom = Math.max(.6, Math.min(1.8, nextZoom))
  state.offset.x = x - worldX * state.zoom
  state.offset.y = y - worldY * state.zoom
  document.querySelector('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`
  draw()
}
canvas.addEventListener('pointerdown', (event) => {
  const p = canvasPoint(event), node = hitNode(p.x, p.y)
  canvas.setPointerCapture(event.pointerId)
  if (node) {
    state.selected = node.id
    if (node.type === 'output') {
      updateInspector()
      draw()
      return
    }
    beginDrag(node, p)
    updateInspector(); draw()
  } else {
    state.pan = { x: event.clientX, y: event.clientY, offsetX: state.offset.x, offsetY: state.offset.y }
    canvas.classList.add('panning')
  }
})
// pointermove/pointerup/pointercancel live on `window`, not `canvas`, because
// a drag can now also START on a DOM slot chip (see updatePortEditor's
// detach handler) — that pointerdown's target is a sibling overlay element,
// not a descendant of canvas, so canvas-scoped listeners would never see the
// rest of that drag. Both drag origins funnel through the same state.drag,
// so one pair of window listeners drives them identically.
window.addEventListener('pointermove', (event) => {
  if (state.drag) {
    const p = canvasPoint(event)
    if (Math.hypot(event.movementX, event.movementY) > 2) state.drag.moved = true
    state.drag.node.x = p.x - state.drag.dx
    state.drag.node.y = p.y - state.drag.dy
    state.snapTarget = findSnapTarget(state.drag.node)
    draw()
  } else if (state.pan) {
    state.offset.x = state.pan.offsetX + event.clientX - state.pan.x
    state.offset.y = state.pan.offsetY + event.clientY - state.pan.y
    draw()
  }
})
window.addEventListener('pointerup', (event) => {
  if (!state.drag && !state.pan) return
  if (!state.drag) {
    state.pan = null
    canvas.classList.remove('panning')
    return
  }
  finishConnection(state.drag.node)
  const wasDragged = state.drag.moved
  endDrag(); state.snapTarget = null; updateInspector(); draw()
  if (wasDragged) {
    state.suppressClick = true
    event.stopPropagation()
  }
})
window.addEventListener('pointercancel', () => { endDrag(); state.pan = null; state.snapTarget = null; canvas.classList.remove('panning') })
canvas.addEventListener('wheel', (event) => {
  event.preventDefault()
  setZoom(state.zoom + (event.deltaY < 0 ? .1 : -.1), event.clientX, event.clientY)
}, { passive: false })
canvas.addEventListener('click', (event) => {
  if (state.suppressClick) {
    state.suppressClick = false
    return
  }
  const p = canvasPoint(event)
  const fn = Object.values(activeNodes()).find(n => n.type === 'function' && isVisible(n) && Math.hypot(p.x - (functionBlockRight(n) - 16), p.y - (n.y - FN_H / 2 + 2)) < 18)
  if (fn) {
    executeFunction(fn)
    return
  }
})
// A single click only selects (so the inspector shows the function);
// double-clicking a custom function — its definition or a call to it — on
// `main` opens its body, as does the inspector's "Open body".
canvas.addEventListener('dblclick', (event) => {
  const p = canvasPoint(event)
  const selected = Object.values(activeNodes()).find(n => n.type === 'function' && isVisible(n) && pointInFunctionBlock(n, p.x, p.y))
  const definitionId = selected && (selected.sourceFunctionId || selected.id)
  if (selected && nodes[definitionId]?.lambda) enterFunction(definitionId)
  else if (selected && !state.activeFunction && nodes[definitionId]?.custom) enterFunction(definitionId)
})
function enterFunction(id) {
  if (nodes[id]?.readonly) return
  if (!functionBodies[id]) functionBodies[id] = { output: { id: 'output', type: 'output', x: 570, y: 255, label: 'Output', value: 'open', color: '#2fbf8f' } }
  // A λ opens inside the body it was made in (Back returns there); anything else opens from main.
  state.functionStack = nodes[id]?.lambda && state.activeFunction ? [...state.functionStack, state.activeFunction] : []
  state.activeFunction = id
  state.selected = 'output'
  renderFunctionLibrary()
  updateInspector()
  fitToView()
}
document.querySelector('#back-graph').onclick = () => {
  state.activeFunction = state.functionStack.pop() || null
  state.selected = state.activeFunction ? 'output' : 'add'
  renderFunctionLibrary(); updateInspector(); fitToView()
}
// Plays the entry function (always in `main`), falling back to whichever
// function is selected when no entry has been set.
function runEntry() {
  if (entryId && nodes[entryId] && startGameIfProgram(entryId)) return
  if (entryId && nodes[entryId]) {
    if (state.activeFunction) { state.activeFunction = null; renderFunctionLibrary(); fitToView() }
    return executeFunction(nodes[entryId])
  }
  const selected = activeNodes()[state.selected]
  if (selected && isFunction(selected)) return executeFunction(selected)
  showToast('Select a function, or make one the Run graph entry in the inspector')
}
document.querySelector('#run').onclick = runEntry
// --- Playing a Program ------------------------------------------------------
// When the entry point evaluates to a `Program m e` (see builtinSchemes.js'
// `program` and src/runtime.js), Run graph plays it: the view is rendered in
// a panel over the canvas, buttons send their messages through `handle`,
// and time runs through `step` in fixed slices. The game state is saved
// with a timestamp; reopening it applies the time away — in one call if
// `step` passes the monoid-action law, otherwise slice by slice.
const GAME_KEY = 'hs-simulate:game'
const playPanel = document.querySelector('#play-panel')
let play = null // { game, entry, modelType, speed, running, last, acc, frame, saveTimer, law }

// The Program the function `id` evaluates to (or null), its model type, and
// whether its `step` is an action of (ℝ≥0, +) — then any span of time is one call.
function programInfo(id) {
  let program
  try {
    program = evaluator.run(nodes, id)
  } catch (error) {
    if (error instanceof EvalError) return null
    throw error
  }
  if (!isProgram(program)) return null
  const programType = valueTypeOfEntry(typePass(nodes).perNode.get(id))
  const modelType = programType?.kind === 'app' && programType.fn.kind === 'app' ? programType.fn.arg : null
  const law = modelType && !ftv(modelType).size
    ? checkFunctionLaw('action', program.args[3], tfun(tcon('Double'), tfun(modelType, modelType)), { ev: evaluator, types })
    : { ok: false, counterexample: 'the model type is not concrete' }
  return { program, modelType, law }
}

function startGameIfProgram(id) {
  const info = programInfo(id)
  if (!info) return false
  const { program, modelType, law } = info
  stopGame()
  const game = createGame(evaluator, program, { exactTime: law.ok })
  play = { game, entry: id, modelTypeObj: modelType, modelType: modelType ? showQual([], modelType) : '?', speed: 1, running: true, last: null, acc: 0, frame: null, saveTimer: null, law }
  let offline = null
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_KEY) || 'null')
    if (saved && saved.entry === id && saved.modelType === play.modelType) {
      game.restore(saved)
      const away = Math.max(0, (Date.now() - saved.savedAt) / 1000) // capped by the program's maxOffline
      if (away > 1) offline = { away: Math.min(away, game.maxOffline), ...game.advance(away) }
    }
  } catch (error) {
    if (!(error instanceof EvalError) && !(error instanceof SyntaxError)) throw error
    game.reset()
  }
  playPanel.hidden = false
  buildPlayPanel()
  renderPlay()
  if (offline) showToast(offline.exact ? `While you were away: ${formatSeconds(offline.away)} applied in one step (step is a monoid action)` : `While you were away: ${formatSeconds(offline.away)} simulated in ${offline.calls} slices`)
  play.saveTimer = setInterval(saveGame, 2000)
  play.frame = requestAnimationFrame(loop)
  return true
}

function formatSeconds(t) {
  if (t < 90) return `${Math.round(t)}s`
  if (t < 5400) return `${Math.round(t / 60)}m`
  return `${(t / 3600).toFixed(1)}h`
}

function loop(now) {
  if (!play) return
  if (play.running && play.last !== null) {
    play.acc += Math.min(1, (now - play.last) / 1000) * play.speed
    let ticked = false
    try {
      const slice = 1 / play.game.stepsPerSecond // the program's own tick rate
      while (play.acc >= slice) { play.game.tick(slice); play.acc -= slice; ticked = true }
    } catch (error) {
      gameError(error)
    }
    if (ticked) renderPlay()
  }
  play.last = now
  play.frame = requestAnimationFrame(loop)
}

function gameError(error) {
  if (!(error instanceof EvalError)) throw error
  play.running = false
  showToast(`Game stopped: ${error.message}`)
  renderPlay()
}

function saveGame() {
  if (!play) return
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify({ ...play.game.snapshot(), entry: play.entry, modelType: play.modelType, savedAt: Date.now() }))
  } catch {}
}

function stopGame() {
  if (!play) return
  saveGame()
  cancelAnimationFrame(play.frame)
  clearInterval(play.saveTimer)
  play = null
  playPanel.hidden = true
  playPanel.innerHTML = ''
}

function buildPlayPanel() {
  playPanel.innerHTML = `<div class="play-bar"><b></b><span class="play-time"></span><button class="tool-button icon-only" data-play="toggle" title="Pause / resume"></button><button class="tool-button" data-play="step" title="Advance one second">+1s</button><select data-play="speed" title="Speed">${[1, 2, 10, 60].map((x) => `<option value="${x}">${x}×</option>`).join('')}</select><button class="tool-button" data-play="reset">Reset game</button><button class="tool-button icon-only" data-play="close" title="Back to the editor">×</button></div><div class="play-body"><div class="play-view"></div><aside class="play-side"><label class="play-model-label"></label><button class="law-check" data-play="edit-model" title="Edit the model in Haskell syntax">Edit</button><pre class="play-model"></pre><div class="play-model-editor" hidden><textarea spellcheck="false" rows="5"></textarea><p class="type-error"></p><button class="law-check" data-play="apply-model">Apply</button> <button class="law-check" data-play="cancel-model">Cancel</button></div><label>TIME</label><p class="play-law"></p><label class="play-log-label"></label><ol class="play-log"></ol></aside></div>`
  playPanel.querySelector('[data-play="toggle"]').onclick = () => { play.running = !play.running; play.last = null; renderPlay() }
  playPanel.querySelector('[data-play="step"]').onclick = () => { try { play.game.tick(1) } catch (error) { return gameError(error) } renderPlay() }
  playPanel.querySelector('[data-play="speed"]').onchange = (event) => { play.speed = Number(event.target.value) }
  playPanel.querySelector('[data-play="reset"]').onclick = () => { play.game.reset(); saveGame(); renderPlay() }
  playPanel.querySelector('[data-play="close"]').onclick = stopGame
  // Editing the model: written in Haskell syntax (exactly what's shown),
  // read back at the model's type by src/valueParser.js.
  const editor = playPanel.querySelector('.play-model-editor')
  playPanel.querySelector('[data-play="edit-model"]').onclick = () => {
    play.running = false
    play.editing = true
    editor.hidden = false
    editor.querySelector('textarea').value = showValue(play.game.model, types)
    editor.querySelector('.type-error').textContent = ''
    renderPlay()
  }
  playPanel.querySelector('[data-play="cancel-model"]').onclick = () => { play.editing = false; editor.hidden = true; renderPlay() }
  playPanel.querySelector('[data-play="apply-model"]').onclick = () => {
    try {
      play.game.setModel(parseValue(editor.querySelector('textarea').value, play.modelTypeObj, types))
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
      editor.querySelector('.type-error').textContent = error.message
      return
    }
    play.editing = false
    editor.hidden = true
    saveGame()
    renderPlay()
    showToast('Model updated (paused — press ▶ to continue)')
  }
  playPanel.querySelector('.play-view').addEventListener('pointerdown', (event) => {
    const button = event.target.closest('.w-button')
    if (!button || !play) return
    event.preventDefault()
    try { play.game.dispatch(play.msgs[Number(button.dataset.msg)]) } catch (error) { return gameError(error) }
    renderPlay()
  })
}

function renderPlay() {
  if (!play) return
  const { game } = play
  const $ = (sel) => playPanel.querySelector(sel)
  play.msgs = []
  let view
  try {
    view = renderWidget(game.view(), play.msgs)
  } catch (error) {
    if (!(error instanceof EvalError)) throw error
    view = Object.assign(document.createElement('p'), { className: 'w-error', textContent: `view failed: ${error.message}` })
  }
  $('.play-view').replaceChildren(view)
  $('.play-bar b').textContent = `▶ ${nodes[play.entry]?.label || play.entry}`
  $('.play-time').textContent = `t = ${game.time.toFixed(1)}s`
  $('[data-play="toggle"]').textContent = play.running ? '⏸' : '▶'
  $('[data-play="speed"]').value = String(play.speed)
  $('.play-model-label').textContent = `MODEL :: ${play.modelType}`
  $('.play-model').textContent = showValue(game.model, types)
  $('.play-model').hidden = Boolean(play.editing)
  const law = $('.play-law')
  law.className = `play-law ${play.law.ok ? 'ok' : ''}`
  law.textContent = play.law.ok ? '✓ step is a monoid action of (ℝ≥0, +): time away is applied in one step' : `step is not a monoid action (${play.law.counterexample || play.law.law}): time away is simulated in slices`
  $('.play-log-label').textContent = `LOG · ${game.log.length} messages`
  $('.play-log').start = Math.max(1, game.log.length - 11)
  // Each entry rewinds to the state right after that message (time travel).
  const first = Math.max(0, game.log.length - 12)
  $('.play-log').replaceChildren(...game.log.slice(first).map((m, i) => {
    const li = Object.assign(document.createElement('li'), { textContent: showValue(m, types) })
    const count = first + i + 1
    if (game.canRewind(count) && count < game.log.length) {
      li.className = 'rewindable'
      li.title = 'Rewind to just after this message'
      li.onclick = () => { game.rewind(count); play.running = false; renderPlay(); showToast(`Rewound to message ${count} (paused)`) }
    }
    return li
  }))
}
window.addEventListener('beforeunload', saveGame)
// Keys go to the game's onKey subscriptions while it's playing (not while typing in a field).
window.addEventListener('keydown', (event) => {
  if (!play || play.editing || event.target.closest?.('input, select, textarea')) return
  try {
    if (play.game.keyPressed(event.key)) { event.preventDefault(); renderPlay() }
  } catch (error) {
    gameError(error)
  }
})
const TEMPLATES = { clickCounter: ['the click-counter example', buildClickCounter], blankGame: ['a blank game', buildBlankGame] }
document.querySelector('#template').onchange = (event) => {
  const [name, build] = TEMPLATES[event.target.value] || []
  event.target.value = ''
  if (!build) return
  stopGame()
  state.activeFunction = null
  loadProject(mergeBuiltins(upgradeProject(parseProject(serializeProject(build()))), builtinNodes, builtinBodies))
  fitToView()
  showToast(`Loaded ${name} — Run graph to play it (undo to go back)`)
}
// Download the entry point's game as one HTML file that runs without the
// editor: the player modules plus every definition, body and type it needs.
document.querySelector('#export-game').onclick = () => {
  const info = entryId && nodes[entryId] ? programInfo(entryId) : null
  if (!info) return showToast('Make a function that returns a Program (see the Game group) the Run graph entry first')
  const title = nodes[entryId].label === 'main' ? 'hs-simulate game' : nodes[entryId].label
  const data = { title, definitions: { ...preludeDefs, ...derivedDefs, ...nodes }, functionBodies, types, entry: entryId, exactTime: info.law.ok }
  const url = URL.createObjectURL(new Blob([buildPlayerHtml(data, playerSources)], { type: 'text/html' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: `${title.replace(/[^\w-]+/g, '-')}.html` })
  link.click()
  URL.revokeObjectURL(url)
  showToast(`Exported ${link.download} — open it in any browser to play`)
}
// --- Toasts ---------------------------------------------------------------
let toastTimer = null
function showToast(message) {
  let toast = document.querySelector('#toast')
  if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.setAttribute('role', 'status'); document.body.append(toast) }
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200)
}
// --- Project snapshots, autosave, undo/redo ---------------------------------
function currentSnapshot() { return serializeProject({ nodes, functionBodies, types, entry: entryId, outputId }) }
// Replaces the live project with `project` (already parsed + merged) in place
// — `nodes`/`functionBodies` are shared with the evaluator, so they're
// refilled rather than reassigned.
function loadProject(project) {
  Object.keys(nodes).forEach((id) => delete nodes[id])
  Object.assign(nodes, project.nodes)
  Object.keys(functionBodies).forEach((id) => delete functionBodies[id])
  Object.assign(functionBodies, project.functionBodies)
  applyTypes(project.types || {})
  if (typeEditor) { if (types[typeEditor.original]) { typeEditor.draft = declToDraft(types[typeEditor.original]); renderTypeEditor() } else closeTypeEditor() }
  entryId = project.entry
  outputId = project.outputId
  if (state.activeFunction && !functionBodies[state.activeFunction]) state.activeFunction = null
  if (!activeNodes()[state.selected]) state.selected = state.activeFunction ? 'output' : 'add'
  renderFunctionLibrary(); updateInspector(); draw()
}
function restoreSnapshot(snapshot) { loadProject(parseProject(snapshot)) }
const defaultSnapshot = currentSnapshot()
let checkpointTimer = null
function scheduleCheckpoint() {
  clearTimeout(checkpointTimer)
  checkpointTimer = setTimeout(flushCheckpoint, 300)
}
function flushCheckpoint() {
  clearTimeout(checkpointTimer)
  checkpointTimer = null
  const snapshot = currentSnapshot()
  if (history.record(snapshot)) { persist(snapshot); renderFunctionLibrary() } // keep sidebar signatures current while a body is edited
  updateHistoryButtons()
}
function persist(snapshot) {
  const status = document.querySelector('#saved-status span')
  try {
    localStorage.setItem(STORAGE_KEY, snapshot)
    status.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  } catch {
    status.textContent = 'Not saved (storage unavailable)'
  }
}
function updateHistoryButtons() {
  document.querySelector('#undo').disabled = !history.canUndo
  document.querySelector('#redo').disabled = !history.canRedo
}
function undo() {
  flushCheckpoint()
  const snapshot = history.undo()
  if (snapshot) { restoreSnapshot(snapshot); persist(snapshot) }
  updateHistoryButtons()
}
function redo() {
  flushCheckpoint()
  const snapshot = history.redo()
  if (snapshot) { restoreSnapshot(snapshot); persist(snapshot) }
  updateHistoryButtons()
}
document.querySelector('#undo').onclick = undo
document.querySelector('#redo').onclick = redo
// Reset is an ordinary (undoable) edit back to the built-in starting graph.
document.querySelector('#reset').onclick = () => { state.activeFunction = null; restoreSnapshot(defaultSnapshot); fitToView() }
document.querySelector('#export').onclick = () => {
  const url = URL.createObjectURL(new Blob([currentSnapshot()], { type: 'application/json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: 'hs-simulate-project.json' })
  link.click()
  URL.revokeObjectURL(url)
}
const importFile = document.querySelector('#import-file')
document.querySelector('#import').onclick = () => importFile.click()
importFile.onchange = async () => {
  const file = importFile.files[0]
  importFile.value = ''
  if (!file) return
  try {
    state.activeFunction = null
    loadProject(mergeBuiltins(upgradeProject(parseProject(await file.text())), builtinNodes, builtinBodies))
    fitToView()
    showToast(`Imported ${file.name}`)
  } catch (error) {
    if (error instanceof ProjectError) return showToast(`Import failed: ${error.message}`)
    throw error
  }
}
// --- Keyboard ---------------------------------------------------------------
window.addEventListener('keydown', (event) => {
  const typing = event.target.closest?.('input, select, textarea, [contenteditable]')
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key === 'Enter') { event.preventDefault(); runEntry(); return }
  if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); searchInput.select(); return }
  if (typing || document.querySelector('#function-dialog') || play) return // no editing shortcuts while a game is playing
  const key = event.key.toLowerCase()
  if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
  else if (mod && key === 'y') { event.preventDefault(); redo() }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteNode(state.selected) }
})
document.querySelector('#zoom-in').onclick = () => setZoom(state.zoom + .1)
document.querySelector('#zoom-out').onclick = () => setZoom(state.zoom - .1)
document.querySelector('#fit').onclick = () => fitToView()
document.querySelector('#unfold-all').onclick = () => setAllUnfolded(true)
document.querySelector('#fold-all').onclick = () => setAllUnfolded(false)
// The canvas bitmap has to track the element's CSS size, not just the
// window's: the element also changes size without any window resize (the
// inspector collapsing at the breakpoint, layout settling after fonts load),
// and a stale bitmap gets stretched by CSS — the drawn blocks come out
// squashed and no longer line up with the DOM slots laid over them.
new ResizeObserver(resize).observe(canvas)
window.addEventListener('resize', resize) // devicePixelRatio changes (browser zoom) don't resize the element
document.querySelector('.add-node').addEventListener('click', createCustomFunction)
document.querySelector('.add-type').addEventListener('click', () => openTypeEditor())
document.querySelectorAll('.node-library > .library-item[data-type]').forEach((item) => item.addEventListener('click', () => {
  if (item.dataset.type === 'list') return addFunctionCall('prelude:listOf')
  if (item.dataset.type === 'lambda') return createLambda()
  const graph = activeNodes()
  if (item.dataset.type === 'text') {
    const id = `text-${Date.now()}`
    graph[id] = { id, type: 'text', label: 'text', value: 'text', color: '#e8b23c', ...freePosition(graph, CHIP_W) }
    state.selected = id
    updateInspector(); draw()
    return
  }
  if (!['number', 'boolean'].includes(item.dataset.type)) return
  const isBoolean = item.dataset.type === 'boolean'
  const id = `${item.dataset.type}-${Date.now()}`
  graph[id] = { id, type: isBoolean ? 'boolean' : 'number', typeName: isBoolean ? 'Bool' : 'Int', label: isBoolean ? 'boolean' : 'number', value: isBoolean ? 'false' : '0', color: isBoolean ? '#ed6b84' : '#4f8ef7', ...freePosition(graph, CHIP_W) }
  state.selected = id
  updateInspector()
  draw()
}))
// Restore the autosaved project, if any, then start history from whatever
// is on screen.
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) loadProject(mergeBuiltins(upgradeProject(parseProject(saved)), builtinNodes, builtinBodies))
} catch (error) {
  showToast(`Couldn't restore the saved project: ${error.message}`)
}
renderPreludeLibrary(); renderFunctionLibrary(); updateInspector(); resize(); fitToView()
history.reset(currentSnapshot())
updateHistoryButtons()
