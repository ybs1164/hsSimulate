// Unit 3 · currying and composition — a damage pipeline. Each upgrade is
// a partially applied function (`(+ 5)`, `(* 2)`, `(- 3)` as a slot left
// empty), switched on or off with `select b f identity`, and the hit is
// their composition applied to the base damage. Swapping the order shows
// that `(* 2) . (+ 5)` and `(+ 5) . (* 2)` are different functions.
//
//   data Model = Model { sharp :: Bool, crit :: Bool, armor :: Bool, critFirst :: Bool }
//   data Msg   = Sharpen | Crit | Armor | Swap
//
//   weapon b     = select b (+ 5) identity
//   critical b   = select b (* 2) identity
//   shield b     = select b (subtract 3) identity              -- (-) with its first slot empty
//   pipeline m   = compose (shield (armor m)) (select (critFirst m) (compose w c) (compose c w))
//     where w = weapon (sharp m); c = critical (crit m)
//   damage m     = apply (pipeline m) 10
//   label b s    = select b s "id"
//   formula m    = label (armor m) "(-3)" ++ " . " ++ select (critFirst m) (w ++ " . " ++ c) (c ++ " . " ++ w) ++ " $ 10"
//     where w = label (sharp m) "(+5)"; c = label (crit m) "(*2)"
//   handle msg m = apply (caseMsg (over sharp not) (over crit not) (over armor not) (over critFirst not) msg) m
//   view m       = column [heading "Damage pipeline", text (formula m), text ("Damage: " ++ show (damage m)),
//                          drawing 260 30 (color red (rectangleSolid (fromIntegral (damage m) * 8) 20)),
//                          row [button "Sharpen (+5)" Sharpen, button "Critical (*2)" Crit, button "Armor (-3)" Armor, button "Swap order" Swap]]
//   initial      = Model False False False False
import { P, T, buildProject, call, n, ref } from './build.js'

export const DAMAGE_TYPES = `data Model = Model { sharp :: Bool, crit :: Bool, armor :: Bool, critFirst :: Bool } deriving stock (Show)
data Msg = Sharpen | Crit | Armor | Swap deriving stock (Eq, Show)`

const M = (field) => T('Model', field)

// select b f identity — an upgrade that is either on or the identity.
const upgrade = (fn, label, slots) => [['b'], [
  call('f', fn, label, slots), call('id', 'identity', 'identity', ['']), call('out', 'select', 'select', [n('b'), n('f'), n('id')]),
], 'out']

