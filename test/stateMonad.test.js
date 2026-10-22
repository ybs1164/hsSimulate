// Control.Monad.State: a state threaded through a computation by the
// Monad instead of by hand — and a chain of (>>=) read back as do-notation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { showValue } from '../src/evaluator.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { printDefinition } from '../src/haskellPrint.js'

const fn = (id, label, params) => ({ id, type: 'function', builtin: id, label, params, mounted: params.map(() => null) })
const library = {
  ...preludeDefs, ...preludeTypeDefs,
  apply: fn('apply', 'apply', ['f', 'x']), identity: fn('identity', 'identity', ['x']), plus: fn('plus', '(+)', ['x', 'y']), times: fn('times', '(*)', ['x', 'y']),
}
const call = (id, callee, slots) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const run = (graph, out = 'out', registry = { nodes: library, functionBodies: {} }) => showValue(createEvaluator(registry).run(graph, out))
const graphOf = (...ns) => Object.fromEntries(ns.map((x) => [x.id, x]))

test('two dice rolled with State: the generator is passed along by liftA2, not by hand', () => {
  const g = call('g', 'prelude:mkStdGen', ['2026'])
  const range = call('range', 'prelude:pair', ['1', '6'])
  // die = state (randomRInt (1, 6));  evalState (liftA2 (,) die die) (mkStdGen 2026)
  const viaState = graphOf(g, range,
    call('r1', 'prelude:randomRInt', [{ node: 'range' }, '']), call('die1', 'prelude:state', [{ node: 'r1' }]),
    call('r2', 'prelude:randomRInt', [{ node: 'range' }, '']), call('die2', 'prelude:state', [{ node: 'r2' }]),
    call('both', 'prelude:pair', ['', '']), call('two', 'prelude:liftA2', [{ node: 'both' }, { node: 'die1' }, { node: 'die2' }]),
    call('out', 'prelude:evalState', [{ node: 'two' }, { node: 'g' }]))
  // By hand: (fst a, fst b) where a = randomRInt (1, 6) g; b = randomRInt (1, 6) (snd a)
  const byHand = graphOf(g, range,
    call('a', 'prelude:randomRInt', [{ node: 'range' }, { node: 'g' }]), { id: 'a2', type: 'ref', target: 'a' },
    call('ga', 'prelude:snd', [{ node: 'a2' }]), call('b', 'prelude:randomRInt', [{ node: 'range' }, { node: 'ga' }]),
    call('fa', 'prelude:fst', [{ node: 'a' }]), call('fb', 'prelude:fst', [{ node: 'b' }]),
    call('out', 'prelude:pair', [{ node: 'fa' }, { node: 'fb' }]))
  const rolled = run(viaState)
  assert.equal(rolled, run(byHand))
  assert.match(rolled, /^\([1-6],[1-6]\)$/)
})

test('get, put, modify, gets', () => {
  assert.equal(run(graphOf(call('get', 'prelude:stateGet', []), call('out', 'prelude:evalState', [{ node: 'get' }, '7']))), '7')
  // execState (put 3 >> modify (* 2)) 0 = 6
  assert.equal(run(graphOf(
    call('put3', 'prelude:statePut', ['3']), call('dbl', 'times', ['', '2']), call('mod', 'prelude:stateModify', [{ node: 'dbl' }]),
    call('both', 'prelude:thenM', [{ node: 'put3' }, { node: 'mod' }]), call('out', 'prelude:execState', [{ node: 'both' }, '0']))), '6')
  // evalState (gets (+ 1)) 41 = 42, and the state is left alone
  const gets = [call('inc', 'plus', ['', '1']), call('gs', 'prelude:stateGets', [{ node: 'inc' }])]
  assert.equal(run(graphOf(...gets, call('out', 'prelude:evalState', [{ node: 'gs' }, '41']))), '42')
  assert.equal(run(graphOf(...gets, call('out', 'prelude:execState', [{ node: 'gs' }, '41']))), '41')
})

// addBoth m = m >>= \m x -> (m >>= \x y -> return (x + y))   — λs capturing what they use
const nodes = {
  ...library,
  lam1: { id: 'lam1', type: 'function', label: 'λ', params: ['m', 'x'], mounted: [null, null], custom: true, lambda: true },
  lam2: { id: 'lam2', type: 'function', label: 'λ', params: ['x', 'y'], mounted: [null, null], custom: true, lambda: true },
  addBoth: { id: 'addBoth', type: 'function', label: 'addBoth', params: ['m'], mounted: [null], custom: true },
}
const functionBodies = {
  lam2: {
    p0: { id: 'p0', type: 'parameter', label: 'x' }, p1: { id: 'p1', type: 'parameter', label: 'y' },
    sum: call('sum', 'plus', [{ node: 'p0' }, { node: 'p1' }]), ret: call('ret', 'prelude:returnM', [{ node: 'sum' }]),
    output: { id: 'output', type: 'output', source: 'ret' },
  },
  lam1: {
    p0: { id: 'p0', type: 'parameter', label: 'm' }, p1: { id: 'p1', type: 'parameter', label: 'x' },
    k: call('k', 'lam2', [{ node: 'p1' }, '']), b: call('b', 'prelude:bind', [{ node: 'p0' }, { node: 'k' }]),
    output: { id: 'output', type: 'output', source: 'b' },
  },
  addBoth: {
    p0: { id: 'p0', type: 'parameter', label: 'm' }, m2: { id: 'm2', type: 'ref', target: 'p0' },
    k: call('k', 'lam1', [{ node: 'm2' }, '']), b: call('b', 'prelude:bind', [{ node: 'p0' }, { node: 'k' }]),
    output: { id: 'output', type: 'output', source: 'b' },
  },
}

test('a chain of (>>=) through λs prints as one do block', () => {
  assert.equal(printDefinition('addBoth', nodes, functionBodies), 'addBoth m = do { x <- m; y <- m; return (x + y) }')
})

test('the do block runs as written, in any monad', () => {
  const g = (xs) => ({ xs, out: call('out', 'addBoth', [{ node: 'xs' }]) })
  const registry = { nodes, functionBodies }
  assert.equal(run(g(call('xs', 'prelude:listOf', ['1', '2'])), 'out', registry), '[2,3,3,4]')
  assert.equal(run(g(call('xs', 'prelude:just', ['5'])), 'out', registry), 'Just 10')
})

test('without a λ to read, (>>=) and (>>) print infix', () => {
  const body = { p0: { id: 'p0', type: 'parameter', label: 'm' }, k: call('k', 'prelude:just', ['']), b: call('b', 'prelude:bind', [{ node: 'p0' }, { node: 'k' }]), output: { id: 'output', type: 'output', source: 'b' } }
  const defs = { ...library, f: { id: 'f', type: 'function', label: 'f', params: ['m'], mounted: [null], custom: true } }
  assert.equal(printDefinition('f', defs, { f: body }), 'f m = m >>= Just')
})
