import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { showQual } from '../src/typeSystem.js'

const types = declareTypes({}, `
data Wallet = Wallet { clicks :: Double, gems :: Double } deriving stock (Eq, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, VectorSpace, PartialOrd, Lattice)
data Modifier = Modifier { bonus :: Sum Double, mult :: Product Double } deriving (Semigroup, Monoid) via Generically Modifier
`)
const derived = Object.fromEntries(derivedDefinitions(types).map((d) => [d.label, d]))
const BUILTINS = ['plus', 'minus', 'times', 'succ', 'negate', 'identity', 'compose', 'addZero', 'mulOne', 'eq', 'geq', 'listOf', 'nil', 'just', 'nothing', 'mappend', 'mempty', 'mconcat', 'fmap', 'foldMap', 'leq', 'join', 'meet', 'scale', 'mkSum', 'getSum', 'mkProduct', 'getProduct', 'mkEndo', 'appEndo', 'every', 'onKey', 'program', 'setSubscriptions', 'wText']
const nodes = { ...Object.fromEntries(BUILTINS.map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }])), ...Object.fromEntries(Object.values(derived).map((d) => [d.id, d])) }
const registry = { nodes, functionBodies: {}, types }
const ev = createEvaluator(registry)
const idOf = (label) => (nodes[label] ? label : derived[label].id)
const call = (id, label, slots) => ({ id, type: 'function', sourceFunctionId: idOf(label), label, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const graphOf = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))
const show = (g, id) => showValue(ev.run(g, id), types)

test('monoid structures: free monoid, Sum, Product, Maybe, Endo', () => {
  const g = graphOf(
    call('xs', 'listOf', ['1', '2']), call('ys', 'listOf', ['3']), call('cat', 'mappend', [{ node: 'xs' }, { node: 'ys' }]),
    call('s1', 'mkSum', ['2']), call('s2', 'mkSum', ['5']), call('sum', 'mappend', [{ node: 's1' }, { node: 's2' }]),
    call('p1', 'mkProduct', ['2']), call('p2', 'mkProduct', ['5']), call('prod', 'mappend', [{ node: 'p1' }, { node: 'p2' }]),
    call('j', 'just', [{ node: 's1' }]), call('n', 'nothing', []), call('mj', 'mappend', [{ node: 'j' }, { node: 'n' }]),
    call('inc', 'succ', ['']), call('dbl', 'times', ['2', '']), call('e1', 'mkEndo', [{ node: 'inc' }]), call('e2', 'mkEndo', [{ node: 'dbl' }]),
    call('e12', 'mappend', [{ node: 'e1' }, { node: 'e2' }]), call('run', 'appEndo', [{ node: 'e12' }, '5']),
  )
  assert.equal(show(g, 'cat'), '[1,2,3]')
  assert.equal(show(g, 'sum'), 'Sum 7')
  assert.equal(show(g, 'prod'), 'Product 10')
  assert.equal(show(g, 'mj'), 'Just (Sum 2)')
  assert.equal(ev.run(g, 'run'), 11, 'Endo f <> Endo g = Endo (f . g): succ (2 * 5)')
})

test('mempty is absorbed by (<>) and takes the right shape when observed', () => {
  const g = graphOf(
    call('e', 'mempty', []), call('xs', 'listOf', ['1']),
    call('l', 'mappend', [{ node: 'e' }, { node: 'xs' }]), call('r', 'mappend', [{ node: 'xs' }, { node: 'e' }]),
    call('gs', 'getSum', [{ node: 'e' }]), call('gp', 'getProduct', [{ node: 'e' }]), call('ae', 'appEndo', [{ node: 'e' }, '7']),
    call('bonus', 'bonus', [{ node: 'e' }]), call('gb', 'getSum', [{ node: 'bonus' }]),
  )
  assert.equal(show(g, 'l'), '[1]')
  assert.equal(show(g, 'r'), '[1]')
  assert.equal(ev.run(g, 'gs'), 0)
  assert.equal(ev.run(g, 'gp'), 1)
  assert.equal(ev.run(g, 'ae'), 7, 'mempty :: Endo a is the identity')
  assert.equal(ev.run(g, 'gb'), 0, 'a Generically-derived record of mempties')
})

test('foldMap is the monoid homomorphism out of the free monoid', () => {
  const g = graphOf(
    call('xs', 'listOf', ['1', '2', '3', '4']), call('toSum', 'mkSum', ['']), call('fm', 'foldMap', [{ node: 'toSum' }, { node: 'xs' }]),
    call('toProd', 'mkProduct', ['']), call('fp', 'foldMap', [{ node: 'toProd' }, { node: 'xs' }]),
    call('strs', 'listOf', ['"ab"', '"c"', '""']), call('mc', 'mconcat', [{ node: 'strs' }]),
  )
  assert.equal(show(g, 'fm'), 'Sum 10')
  assert.equal(show(g, 'fp'), 'Product 24')
  assert.equal(show(g, 'mc'), '"abc"')
})

