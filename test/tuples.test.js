import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce } from '../src/prelude.js'
import { declareTypes } from '../src/typeDecls.js'
import { showType, tcon, ttuple } from '../src/typeSystem.js'
import { parseValue } from '../src/valueParser.js'

const B = ['pair', 'fst', 'snd', 'mkStdGen', 'randomR', 'randomRInt', 'mappend', 'mkSum', 'show']
const nodes = Object.fromEntries(B.map((b) => [b, { id: b, type: 'function', builtin: b, label: b }]))
const call = (id, f, slots) => ({ id, type: 'function', sourceFunctionId: f, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const g = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))
const ev = createEvaluator({ nodes, functionBodies: {} })

test('pairs: (,), fst, snd, show, and a product of monoids', () => {
  const graph = g(call('p', 'pair', ['1', 'True']), call('a', 'fst', [{ node: 'p' }]), call('b', 'snd', [{ node: 'p' }]),
    call('s1', 'mkSum', ['2']), call('s2', 'mkSum', ['3']), call('q1', 'pair', [{ node: 's1' }, '"ab"']), call('q2', 'pair', [{ node: 's2' }, '"c"']), call('qq', 'mappend', [{ node: 'q1' }, { node: 'q2' }]))
  assert.equal(showValue(ev.run(graph, 'p')), '(1,True)')
  assert.equal(ev.run(graph, 'a'), 1)
  assert.equal(ev.run(graph, 'b'), true)
  assert.equal(showValue(ev.run(graph, 'qq')), '(Sum 5,"abc")')
  const pass = inferGraph(nodes, {}, graph)
  assert.equal(showType(valueTypeOfEntry(pass.perNode.get('qq'))), '(Sum a, String)')
  assert.doesNotThrow(() => reduce(pass.preds))
})

test('random numbers are pure: the same seed gives the same numbers, and the generator moves on', () => {
  const graph = g(call('gen', 'mkStdGen', ['42']), call('r1', 'randomR', [{ node: 'range' }, { node: 'gen' }]), call('range', 'pair', ['1', '6']),
    call('g2', 'snd', [{ node: 'r1' }]), call('r2', 'randomRInt', [{ node: 'range2' }, { node: 'g2' }]), call('range2', 'pair', ['1', '6']))
  const a = ev.run(graph, 'r1')
  const b = ev.run(graph, 'r1')
  assert.deepEqual(a, b, 'deterministic')
  assert.ok(a.args[0] >= 1 && a.args[0] < 6)
  const roll = ev.run(graph, 'r2').args[0]
  assert.ok(Number.isInteger(roll) && roll >= 1 && roll <= 6)
  assert.notDeepEqual(ev.run(graph, 'g2'), ev.run(graph, 'gen'), 'the generator advanced')
  // many rolls cover the whole range
  let gen = { kind: 'data', type: 'StdGen', ctor: 'StdGen', ctorIndex: 0, args: [7] }
  const seen = new Set()
  for (let i = 0; i < 200; i++) { const r = ev.invokeBuiltin('randomRInt', [{ kind: 'data', type: '(,)', ctor: '(,)', ctorIndex: 0, args: [1, 6] }, gen]); seen.add(r.args[0]); gen = r.args[1] }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6])
})

test('a model can hold pairs and a generator; values parse back', () => {
  const types = declareTypes({}, 'data Dice = Dice { last :: (Int, Int), gen :: StdGen } deriving stock (Show)')
  const v = parseValue('Dice {last = (3,5), gen = StdGen 99}', tcon('Dice'), types)
  assert.equal(showValue(v, types), 'Dice {last = (3,5), gen = StdGen 99}')
  assert.equal(showValue(parseValue('(1,"x")', ttuple(tcon('Int'), { kind: 'app', fn: tcon('List'), arg: tcon('Char') }))), '(1,"x")')
})

test('pairs print as Haskell tuples', async () => {
  const { printDefinition } = await import('../src/haskellPrint.js')
  const defs = { pair: { id: 'pair', label: '(,)' }, f: { id: 'f', label: 'f' } }
  const body = { 'input-f-0': { id: 'input-f-0', type: 'parameter', label: 'x' }, p: { id: 'p', type: 'function', sourceFunctionId: 'pair', params: ['', '1'], mounted: ['input-f-0', null] }, output: { id: 'output', type: 'output', source: 'p' } }
  assert.equal(printDefinition('f', defs, { f: body }), 'f x = (x, 1)')
})
