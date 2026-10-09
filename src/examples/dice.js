// A dice roller — pure randomness with a generator kept in the model, a
// pair taken apart with fst/snd, and a gloss-style drawing:
//
//   data Model = Model { face :: Int, gen :: StdGen }
//   data Msg   = Roll
//
//   initial      = Model 1 (mkStdGen 2026)
//   roll m       = Model (fst r) (snd r)   where r = randomRInt (1, 6) (gen m)
//   handle msg m = apply (caseMsg roll msg) m
//   view m       = column [heading "Dice",
//                          drawing 160 160 (color red (rectangleSolid 120 120)
//                                           <> color white (circleSolid (fromIntegral (face m) * 8))),
//                          text ("You rolled " ++ show (face m)), button "Roll" Roll]
//   step dt m    = m
//   main         = program initial view handle step
import { P, T, buildProject, call, n, ref } from './build.js'

export const DICE_TYPES = `data Model = Model { face :: Int, gen :: StdGen } deriving stock (Show)
data Msg = Roll deriving stock (Eq, Show)`

const FUNCTIONS = {
  initial: [[], [call('g', P('mkStdGen'), 'mkStdGen', ['2026']), call('out', T('Model', 'Model'), 'Model', ['1', n('g')])], 'out'],
  roll: [['m'], [
    call('range', P('pair'), '(,)', ['1', '6']), call('gm', T('Model', 'gen'), 'gen', [n('m')]), call('r', P('randomRInt'), 'randomRInt', [n('range'), n('gm')]), ref('r2', 'r'),
    call('f', P('fst'), 'fst', [n('r')]), call('g', P('snd'), 'snd', [n('r2')]), call('out', T('Model', 'Model'), 'Model', [n('f'), n('g')]),
  ], 'out'],
  handle: [['msg', 'm'], [call('rl', 'roll', 'roll', ['']), call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('rl'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')])], 'out'],
  view: [['m'], [
    ref('m2', 'm'),
    call('h', P('wHeading'), 'heading', ['"Dice"']),
    call('red', P('red'), 'red'), call('sq', P('pRectangleSolid'), 'rectangleSolid', ['120', '120']), call('back', P('pColor'), 'color', [n('red'), n('sq')]),
    call('fc', T('Model', 'face'), 'face', [n('m')]), ref('fc2', 'fc'), call('fd', P('fromIntegral'), 'fromIntegral', [n('fc')]), call('rad', 'times', '(*)', [n('fd'), '8']),
    call('dot', P('pCircleSolid'), 'circleSolid', [n('rad')]), call('white', P('white'), 'white'), call('pip', P('pColor'), 'color', [n('white'), n('dot')]),
    call('pic', P('mappend'), '(<>)', [n('back'), n('pip')]), call('dr', P('wDrawing'), 'drawing', ['160', '160', n('pic')]),
    call('sh', P('show'), 'show', [n('fc2')]), call('tx', P('append'), '(++)', ['"You rolled "', n('sh')]), call('t', P('wText'), 'text', [n('tx')]),
    call('mr', T('Msg', 'Roll'), 'Roll'), call('b', P('wButton'), 'button', ['"Roll"', n('mr')]),
    call('list', P('listOf'), '[ , , ]', [n('h'), n('dr'), n('t'), n('b')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildDice() {
  return buildProject(DICE_TYPES, FUNCTIONS)
}
