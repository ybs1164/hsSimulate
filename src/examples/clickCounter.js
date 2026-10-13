// The click-counter example game, built only from what the editor offers —
// declared types, custom functions whose bodies are node graphs, references
// for reused values, derived projections/updates, the copairing caseMsg,
// and Prelude widgets — wired together by `main = program initial view
// handle onTick`. Every number in the model is an Int; the Double the
// runtime hands `onTick` and the ones `progress` and `showCompact` take
// are crossed with the conversions `round` and `fromIntegral` (Prelude
// functions written as graphs, so they can be opened and edited too).
// Equivalent Haskell:
//
//   data Wallet = Wallet { clicks :: Int } deriving anyclass (AddGroup, PartialOrd, …)
//   data Model  = Model { wallet :: Wallet, perClick :: Int, rate :: Int, elapsed :: Int }
//   data Msg    = Click | Buy | BuyAuto
//
//   onClick m            = over wallet (+ Wallet (perClick m)) m
//   onTick dt m          = set elapsed t (over wallet (+ Wallet (rate m * (t `div` 1000 - e `div` 1000))) m)
//     where e = elapsed m; t = e + round (dt * 1000)
//                          -- rate per whole second of play (elapsed in ms): a monoid action
//   purchase cost up m   = if leq cost (wallet m) then up (over wallet (subtract cost) m) else m
//   buyClick             = purchase (Wallet 10) (over perClick (+ 1))
//   buyAuto              = purchase (Wallet 25) (over rate (+ 1))
//   handle               = caseMsg onClick buyClick buyAuto
//   view m               = column [text ("Clicks: " ++ showCompact (fromIntegral (clicks (wallet m)))), …,
//                                  button "Click!" Click, …, progress (fromIntegral (clicks (wallet m)) / 25)]
//   keys k               = select (k == " ") (Just Click) Nothing       -- Space clicks too
//   subs m               = onKey keys
//   main                 = set subscriptions subs (set stepsPerSecond 20 (program initial view handle onTick))
//
// The node ids it uses are the app's own (`plus`, `prelude:wButton`,
// `type:Model:wallet`, …), so the same project runs in tests and in the app.
import { P, T, buildProject, call, n, ref } from './build.js'

export const CLICK_COUNTER_TYPES = `data Wallet = Wallet { clicks :: Int } deriving stock (Eq, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, PartialOrd, Lattice)
data Model = Model { wallet :: Wallet, perClick :: Int, rate :: Int, elapsed :: Int } deriving stock (Show)
data Msg = Click | Buy | BuyAuto deriving stock (Eq, Show)`

const FUNCTIONS = {
  onClick: [['m'], [
    ref('m2', 'm'), call('pc', T('Model', 'perClick'), 'perClick', [n('m2')]), call('w', T('Wallet', 'Wallet'), 'Wallet', [n('pc')]),
    call('add', 'plus', '(+)', [n('w'), '']), call('out', T('Model', 'over wallet'), 'over wallet', [n('add'), n('m')]),
  ], 'out'],
  onTick: [['dt', 'm'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('ms', 'times', '(*)', [n('dt'), '1000']), call('dms', P('round'), 'round', [n('ms')]),
    call('e', T('Model', 'elapsed'), 'elapsed', [n('m2')]), ref('e2', 'e'), call('t', 'plus', '(+)', [n('e'), n('dms')]), ref('t2', 't'),
    call('after', P('div'), 'div', [n('t'), '1000']), call('before', P('div'), 'div', [n('e2'), '1000']), call('secs', 'minus', '(-)', [n('after'), n('before')]),
    call('r', T('Model', 'rate'), 'rate', [n('m3')]), call('earned', 'times', '(*)', [n('r'), n('secs')]),
    call('w', T('Wallet', 'Wallet'), 'Wallet', [n('earned')]), call('add', 'plus', '(+)', [n('w'), '']), call('paid', T('Model', 'over wallet'), 'over wallet', [n('add'), n('m')]),
    call('out', T('Model', 'set elapsed'), 'set elapsed', [n('t2'), n('paid')]),
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
    call('wl', T('Model', 'wallet'), 'wallet', [n('m')]), call('clk', T('Wallet', 'clicks'), 'clicks', [n('wl')]),
    call('cl', P('fromIntegral'), 'fromIntegral', [n('clk')]), ref('cl2', 'cl'), call('s1', P('showCompact'), 'showCompact', [n('cl')]), call('t1', P('append'), '(++)', ['"Clicks: "', n('s1')]), call('w1', P('wText'), 'text', [n('t1')]),
    call('pc', T('Model', 'perClick'), 'perClick', [n('m2')]), call('s2', P('show'), 'show', [n('pc')]), call('t2', P('append'), '(++)', ['"Per click: "', n('s2')]), call('w2', P('wText'), 'text', [n('t2')]),
    call('rt', T('Model', 'rate'), 'rate', [n('m3')]), call('s3', P('show'), 'show', [n('rt')]), call('t3', P('append'), '(++)', ['"Per second: "', n('s3')]), call('w3', P('wText'), 'text', [n('t3')]),
    call('mClick', T('Msg', 'Click'), 'Click'), call('b1', P('wButton'), 'button', ['"Click!"', n('mClick')]),
    call('mBuy', T('Msg', 'Buy'), 'Buy'), call('b2', P('wButton'), 'button', ['"+1 per click (10)"', n('mBuy')]),
    call('mAuto', T('Msg', 'BuyAuto'), 'BuyAuto'), call('b3', P('wButton'), 'button', ['"+1 per second (25)"', n('mAuto')]),
    call('frac', 'divide', '(/)', [n('cl2'), '25']), call('bar', P('wProgress'), 'progress', [n('frac')]),
    call('list', P('listOf'), '[ , , ]', [n('w1'), n('w2'), n('w3'), n('b1'), n('b2'), n('b3'), n('bar')]),
    call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  initial: [[], [call('w', T('Wallet', 'Wallet'), 'Wallet', ['0']), call('out', T('Model', 'Model'), 'Model', [n('w'), '1', '0', '0'])], 'out'],
  keys: [['k'], [
    call('isSpace', 'eq', '(==)', [n('k'), '" "']), call('mClick', T('Msg', 'Click'), 'Click'), call('yes', P('just'), 'Just', [n('mClick')]), call('no', P('nothing'), 'Nothing'),
    call('out', 'select', 'select', [n('isSpace'), n('yes'), n('no')]),
  ], 'out'],
  subs: [['m'], [call('ks', 'keys', 'keys', ['']), call('out', P('onKey'), 'onKey', [n('ks')])], 'out'],
  main: [[], [
    call('init', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('h', 'handle', 'handle', ['']), call('s', 'onTick', 'onTick', ['', '']),
    call('prog', P('program'), 'program', [n('init'), n('v'), n('h'), n('s')]),
    call('fast', P('setStepsPerSecond'), 'set stepsPerSecond', ['20', n('prog')]),
    call('sb', 'subs', 'subs', ['']),
    call('out', P('setSubscriptions'), 'set subscriptions', [n('sb'), n('fast')]),
  ], 'out'],
}

/**
 * The example as project data: `{ types, nodes, functionBodies, entry }`.
 * `nodes` holds only the custom function definitions (the app adds its
 * builtins when the project is loaded).
 */
export function buildClickCounter() {
  return buildProject(CLICK_COUNTER_TYPES, FUNCTIONS)
}
