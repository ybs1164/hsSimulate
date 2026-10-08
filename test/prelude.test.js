import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce } from '../src/prelude.js'
import { showQual, showType } from '../src/typeSystem.js'

const BUILTINS = ['nil', 'cons', 'foldr', 'map', 'length', 'append', 'index', 'nothing', 'just', 'maybe', 'show', 'listOf', 'plus', 'times', 'succ', 'eq', 'geq', 'identity']
const registry = () => ({ nodes: Object.fromEntries(BUILTINS.map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }])), functionBodies: {} })
const call = (id, callee, slots) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const graphOf = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))
const run = (g, id, reg = registry()) => createEvaluator(reg).run(g, id)

test('list node, foldr (the recursor of lists), map, length, (++)', () => {
  const g = graphOf(
    call('xs', 'listOf', ['1', '2', '3']),
    call('add', 'plus', ['', '']),
    call('sum', 'foldr', [{ node: 'add' }, '0', { node: 'xs' }]),
    call('dbl', 'times', ['2', '']),
    call('doubled', 'map', [{ node: 'dbl' }, { node: 'xs' }]),
    call('len', 'length', [{ node: 'xs' }]),
    call('both', 'append', [{ node: 'xs' }, { node: 'doubled' }]),
  )
  assert.equal(run(g, 'sum'), 6)
  assert.equal(showValue(run(g, 'doubled')), '[2,4,6]')
  assert.equal(run(g, 'len'), 3)
  assert.equal(showValue(run(g, 'both')), '[1,2,3,2,4,6]')
})

test('lists are lazy: an infinite list can be indexed', () => {
  const reg = registry()
  // ones = 1 : ones
  reg.nodes.ones = { id: 'ones', type: 'function', label: 'ones', params: [], mounted: [], custom: true }
  reg.functionBodies.ones = graphOf(call('rec', 'ones', []), call('c', 'cons', ['1', { node: 'rec' }]), { id: 'output', type: 'output', source: 'c' })
  const g = graphOf(call('o', 'ones', []), call('i', 'index', [{ node: 'o' }, '5']))
  assert.equal(showValue(run(g, 'i', reg)), 'Just 1')
})

test('(!?) and maybe: Maybe is the coproduct 1 + a', () => {
  const g = graphOf(
    call('xs', 'listOf', ['10', '20']),
    call('hit', 'index', [{ node: 'xs' }, '1']),
    call('miss', 'index', [{ node: 'xs' }, '7']),
    call('id', 'identity', ['']),
    call('a', 'maybe', ['0', { node: 'id' }, { node: 'hit' }]),
    call('b', 'maybe', ['0', { node: 'id' }, { node: 'miss' }]),
  )
  assert.equal(showValue(run(g, 'hit')), 'Just 20')
  assert.equal(showValue(run(g, 'miss')), 'Nothing')
  assert.equal(run(g, 'a'), 20)
  assert.equal(run(g, 'b'), 0)
})

test('strings are [Char]: literals, text nodes, (++), show', () => {
  const g = graphOf(
    { id: 't', type: 'text', label: 'text', value: 'clicks: ' },
    call('n', 'plus', ['40', '2']),
    call('s', 'show', [{ node: 'n' }]),
    call('msg', 'append', [{ node: 't' }, { node: 's' }]),
    call('lit', 'append', ['"ab"', '"cd"']),
    call('first', 'index', ['"xyz"', '0']),
    call('shownList', 'show', [{ node: 'xs' }]),
    call('xs', 'listOf', ['1', '2']),
  )
  assert.equal(showValue(run(g, 'msg')), '"clicks: 42"')
  assert.equal(showValue(run(g, 'lit')), '"abcd"')
  assert.equal(showValue(run(g, 'first')), "Just 'x'")
  assert.equal(showValue(run(g, 'shownList')), '"[1,2]"')
})

test('Eq/Ord on lists and strings are lexicographic', () => {
  const g = graphOf(call('a', 'geq', ['"b"', '"abc"']), call('b', 'eq', [{ node: 'x' }, { node: 'y' }]), call('x', 'listOf', ['1', '2']), call('y', 'listOf', ['1', '2']))
  assert.equal(run(g, 'a'), true)
  assert.equal(run(g, 'b'), true)
})

// ---- Types ------------------------------------------------------------------
const infer = (g) => inferGraph(registry().nodes, {}, g)
const vsig = (pass, id) => showQual(pass.perNode.get(id).preds, valueTypeOfEntry(pass.perNode.get(id)))

test('the list node is variadic and unifies its elements', () => {
  const pass = infer(graphOf(call('xs', 'listOf', ['1', '2', ''])))
  assert.equal(vsig(pass, 'xs'), 'Semiring a ⇒ a → [a]')
  const mixed = infer(graphOf(call('xs', 'listOf', ['1', 'true'])))
  assert.deepEqual(mixed.perNode.get('xs').invalidSlots, [1])
})

test('string and char literals are String and Char', () => {
  const pass = infer(graphOf(call('s', 'append', ['"ab"', '']), call('c', 'cons', ["'x'", ''])))
  assert.equal(vsig(pass, 's'), 'String → String')
  assert.equal(vsig(pass, 'c'), 'String → String')
})

test('instances with contexts: Show [Int] holds, Show [a → a] does not', () => {
  const ok = infer(graphOf(call('xs', 'listOf', ['1']), call('s', 'show', [{ node: 'xs' }])))
  assert.doesNotThrow(() => reduce(ok.preds))
  assert.equal(showType(valueTypeOfEntry(ok.perNode.get('s'))), 'String')
  const bad = infer(graphOf({ ...call('f', 'identity', ['']) }, call('xs', 'listOf', [{ node: 'f' }]), call('s', 'show', [{ node: 'xs' }])))
  assert.throws(() => reduce(bad.preds))
})

test('foldr has the recursor type of lists', () => {
  const pass = infer(graphOf(call('f', 'foldr', ['', '', ''])))
  assert.equal(vsig(pass, 'f'), '(a → b → b) → b → [a] → b')
})
