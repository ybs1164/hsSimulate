// The standard classes as Haskell has them, run by dictionary passing:
// show decided by the type (a Double shows as 1.0), Eq/Ord with their
// defaults and Ordering, Applicative/Monad/Traversable on Maybe, lists,
// Either e and the writer (w,), and hand-written instances completed by
// their class's defaults.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTypedEvaluator } from '../src/typedEvaluator.js'
import { showChar, showString } from '../src/evaluator.js'
import { preludeTypeDefs } from '../src/library.js'
import { declareTypes, derivedDefinitions } from '../src/typeDecls.js'

const BUILTINS = ['plus', 'times', 'succ', 'negate', 'divide', 'identity', 'listOf', 'nil', 'cons', 'just', 'nothing', 'index', 'pair', 'fst',
  'eq', 'neq', 'compare', 'le', 'lt', 'gt', 'geq', 'max', 'min', 'show', 'showsPrec', 'mappend', 'mempty', 'fmap', 'foldMap', 'traverse', 'pure', 'ap', 'bind', 'toRational', 'not']
const base = { ...Object.fromEntries(BUILTINS.map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }])), ...preludeTypeDefs }
const call = (id, callee, slots = []) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const n = (id) => ({ node: id })
const text = (v) => { let s = ''; for (let l = v; l.ctorIndex === 1; l = l.args[1]) s += l.args[0]; return s }
function setup({ types = {}, instances = {}, defs = {}, bodies = {} } = {}) {
  const nodes = { ...base, ...Object.fromEntries(derivedDefinitions(types).map((d) => [d.id, d])), ...defs }
  const ev = createTypedEvaluator({ nodes, functionBodies: bodies, types, instances })
  return (graphNodes, id) => ev.run(Object.fromEntries(graphNodes.map((x) => [x.id, x])), id)
}
const run = setup()
// show of the value `node` builds (the last of `graphNodes`)
const showOf = (graphNodes, r = run) => text(r([...graphNodes, call('s', 'show', [n(graphNodes.at(-1).id)])], 's'))

test('show is decided by the type, as GHC prints it', () => {
  const asDouble = (x) => [call('d', 'divide', [x, '1'])] // (/) makes it a Field: defaults to Double
  assert.equal(showOf([call('i', 'plus', ['1', '2'])]), '3', 'an Integer (the default) shows without a point')
  assert.equal(showOf(asDouble('1')), '1.0')
  assert.equal(showOf(asDouble('0.1')), '0.1')
  assert.equal(showOf(asDouble('12345678')), '1.2345678e7')
  assert.equal(showOf(asDouble('0.05')), '5.0e-2')
  assert.equal(showOf([call('x', 'negate', ['3']), call('j', 'just', [n('x')])]), 'Just (-3)', 'a negative argument gets parentheses (showsPrec 11)')
  assert.equal(showOf([call('xs', 'listOf', ['"ab"', '"c d"'])]), '["ab","c d"]')
  assert.equal(showString('a"b\n\u00e9' + '1'), '"a\\"b\\n\\233\\&1"', 'escapes as GHC writes them, \\& after a numeric one before a digit')
  assert.equal(showChar("'"), "'\\''")
  assert.equal(showOf([call('w', 'listOf', ["'h'", "'i'"])]), '"hi"', "a [Char] shows as text (Show Char's showList)")
  assert.equal(showOf([call('q', 'toRational', ['0.75'])]), '3 % 4', 'a Rational shows as a fraction')
  assert.equal(text(run([call('s', 'showsPrec', ['11', n('x')]), call('x', 'negate', ['2.5'])], 's')), '(-2.5)')
})

test('Eq and Ord: compare, (<=), max, min — and Ordering is a monoid', () => {
  const ord = (ctor) => run([call('c', 'compare', ...ctor)], 'c').ctor
  assert.equal(ord([['1', '2']]), 'LT')
  assert.equal(ord([['2', '2']]), 'EQ')
  assert.equal(run([call('j1', 'just', ['3']), call('n0', 'nothing'), call('c', 'compare', [n('n0'), n('j1')])], 'c').ctor, 'LT', 'Nothing < Just _, as derived')
  assert.equal(run([call('m', 'max', ['3', '7'])], 'm'), 7)
  assert.equal(run([call('m', 'min', ['3', '7'])], 'm'), 3)
  assert.equal(run([call('m', 'le', ['3', '3'])], 'm'), true)
  assert.equal(run([call('m', 'neq', ['3', '4'])], 'm'), true)
  // lexicographic comparison by Ordering's (<>): compare 1 1 <> compare 2 5
  assert.equal(run([call('a', 'compare', ['1', '1']), call('b', 'compare', ['2', '5']), call('c', 'mappend', [n('a'), n('b')])], 'c').ctor, 'LT')
  const left = run([call('l', 'type:Either:Left', ['1']), call('r', 'type:Either:Right', ['0']), call('c', 'compare', [n('l'), n('r')])], 'c')
  assert.equal(left.ctor, 'LT', 'Left _ < Right _')
})

