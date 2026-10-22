// Blackjack — a game built on lists: the deck, both hands and the random
// keys that shuffle it are all `[Int]` (a card is its rank, 1 = Ace … 13 =
// King), worked on with the Prelude's list functions.
//
//   data Phase = Playing | Won | Lost | Push
//   data Model = Model { deck :: [Int], player :: [Int], dealer :: [Int], gen :: StdGen,
//                        phase :: Phase, wins :: Int, losses :: Int }
//   data Msg   = Hit | Stand | Deal
//
//   cardValue r   = min r 10                                    -- Ace counts 1 …
//   score h       = select (elem 1 h && 21 >= s + 10) (s + 10) s  -- … or 11 when it fits
//     where s = sum (map cardValue h)
//   rolls g       = fst r : rolls (snd r)   where r = randomRInt (0, 1000000) g   -- infinite
//   byKey a b     = compare (fst a) (fst b)
//   shuffle g xs  = map snd (sortBy byKey (zip (rolls g) xs))   -- sort by random keys
//   deal m        = Model (drop 4 d) (take 2 d) (take 2 (drop 2 d)) (mkStdGen (fst (randomRInt (0, 1000000000) (gen m))))
//                         Playing (wins m) (losses m)
//     where d = shuffle (gen m) (concatMap (replicate 4) (enumFromTo 1 13))
//   isPlaying m   = phase m == Playing
//   drawPlayer m  = set deck (drop 1 (deck m)) (over player (++ take 1 (deck m)) m)
//   drawDealer m  = set deck (drop 1 (deck m)) (over dealer (++ take 1 (deck m)) m)
//   settle p m    = set phase p (over losses (+ casePhase 0 0 1 0 p) (over wins (+ casePhase 0 1 0 0 p) m))
//   checkBust m   = select (score (player m) > 21) (settle Lost m) m
//   hit m         = select (isPlaying m) (checkBust (drawPlayer m)) m
//   dealerPlay m  = select (score (dealer m) >= 17) m (dealerPlay (drawDealer m))   -- dealer draws to 17
//   outcome m     = select (d > 21 || p > d) Won (select (p == d) Push Lost)
//     where p = score (player m); d = score (dealer m)
//   finish m      = settle (outcome d) d   where d = dealerPlay m
//   stand m       = select (isPlaying m) (finish m) m
//   nextRound m   = select (isPlaying m) m (deal m)
//   handle msg m  = apply (caseMsg hit stand nextRound msg) m
//   cardName r    = maybe "?" identity (["A","2",…,"10","J","Q","K"] !? (r - 1))
//   cardLabel r   = cardName r ++ " "
//   showHand h    = concatMap cardLabel h
//   view m        = column [heading "Blackjack", text dealerLine, text playerLine,
//                           text (casePhase "Hit or stand?" "You win!" "You lose." "Push — a tie." (phase m)),
//                           row [button "Hit" Hit, button "Stand" Stand, button "Deal" Deal],
//                           text ("Wins " ++ show (wins m) ++ "  ·  Losses " ++ show (losses m))]
//     -- the dealer's second card stays hidden while you play
//   initial       = deal (Model [] [] [] (mkStdGen 2026) Playing 0 0)
//   main          = program initial view handle step
import { P, T, buildProject, call, n, ref } from './build.js'

export const BLACKJACK_TYPES = `data Phase = Playing | Won | Lost | Push deriving stock (Eq, Show)
data Model = Model { deck :: [Int], player :: [Int], dealer :: [Int], gen :: StdGen, phase :: Phase, wins :: Int, losses :: Int } deriving stock (Show)
data Msg = Hit | Stand | Deal deriving stock (Eq, Show)`

const M = (field) => T('Model', field)
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((r) => `"${r}"`)

// drawPlayer / drawDealer: the top card of the deck onto a hand.
const draw = (hand) => [['m'], [
  ref('m2', 'm'), call('dk', M('deck'), 'deck', [n('m')]), ref('dk2', 'dk'),
  call('top', P('take'), 'take', ['1', n('dk')]), call('add', P('append'), '(++)', ['', n('top')]),
  call('dealt', M(`over ${hand}`), `over ${hand}`, [n('add'), n('m2')]),
  call('rest', P('drop'), 'drop', ['1', n('dk2')]), call('out', M('set deck'), 'set deck', [n('rest'), n('dealt')]),
], 'out']

