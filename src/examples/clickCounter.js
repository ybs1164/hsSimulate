// The click-counter example game, built only from what the editor offers —
// declared types, custom functions whose bodies are node graphs, references
// for reused values, derived projections/updates, the copairing caseMsg,
// and Prelude widgets — wired together by `main = program initial view
// handle onTick`. Equivalent Haskell:
//
//   data Wallet = Wallet { clicks :: Double } deriving anyclass (AddGroup, VectorSpace, PartialOrd, …)
//   data Model  = Model { wallet :: Wallet, perClick :: Double, rate :: Double }
//   data Msg    = Click | Buy | BuyAuto
//
//   onClick m            = over wallet (+ Wallet (perClick m)) m
//   onTick dt m          = over wallet (+ dt *^ Wallet (rate m)) m      -- a monoid action
//   purchase cost up m   = if leq cost (wallet m) then up (over wallet (subtract cost) m) else m
//   buyClick             = purchase (Wallet 10) (over perClick (+ 1))
//   buyAuto              = purchase (Wallet 25) (over rate (+ 1))
//   handle               = caseMsg onClick buyClick buyAuto
//   view m               = column [text ("Clicks: " ++ showFFloat 0 (clicks (wallet m))), …,
//                                  button "Click!" Click, …, progress (clicks (wallet m) / 25)]
//   main                 = program initial view handle onTick
//
// The node ids it uses are the app's own (`plus`, `prelude:wButton`,
// `type:Model:wallet`, …), so the same project runs in tests and in the app.
import { declareTypes } from '../typeDecls.js'

export const CLICK_COUNTER_TYPES = `data Wallet = Wallet { clicks :: Double } deriving stock (Eq, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, VectorSpace, PartialOrd, Lattice)
data Model = Model { wallet :: Wallet, perClick :: Double, rate :: Double } deriving stock (Show)
data Msg = Click | Buy | BuyAuto deriving stock (Eq, Show)`

const T = (type, label) => `type:${type}:${label}`
const P = (name) => `prelude:${name}`

/** A call node; each slot is inline literal text or { node: id } for a mounted node. */
function call(id, callee, label, slots = []) {
  return {
    id, type: 'function', sourceFunctionId: callee, label, scope: 'local', color: '#5fa8e8',
    params: slots.map((s) => (typeof s === 'string' ? s : '')),
    mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)),
    paramScopes: slots.map(() => 'local'),
  }
}
const ref = (id, target) => ({ id, type: 'ref', target, label: `↪ ${target}` })
const n = (id) => ({ node: id })

function body(fnId, params, nodes, source) {
  const graph = {}
  params.forEach((name, i) => {
    const id = `input-${fnId}-${i}`
    graph[id] = { id, type: 'parameter', label: name, value: name, color: '#4f8ef7' }
  })
  const rename = (s) => (s && typeof s === 'object' ? { node: params.includes(s.node) ? `input-${fnId}-${params.indexOf(s.node)}` : s.node } : s)
  for (const node of nodes) {
    const fixed = { ...node }
    if (node.type === 'ref' && params.includes(node.target)) fixed.target = `input-${fnId}-${params.indexOf(node.target)}`
    if (node.mounted) fixed.mounted = node.mounted.map((m) => (m && params.includes(m) ? `input-${fnId}-${params.indexOf(m)}` : m))
    graph[node.id] = fixed
  }
  graph.output = { id: 'output', type: 'output', label: 'Output', value: 'ƒ', color: '#2fbf8f', source: rename(n(source)).node }
  layout(graph)
  return graph
}

// Lay out what's visible (nodes not plugged into a slot): parameters and
// references on the left, the result in the middle, Output on the right.
function layout(graph) {
  const free = Object.values(graph).filter((x) => x.type !== 'output' && !isMounted(graph, x.id))
  const output = graph.output
  free.forEach((x, i) => {
    const isResult = x.id === output.source
    x.x = isResult ? 520 : 110
    x.y = isResult ? 255 : 150 + i * 130
  })
  output.x = 980
  output.y = 255
  for (const x of Object.values(graph)) {
    if (x.x === undefined) { x.x = 300; x.y = 600 } // hidden inside a slot until detached
    const host = Object.values(graph).find((h) => h.mounted?.includes(x.id))
    if (host) { x.mountedTo = `${host.id}:${host.mounted.indexOf(x.id)}`; x.connected = true }
  }
  const src = graph[output.source]
  if (src) src.connected = true
}
const isMounted = (graph, id) => Object.values(graph).some((h) => h.mounted?.includes(id))