test('functor laws on lists and Maybe', () => {
  const g = graphOf(
    call('xs', 'listOf', ['1', '2', '3']), call('id', 'identity', ['']), call('fid', 'fmap', [{ node: 'id' }, { node: 'xs' }]),
    call('f', 'succ', ['']), call('h', 'times', ['3', '']), call('hf', 'compose', [{ node: 'h' }, { node: 'f' }, '']),
    call('fmapHF', 'fmap', [{ node: 'hf' }, { node: 'xs' }]), call('fmapF', 'fmap', [{ node: 'f' }, { node: 'xs' }]), call('fmapH_F', 'fmap', [{ node: 'h' }, { node: 'fmapF' }]),
    call('j', 'just', ['4']), call('fj', 'fmap', [{ node: 'f' }, { node: 'j' }]),
  )
  assert.equal(show(g, 'fid'), show(g, 'xs'), 'fmap id = id')
  assert.equal(show(g, 'fmapHF'), show(g, 'fmapH_F'), 'fmap (h . f) = fmap h . fmap f')
  assert.equal(show(g, 'fj'), 'Just 5')
})

test('a product derives pointwise structure (anyclass): the wallet', () => {
  const g = graphOf(
    call('w', 'Wallet', ['100', '3']), call('cost', 'Wallet', ['40', '1']),
    call('spend', 'minus', [{ node: 'w' }, { node: 'cost' }]),
    call('pricier', 'scale', ['1.5', { node: 'cost' }]),
    call('afford', 'leq', [{ node: 'cost' }, { node: 'w' }]), call('tooMuch', 'leq', [{ node: 'pricier' }, { node: 'spend' }]),
    call('z', 'addZero', []), call('wz', 'plus', [{ node: 'w' }, { node: 'z' }]),
    call('bump', 'plus', [{ node: 'w' }, '1']),
    call('hi', 'join', [{ node: 'w' }, { node: 'pricier' }]),
  )
  assert.equal(show(g, 'spend'), 'Wallet {clicks = 60, gems = 2}')
  assert.equal(show(g, 'pricier'), 'Wallet {clicks = 60, gems = 1.5}')
  assert.equal(ev.run(g, 'afford'), true)
  assert.equal(ev.run(g, 'tooMuch'), true, '60 ≤ 60 and 1.5 ≤ 2')
  assert.equal(show(g, 'wz'), show(g, 'w'), 'addZero is the zero wallet')
  assert.equal(show(g, 'bump'), 'Wallet {clicks = 101, gems = 4}', 'a literal is broadcast along the product')
  assert.equal(show(g, 'hi'), 'Wallet {clicks = 100, gems = 3}')
})

test('a product of monoids is a monoid (via Generically): modifiers stack in any order', () => {
  const g = graphOf(
    call('b1', 'mkSum', ['5']), call('m1', 'mkProduct', ['2']), call('a', 'Modifier', [{ node: 'b1' }, { node: 'm1' }]),
    call('b2', 'mkSum', ['1']), call('m2', 'mkProduct', ['3']), call('b', 'Modifier', [{ node: 'b2' }, { node: 'm2' }]),
    call('ab', 'mappend', [{ node: 'a' }, { node: 'b' }]), call('ba', 'mappend', [{ node: 'b' }, { node: 'a' }]),
    call('e', 'mempty', []), call('ae', 'mappend', [{ node: 'a' }, { node: 'e' }]),
  )
  assert.equal(show(g, 'ab'), 'Modifier {bonus = Sum 6, mult = Product 6}')
  assert.equal(show(g, 'ab'), show(g, 'ba'))
  assert.equal(show(g, 'ae'), show(g, 'a'))
})