const FUNCTIONS = {
  cardValue: [['r'], [call('out', P('min'), 'min', [n('r'), '10'])], 'out'],
  score: [['h'], [
    ref('h2', 'h'), call('cv', 'cardValue', 'cardValue', ['']), call('vals', P('map'), 'map', [n('cv'), n('h')]),
    call('s', P('sum'), 'sum', [n('vals')]), ref('s2', 's'), call('soft', 'plus', '(+)', [n('s'), '10']), ref('soft2', 'soft'),
    call('ace', P('elem'), 'elem', ['1', n('h2')]), call('fits', 'geq', '(>=)', ['21', n('soft')]),
    call('cond', P('and'), '(&&)', [n('ace'), n('fits')]), call('out', 'select', 'select', [n('cond'), n('soft2'), n('s2')]),
  ], 'out'],
  rolls: [['g'], [
    call('range', P('pair'), '(,)', ['0', '1000000']), call('r', P('randomRInt'), 'randomRInt', [n('range'), n('g')]), ref('r2', 'r'),
    call('k', P('fst'), 'fst', [n('r')]), call('g2', P('snd'), 'snd', [n('r2')]), call('more', 'rolls', 'rolls', [n('g2')]),
    call('out', P('cons'), '(:)', [n('k'), n('more')]),
  ], 'out'],
  byKey: [['a', 'b'], [call('ka', P('fst'), 'fst', [n('a')]), call('kb', P('fst'), 'fst', [n('b')]), call('out', P('compare'), 'compare', [n('ka'), n('kb')])], 'out'],
  shuffle: [['g', 'xs'], [
    call('rs', 'rolls', 'rolls', [n('g')]), call('keyed', P('zip'), 'zip', [n('rs'), n('xs')]),
    call('bk', 'byKey', 'byKey', ['', '']), call('sorted', P('sortBy'), 'sortBy', [n('bk'), n('keyed')]),
    call('sn', P('snd'), 'snd', ['']), call('out', P('map'), 'map', [n('sn'), n('sorted')]),
  ], 'out'],
  deal: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('g', M('gen'), 'gen', [n('m')]), ref('g2', 'g'),
    call('ranks', P('enumFromTo'), 'enumFromTo', ['1', '13']), call('four', P('replicate'), 'replicate', ['4', '']),
    call('full', P('concatMap'), 'concatMap', [n('four'), n('ranks')]), call('d', 'shuffle', 'shuffle', [n('g'), n('full')]), ref('d2', 'd'), ref('d3', 'd'),
    call('rest', P('drop'), 'drop', ['4', n('d')]), call('ph', P('take'), 'take', ['2', n('d2')]),
    call('dd', P('drop'), 'drop', ['2', n('d3')]), call('dh', P('take'), 'take', ['2', n('dd')]),
    call('range', P('pair'), '(,)', ['0', '1000000000']), call('rr', P('randomRInt'), 'randomRInt', [n('range'), n('g2')]),
    call('seed', P('fst'), 'fst', [n('rr')]), call('ng', P('mkStdGen'), 'mkStdGen', [n('seed')]),
    call('playing', T('Phase', 'Playing'), 'Playing'), call('w', M('wins'), 'wins', [n('m2')]), call('l', M('losses'), 'losses', [n('m3')]),
    call('out', M('Model'), 'Model', [n('rest'), n('ph'), n('dh'), n('ng'), n('playing'), n('w'), n('l')]),
  ], 'out'],
  isPlaying: [['m'], [call('ph', M('phase'), 'phase', [n('m')]), call('playing', T('Phase', 'Playing'), 'Playing'), call('out', 'eq', '(==)', [n('ph'), n('playing')])], 'out'],
  drawPlayer: draw('player'),
  drawDealer: draw('dealer'),
  settle: [['p', 'm'], [
    ref('p2', 'p'), ref('p3', 'p'),
    call('wi', T('Phase', 'casePhase'), 'casePhase', ['0', '1', '0', '0', n('p')]), call('addW', 'plus', '(+)', ['', n('wi')]),
    call('ow', M('over wins'), 'over wins', [n('addW'), n('m')]),
    call('li', T('Phase', 'casePhase'), 'casePhase', ['0', '0', '1', '0', n('p2')]), call('addL', 'plus', '(+)', ['', n('li')]),
    call('ol', M('over losses'), 'over losses', [n('addL'), n('ow')]),
    call('out', M('set phase'), 'set phase', [n('p3'), n('ol')]),
  ], 'out'],
  checkBust: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('pl', M('player'), 'player', [n('m')]), call('sc', 'score', 'score', [n('pl')]), call('bust', P('gt'), '(>)', [n('sc'), '21']),
    call('lost', T('Phase', 'Lost'), 'Lost'), call('st', 'settle', 'settle', [n('lost'), n('m2')]),
    call('out', 'select', 'select', [n('bust'), n('st'), n('m3')]),
  ], 'out'],
  hit: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('ip', 'isPlaying', 'isPlaying', [n('m')]), call('dp', 'drawPlayer', 'drawPlayer', [n('m2')]), call('chk', 'checkBust', 'checkBust', [n('dp')]),
    call('out', 'select', 'select', [n('ip'), n('chk'), n('m3')]),
  ], 'out'],
  dealerPlay: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('dh', M('dealer'), 'dealer', [n('m')]), call('sc', 'score', 'score', [n('dh')]), call('done', 'geq', '(>=)', [n('sc'), '17']),
    call('dd', 'drawDealer', 'drawDealer', [n('m2')]), call('again', 'dealerPlay', 'dealerPlay', [n('dd')]),
    call('out', 'select', 'select', [n('done'), n('m3'), n('again')]),
  ], 'out'],
  outcome: [['m'], [
    ref('m2', 'm'),
    call('pl', M('player'), 'player', [n('m')]), call('p', 'score', 'score', [n('pl')]), ref('p2', 'p'),
    call('dl', M('dealer'), 'dealer', [n('m2')]), call('d', 'score', 'score', [n('dl')]), ref('d2', 'd'), ref('d3', 'd'),
    call('dbust', P('gt'), '(>)', [n('d'), '21']), call('beat', P('gt'), '(>)', [n('p'), n('d2')]), call('win', P('or'), '(||)', [n('dbust'), n('beat')]),
    call('tie', 'eq', '(==)', [n('p2'), n('d3')]),
    call('won', T('Phase', 'Won'), 'Won'), call('push', T('Phase', 'Push'), 'Push'), call('lost', T('Phase', 'Lost'), 'Lost'),
    call('other', 'select', 'select', [n('tie'), n('push'), n('lost')]), call('out', 'select', 'select', [n('win'), n('won'), n('other')]),
  ], 'out'],
  finish: [['m'], [call('d', 'dealerPlay', 'dealerPlay', [n('m')]), ref('d2', 'd'), call('oc', 'outcome', 'outcome', [n('d')]), call('out', 'settle', 'settle', [n('oc'), n('d2')])], 'out'],
  stand: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('ip', 'isPlaying', 'isPlaying', [n('m')]), call('fin', 'finish', 'finish', [n('m2')]), call('out', 'select', 'select', [n('ip'), n('fin'), n('m3')]),
  ], 'out'],
  nextRound: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'),
    call('ip', 'isPlaying', 'isPlaying', [n('m')]), call('dl', 'deal', 'deal', [n('m3')]), call('out', 'select', 'select', [n('ip'), n('m2'), n('dl')]),
  ], 'out'],
  handle: [['msg', 'm'], [
    call('h', 'hit', 'hit', ['']), call('s', 'stand', 'stand', ['']), call('nr', 'nextRound', 'nextRound', ['']),
    call('cm', T('Msg', 'caseMsg'), 'caseMsg', [n('h'), n('s'), n('nr'), n('msg')]), call('out', 'apply', 'apply', [n('cm'), n('m')]),
  ], 'out'],
  cardName: [['r'], [
    call('names', P('listOf'), '[ , , ]', RANKS), call('i', 'minus', '(-)', [n('r'), '1']), call('ix', P('index'), '(!?)', [n('names'), n('i')]),
    call('id', 'identity', 'identity', ['']), call('out', P('maybe'), 'maybe', ['"?"', n('id'), n('ix')]),
  ], 'out'],
  cardLabel: [['r'], [call('nm', 'cardName', 'cardName', [n('r')]), call('out', P('append'), '(++)', [n('nm'), '" "'])], 'out'],
  showHand: [['h'], [call('lbl', 'cardLabel', 'cardLabel', ['']), call('out', P('concatMap'), 'concatMap', [n('lbl'), n('h')])], 'out'],
  view: [['m'], [
    ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'), ref('m5', 'm'), ref('m6', 'm'),
    call('hd', P('wHeading'), 'heading', ['"Blackjack"']),
    // Dealer: the first card only while you play, then the whole hand and its score.
    call('ip', 'isPlaying', 'isPlaying', [n('m')]), ref('ip2', 'ip'),
    call('dh', M('dealer'), 'dealer', [n('m2')]), ref('dh2', 'dh'), ref('dh3', 'dh'),
    call('first', P('take'), 'take', ['1', n('dh')]), call('shown', 'select', 'select', [n('ip'), n('first'), n('dh2')]),
    call('dsh', 'showHand', 'showHand', [n('shown')]), call('dsc', 'score', 'score', [n('dh3')]), call('dscS', P('show'), 'show', [n('dsc')]),
    call('dp1', P('append'), '(++)', ['"("', n('dscS')]), call('dp2', P('append'), '(++)', [n('dp1'), '")"']),
    call('dtail', 'select', 'select', [n('ip2'), '"?"', n('dp2')]),
    call('dl1', P('append'), '(++)', ['"Dealer: "', n('dsh')]), call('dl2', P('append'), '(++)', [n('dl1'), n('dtail')]), call('dt', P('wText'), 'text', [n('dl2')]),
    // You: your hand and its score.
    call('pl', M('player'), 'player', [n('m3')]), ref('pl2', 'pl'),
    call('psh', 'showHand', 'showHand', [n('pl')]), call('psc', 'score', 'score', [n('pl2')]), call('pscS', P('show'), 'show', [n('psc')]),
    call('pl1', P('append'), '(++)', ['"You: "', n('psh')]), call('pl3', P('append'), '(++)', [n('pl1'), '"("']),
    call('pl4', P('append'), '(++)', [n('pl3'), n('pscS')]), call('pl5', P('append'), '(++)', [n('pl4'), '")"']), call('pt', P('wText'), 'text', [n('pl5')]),
    call('ph', M('phase'), 'phase', [n('m4')]),
    call('st', T('Phase', 'casePhase'), 'casePhase', ['"Hit or stand?"', '"You win!"', '"You lose."', '"Push — a tie."', n('ph')]), call('stt', P('wText'), 'text', [n('st')]),
    call('mh', T('Msg', 'Hit'), 'Hit'), call('bh', P('wButton'), 'button', ['"Hit"', n('mh')]),
    call('ms', T('Msg', 'Stand'), 'Stand'), call('bs', P('wButton'), 'button', ['"Stand"', n('ms')]),
    call('md', T('Msg', 'Deal'), 'Deal'), call('bd', P('wButton'), 'button', ['"Deal"', n('md')]),
    call('btns', P('listOf'), '[ , , ]', [n('bh'), n('bs'), n('bd')]), call('rw', P('wRow'), 'row', [n('btns')]),
    call('w', M('wins'), 'wins', [n('m5')]), call('ws', P('show'), 'show', [n('w')]), call('l', M('losses'), 'losses', [n('m6')]), call('ls', P('show'), 'show', [n('l')]),
    call('t1', P('append'), '(++)', ['"Wins "', n('ws')]), call('t2', P('append'), '(++)', [n('t1'), '"  ·  Losses "']), call('t3', P('append'), '(++)', [n('t2'), n('ls')]),
    call('tt', P('wText'), 'text', [n('t3')]),
    call('items', P('listOf'), '[ , , ]', [n('hd'), n('dt'), n('pt'), n('stt'), n('rw'), n('tt')]), call('out', P('wColumn'), 'column', [n('items')]),
  ], 'out'],
  step: [['dt', 'm'], [], 'm'],
  initial: [[], [
    call('n1', P('nil'), '[]'), call('n2', P('nil'), '[]'), call('n3', P('nil'), '[]'), call('g', P('mkStdGen'), 'mkStdGen', ['2026']),
    call('playing', T('Phase', 'Playing'), 'Playing'),
    call('blank', M('Model'), 'Model', [n('n1'), n('n2'), n('n3'), n('g'), n('playing'), '0', '0']), call('out', 'deal', 'deal', [n('blank')]),
  ], 'out'],
  main: [[], [call('i', 'initial', 'initial'), call('v', 'view', 'view', ['']), call('hd', 'handle', 'handle', ['', '']), call('s', 'step', 'step', ['', '']), call('out', P('program'), 'program', [n('i'), n('v'), n('hd'), n('s')])], 'out'],
}

export function buildBlackjack() {
  return buildProject(BLACKJACK_TYPES, FUNCTIONS)
}
