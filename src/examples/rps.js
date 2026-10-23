// Unit 4 · data types — rock, paper, scissors. The game is its types: a
// sum `Hand` with three constructors, a `Result`, a record `Model` whose
// not-yet-played hands are `Maybe Hand`, and a message that carries a
// value (`Throw Hand`). Each rule is the type's eliminator (`caseHand`,
// `caseResult`) — one branch per constructor.
//
//   data Hand   = Rock | Paper | Scissors
//   data Result = Win | Lose | Draw
//   data Model  = Model { mine :: Maybe Hand, theirs :: Maybe Hand, outcome :: Maybe Result, gen :: StdGen, score :: Int }
//   data Msg    = Throw Hand
//
//   beats a b     = caseHand (b == Scissors) (b == Rock) (b == Paper) a
//   result a b    = select (a == b) Draw (select (beats a b) Win Lose)
//   points r      = caseResult 1 (-1) 0 r
//   toHand i      = select (i == 0) Rock (select (i == 1) Paper Scissors)
//   throw h m     = Model (Just h) (Just c) (Just r) (snd g) (score m + points r)
//     where g = randomRInt (0, 2) (gen m); c = toHand (fst g); r = result h c
//   handle msg m  = apply (caseMsg throw msg) m
//   handText      = maybe "—" show
//   view m        = column [heading "Rock · Paper · Scissors", text ("You: " ++ handText (mine m)),
//                           text ("CPU: " ++ handText (theirs m)),
//                           text (maybe "Pick a hand." (caseResult "You win!" "You lose." "Draw.") (outcome m)),
//                           text ("Score: " ++ show (score m)),
//                           row [button "Rock" (Throw Rock), button "Paper" (Throw Paper), button "Scissors" (Throw Scissors)]]
//   initial       = Model Nothing Nothing Nothing (mkStdGen 2026) 0
import { P, T, buildProject, call, n, ref } from './build.js'

export const RPS_TYPES = `data Hand = Rock | Paper | Scissors deriving stock (Eq, Show)
data Result = Win | Lose | Draw deriving stock (Eq, Show)
data Model = Model { mine :: Maybe Hand, theirs :: Maybe Hand, outcome :: Maybe Result, gen :: StdGen, score :: Int } deriving stock (Show)
data Msg = Throw Hand deriving stock (Eq, Show)`

const M = (field) => T('Model', field)
const H = (ctor) => T('Hand', ctor)

