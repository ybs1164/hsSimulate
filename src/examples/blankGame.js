// The smallest complete game — a starting point to grow your own:
//
//   data Model = Model { count :: Double }
//   data Msg   = Increment
//
//   initial      = Model 0
//   handle msg m = apply (caseMsg (over count (1 +)) msg) m
//   view m       = column [text ("Count: " ++ showFFloat 0 (count m)), button "+1" Increment]
//   step dt m    = m
//   main         = program initial view handle step
import { P, T, buildProject, call, n } from './build.js'

export const BLANK_GAME_TYPES = `data Model = Model { count :: Double } deriving stock (Eq, Show)
data Msg = Increment deriving stock (Eq, Show)`

const FUNCTIONS = {
  initial: [[], [call('out', T('Model', 'Model'), 'Model', ['0'])], 'out'],
  handle: [['msg', 'm'], [call('inc', 'plus', '(+)', ['1', '']), call('up', T('Model', 'over count'), 'over count', [n('inc'), '']), call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('up'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')])], 'out'],
  view: [['m'], [
    call('c', T('Model', 'count'), 'count', [n('m')]), call('s', P('showFFloat'), 'showFFloat', ['0', n('c')]), call('t', P('append'), '(++)', ['"Count: "', n('s')]), call('w1', P('wText'), 'text', [n('t')]),
    call('msg', T('Msg', 'Increment'), 'Increment'), call('b', P('wButton'), 'button', ['"+1"', n('msg')]),
    call('list', P('listOf'), '[ , , ]', [n('w1'), n('b')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('h', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('h'), n('s')])], 'out'],
}

export function buildBlankGame() {
  return buildProject(BLANK_GAME_TYPES, FUNCTIONS)
}
