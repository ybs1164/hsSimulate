import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, EvalError } from '../src/evaluator.js'

const BUILTINS = ['succ', 'zero', 'identity', 'apply', 'compose', 'isZero', 'ifThenElse', 'plus', 'negate', 'minus', 'times', 'divide', 'sqrt', 'round', 'isNaN', 'geq', 'eq', 'select', 'addZero', 'mulOne']
const registry = () => ({ nodes: Object.fromEntries(BUILTINS.map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }])), functionBodies: {} })
// A call node: `slots` entries are either inline literal text or { node: id } for a mounted node.
const call = (id, callee, slots) => ({
  id, type: 'function', sourceFunctionId: callee, label: callee,
  params: slots.map((s) => (typeof s === 'string' ? s : '')),
  mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)),
})
const num = (id, value) => ({ id, type: 'number', label: id, value })
const graphOf = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))

test('fully applied builtins compute, protected ones unchanged', () => {
  const ev = createEvaluator(registry())
  const g = graphOf(call('s', 'succ', ['4']), call('z', 'zero', []), call('i', 'isZero', ['0']), call('t', 'ifThenElse', ['false', '1', '2']), call('d', 'divide', ['1', '4']))
  assert.equal(ev.run(g, 's'), 5)
  assert.equal(ev.run(g, 'z'), 0)
  assert.equal(ev.run(g, 'i'), true)
  assert.equal(ev.run(g, 't'), 2)
  assert.equal(ev.run(g, 'd'), 0.25)
})

test('mounted nodes are evaluated live, not snapshotted', () => {
  const ev = createEvaluator(registry())
  const g = graphOf(num('a', '3'), call('inner', 'succ', [{ node: 'a' }]), call('outer', 'times', [{ node: 'inner' }, '10']))
  assert.equal(ev.run(g, 'outer'), 40)
  g.a.value = '9'
  assert.equal(ev.run(g, 'outer'), 100)
})

test('open slots make a closure that can be stored and applied later', () => {
  const ev = createEvaluator(registry())
  const g = graphOf(call('p', 'plus', ['2', '']))
  const closure = ev.run(g, 'p')
  assert.deepEqual(closure, { kind: 'closure', callee: 'plus', args: [2, null] })
  const g2 = graphOf({ id: 'c', type: 'curried', label: 'plus · 1/2', closure: JSON.parse(JSON.stringify(closure)) }, call('ap', 'apply', [{ node: 'c' }, '3']))
  assert.equal(ev.run(g2, 'ap'), 5)
})

test('category laws: identity is a unit for compose, compose is associative', () => {
  const ev = createEvaluator(registry())
  const f = call('f', 'succ', [''])
  const g = call('g', 'negate', [''])
  const h = call('h', 'times', ['3', ''])
  const id = call('id', 'identity', [''])
  const graph = graphOf(f, g, h, id,
    call('fx', 'apply', [{ node: 'f' }, '5']),
    call('left', 'compose', [{ node: 'id' }, { node: 'f' }, '5']),
    call('right', 'compose', [{ node: 'f' }, { node: 'id' }, '5']),
    call('fg', 'compose', [{ node: 'f' }, { node: 'g' }, '']),
    call('gh', 'compose', [{ node: 'g' }, { node: 'h' }, '']),
    call('assocL', 'compose', [{ node: 'fg' }, { node: 'h' }, '7']),
    call('assocR', 'compose', [{ node: 'f' }, { node: 'gh' }, '7']))
  assert.equal(ev.run(graph, 'left'), ev.run(graph, 'fx'))
  assert.equal(ev.run(graph, 'right'), ev.run(graph, 'fx'))
  assert.equal(ev.run(graph, 'assocL'), ev.run(graph, 'assocR'))
  assert.equal(ev.run(graph, 'assocL'), -20)
})

test('select is lazy, so a recursive custom function with a base case terminates', () => {
  const reg = registry()
  // sumTo n = select (n == 0) 0 (n + sumTo (n - 1))
  reg.nodes.sumTo = { id: 'sumTo', type: 'function', label: 'sumTo', params: ['n'], mounted: [null], custom: true }
  reg.functionBodies.sumTo = graphOf(
    { id: 'n', type: 'parameter', label: 'n' },
    call('isBase', 'eq', [{ node: 'n' }, '0']),
    call('dec', 'minus', [{ node: 'n' }, '1']),
    call('rec', 'sumTo', [{ node: 'dec' }]),
    call('step', 'plus', [{ node: 'n' }, { node: 'rec' }]),
    call('sel', 'select', [{ node: 'isBase' }, '0', { node: 'step' }]),
    { id: 'output', type: 'output', label: 'Output', source: 'sel' },
  )
  const ev = createEvaluator(reg)
  assert.equal(ev.run(graphOf(call('go', 'sumTo', ['4'])), 'go'), 10)
})

test('unbounded recursion fails cleanly instead of hanging', () => {
  const reg = registry()
  reg.nodes.loop = { id: 'loop', type: 'function', label: 'loop', params: ['n'], mounted: [null], custom: true }
  reg.functionBodies.loop = graphOf({ id: 'n', type: 'parameter', label: 'n' }, call('rec', 'loop', [{ node: 'n' }]), { id: 'output', type: 'output', label: 'Output', source: 'rec' })
  assert.throws(() => createEvaluator(reg).run(graphOf(call('go', 'loop', ['1'])), 'go'), EvalError)
})

test('runtime errors are EvalErrors with a readable message', () => {
  const reg = registry()
  reg.nodes.empty = { id: 'empty', type: 'function', label: 'empty', params: [], mounted: [], custom: true }
  reg.functionBodies.empty = { output: { id: 'empty-output', type: 'output', label: 'Output' } }
  const ev = createEvaluator(reg)
  assert.throws(() => ev.run(graphOf(num('five', '5'), call('ap', 'apply', [{ node: 'five' }, '1'])), 'ap'), /not a function/)
  assert.throws(() => ev.run(graphOf(call('e', 'empty', [])), 'e'), /Output is not connected/)
  assert.throws(() => ev.run(graphOf({ id: 'p', type: 'parameter', label: 'x' }), 'p'), /only has a value inside a call/)
})

test('round goes half-to-even like Haskell', () => {
  const ev = createEvaluator(registry())
  const g = graphOf(...['2.5', '3.5', '-2.5', '0.5', '1.4'].map((v, i) => call(`r${i}`, 'round', [v])))
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => ev.run(g, `r${i}`)), [2, 4, -2, 0, 1])
})