export const RPS_FUNCTIONS = {
  beats: [['a', 'b'], [
    ref('b2', 'b'), ref('b3', 'b'),
    call('sc', H('Scissors'), 'Scissors'), call('vsS', 'eq', '(==)', [n('b'), n('sc')]),
    call('rk', H('Rock'), 'Rock'), call('vsR', 'eq', '(==)', [n('b2'), n('rk')]),
    call('pp', H('Paper'), 'Paper'), call('vsP', 'eq', '(==)', [n('b3'), n('pp')]),
    call('out', H('caseHand'), 'caseHand', [n('vsS'), n('vsR'), n('vsP'), n('a')]),
  ], 'out'],
  result: [['a', 'b'], [
    ref('a2', 'a'), ref('b2', 'b'),
    call('same', 'eq', '(==)', [n('a'), n('b')]), call('bt', 'beats', 'beats', [n('a2'), n('b2')]),
    call('win', T('Result', 'Win'), 'Win'), call('lose', T('Result', 'Lose'), 'Lose'), call('draw', T('Result', 'Draw'), 'Draw'),
    call('wl', 'select', 'select', [n('bt'), n('win'), n('lose')]), call('out', 'select', 'select', [n('same'), n('draw'), n('wl')]),
  ], 'out'],
  points: [['r'], [call('out', T('Result', 'caseResult'), 'caseResult', ['1', '-1', '0', n('r')])], 'out'],
  toHand: [['i'], [
    ref('i2', 'i'),
    call('is0', 'eq', '(==)', [n('i'), '0']), call('is1', 'eq', '(==)', [n('i2'), '1']),
    call('rk', H('Rock'), 'Rock'), call('pp', H('Paper'), 'Paper'), call('sc', H('Scissors'), 'Scissors'),
    call('ps', 'select', 'select', [n('is1'), n('pp'), n('sc')]), call('out', 'select', 'select', [n('is0'), n('rk'), n('ps')]),
  ], 'out'],
  throw: [['h', 'm'], [
    ref('h2', 'h'), ref('m2', 'm'),
    call('range', P('pair'), '(,)', ['0', '2']), call('gm', M('gen'), 'gen', [n('m')]), call('g', P('randomRInt'), 'randomRInt', [n('range'), n('gm')]), ref('g2', 'g'),
    call('k', P('fst'), 'fst', [n('g')]), call('c', 'toHand', 'toHand', [n('k')]), ref('c2', 'c'),
    call('r', 'result', 'result', [n('h'), n('c')]), ref('r2', 'r'),
    call('jh', P('just'), 'Just', [n('h2')]), call('jc', P('just'), 'Just', [n('c2')]), call('jr', P('just'), 'Just', [n('r')]),
    call('ng', P('snd'), 'snd', [n('g2')]),
    call('sc', M('score'), 'score', [n('m2')]), call('pt', 'points', 'points', [n('r2')]), call('ns', 'plus', '(+)', [n('sc'), n('pt')]),
    call('out', M('Model'), 'Model', [n('jh'), n('jc'), n('jr'), n('ng'), n('ns')]),
  ], 'out'],
  handle: [['msg', 'm'], [call('th', 'throw', 'throw', ['', '']), call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('th'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')])], 'out'],
  handText: [['mh'], [call('sh', P('show'), 'show', ['']), call('out', P('maybe'), 'maybe', ['"—"', n('sh'), n('mh')])], 'out'],
  view: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'),
    call('hd', P('wHeading'), 'heading', ['"Rock · Paper · Scissors"']),
    call('mi', M('mine'), 'mine', [n('m')]), call('mt', 'handText', 'handText', [n('mi')]), call('t1', P('append'), '(++)', ['"You: "', n('mt')]), call('w1', P('wText'), 'text', [n('t1')]),
    call('th', M('theirs'), 'theirs', [n('m2')]), call('tt', 'handText', 'handText', [n('th')]), call('t2', P('append'), '(++)', ['"CPU: "', n('tt')]), call('w2', P('wText'), 'text', [n('t2')]),
    call('oc', M('outcome'), 'outcome', [n('m3')]), call('say', T('Result', 'caseResult'), 'caseResult', ['"You win!"', '"You lose."', '"Draw."', '']),
    call('t3', P('maybe'), 'maybe', ['"Pick a hand."', n('say'), n('oc')]), call('w3', P('wText'), 'text', [n('t3')]),
    call('sc', M('score'), 'score', [n('m4')]), call('ss', P('show'), 'show', [n('sc')]), call('t4', P('append'), '(++)', ['"Score: "', n('ss')]), call('w4', P('wText'), 'text', [n('t4')]),
    call('rk', H('Rock'), 'Rock'), call('mr', T('Msg', 'Throw'), 'Throw', [n('rk')]), call('b1', P('wButton'), 'button', ['"Rock"', n('mr')]),
    call('pp', H('Paper'), 'Paper'), call('mp', T('Msg', 'Throw'), 'Throw', [n('pp')]), call('b2', P('wButton'), 'button', ['"Paper"', n('mp')]),
    call('scs', H('Scissors'), 'Scissors'), call('ms', T('Msg', 'Throw'), 'Throw', [n('scs')]), call('b3', P('wButton'), 'button', ['"Scissors"', n('ms')]),
    call('btns', P('listOf'), '[ , , ]', [n('b1'), n('b2'), n('b3')]), call('rw', P('wRow'), 'row', [n('btns')]),
    call('list', P('listOf'), '[ , , ]', [n('hd'), n('w1'), n('w2'), n('w3'), n('w4'), n('rw')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  initial: [[], [
    call('n1', P('nothing'), 'Nothing'), call('n2', P('nothing'), 'Nothing'), call('n3', P('nothing'), 'Nothing'), call('g', P('mkStdGen'), 'mkStdGen', ['2026']),
    call('out', M('Model'), 'Model', [n('n1'), n('n2'), n('n3'), n('g'), '0']),
  ], 'out'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildRps() {
  return buildProject(RPS_TYPES, RPS_FUNCTIONS)
}
