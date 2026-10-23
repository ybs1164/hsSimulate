// Unit 1 · functions and types — a vending machine's coin slot. The model
// is one Int (the balance) and every rule is a function with a fixed
// signature, so the lesson is reading `::` and `->`:
//
//   data Msg = Coin100 | Coin500 | Refund
//
//   insert :: Int -> Int -> Int
//   insert coin total = coin + total
//   refund :: Int -> Int
//   refund total      = 0
//   handle msg m      = apply (caseMsg (insert 100) (insert 500) refund msg) m
//   view total        = column [heading "Vending machine", text ("Balance: " ++ show total ++ " won"),
//                               row [button "+100" Coin100, button "+500" Coin500, button "Refund" Refund]]
//   initial = 0
//   main    = program initial view handle step
import { P, T, buildProject, call, lit, n } from './build.js'

export const VENDING_TYPES = `data Msg = Coin100 | Coin500 | Refund deriving stock (Eq, Show)`

export const VENDING_FUNCTIONS = {
  insert: [['coin', 'total'], [call('out', 'plus', '(+)', [n('coin'), n('total')])], 'out', ['Int', 'Int', 'Int']],
  refund: [['total'], [lit('out', '0')], 'out', ['Int', 'Int']],
  handle: [['msg', 'm'], [
    call('i100', 'insert', 'insert', ['100', '']), call('i500', 'insert', 'insert', ['500', '']), call('rf', 'refund', 'refund', ['']),
    call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('i100'), n('i500'), n('rf'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')]),
  ], 'out'],
  view: [['total'], [
    call('h', P('wHeading'), 'heading', ['"Vending machine"']),
    call('s', P('show'), 'show', [n('total')]), call('t1', P('append'), '(++)', ['"Balance: "', n('s')]), call('t2', P('append'), '(++)', [n('t1'), '" won"']),
    call('t', P('wText'), 'text', [n('t2')]),
    call('m1', T('Msg', 'Coin100'), 'Coin100'), call('b1', P('wButton'), 'button', ['"+100"', n('m1')]),
    call('m2', T('Msg', 'Coin500'), 'Coin500'), call('b2', P('wButton'), 'button', ['"+500"', n('m2')]),
    call('m3', T('Msg', 'Refund'), 'Refund'), call('b3', P('wButton'), 'button', ['"Refund"', n('m3')]),
    call('btns', P('listOf'), '[ , , ]', [n('b1'), n('b2'), n('b3')]), call('rw', P('wRow'), 'row', [n('btns')]),
    call('list', P('listOf'), '[ , , ]', [n('h'), n('t'), n('rw')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  initial: [[], [lit('out', '0')], 'out', ['Int']],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildVending() {
  return buildProject(VENDING_TYPES, VENDING_FUNCTIONS)
}
