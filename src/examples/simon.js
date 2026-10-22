// Unit 5 · lists and recursion — Simon, the memory game. The pattern and
// what you've entered are both `[Pad]`; a round is list work: append a
// random pad, compare a prefix with `take`, count with `length`, and draw
// the pads with `map`. Remember the pattern, then repeat it — it hides as
// soon as you start.
//
//   data Pad   = Red | Green | Blue | Yellow
//   data Model = Model { pattern :: [Pad], entered :: [Pad], gen :: StdGen, best :: Int, failed :: Bool }
//   data Msg   = Press Pad | Start
//
//   pads         = [Red, Green, Blue, Yellow]
//   toPad i      = maybe Red identity (pads !? i)
//   grow m       = Model (pattern m ++ [toPad (fst r)]) [] (snd r) (max (best m) (length (pattern m))) False
//     where r = randomRInt (0, 3) (gen m)
//   check m      = select (take (length e) p == e) (select (length e == length p) (grow m) m) (set failed True m)
//     where p = pattern m; e = entered m
//   press p m    = select (failed m) m (check (over entered (++ [p]) m))
//   start m      = grow (Model [] [] (gen m) (best m) False)
//   handle msg m = apply (caseMsg press start msg) m
//   padLabel p   = show p ++ " "
//   padButton p  = withColor (casePad red green blue yellow p) (button (show p) (Press p))
//   hint m       = select (failed m) ("Wrong! Best: " ++ show (best m) ++ " rounds")
//                    (select (null (entered m)) ("Remember: " ++ concatMap padLabel (pattern m)) ("Now repeat it: " ++ concatMap padLabel (entered m)))
//   view m       = column [heading "Simon", text ("Round " ++ show (length (pattern m))), text (hint m),
//                          row (map padButton pads), button "New game" Start]
//   initial      = start (Model [] [] (mkStdGen 7) 0 False)
import { P, T, buildProject, call, n, ref } from './build.js'

export const SIMON_TYPES = `data Pad = Red | Green | Blue | Yellow deriving stock (Eq, Show)
data Model = Model { pattern :: [Pad], entered :: [Pad], gen :: StdGen, best :: Int, failed :: Bool } deriving stock (Show)
data Msg = Press Pad | Start deriving stock (Eq, Show)`

const M = (field) => T('Model', field)
const PADS = ['Red', 'Green', 'Blue', 'Yellow']

