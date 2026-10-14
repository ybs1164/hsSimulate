import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferGraph } from '../src/inferGraph.js'
import { createEvaluator } from '../src/evaluator.js'
import { printDefinition } from '../src/haskellPrint.js'
import { showQual } from '../src/typeSystem.js'

// A literal node holds Haskell literal text (`3`, `"hi"`, `True`, `'c'`) and,
// plugged into a slot, behaves exactly like the same text typed into it.
const fn = (id, builtin, mounted, params = mounted.map(() => '')) => ({ id, type: 'function', builtin, label: builtin, params, mounted })
const lit = (id, value, host) => ({ id, type: 'literal', label: 'literal', value, mountedTo: host })
const infer = (graph) => inferGraph(graph, {}, graph)
const valueSig = (pass, id) => { const e = pass.perNode.get(id); return showQual(e.preds, e.valueType) }

test('a plugged-in literal types like inline text: it takes the slot type', () => {
  const pass = infer({ two: lit('two', '2', 'sqrt:0'), sqrt: fn('sqrt', 'sqrt', ['two']) })
  assert.equal(valueSig(pass, 'two'), 'Transcendental a ⇒ a')
  assert.deepEqual(pass.perNode.get('sqrt').invalidSlots, [])
  const inline = infer({ sqrt: fn('sqrt', 'sqrt', [null], ['2']) })
  assert.equal(showQual(inline.perNode.get('sqrt').preds, inline.perNode.get('sqrt').resultType), showQual(pass.perNode.get('sqrt').preds, pass.perNode.get('sqrt').resultType))
})

test('a free-standing literal has the type its text gives', () => {
  const pass = infer({ a: lit('a', '3'), b: lit('b', '-1.5'), c: lit('c', '"hi"'), d: lit('d', 'True'), e: lit('e', "'x'") })
  assert.equal(valueSig(pass, 'a'), 'Semiring a ⇒ a')
  assert.equal(valueSig(pass, 'b'), 'Field a ⇒ a')
  assert.equal(valueSig(pass, 'c'), 'String')
  assert.equal(valueSig(pass, 'd'), 'Bool')
  assert.equal(valueSig(pass, 'e'), 'Char')
})

test('a literal that does not fit its slot flags only that slot', () => {
  const pass = infer({ t: lit('t', 'True', 'neg:0'), neg: fn('neg', 'negate', ['t']) })
  assert.deepEqual(pass.perNode.get('neg').invalidSlots, [0])
  const junk = infer({ j: lit('j', 'nope', 'neg:0'), neg: fn('neg', 'negate', ['j']) })
  assert.deepEqual(junk.perNode.get('neg').invalidSlots, [0])
})

test('a literal node evaluates to its value, and prints as itself', () => {
  const nodes = Object.fromEntries(['times', 'succ'].map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }]))
  const g = {
    a: lit('a', '4', 't:0'), b: lit('b', '-2', 't:1'),
    t: { id: 't', type: 'function', sourceFunctionId: 'times', label: 'times', params: ['', ''], mounted: ['a', 'b'] },
  }
  assert.equal(createEvaluator({ nodes, functionBodies: {} }).run(g, 't'), -8)
  const definitions = { ...nodes, f: { id: 'f', type: 'function', custom: true, label: 'f', params: [], mounted: [] } }
  definitions.times.label = '(*)'
  const body = { ...g, output: { id: 'output', type: 'output', source: 't' } }
  assert.match(printDefinition('f', definitions, { f: body }), /4 \* \(?-2\)?|\(\*\) 4 \(-2\)/)
})
