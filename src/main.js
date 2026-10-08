import './style.css'
import { applySubst, showQual, tcon, tfun, unify, createNamer, pred } from './typeSystem.js'
import { inferGraph, valueTypeOfEntry } from './inferGraph.js'
import { reduce, predsOnVar, pickDefault, entails, literalClass, numericTypes } from './numericClasses.js'

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
          <button class="library-item" data-type="number"><span class="lib-icon number-icon">#</span><span><b>Numbers</b><small>Int · Float</small></span></button>
          <button class="library-item" data-type="text"><span class="lib-icon text-icon">Aa</span><span><b>Text</b><small>String</small></span></button>
          <button class="library-item" data-type="list"><span class="lib-icon list-icon">[ ]</span><span><b>Lists</b><small>[a, b, c]</small></span></button>
          <button class="library-item" data-type="boolean"><span class="lib-icon bool-icon">◉</span><span><b>Booleans</b><small>True · False</small></span></button>
        </nav>
        <div class="side-footer"><div class="tip"><span class="tip-icon">i</span><div><b>Try it out</b><p>Drag nodes and use the<br/>play button on a function.</p></div></div><div class="runtime-row"><span>Runtime</span><strong>GHC 9.6.3 <i>●</i></strong></div></div>
      </aside>
      <section class="canvas-panel">
        <div class="canvas-toolbar"><div class="breadcrumbs"><button class="crumb-back" id="back-graph" hidden>← main</button><span>GRAPH</span><span>/</span><b id="graph-name">main</b><span class="saved"><i></i> Saved just now</span></div><div class="toolbar-actions"><button class="tool-button" id="reset">↺ <span>Reset</span></button><button class="tool-button primary" id="run">▶ <span>Run graph</span></button></div></div>
        <div class="canvas-wrap"><canvas id="graph-canvas"></canvas><div id="port-editor"></div><div class="canvas-hint"><span class="mouse-icon">⌖</span><span>Drag to pan · Nodes snap together like magnets</span></div><div class="zoom-control"><button id="zoom-out">−</button><span id="zoom-level">100%</span><button id="zoom-in">+</button><button id="fit">⌗</button></div></div>
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
const state = { zoom: 1, offset: { x: 0, y: 0 }, selected: 'add', running: false, drag: null, pan: null, snapTarget: null, activeFunction: null, suppressClick: false }
const nodes = {
  add: { id: 'add', type: 'function', x: 300, y: 190, label: 'add', params: ['n'], mounted: [null], paramScopes: ['local'], color: '#6c5ce7', scope: 'main', builtin: 'succ', readonly: true, expression: 'λn f x. f (n f x)' },
  identity: { id: 'identity', type: 'function', x: 620, y: 190, label: 'identity', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#4f8ef7', scope: 'main', builtin: 'identity', readonly: true, expression: 'λx. x' },
  zero: { id: 'zero', type: 'function', x: 300, y: 410, label: 'zero', params: [], mounted: [], paramScopes: [], color: '#a96ef0', scope: 'main', builtin: 'zero', readonly: true, expression: 'λf x. x' },
  apply: { id: 'apply', type: 'function', x: 620, y: 410, label: 'apply', params: ['f', 'x'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#f0954a', scope: 'main', builtin: 'apply', readonly: true, expression: 'λf x. f x' },
  compose: { id: 'compose', type: 'function', x: 300, y: 630, label: 'compose', params: ['f', 'g', 'x'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#2bb8b0', scope: 'main', builtin: 'compose', readonly: true, expression: 'λf g x. f (g x)' },
  isZero: { id: 'isZero', type: 'function', x: 620, y: 630, label: 'isZero', params: ['n'], mounted: [null], paramScopes: ['local'], color: '#ed6b84', scope: 'main', builtin: 'isZero', readonly: true, expression: 'λn. n == 0' },
  ifThenElse: { id: 'ifThenElse', type: 'function', x: 620, y: 850, label: 'ifThenElse', params: ['condition', 'whenTrue', 'whenFalse'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#c77dd6', scope: 'main', builtin: 'ifThenElse', readonly: true, expression: 'λc a b. c ? a : b' },
  // Group-theoretic numeric hierarchy builtins (see src/numericClasses.js) —
  // each demands only the weakest algebraic structure it needs.
  plus: { id: 'plus', type: 'function', x: 300, y: 1070, label: '(+)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#e8b23c', scope: 'main', builtin: 'plus', readonly: true, expression: 'x + y' },
  negate: { id: 'negate', type: 'function', x: 620, y: 1070, label: 'negate', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#8c7cf2', scope: 'main', builtin: 'negate', readonly: true, expression: '-x' },
  divide: { id: 'divide', type: 'function', x: 300, y: 1290, label: '(/)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#35b4e0', scope: 'main', builtin: 'divide', readonly: true, expression: 'x / y' },
  sqrt: { id: 'sqrt', type: 'function', x: 620, y: 1290, label: 'sqrt', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#3cbe84', scope: 'main', builtin: 'sqrt', readonly: true, expression: 'sqrt x' },
  toRational: { id: 'toRational', type: 'function', x: 300, y: 1510, label: 'toRational', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#d66bd1', scope: 'main', builtin: 'toRational', readonly: true, expression: 'toRational x' },
  fromIntegral: { id: 'fromIntegral', type: 'function', x: 620, y: 1510, label: 'fromIntegral', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#ec7550', scope: 'main', builtin: 'fromIntegral', readonly: true, expression: 'fromIntegral x' },
  round: { id: 'round', type: 'function', x: 300, y: 1730, label: 'round', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#86c24c', scope: 'main', builtin: 'round', readonly: true, expression: 'round x' },
  isNaN: { id: 'isNaN', type: 'function', x: 620, y: 1730, label: 'isNaN', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#e85c9e', scope: 'main', builtin: 'isNaN', readonly: true, expression: 'isNaN x' },
  minus: { id: 'minus', type: 'function', x: 300, y: 1950, label: '(-)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#5fa8e8', scope: 'main', builtin: 'minus', readonly: true, expression: 'x - y' },
  times: { id: 'times', type: 'function', x: 620, y: 1950, label: '(*)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#f0954a', scope: 'main', builtin: 'times', readonly: true, expression: 'x * y' },
  addZero: { id: 'addZero', type: 'function', x: 300, y: 2170, label: 'addZero', params: [], mounted: [], paramScopes: [], color: '#4fc2c2', scope: 'main', builtin: 'addZero', readonly: true, expression: '0 (additive identity)' },
  mulOne: { id: 'mulOne', type: 'function', x: 620, y: 2170, label: 'mulOne', params: [], mounted: [], paramScopes: [], color: '#b98fef', scope: 'main', builtin: 'mulOne', readonly: true, expression: '1 (multiplicative identity)' },
  geq: { id: 'geq', type: 'function', x: 300, y: 2390, label: '(>=)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#ed8fa8', scope: 'main', builtin: 'geq', readonly: true, expression: 'x >= y' },
  eq: { id: 'eq', type: 'function', x: 620, y: 2390, label: '(==)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#3cbe9e', scope: 'main', builtin: 'eq', readonly: true, expression: 'x == y' },
  select: { id: 'select', type: 'function', x: 620, y: 2610, label: 'select', params: ['condition', 'whenTrue', 'whenFalse'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#c77dd6', scope: 'main', builtin: 'select', readonly: true, expression: 'λc a b. c ? a : b' },
}
function activeNodes() { return state.activeFunction ? functionBodies[state.activeFunction] : nodes }
function activeName() { return state.activeFunction ? nodes[state.activeFunction].label : 'main' }
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
const functionLibrary = document.querySelector('#function-library')

function renderFunctionLibrary() {
  functionLibrary.innerHTML = Object.values(nodes).filter(isFunction).map((node) => `
    <button class="library-item function-library-item ${state.activeFunction === node.id ? 'active' : ''}" data-function-id="${node.id}">
      <span class="lib-icon function-icon">ƒ</span>
      <span><b>${node.label}</b><small>${functionSignature(node, nodes)}</small></span>
    </button>
  `).join('')
  functionLibrary.querySelectorAll('.function-library-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (state.activeFunction) addFunctionCall(item.dataset.functionId)
      else enterFunction(item.dataset.functionId)
    })
  })
}

function addFunctionCall(sourceId) {
  const source = nodes[sourceId]
  if (!source) return
  const graph = activeNodes()
  const id = `call-${sourceId}-${Date.now()}`
  graph[id] = {
    id, type: 'function', sourceFunctionId: sourceId,
    x: 180 + (Object.keys(graph).length % 3) * 210,
    y: 360 + (Object.keys(graph).length % 2) * 90,
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
    id: `${id}-output`, type: 'output', x: 570, y: 255,
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
    nodes[id] = { id, type: 'function', x: 300, y: 190, label, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true }
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
  canvas.width = canvas.clientWidth * dpr
  canvas.height = canvas.clientHeight * dpr
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
const FN_TAIL = 40       // right padding after the last slot before the block's right edge
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
function graphBounds(graphNodes = Object.values(activeNodes()).filter(n => !n.mountedTo)) {
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
function roundedRectPath(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r)
  c.closePath()
}
// One inferGraph() pass over `graph` (defaults to whatever's on screen). Not
// cached — cheap for this app's graph sizes, and always fresh so a
// connect/disconnect is reflected on the very next call, no invalidation needed.
function typePass(graph = activeNodes()) { return inferGraph(nodes, functionBodies, graph) }
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
function nodeTypeLabel(node) { return node.type === 'boolean' ? 'Boolean · Bool' : node.type === 'curried' ? 'Curried function' : 'Number · Int' }
function draw() {
  labelNamer = createNamer()
  const pass = typePass() // shared by every node label and port badge below, so nodes/ports that truly share a type variable display the same letter
  const w = canvas.clientWidth, h = canvas.clientHeight
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#f8f7fc'; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#ecebf5'; ctx.lineWidth = 1
  for (let x = state.offset.x % 24; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = state.offset.y % 24; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  Object.values(activeNodes()).filter(n => !n.mountedTo).forEach(n => {
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
  const playX = rect.right - 16 * state.zoom, playY = rect.top + 2 * state.zoom
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
  const glyph = isFunctionValued ? 'ƒ' : node.type === 'output' ? '→' : node.type === 'boolean' ? '◉' : '#'
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
  const content = isFunctionValued ? (node.value || 'ƒ') : node.type === 'output' ? (node.value ?? 'Output') : String(node.value ?? node.label)
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
function paramDisplayName(node, index) {
  const source = node.sourceFunctionId ? nodes[node.sourceFunctionId] : node
  return source?.params?.[index] || `#${index + 1}`
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
  if (moving) { moving.mountedTo = null; moving.connected = false }
  return moving
}
function updatePortEditor(pass = typePass()) {
  editor.innerHTML = ''
  Object.values(activeNodes()).filter(isFunction).forEach(node => node.params.forEach((rawValue, index) => {
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
    const tagType = document.createElement('span')
    tagType.className = 'param-tag-type'; tagType.textContent = expectedParamType(node, index, activeNodes(), labelNamer, pass)
    tagType.style.color = slotColor
    tag.append(tagName, tagSep, tagType)
    // Plain DOM elements laid over the canvas, not canvas-drawn text — the
    // slot's own width/height already scale with state.zoom above, but this
    // tag's font-size/spacing need the same treatment explicitly or it stays
    // pinned at its CSS default size while the slot around it grows/shrinks,
    // drifting out of place at anything but 100% zoom.
    tag.style.fontSize = `${9 * state.zoom}px`
    tag.style.padding = `${3 * state.zoom}px ${8 * state.zoom}px`
    tag.style.marginBottom = `${8 * state.zoom}px`
    tag.style.gap = `${3 * state.zoom}px`
    slot.append(tag)
    if (mountedNode) {
      // Snapped-in: render the plugged node as a nested chip — colored by
      // its resolved TYPE (not the slot's own decorative node color), so a
      // slot and whatever's plugged into it always agree — grabbing it
      // pulls it back out, magnet-style, as a free node under the cursor.
      const chip = document.createElement('div')
      chip.className = 'param-chip'
      chip.style.background = colorForType(resolvedValueQual(mountedNode, activeNodes(), pass).type, labelNamer)
      chip.textContent = mountedNode.type === 'function' ? `ƒ ${mountedNode.label}` : String(mountedNode.value ?? mountedNode.label)
      chip.title = '드래그해서 떼어내기'
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
      input.style.fontSize = `${11 * state.zoom}px`
      input.style.paddingTop = `${4 * state.zoom}px`
      input.addEventListener('input', () => { node.params[index] = input.value; state.selected = node.id; updateInspector(); draw() })
      slot.append(input)
    }
    const remove = document.createElement('button')
    remove.className = 'param-remove'; remove.type = 'button'; remove.textContent = '−'; remove.title = 'Remove parameter'
    remove.style.width = remove.style.height = `${16 * state.zoom}px`
    remove.style.right = remove.style.top = `${-6 * state.zoom}px`
    remove.style.fontSize = `${12 * state.zoom}px`; remove.style.lineHeight = `${16 * state.zoom}px`
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      const moving = detachMounted(node, index)
      if (moving) { moving.x = node.x + 150; moving.y = node.y + 110 }
      node.params.splice(index, 1); node.mounted.splice(index, 1); node.paramScopes.splice(index, 1)
      state.selected = node.id; updateInspector(); draw()
    })
    slot.append(remove)
    editor.append(slot)
  }))
  Object.values(activeNodes()).filter(isFunction).forEach(node => {
    const add = document.createElement('button')
    add.className = 'param-add'; add.type = 'button'; add.textContent = '+'; add.title = 'Add parameter'
    const center = slotScreenCenter(node, node.params.length)
    const addSize = 26 * state.zoom
    add.style.width = add.style.height = `${addSize}px`
    add.style.fontSize = `${18 * state.zoom}px`; add.style.lineHeight = `${20 * state.zoom}px`
    add.style.left = `${center.x - addSize / 2}px`; add.style.top = `${point(node).y - addSize / 2}px`
    add.addEventListener('click', () => { node.params.push(`p${node.params.length + 1}`); node.mounted.push(null); node.paramScopes.push('local'); state.selected = node.id; updateInspector(); draw() })
    editor.append(add)
  })
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
  return `<div class="selected-node"><span class="selected-icon number">#</span><div><b>${n.label}</b><small>${nodeTypeLabel(n)}</small></div><span class="live">VALUE</span></div><div class="property"><label>TYPE</label><code>${showQual(q.preds, q.type)}</code></div>${defaultRow}${annotateRow}<div class="property"><label>VALUE</label><input class="value-input" value="${n.value ?? 'partial'}" ${isNumber ? '' : 'readonly'} /></div>`
}
function updateInspector() {
  const n = activeNodes()[state.selected]
  if (!n) return
  inspector.innerHTML = n.type === 'output'
    ? `<div class="selected-node"><span class="selected-icon output-icon">→</span><div><b>Output</b><small>Function result</small></div><span class="live">TARGET</span></div><div class="property"><label>OUTPUT VALUE</label><div class="connection-tag">${n.source ? `ƒ ${activeNodes()[n.source]?.label || n.value}` : 'Drop a node here'}</div></div><div class="inspector-note">This node defines what the function returns.</div>`
    : n.type === 'function'
    ? `<div class="selected-node"><span class="selected-icon">ƒ</span><div><b>${n.label}</b><small>Function · ${n.scope || 'main'}</small></div><span class="live">COMPOSABLE</span></div><div class="property"><label>TYPE SIGNATURE</label><code>${functionSignature(n)}</code></div><div class="property"><label>BODY · OUTPUT</label><div class="connection-tag">${n.expression || functionBodies[n.sourceFunctionId || n.id]?.output?.expression || 'Drop a node into Output to define this function'}</div></div><div class="property"><label>PARAMETERS</label>${n.params.map((value, i) => `<div class="port-row"><span class="port ${value ? 'filled' : 'hollow'}"></span><span>${value || `parameter ${i + 1}`}</span><select class="param-scope" data-index="${i}"><option ${n.paramScopes[i] === 'local' ? 'selected' : ''}>local</option><option ${n.paramScopes[i] === 'main' ? 'selected' : ''}>main</option><option ${n.paramScopes[i] === 'shared' ? 'selected' : ''}>shared</option></select><strong>${n.mounted[i] ? `ƒ ${activeNodes()[n.mounted[i]]?.label || 'function'}` : 'open'}</strong></div>`).join('')}</div><div class="property"><label>FUNCTION SCOPE</label><select class="scope-select" id="function-scope"><option ${n.scope === 'local' ? 'selected' : ''}>local</option><option ${n.scope === 'main' ? 'selected' : ''}>main</option><option ${n.scope === 'shared' ? 'selected' : ''}>shared</option></select></div><button class="evaluate" id="evaluate">▶ &nbsp; Play function</button><div class="inspector-note">The canvas is the function body.<br/>Connect any declared function to Output.</div>`
    : renderValueInspector(n)
  const evaluate = document.querySelector('#evaluate')
  if (evaluate) evaluate.onclick = () => executeFunction(n)
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
  if (valueInput && n.type === 'number') valueInput.oninput = () => { n.value = valueInput.value; draw() }
}
function executeFunction(fn) {
  if (!isFunction(fn)) return
  state.running = true
  const values = fn.params.map(value => Number(value) || 0), filled = fn.params.filter(v => v !== '').length
  const id = `output-${++outputId}`
  if (filled < fn.params.length) {
    // Residual type after peeling off the already-filled params (left-to-right,
    // same looseness as `filled` above — this app doesn't track which specific
    // slots are filled, only how many).
    const entry = typePass().perNode.get(fn.id)
    const residual = entry?.paramTypes ? entry.paramTypes.slice(filled).reduceRight((acc, t) => tfun(t, acc), entry.resultType) : null
    // Note: unlike a full signature, this residual doesn't carry the preds
    // still pending on it (e.g. partially-applying `plus` loses its `AddSemigroup`
    // obligation in this display) — an intentionally narrow scope limit,
    // same spirit as leaving curried nodes untyped for reconnection below.
    activeNodes()[id] = { id, type: 'curried', typeName: residual ? showQual([], residual) : functionSignature(fn), resolvedType: residual || undefined, x: functionBlockRight(fn) + 90, y: fn.y + (outputId % 2) * 45, label: `${fn.label} · ${filled}/${fn.params.length}`, value: 'ƒ', remaining: fn.params.length - filled, color: '#a96ef0' }
  } else {
    const result = evaluateFunction(fn, values)
    const booleanResult = typeof result === 'boolean'
    // Inherit the function's actual resolved result type when it's concrete
    // (e.g. Play `sqrt` on a Double literal → the result node is Double too,
    // not a hardcoded Int) via the same annotation mechanism a literal uses.
    const resultType = typePass().perNode.get(fn.id)?.resultType
    const concreteType = !booleanResult && resultType?.kind === 'con' ? resultType.name : undefined
    activeNodes()[id] = { id, type: booleanResult ? 'boolean' : 'number', typeName: booleanResult ? 'Bool' : (concreteType || 'Int'), annotation: concreteType, x: functionBlockRight(fn) + 90, y: fn.y + (outputId % 2) * 45, label: 'result', value: String(result), color: booleanResult ? '#ed6b84' : '#8c7cf2' }
  }
  state.selected = id; updateInspector(); draw()
  setTimeout(() => { state.running = false; draw() }, 300)
}
function evaluateFunction(fn, values, seen = new Set(), environment = {}) {
  if (seen.has(fn.id)) throw new Error(`Circular function call: ${fn.label}`)
  const source = fn.sourceFunctionId ? nodes[fn.sourceFunctionId] : fn
  if (source?.builtin === 'succ') return (values[0] || 0) + 1
  if (source?.builtin === 'plus') return (values[0] || 0) + (values[1] || 0)
  if (source?.builtin === 'zero') return 0
  if (source?.builtin === 'identity') return values[0] || 0
  if (source?.builtin === 'isZero') return (values[0] || 0) === 0
  if (source?.builtin === 'ifThenElse') return values[0] ? values[1] : values[2]
  if (source?.builtin === 'negate') return -(values[0] || 0)
  if (source?.builtin === 'divide') return (values[0] || 0) / (values[1] || 1) // avoid a bare-zero divisor producing a confusing Infinity by default
  if (source?.builtin === 'sqrt') return Math.sqrt(values[0] || 0)
  if (source?.builtin === 'toRational' || source?.builtin === 'fromIntegral') return values[0] || 0 // this app has no distinct runtime numeric representations — type-level only
  if (source?.builtin === 'round') return Math.round(values[0] || 0) // Haskell rounds half-to-even; simplified here
  if (source?.builtin === 'isNaN') return Number.isNaN(values[0]) // note: executeFunction launders every param through `Number(value) || 0` before this runs, so a real NaN can never actually arrive — this is a type-level demo of IEEEFloat, its Play result is always false
  if (source?.builtin === 'minus') return (values[0] || 0) - (values[1] || 0)
  if (source?.builtin === 'times') return (values[0] || 0) * (values[1] || 0)
  if (source?.builtin === 'addZero') return 0
  if (source?.builtin === 'mulOne') return 1
  if (source?.builtin === 'geq') return (values[0] || 0) >= (values[1] || 0)
  if (source?.builtin === 'eq') return (values[0] || 0) === (values[1] || 0)
  // `values` has already been through `Number(value) || 0`, which turns the
  // string 'true' into 0 — read the raw port text for the Bool condition.
  if (source?.builtin === 'select') return fn.params?.[0] === 'true' || (fn.params?.[0] !== 'false' && Boolean(values[0])) ? values[1] || 0 : values[2] || 0
  if (source?.builtin === 'apply') {
    const target = findFunctionById(fn.mounted?.[0])
    return target ? evaluateFunction(target, [values[1] || 0], new Set([...seen, fn.id]), environment) : values[1] || 0
  }
  if (source?.builtin === 'compose') {
    const first = findFunctionById(fn.mounted?.[0])
    const second = findFunctionById(fn.mounted?.[1])
    if (first && second) {
      const intermediate = evaluateFunction(second, [values[2] || 0], new Set([...seen, fn.id]), environment)
      return evaluateFunction(first, [intermediate], new Set([...seen, fn.id]), environment)
    }
    return values[0] || 0
  }
  const body = functionBodies[fn.sourceFunctionId || fn.id]
  const output = body && body.output
  if (output && output.source) {
    const source = body[output.source]
    if (source && source.type === 'parameter') {
      const index = bodyParameterIndex(body, source.id)
      return values[index] || 0
    }
    if (source && source.type === 'function') {
      const sourceFn = nodes[source.sourceFunctionId || source.id]
      if (sourceFn) {
        const args = source.params.map(value => {
          const numeric = Number(value)
          return Number.isNaN(numeric) ? (environment[value] || 0) : numeric
        })
        return evaluateFunction(sourceFn, args, new Set([...seen, fn.id]), environment)
      }
    }
  }
  return values[0] || 0
}
function bodyParameterIndex(body, id) {
  return Object.values(body).filter(node => node.type === 'parameter').findIndex(node => node.id === id)
}
function findFunctionById(id) {
  if (!id) return null
  if (nodes[id] && isFunction(nodes[id])) return nodes[id]
  for (const body of Object.values(functionBodies)) {
    if (body[id] && isFunction(body[id])) return body[id]
  }
  return null
}
// Nodes currently snapped into a slot have no meaningful standalone
// position/hitbox on the open canvas — they're only reachable through the
// slot's own nested chip (see updatePortEditor's detach handler).
function hitNode(x, y) {
  return Object.values(activeNodes()).find(n => {
    if (n.mountedTo) return false
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
  if (!dragged || dragged.type === 'output') return null
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
    output.source = dragged.id
    output.value = dragged.type === 'function' ? `ƒ ${dragged.label}` : dragged.value
    dragged.mountedTo = `${output.id}:source`
    dragged.connected = true
    state.selected = output.id
    return true
  }
  const targetNode = activeNodes()[target.targetId]
  if (!targetNode) return false
  targetNode.params[target.index] = dragged.type === 'function' ? `ƒ ${dragged.label}` : dragged.value
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
  const fn = Object.values(activeNodes()).find(n => n.type === 'function' && !n.mountedTo && Math.hypot(p.x - (functionBlockRight(n) - 16), p.y - (n.y - FN_H / 2 + 2)) < 18)
  if (fn) {
    executeFunction(fn)
    return
  }
  const selected = Object.values(activeNodes()).find(n => n.type === 'function' && !n.mountedTo && pointInFunctionBlock(n, p.x, p.y))
  if (selected && !state.activeFunction && !selected.readonly && !nodes[selected.sourceFunctionId]?.readonly) enterFunction(selected.id)
})
function enterFunction(id) {
  if (nodes[id]?.readonly) return
  if (!functionBodies[id]) functionBodies[id] = { output: { id: `${id}-output`, type: 'output', x: 570, y: 255, label: 'Output', value: 'open', color: '#2fbf8f' } }
  state.activeFunction = id
  state.selected = 'output'
  renderFunctionLibrary()
  updateInspector()
  fitToView()
}
document.querySelector('#back-graph').onclick = () => { state.activeFunction = null; state.selected = 'add'; renderFunctionLibrary(); updateInspector(); fitToView() }
document.querySelector('#run').onclick = () => executeFunction(activeNodes().add || nodes.add)
document.querySelector('#reset').onclick = () => { Object.keys(nodes).filter(id => id.startsWith('output-') || id.startsWith('call-') || id.startsWith('number-')).forEach(id => delete nodes[id]); Object.values(functionBodies).forEach(body => Object.keys(body).filter(id => id.startsWith('call-')).forEach(id => delete body[id])); Object.values(nodes).forEach(node => { node.mountedTo = null; node.connected = false }); state.activeFunction = null; state.selected = 'add'; renderFunctionLibrary(); updateInspector(); fitToView() }
document.querySelector('#zoom-in').onclick = () => setZoom(state.zoom + .1)
document.querySelector('#zoom-out').onclick = () => setZoom(state.zoom - .1)
document.querySelector('#fit').onclick = () => fitToView()
window.addEventListener('resize', resize)
document.querySelector('.add-node').addEventListener('click', createCustomFunction)
document.querySelectorAll('.node-library > .library-item[data-type]').forEach((item) => item.addEventListener('click', () => {
  if (!['number', 'boolean'].includes(item.dataset.type)) return
  const graph = activeNodes()
  const isBoolean = item.dataset.type === 'boolean'
  const id = `${item.dataset.type}-${Date.now()}`
  graph[id] = { id, type: isBoolean ? 'boolean' : 'number', typeName: isBoolean ? 'Bool' : 'Int', label: isBoolean ? 'boolean' : 'number', value: isBoolean ? 'false' : '0', color: isBoolean ? '#ed6b84' : '#4f8ef7', x: 180 + (Object.keys(graph).length % 3) * 210, y: 360 + (Object.keys(graph).length % 2) * 90 }
  state.selected = id
  updateInspector()
  draw()
}))
renderFunctionLibrary(); updateInspector(); resize(); fitToView()
