// Unit 2 · conditions — Nim against the computer. Take 1 or 2 stones;
// whoever takes the last one wins. Every rule is a Bool from `isZero`
// picking a number with `ifThenElse` (or, for text and models, the
// polymorphic `select`). The CPU leaves a multiple of 3 whenever it can —
// can you find the first move that beats it?
//
//   data Model = Model { left :: Int, cpuLast :: Int }
//   data Msg   = Take1 | Take2 | Restart
//
//   yourTake k m  = ifThenElse (isZero (left m - 1)) 1 k     -- only 1 stone left: take it
//   cpuTake l     = ifThenElse (isZero r) 1 r   where r = mod l 3   -- leave a multiple of 3
//   move k m      = select (isZero (left m)) m (Model (l - c) c)  -- the game is over at 0
//     where t = yourTake k m; l = left m - t; c = ifThenElse (isZero l) 0 (cpuTake l)
//   status m      = select (isZero (left m))
//                     (select (isZero (cpuLast m)) "You took the last stone — you win!" "The CPU took the last stone — you lose.")
//                     (select (isZero (cpuLast m)) "Take 1 or 2. Whoever takes the last stone wins." ("The CPU took " ++ show (cpuLast m) ++ ". Your move."))
//   handle msg m  = apply (caseMsg (move 1) (move 2) restart msg) m
//   view m        = column [heading "Nim", text ("Stones left: " ++ show (left m)), text (concat (replicate (left m) "● ")),
//                           text (status m), row [button "Take 1" Take1, button "Take 2" Take2, button "New game" Restart]]
//   initial       = Model 20 0
import { P, T, buildProject, call, n, ref } from './build.js'

export const NIM_TYPES = `data Model = Model { left :: Int, cpuLast :: Int } deriving stock (Show)
data Msg = Take1 | Take2 | Restart deriving stock (Eq, Show)`

const M = (field) => T('Model', field)

export const NIM_FUNCTIONS = {
  yourTake: [['k', 'm'], [
    call('l', M('left'), 'left', [n('m')]), call('l1', 'minus', '(-)', [n('l'), '1']), call('last', 'isZero', 'isZero', [n('l1')]),
    call('out', 'ifThenElse', 'ifThenElse', [n('last'), '1', n('k')]),
  ], 'out'],
  cpuTake: [['l'], [
    call('r', P('mod'), 'mod', [n('l'), '3']), ref('r2', 'r'), call('stuck', 'isZero', 'isZero', [n('r')]),
    call('out', 'ifThenElse', 'ifThenElse', [n('stuck'), '1', n('r2')]),
  ], 'out'],
  move: [['k', 'm'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'),
    call('t', 'yourTake', 'yourTake', [n('k'), n('m')]),
    call('lm', M('left'), 'left', [n('m2')]), call('l', 'minus', '(-)', [n('lm'), n('t')]), ref('l2', 'l'), ref('l3', 'l'),
    call('none', 'isZero', 'isZero', [n('l')]), call('ct', 'cpuTake', 'cpuTake', [n('l2')]),
    call('c', 'ifThenElse', 'ifThenElse', [n('none'), '0', n('ct')]), ref('c2', 'c'),
    call('rest', 'minus', '(-)', [n('l3'), n('c')]), call('next', M('Model'), 'Model', [n('rest'), n('c2')]),
    call('lo', M('left'), 'left', [n('m3')]), call('over', 'isZero', 'isZero', [n('lo')]),
    call('out', 'select', 'select', [n('over'), n('m4'), n('next')]),
  ], 'out'],
  status: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'),
    call('l', M('left'), 'left', [n('m')]), call('over', 'isZero', 'isZero', [n('l')]),
    call('c1', M('cpuLast'), 'cpuLast', [n('m2')]), call('youLast', 'isZero', 'isZero', [n('c1')]),
    call('end', 'select', 'select', [n('youLast'), '"You took the last stone — you win!"', '"The CPU took the last stone — you lose."']),
    call('c2', M('cpuLast'), 'cpuLast', [n('m3')]), call('fresh', 'isZero', 'isZero', [n('c2')]),
    call('c3', M('cpuLast'), 'cpuLast', [n('m4')]), call('cs', P('show'), 'show', [n('c3')]),
    call('s1', P('append'), '(++)', ['"The CPU took "', n('cs')]), call('s2', P('append'), '(++)', [n('s1'), '". Your move."']),
    call('playing', 'select', 'select', [n('fresh'), '"Take 1 or 2. Whoever takes the last stone wins."', n('s2')]),
    call('out', 'select', 'select', [n('over'), n('end'), n('playing')]),
  ], 'out'],
  restart: [['m'], [call('out', 'initial', 'initial')], 'out'],
  handle: [['msg', 'm'], [
    call('t1', 'move', 'move', ['1', '']), call('t2', 'move', 'move', ['2', '']), call('rs', 'restart', 'restart', ['']),
    call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('t1'), n('t2'), n('rs'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')]),
  ], 'out'],
  view: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('h', P('wHeading'), 'heading', ['"Nim"']),
    call('l', M('left'), 'left', [n('m')]), call('ls', P('show'), 'show', [n('l')]), call('t1', P('append'), '(++)', ['"Stones left: "', n('ls')]), call('w1', P('wText'), 'text', [n('t1')]),
    call('l2', M('left'), 'left', [n('m2')]), call('dots', P('replicate'), 'replicate', [n('l2'), '"● "']), call('row', P('concat'), 'concat', [n('dots')]), call('w2', P('wText'), 'text', [n('row')]),
    call('st', 'status', 'status', [n('m3')]), call('w3', P('wText'), 'text', [n('st')]),
    call('mt1', T('Msg', 'Take1'), 'Take1'), call('b1', P('wButton'), 'button', ['"Take 1"', n('mt1')]),
    call('mt2', T('Msg', 'Take2'), 'Take2'), call('b2', P('wButton'), 'button', ['"Take 2"', n('mt2')]),
    call('mr', T('Msg', 'Restart'), 'Restart'), call('b3', P('wButton'), 'button', ['"New game"', n('mr')]),
    call('btns', P('listOf'), '[ , , ]', [n('b1'), n('b2'), n('b3')]), call('rw', P('wRow'), 'row', [n('btns')]),
    call('list', P('listOf'), '[ , , ]', [n('h'), n('w1'), n('w2'), n('w3'), n('rw')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  initial: [[], [call('out', M('Model'), 'Model', ['20', '0'])], 'out'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildNim() {
  return buildProject(NIM_TYPES, NIM_FUNCTIONS)
}