// ---- Types ------------------------------------------------------------------
test('the type checker resolves constructor classes and derived instances', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    const pass = (g) => inferGraph(nodes, {}, g)
    const vsig = (p, id) => showQual(p.perNode.get(id).preds, valueTypeOfEntry(p.perNode.get(id)))
    const fm = pass(graphOf(call('toSum', 'mkSum', ['']), call('xs', 'listOf', ['1', '2']), call('f', 'foldMap', [{ node: 'toSum' }, { node: 'xs' }])))
    assert.doesNotThrow(() => reduce(fm.preds))
    assert.equal(vsig(fm, 'f'), 'Semiring a ⇒ Sum a')
    // (fmap succ 3 is legal Haskell — (Functor f, Num (f Int)) => f Int — but Bool is never f a)
    const notFunctor = pass(graphOf(call('inc', 'succ', ['']), call('f', 'fmap', [{ node: 'inc' }, 'True'])))
    assert.deepEqual(notFunctor.perNode.get('f').invalidSlots, [1])
    const walletOrd = pass(graphOf(call('w', 'Wallet', ['1', '2']), call('g', 'geq', [{ node: 'w' }, ''])))
    assert.throws(() => reduce(walletOrd.preds), 'products are only partially ordered: no Ord Wallet')
    const walletLeq = pass(graphOf(call('w', 'Wallet', ['1', '2']), call('l', 'leq', [{ node: 'w' }, ''])))
    assert.doesNotThrow(() => reduce(walletLeq.preds))
    const doubleMonoid = pass(graphOf(call('e', 'mempty', []), { id: 'd', type: 'number', value: '1.5', annotation: 'Double' }, call('p', 'plus', [{ node: 'e' }, { node: 'd' }])))
    assert.throws(() => reduce(doubleMonoid.preds), 'Double has several monoids — pick one with Sum or Product')
  } finally {
    setDynamicInstances([])
  }
})

test('Sub is a monoid and a functor: timers fire on game time, relabelled by fmap', async () => {
  const { createGame } = await import('../src/runtime.js')
  const extra = ['every', 'onKey', 'program', 'setSubscriptions', 'wText']
  const reg = { nodes: { ...nodes, ...Object.fromEntries(extra.map((b) => [b, { id: b, builtin: b, label: b }])) }, functionBodies: {}, types }
  const e2 = createEvaluator(reg)
  // subs = fmap Sum (every 1 2 <> every 0.5 10) — messages are Sum Doubles; handle adds them up
  const g = graphOf(
    call('t1', 'every', ['1', '2']), call('t2', 'every', ['0.5', '10']), call('both', 'mappend', [{ node: 't1' }, { node: 't2' }]),
    call('wrap', 'mkSum', ['']), call('subs', 'fmap', [{ node: 'wrap' }, { node: 'both' }]),
  )
  const subsValue = e2.run(g, 'subs')
  const program = { kind: 'data', type: 'Program', ctor: 'Program', ctorIndex: 0, args: [0, { kind: 'closure', callee: 'wText', args: [null] }, { kind: 'closure', callee: 'plus', args: [null, null] }, { kind: 'closure', callee: 'identity', args: [null] }, 10, 0, { kind: 'closure', callee: 'identity', args: [null] }] }
  // subscriptions m = subsValue (ignore m): use a constant via a data trick — set field 6 to a closure returning it
  reg.nodes.constSubs = { id: 'constSubs', label: 'constSubs', custom: true }
  reg.functionBodies.constSubs = { 'input-constSubs-0': { id: 'input-constSubs-0', type: 'parameter', label: 'm' }, v: { id: 'v', type: 'value', data: subsValue }, output: { id: 'output', type: 'output', source: 'v' } }
  program.args[6] = { kind: 'closure', callee: 'constSubs', args: [null] }
  // handle (Sum k) m = m + k
  reg.nodes.addMsg = { id: 'addMsg', label: 'addMsg', custom: true }
  reg.functionBodies.addMsg = {
    'input-addMsg-0': { id: 'input-addMsg-0', type: 'parameter', label: 's' }, 'input-addMsg-1': { id: 'input-addMsg-1', type: 'parameter', label: 'm' },
    gs: { id: 'gs', type: 'function', sourceFunctionId: 'getSum', params: [''], mounted: ['input-addMsg-0'] },
    add: { id: 'add', type: 'function', sourceFunctionId: 'plus', params: ['', ''], mounted: ['input-addMsg-1', 'gs'] },
    output: { id: 'output', type: 'output', source: 'add' },
  }
  program.args[2] = { kind: 'closure', callee: 'addMsg', args: [null, null] }
  // step dt m = m
  reg.nodes.still = { id: 'still', label: 'still', custom: true }
  reg.functionBodies.still = { 'input-still-0': { id: 'input-still-0', type: 'parameter', label: 'dt' }, 'input-still-1': { id: 'input-still-1', type: 'parameter', label: 'm' }, output: { id: 'output', type: 'output', source: 'input-still-1' } }
  program.args[3] = { kind: 'closure', callee: 'still', args: [null, null] }
  const game = createGame(e2, program)
  assert.equal(game.subscriptions().every.length, 2)
  for (let i = 0; i < 20; i++) game.tick(0.1) // two seconds
  assert.equal(game.model, 2 * 2 + 4 * 10, 'every 1 2 fired twice, every 0.5 10 fired four times')
})
