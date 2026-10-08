// The click-counter game, built entirely out of what the tool provides —
// declared types, custom functions with function bodies, references,
// derived projections/updates, the copairing caseEvent, foldr and the
// protected compose/identity — then played, replayed, law-checked and
// type-checked. This is the end-to-end scenario of plan Phase 1c-3.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { checkFunctionLaw } from '../src/laws.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { showQual, tcon, tfun } from '../src/typeSystem.js'

const types = declareTypes({}, `
data Wallet = Wallet { clicks :: Double } deriving stock (Eq, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, VectorSpace, PartialOrd, Lattice)
data Model = Model { wallet :: Wallet, perClick :: Double, rate :: Double } deriving stock (Show)
data Event = Click | Tick Double | Buy deriving stock (Show)
`)
const derived = Object.fromEntries(derivedDefinitions(types).map((d) => [d.label, d]))
const BUILTINS = ['plus', 'minus', 'times', 'scale', 'leq', 'select', 'compose', 'identity', 'apply', 'foldr', 'listOf']
const nodes = Object.fromEntries(BUILTINS.map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }]))
Object.values(derived).forEach((d) => { nodes[d.id] = d })
const functionBodies = {}

// --- tiny graph builders -------------------------------------------------
const idOf = (label) => (nodes[label] ? label : derived[label]?.id ?? label)
const call = (id, label, slots = []) => ({ id, type: 'function', sourceFunctionId: idOf(label), label, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const ref = (id, target) => ({ id, type: 'ref', target, label: `↪ ${target}` })
const param = (id) => ({ id, type: 'parameter', label: id })
const n = (id) => ({ node: id })
function defineFunction(name, params, bodyNodes, outputSource) {
  nodes[name] = { id: name, type: 'function', label: name, params, mounted: params.map(() => null), custom: true }
  const body = Object.fromEntries([...params.map(param), ...bodyNodes].map((x) => [x.id, x]))
  body.output = { id: 'output', type: 'output', label: 'Output', source: outputSource }
  functionBodies[name] = body
}

// onClick m = over wallet (+ Wallet (perClick m)) m
defineFunction('onClick', ['m'], [ref('m2', 'm'), call('pc', 'perClick', [n('m2')]), call('w', 'Wallet', [n('pc')]), call('add', 'plus', [n('w'), '']), call('out', 'over wallet', [n('add'), n('m')])], 'out')
// onTick dt m = over wallet (+ dt *^ Wallet (rate m)) m — linear in dt
defineFunction('onTick', ['dt', 'm'], [ref('m2', 'm'), call('r', 'rate', [n('m2')]), call('w', 'Wallet', [n('r')]), call('sw', 'scale', [n('dt'), n('w')]), call('add', 'plus', [n('sw'), '']), call('out', 'over wallet', [n('add'), n('m')])], 'out')
// buy m = select (leq cost (wallet m)) (set perClick (perClick m + 1) (over wallet (subtract cost) m)) m, cost = Wallet 10
defineFunction('buy', ['m'], [
  ref('m2', 'm'), ref('m3', 'm'), ref('m4', 'm'), ref('m5', 'm'), call('cost', 'Wallet', ['10']), ref('cost2', 'cost'),
  call('wl', 'wallet', [n('m2')]), call('can', 'leq', [n('cost'), n('wl')]),
  call('pay', 'minus', ['', n('cost2')]), call('paid', 'over wallet', [n('pay'), n('m3')]),
  call('pc', 'perClick', [n('m4')]), call('pc1', 'plus', [n('pc'), '1']), call('upgraded', 'set perClick', [n('pc1'), n('paid')]),
  call('out', 'select', [n('can'), n('upgraded'), n('m5')]),
], 'out')
// handle = caseEvent onClick onTick buy — the copairing of the handlers
defineFunction('handle', ['e'], [call('c', 'onClick'), call('t', 'onTick', ['', '']), call('b', 'buy', ['']), call('out', 'caseEvent', [n('c'), n('t'), n('b'), n('e')])], 'out')
// step e k = k . handle e ;  replay = foldr step id  (events applied first to last)
defineFunction('step', ['e', 'k'], [call('he', 'handle', [n('e')]), call('out', 'compose', [n('k'), n('he'), ''])], 'out')
defineFunction('replay', ['es'], [call('s', 'step', ['', '']), call('idn', 'identity', ['']), call('out', 'foldr', [n('s'), n('idn'), n('es')])], 'out')
// A compounding tick, for contrast: over wallet ((1 + dt) *^) — not an action of (ℝ≥0, +)
defineFunction('compoundTick', ['dt', 'm'], [call('k', 'plus', ['1', n('dt')]), call('sc', 'scale', [n('k'), '']), call('out', 'over wallet', [n('sc'), n('m')])], 'out')

const ev = createEvaluator({ nodes, functionBodies, types })
const model = (clicks, perClick = 1, rate = 0) => [call('mw', 'Wallet', [String(clicks)]), call('m0', 'Model', [n('mw'), String(perClick), String(rate)])]
const graphOf = (...ns) => Object.fromEntries(ns.flat().map((x) => [x.id, x]))
const shown = (g, id) => showValue(ev.run(g, id), types)

test('clicking adds perClick; buying spends 10 and upgrades perClick; buying broke does nothing', () => {
  const clicks = Array.from({ length: 12 }, (_, i) => call(`c${i}`, 'onClick', [n(i ? `c${i - 1}` : 'm0')]))
  const g = graphOf(model(0), clicks, call('b1', 'buy', [n('c11')]), call('c12', 'onClick', [n('b1')]), call('b2', 'buy', [n('c12')]))
  assert.equal(shown(g, 'c11'), 'Model {wallet = Wallet {clicks = 12}, perClick = 1, rate = 0}')
  assert.equal(shown(g, 'b1'), 'Model {wallet = Wallet {clicks = 2}, perClick = 2, rate = 0}')
  assert.equal(shown(g, 'c12'), 'Model {wallet = Wallet {clicks = 4}, perClick = 2, rate = 0}')
  assert.equal(shown(g, 'b2'), shown(g, 'c12'), 'cannot afford: unchanged')
})

test('ticking earns rate × dt', () => {
  const g = graphOf(model(5, 1, 2), call('t', 'onTick', ['1.5', n('m0')]))
  assert.equal(shown(g, 't'), 'Model {wallet = Wallet {clicks = 8}, perClick = 1, rate = 2}')
})

test('replaying an event log equals applying the events in order (foldr is the recursor of lists)', () => {
  const g = graphOf(
    model(9, 1, 2),
    call('e1', 'Click'), call('e2', 'Buy'), call('e3', 'Click'), call('e4', 'Tick', ['0.5']),
    call('log', 'listOf', [n('e1'), n('e2'), n('e3'), n('e4')]),
    call('r', 'replay', [n('log')]), call('replayed', 'apply', [n('r'), n('m0')]),
    call('s1', 'onClick', [n('m0')]), call('s2', 'buy', [n('s1')]), call('s3', 'onClick', [n('s2')]), call('s4', 'onTick', ['0.5', n('s3')]),
  )
  assert.equal(shown(g, 'replayed'), shown(g, 's4'))
  assert.equal(shown(g, 's4'), 'Model {wallet = Wallet {clicks = 3}, perClick = 2, rate = 2}')
})

test('onTick is a monoid action of (ℝ≥0, +) — so offline progress can be computed in one step; compounding is not', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    const sig = tfun(tcon('Double'), tfun(tcon('Model'), tcon('Model')))
    const ok = checkFunctionLaw('action', { kind: 'closure', callee: 'onTick', args: [null, null] }, sig, { ev, types })
    assert.ok(ok.ok, ok.counterexample)
    const bad = checkFunctionLaw('action', { kind: 'closure', callee: 'compoundTick', args: [null, null] }, sig, { ev, types })
    assert.equal(bad.ok, false)
    assert.match(bad.law, /f \(a \+ b\) = f a ∘ f b/)
  } finally {
    setDynamicInstances([])
  }
})

test('the whole game type-checks: handle :: Event → Model → Model, replay :: [Event] → Model → Model', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    const main = Object.fromEntries(['onClick', 'onTick', 'buy', 'handle', 'step', 'replay'].map((f) => [f, nodes[f]]))
    const pass = inferGraph(nodes, functionBodies, main)
    const sig = (id) => { const e = pass.perNode.get(id); return showQual(e.preds, e.paramTypes.reduceRight((acc, t) => tfun(t, acc), e.resultType)) }
    assert.equal(sig('onClick'), 'Model → Model')
    assert.equal(sig('onTick'), 'Double → Model → Model')
    assert.equal(sig('buy'), 'Model → Model')
    assert.equal(sig('handle'), 'Event → Model → Model')
    assert.equal(sig('replay'), '[Event] → Model → Model')
    assert.doesNotThrow(() => reduce(pass.preds))
  } finally {
    setDynamicInstances([])
  }
})