export const DAMAGE_FUNCTIONS = {
  weapon: upgrade('plus', '(+)', ['', '5']),
  critical: upgrade('times', '(*)', ['', '2']),
  shield: upgrade('minus', '(-)', ['', '3']),
  pipeline: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'),
    call('ar', M('armor'), 'armor', [n('m')]), call('sh', 'shield', 'shield', [n('ar')]),
    call('sp', M('sharp'), 'sharp', [n('m2')]), call('w', 'weapon', 'weapon', [n('sp')]), ref('w2', 'w'),
    call('cr', M('crit'), 'crit', [n('m3')]), call('c', 'critical', 'critical', [n('cr')]), ref('c2', 'c'),
    call('wc', 'compose', 'compose', [n('w'), n('c'), '']), call('cw', 'compose', 'compose', [n('c2'), n('w2'), '']),
    call('cf', M('critFirst'), 'critFirst', [n('m4')]), call('ordered', 'select', 'select', [n('cf'), n('wc'), n('cw')]),
    call('out', 'compose', 'compose', [n('sh'), n('ordered'), '']),
  ], 'out'],
  damage: [['m'], [call('p', 'pipeline', 'pipeline', [n('m')]), call('out', 'apply', 'apply', [n('p'), '10'])], 'out'],
  label: [['b', 's'], [call('out', 'select', 'select', [n('b'), n('s'), '"id"'])], 'out'],
  formula: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'),
    call('ar', M('armor'), 'armor', [n('m')]), call('al', 'label', 'label', [n('ar'), '"(-3)"']),
    call('sp', M('sharp'), 'sharp', [n('m2')]), call('w', 'label', 'label', [n('sp'), '"(+5)"']), ref('w2', 'w'),
    call('cr', M('crit'), 'crit', [n('m3')]), call('c', 'label', 'label', [n('cr'), '"(*2)"']), ref('c2', 'c'),
    call('wc1', P('append'), '(++)', [n('w'), '" . "']), call('wc', P('append'), '(++)', [n('wc1'), n('c')]),
    call('cw1', P('append'), '(++)', [n('c2'), '" . "']), call('cw', P('append'), '(++)', [n('cw1'), n('w2')]),
    call('cf', M('critFirst'), 'critFirst', [n('m4')]), call('ordered', 'select', 'select', [n('cf'), n('wc'), n('cw')]),
    call('f1', P('append'), '(++)', [n('al'), '" . "']), call('f2', P('append'), '(++)', [n('f1'), n('ordered')]),
    call('out', P('append'), '(++)', [n('f2'), '" $ 10"']),
  ], 'out'],
  handle: [['msg', 'm'], [
    call('nt1', P('not'), 'not', ['']), call('o1', M('over sharp'), 'over sharp', [n('nt1'), '']),
    call('nt2', P('not'), 'not', ['']), call('o2', M('over crit'), 'over crit', [n('nt2'), '']),
    call('nt3', P('not'), 'not', ['']), call('o3', M('over armor'), 'over armor', [n('nt3'), '']),
    call('nt4', P('not'), 'not', ['']), call('o4', M('over critFirst'), 'over critFirst', [n('nt4'), '']),
    call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('o1'), n('o2'), n('o3'), n('o4'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')]),
  ], 'out'],
  view: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('h', P('wHeading'), 'heading', ['"Damage pipeline"']),
    call('fm', 'formula', 'formula', [n('m')]), call('w1', P('wText'), 'text', [n('fm')]),
    call('d', 'damage', 'damage', [n('m2')]), call('ds', P('show'), 'show', [n('d')]), call('t2', P('append'), '(++)', ['"Damage: "', n('ds')]), call('w2', P('wText'), 'text', [n('t2')]),
    call('d2', 'damage', 'damage', [n('m3')]), call('df', P('fromIntegral'), 'fromIntegral', [n('d2')]), call('len', 'times', '(*)', [n('df'), '8']),
    call('bar', P('pRectangleSolid'), 'rectangleSolid', [n('len'), '20']), call('red', P('red'), 'red'), call('pic', P('pColor'), 'color', [n('red'), n('bar')]),
    call('dr', P('wDrawing'), 'drawing', ['260', '30', n('pic')]),
    call('ms', T('Msg', 'Sharpen'), 'Sharpen'), call('b1', P('wButton'), 'button', ['"Sharpen (+5)"', n('ms')]),
    call('mc', T('Msg', 'Crit'), 'Crit'), call('b2', P('wButton'), 'button', ['"Critical (*2)"', n('mc')]),
    call('ma', T('Msg', 'Armor'), 'Armor'), call('b3', P('wButton'), 'button', ['"Armor (-3)"', n('ma')]),
    call('mw', T('Msg', 'Swap'), 'Swap'), call('b4', P('wButton'), 'button', ['"Swap order"', n('mw')]),
    call('btns', P('listOf'), '[ , , ]', [n('b1'), n('b2'), n('b3'), n('b4')]), call('rw', P('wRow'), 'row', [n('btns')]),
    call('list', P('listOf'), '[ , , ]', [n('h'), n('w1'), n('w2'), n('dr'), n('rw')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  initial: [[], [call('out', M('Model'), 'Model', ['False', 'False', 'False', 'False'])], 'out'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildDamage() {
  return buildProject(DAMAGE_TYPES, DAMAGE_FUNCTIONS)
}