test('Applicative and Monad: Maybe, lists, Either e, and the writer (w,)', () => {
  // Maybe
  assert.equal(showOf([call('g', 'succ', ['']), call('f', 'just', [n('g')]), call('x', 'just', ['41']), call('r', 'ap', [n('f'), n('x')])]), 'Just 42')
  const ys = call('ys', 'listOf', ['10', '20'])
  const lookup = call('ix', 'index', [n('ys'), ''])
  assert.equal(showOf([ys, lookup, call('m', 'just', ['1']), call('b', 'bind', [n('m'), n('ix')])]), 'Just 20', 'Just 1 >>= (ys !?)')
  assert.equal(showOf([ys, lookup, call('m', 'just', ['5']), call('b', 'bind', [n('m'), n('ix')])]), 'Nothing')
  // lists: every function applied to every argument
  assert.equal(showOf([call('f1', 'succ', ['']), call('f2', 'times', ['10', '']), call('fs', 'listOf', [n('f1'), n('f2')]), call('xs', 'listOf', ['1', '2']), call('r', 'ap', [n('fs'), n('xs')])]), '[2,3,10,20]')
  // Either: the first Left wins
  assert.equal(showOf([call('e', 'type:Either:Left', ['"boom"']), call('f', 'succ', ['']), call('r', 'fmap', [n('f'), n('e')])]), 'Left "boom"')
  // (Left "no" pins what a Left holds — alone, `fmap succ (Right 1)` has an ambiguous Left type, as in Haskell)
  assert.equal(showOf([call('e', 'type:Either:Right', ['1']), call('f', 'succ', ['']), call('r', 'fmap', [n('f'), n('e')]), call('l', 'type:Either:Left', ['"no"']), call('s2', 'mappend', [n('l'), n('r')])]), 'Right 2', 'Either is a semigroup: the first Right')
  // the writer: (w, f) <*> (v, x) = (w <> v, f x)
  assert.equal(showOf([call('w1', 'listOf', ['"x"']), call('f', 'succ', ['']), call('pf', 'pair', [n('w1'), n('f')]), call('w2', 'listOf', ['"y"']), call('px', 'pair', [n('w2'), '41']), call('r', 'ap', [n('pf'), n('px')])]), '(["x","y"],42)')
})

test('traverse runs an effect over a structure', () => {
  const ys = call('ys', 'listOf', ['10', '20'])
  const lookup = call('ix', 'index', [n('ys'), ''])
  assert.equal(showOf([ys, lookup, call('is', 'listOf', ['0', '1']), call('t', 'traverse', [n('ix'), n('is')])]), 'Just [10,20]')
  assert.equal(showOf([ys, lookup, call('is', 'listOf', ['0', '7']), call('t', 'traverse', [n('ix'), n('is')])]), 'Nothing', 'one lookup fails, so all does')
  assert.equal(showOf([call('j', 'just', ['']), call('m', 'just', ['3']), call('t', 'traverse', [n('j'), n('m')])]), 'Just (Just 3)')
})

test('a hand-written instance gets the rest from its class: (==) from (/=), compare from (<=)', () => {
  const types = declareTypes({}, 'data Coin = Heads | Tails')
  const caseCoin = 'type:Coin:caseCoin'
  // neqCoin x y = caseCoin (caseCoin False True y) (caseCoin True False y) x
  const bodies = {
    neqCoin: { x: { id: 'x', type: 'parameter', label: 'x' }, y: { id: 'y', type: 'parameter', label: 'y' }, h: call('h', caseCoin, ['False', 'True', n('y')]), t: call('t', caseCoin, ['True', 'False', n('y')]), r: call('r', caseCoin, [n('h'), n('t'), n('x')]), output: { id: 'output', type: 'output', source: 'r' } },
    // leCoin x y = caseCoin True (caseCoin False True y) x  — Heads ≤ everything
    leCoin: { x: { id: 'x', type: 'parameter', label: 'x' }, y: { id: 'y', type: 'parameter', label: 'y' }, t: call('t', caseCoin, ['False', 'True', n('y')]), r: call('r', caseCoin, ['True', n('t'), n('x')]), output: { id: 'output', type: 'output', source: 'r' } },
  }
  const defs = { neqCoin: { id: 'neqCoin', type: 'function', label: 'neqCoin', params: ['x', 'y'], mounted: [null, null], custom: true }, leCoin: { id: 'leCoin', type: 'function', label: 'leCoin', params: ['x', 'y'], mounted: [null, null], custom: true } }
  const instances = { Eq: [{ head: 'Coin', context: [], methods: { neq: 'neqCoin' } }], Ord: [{ head: 'Coin', context: [], methods: { le: 'leCoin' } }] }
  const r = setup({ types, instances, defs, bodies })
  const coin = (id, c) => call(id, `type:Coin:${c}`)
  assert.equal(r([coin('a', 'Heads'), coin('b', 'Heads'), call('e', 'eq', [n('a'), n('b')])], 'e'), true, '(==) = not . (/=)')
  assert.equal(r([coin('a', 'Heads'), coin('b', 'Tails'), call('e', 'eq', [n('a'), n('b')])], 'e'), false)
  assert.equal(r([coin('a', 'Tails'), coin('b', 'Heads'), call('c', 'compare', [n('a'), n('b')])], 'c').ctor, 'GT', 'compare from (<=) and (==)')
  assert.equal(r([coin('a', 'Tails'), coin('b', 'Heads'), call('m', 'max', [n('a'), n('b')])], 'm').ctor, 'Tails')
})