const FUNCTIONS = {
  pads: [[], [...PADS.map((p) => call(`p${p}`, T('Pad', p), p)), call('out', P('listOf'), '[ , , ]', PADS.map((p) => n(`p${p}`)))], 'out'],
  toPad: [['i'], [
    call('ps', 'pads', 'pads'), call('ix', P('index'), '(!?)', [n('ps'), n('i')]), call('red', T('Pad', 'Red'), 'Red'), call('id', 'identity', 'identity', ['']),
    call('out', P('maybe'), 'maybe', [n('red'), n('id'), n('ix')]),
  ], 'out'],
  grow: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'),
    call('range', P('pair'), '(,)', ['0', '3']), call('gm', M('gen'), 'gen', [n('m')]), call('r', P('randomRInt'), 'randomRInt', [n('range'), n('gm')]), ref('r2', 'r'),
    call('k', P('fst'), 'fst', [n('r')]), call('pad', 'toPad', 'toPad', [n('k')]), call('one', P('listOf'), '[ , , ]', [n('pad')]),
    call('pt', M('pattern'), 'pattern', [n('m2')]), call('np', P('append'), '(++)', [n('pt'), n('one')]),
    call('none', P('nil'), '[]'), call('ng', P('snd'), 'snd', [n('r2')]),
    call('pt2', M('pattern'), 'pattern', [n('m3')]), call('len', P('length'), 'length', [n('pt2')]),
    call('b', M('best'), 'best', [n('m4')]), call('nb', P('max'), 'max', [n('b'), n('len')]),
    call('out', M('Model'), 'Model', [n('np'), n('none'), n('ng'), n('nb'), 'False']),
  ], 'out'],
  check: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'), ref('m5', 'm'),
    call('p', M('pattern'), 'pattern', [n('m')]), ref('p2', 'p'),
    call('e', M('entered'), 'entered', [n('m2')]), ref('e2', 'e'), ref('e3', 'e'),
    call('le', P('length'), 'length', [n('e')]), ref('le2', 'le'),
    call('pre', P('take'), 'take', [n('le'), n('p')]), call('ok', 'eq', '(==)', [n('pre'), n('e2')]),
    call('lp', P('length'), 'length', [n('p2')]), call('done', 'eq', '(==)', [n('le2'), n('lp')]),
    call('g', 'grow', 'grow', [n('m3')]), call('next', 'select', 'select', [n('done'), n('g'), n('m4')]),
    call('fail', M('set failed'), 'set failed', ['True', n('m5')]),
    call('out', 'select', 'select', [n('ok'), n('next'), n('fail')]),
  ], 'out'],
  press: [['p', 'm'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('one', P('listOf'), '[ , , ]', [n('p')]), call('add', P('append'), '(++)', ['', n('one')]),
    call('ov', M('over entered'), 'over entered', [n('add'), n('m')]), call('ck', 'check', 'check', [n('ov')]),
    call('f', M('failed'), 'failed', [n('m2')]), call('out', 'select', 'select', [n('f'), n('m3'), n('ck')]),
  ], 'out'],
  start: [['m'], [
    ref('m2', 'm'),
    call('n1', P('nil'), '[]'), call('n2', P('nil'), '[]'), call('g', M('gen'), 'gen', [n('m')]), call('b', M('best'), 'best', [n('m2')]),
    call('fresh', M('Model'), 'Model', [n('n1'), n('n2'), n('g'), n('b'), 'False']), call('out', 'grow', 'grow', [n('fresh')]),
  ], 'out'],
  handle: [['msg', 'm'], [
    call('pr', 'press', 'press', ['', '']), call('st', 'start', 'start', ['']),
    call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('pr'), n('st'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')]),
  ], 'out'],
  padLabel: [['p'], [call('s', P('show'), 'show', [n('p')]), call('out', P('append'), '(++)', [n('s'), '" "'])], 'out'],
  padButton: [['p'], [
    ref('p2', 'p'), ref('p3', 'p'),
    call('r', P('red'), 'red'), call('g', P('green'), 'green'), call('b', P('blue'), 'blue'), call('y', P('yellow'), 'yellow'),
    call('c', T('Pad', 'casePad'), 'casePad', [n('r'), n('g'), n('b'), n('y'), n('p')]),
    call('s', P('show'), 'show', [n('p2')]), call('msg', T('Msg', 'Press'), 'Press', [n('p3')]), call('btn', P('wButton'), 'button', [n('s'), n('msg')]),
    call('out', P('wColor'), 'withColor', [n('c'), n('btn')]),
  ], 'out'],
  hint: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'), ref('m5', 'm'),
    call('b', M('best'), 'best', [n('m')]), call('bs', P('show'), 'show', [n('b')]),
    call('w1', P('append'), '(++)', ['"Wrong! Best: "', n('bs')]), call('wrong', P('append'), '(++)', [n('w1'), '" rounds"']),
    call('pl', 'padLabel', 'padLabel', ['']), call('pt', M('pattern'), 'pattern', [n('m2')]), call('pts', P('concatMap'), 'concatMap', [n('pl'), n('pt')]),
    call('rem', P('append'), '(++)', ['"Remember: "', n('pts')]),
    call('pl2', 'padLabel', 'padLabel', ['']), call('en', M('entered'), 'entered', [n('m3')]), call('ens', P('concatMap'), 'concatMap', [n('pl2'), n('en')]),
    call('rep', P('append'), '(++)', ['"Now repeat it: "', n('ens')]),
    call('en2', M('entered'), 'entered', [n('m4')]), call('fresh', P('null'), 'null', [n('en2')]),
    call('going', 'select', 'select', [n('fresh'), n('rem'), n('rep')]),
    call('f', M('failed'), 'failed', [n('m5')]), call('out', 'select', 'select', [n('f'), n('wrong'), n('going')]),
  ], 'out'],
  view: [['m'], [
    ref('m2', 'm'),
    call('hd', P('wHeading'), 'heading', ['"Simon"']),
    call('pt', M('pattern'), 'pattern', [n('m')]), call('len', P('length'), 'length', [n('pt')]), call('ls', P('show'), 'show', [n('len')]),
    call('t1', P('append'), '(++)', ['"Round "', n('ls')]), call('w1', P('wText'), 'text', [n('t1')]),
    call('hn', 'hint', 'hint', [n('m2')]), call('w2', P('wText'), 'text', [n('hn')]),
    call('pb', 'padButton', 'padButton', ['']), call('ps', 'pads', 'pads'), call('btns', P('map'), 'map', [n('pb'), n('ps')]), call('rw', P('wRow'), 'row', [n('btns')]),
    call('ms', T('Msg', 'Start'), 'Start'), call('ng', P('wButton'), 'button', ['"New game"', n('ms')]),
    call('list', P('listOf'), '[ , , ]', [n('hd'), n('w1'), n('w2'), n('rw'), n('ng')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  initial: [[], [
    call('n1', P('nil'), '[]'), call('n2', P('nil'), '[]'), call('g', P('mkStdGen'), 'mkStdGen', ['7']),
    call('blank', M('Model'), 'Model', [n('n1'), n('n2'), n('g'), '0', 'False']), call('out', 'start', 'start', [n('blank')]),
  ], 'out'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildSimon() {
  return buildProject(SIMON_TYPES, FUNCTIONS)
}