const FUNCTIONS = {
  onClick: [['m'], [
    ref('m2', 'm'), call('pc', T('Model', 'perClick'), 'perClick', [n('m2')]), call('w', T('Wallet', 'Wallet'), 'Wallet', [n('pc')]),
    call('add', 'plus', '(+)', [n('w'), '']), call('out', T('Model', 'over wallet'), 'over wallet', [n('add'), n('m')]),
  ], 'out'],
  onTick: [['dt', 'm'], [
    ref('m2', 'm'), call('r', T('Model', 'rate'), 'rate', [n('m2')]), call('w', T('Wallet', 'Wallet'), 'Wallet', [n('r')]),
    call('sw', P('scale'), '(*^)', [n('dt'), n('w')]), call('add', 'plus', '(+)', [n('sw'), '']), call('out', T('Model', 'over wallet'), 'over wallet', [n('add'), n('m')]),
  ], 'out'],
  purchase: [['cost', 'upgrade', 'm'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('cost2', 'cost'),
    call('wl', T('Model', 'wallet'), 'wallet', [n('m2')]), call('can', P('leq'), 'leq', [n('cost'), n('wl')]),
    call('pay', 'minus', '(-)', ['', n('cost2')]), call('paid', T('Model', 'over wallet'), 'over wallet', [n('pay'), n('m')]),
    call('up', 'apply', 'apply', [n('upgrade'), n('paid')]), call('out', 'select', 'select', [n('can'), n('up'), n('m3')]),
  ], 'out'],
  buyClick: [['m'], [
    call('cost', T('Wallet', 'Wallet'), 'Wallet', ['10']), call('inc', 'plus', '(+)', ['1', '']),
    call('ov', T('Model', 'over perClick'), 'over perClick', [n('inc'), '']), call('out', 'purchase', 'purchase', [n('cost'), n('ov'), n('m')]),
  ], 'out'],
  buyAuto: [['m'], [
    call('cost', T('Wallet', 'Wallet'), 'Wallet', ['25']), call('inc', 'plus', '(+)', ['1', '']),
    call('ov', T('Model', 'over rate'), 'over rate', [n('inc'), '']), call('out', 'purchase', 'purchase', [n('cost'), n('ov'), n('m')]),
  ], 'out'],
  handle: [['msg'], [
    call('c', 'onClick', 'onClick', ['']), call('b1', 'buyClick', 'buyClick', ['']), call('b2', 'buyAuto', 'buyAuto', ['']),
    call('out', T('Msg', 'caseMsg'), 'caseMsg', [n('c'), n('b1'), n('b2'), n('msg')]),
  ], 'out'],
  view: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('wl', T('Model', 'wallet'), 'wallet', [n('m')]), call('cl', T('Wallet', 'clicks'), 'clicks', [n('wl')]), ref('cl2', 'cl'),
    call('s1', P('showFFloat'), 'showFFloat', ['0', n('cl')]), call('t1', P('append'), '(++)', ['"Clicks: "', n('s1')]), call('w1', P('wText'), 'text', [n('t1')]),
    call('pc', T('Model', 'perClick'), 'perClick', [n('m2')]), call('s2', P('show'), 'show', [n('pc')]), call('t2', P('append'), '(++)', ['"Per click: "', n('s2')]), call('w2', P('wText'), 'text', [n('t2')]),
    call('rt', T('Model', 'rate'), 'rate', [n('m3')]), call('s3', P('showFFloat'), 'showFFloat', ['0', n('rt')]), call('t3', P('append'), '(++)', ['"Per second: "', n('s3')]), call('w3', P('wText'), 'text', [n('t3')]),
    call('mClick', T('Msg', 'Click'), 'Click'), call('b1', P('wButton'), 'button', ['"Click!"', n('mClick')]),
    call('mBuy', T('Msg', 'Buy'), 'Buy'), call('b2', P('wButton'), 'button', ['"+1 per click (10)"', n('mBuy')]),
    call('mAuto', T('Msg', 'BuyAuto'), 'BuyAuto'), call('b3', P('wButton'), 'button', ['"+1 per second (25)"', n('mAuto')]),
    call('frac', 'divide', '(/)', [n('cl2'), '25']), call('bar', P('wProgress'), 'progress', [n('frac')]),
    call('list', P('listOf'), '[ , , ]', [n('w1'), n('w2'), n('w3'), n('b1'), n('b2'), n('b3'), n('bar')]),
    call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  initial: [[], [call('w', T('Wallet', 'Wallet'), 'Wallet', ['0']), call('out', T('Model', 'Model'), 'Model', [n('w'), '1', '0'])], 'out'],
  main: [[], [
    call('init', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('h', 'handle', 'handle', ['']), call('s', 'onTick', 'onTick', ['', '']),
    call('out', P('program'), 'program', [n('init'), n('v'), n('h'), n('s')]),
  ], 'out'],
}

/**
 * The example as project data: `{ types, nodes, functionBodies, entry }`.
 * `nodes` holds only the custom function definitions (the app adds its
 * builtins when the project is loaded).
 */
export function buildClickCounter() {
  const types = declareTypes({}, CLICK_COUNTER_TYPES)
  const nodes = {}
  const functionBodies = {}
  Object.entries(FUNCTIONS).forEach(([name, [params, bodyNodes, source]], i) => {
    nodes[name] = { id: name, type: 'function', label: name, params: [...params], mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true, x: 1060 + (i % 2) * 380, y: 190 + Math.floor(i / 2) * 230 }
    functionBodies[name] = body(name, params, bodyNodes, source)
  })
  return { types, nodes, functionBodies, entry: 'main', outputId: 0 }
}
