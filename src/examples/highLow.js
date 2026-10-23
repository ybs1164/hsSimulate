// Unit 6 · type classes — High-Low. `Rank`'s order and its names come
// from `deriving (Eq, Ord, Show)`: `compare` ranks the cards in
// constructor order and `show` names them, with no code of our own. Guess
// whether the next card is higher or lower; a tie keeps your streak.
// (Try writing `instance Ord Rank` yourself to make the Ace low.)
//
//   data Rank  = Two | Three | Four | Five | Six | Seven | Eight | Nine | Ten | Jack | Queen | King | Ace
//   data Model = Model { current :: Rank, gen :: StdGen, streak :: Int, best :: Int, message :: String }
//   data Msg   = Hi | Lo
//
//   ranks          = [Two, Three, …, Ace]
//   rankOf i       = maybe Two identity (ranks !? i)
//   guess up m     = Model next (snd r) s (max (best m) s) (show (current m) ++ " → " ++ show next ++ select ok "  ✓" "  ✗")
//     where r    = randomRInt (0, 12) (gen m)
//           next = rankOf (fst r)
//           ok   = caseOrdering (not up) True up (compare next (current m))
//           s    = select ok (streak m + 1) 0
//   handle msg m   = apply (caseMsg (guess True) (guess False) msg) m
//   view m         = column [heading "High · Low", text ("Card: " ++ show (current m)), text (message m),
//                            text ("Streak " ++ show (streak m) ++ "  ·  Best " ++ show (best m)),
//                            row [button "Higher" Hi, button "Lower" Lo]]
//   initial        = Model Seven (mkStdGen 2026) 0 0 "Higher or lower?"
import { P, T, buildProject, call, n, ref } from './build.js'

const RANKS = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace']

export const HIGH_LOW_TYPES = `data Rank = ${RANKS.join(' | ')} deriving stock (Eq, Ord, Show)
data Model = Model { current :: Rank, gen :: StdGen, streak :: Int, best :: Int, message :: String } deriving stock (Show)
data Msg = Hi | Lo deriving stock (Eq, Show)`

const M = (field) => T('Model', field)

export const HIGH_LOW_FUNCTIONS = {
  ranks: [[], [...RANKS.map((r) => call(`r${r}`, T('Rank', r), r)), call('out', P('listOf'), '[ , , ]', RANKS.map((r) => n(`r${r}`)))], 'out'],
  rankOf: [['i'], [
    call('rs', 'ranks', 'ranks'), call('ix', P('index'), '(!?)', [n('rs'), n('i')]), call('two', T('Rank', 'Two'), 'Two'), call('id', 'identity', 'identity', ['']),
    call('out', P('maybe'), 'maybe', [n('two'), n('id'), n('ix')]),
  ], 'out'],
  guess: [['up', 'm'], [
    ref('up2', 'up'), ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'), ref('m5', 'm'),
    call('range', P('pair'), '(,)', ['0', '12']), call('gm', M('gen'), 'gen', [n('m')]), call('r', P('randomRInt'), 'randomRInt', [n('range'), n('gm')]), ref('r2', 'r'),
    call('k', P('fst'), 'fst', [n('r')]), call('next', 'rankOf', 'rankOf', [n('k')]), ref('next2', 'next'), ref('next3', 'next'),
    call('cur', M('current'), 'current', [n('m2')]), ref('cur2', 'cur'),
    call('cmp', P('compare'), 'compare', [n('next'), n('cur')]), call('down', P('not'), 'not', [n('up')]),
    call('ok', T('Ordering', 'caseOrdering'), 'caseOrdering', [n('down'), 'True', n('up2'), n('cmp')]), ref('ok2', 'ok'),
    call('st', M('streak'), 'streak', [n('m3')]), call('st1', 'plus', '(+)', [n('st'), '1']),
    call('s', 'select', 'select', [n('ok'), n('st1'), '0']), ref('s2', 's'),
    call('b', M('best'), 'best', [n('m4')]), call('nb', P('max'), 'max', [n('b'), n('s2')]),
    call('cs', P('show'), 'show', [n('cur2')]), call('ns', P('show'), 'show', [n('next2')]),
    call('t1', P('append'), '(++)', [n('cs'), '" → "']), call('t2', P('append'), '(++)', [n('t1'), n('ns')]),
    call('mark', 'select', 'select', [n('ok2'), '"  ✓"', '"  ✗"']), call('msg', P('append'), '(++)', [n('t2'), n('mark')]),
    call('ng', P('snd'), 'snd', [n('r2')]),
    call('out', M('Model'), 'Model', [n('next3'), n('ng'), n('s'), n('nb'), n('msg')]),
  ], 'out'],
  handle: [['msg', 'm'], [
    call('hi', 'guess', 'guess', ['True', '']), call('lo', 'guess', 'guess', ['False', '']),
    call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('hi'), n('lo'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')]),
  ], 'out'],
  view: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'),
    call('hd', P('wHeading'), 'heading', ['"High · Low"']),
    call('cur', M('current'), 'current', [n('m')]), call('cs', P('show'), 'show', [n('cur')]), call('t1', P('append'), '(++)', ['"Card: "', n('cs')]), call('w1', P('wText'), 'text', [n('t1')]),
    call('ms', M('message'), 'message', [n('m2')]), call('w2', P('wText'), 'text', [n('ms')]),
    call('st', M('streak'), 'streak', [n('m3')]), call('ss', P('show'), 'show', [n('st')]), call('b', M('best'), 'best', [n('m4')]), call('bs', P('show'), 'show', [n('b')]),
    call('t3', P('append'), '(++)', ['"Streak "', n('ss')]), call('t4', P('append'), '(++)', [n('t3'), '"  ·  Best "']), call('t5', P('append'), '(++)', [n('t4'), n('bs')]),
    call('w3', P('wText'), 'text', [n('t5')]),
    call('mh', T('Msg', 'Hi'), 'Hi'), call('bh', P('wButton'), 'button', ['"Higher"', n('mh')]),
    call('ml', T('Msg', 'Lo'), 'Lo'), call('bl', P('wButton'), 'button', ['"Lower"', n('ml')]),
    call('btns', P('listOf'), '[ , , ]', [n('bh'), n('bl')]), call('rw', P('wRow'), 'row', [n('btns')]),
    call('list', P('listOf'), '[ , , ]', [n('hd'), n('w1'), n('w2'), n('w3'), n('rw')]), call('out', P('wColumn'), 'column', [n('list')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  initial: [[], [
    call('seven', T('Rank', 'Seven'), 'Seven'), call('g', P('mkStdGen'), 'mkStdGen', ['2026']),
    call('out', M('Model'), 'Model', [n('seven'), n('g'), '0', '0', '"Higher or lower?"']),
  ], 'out'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildHighLow() {
  return buildProject(HIGH_LOW_TYPES, HIGH_LOW_FUNCTIONS)
}
