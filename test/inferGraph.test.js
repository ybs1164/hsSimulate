import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce } from '../src/prelude.js'
import { showQual } from '../src/typeSystem.js'

const fn = (id, builtin, mounted) => ({ id, type: 'function', builtin, params: mounted.map(() => ''), mounted })
const num = (id, value, annotation) => ({ id, type: 'number', value, annotation })
const bool = (id) => ({ id, type: 'boolean', value: 'true' })
const infer = (graph) => inferGraph(graph, {}, graph)
const sig = (pass, id) => {
  const e = pass.perNode.get(id)
  return e.paramTypes ? showQual(e.preds, e.paramTypes.reduceRight((acc, t) => ({ kind: 'fun', from: t, to: acc }), e.resultType)) : showQual(e.preds, e.valueType)
}

test('builtins demand only the structure they need', () => {
  const pass = infer({ plus: fn('plus', 'plus', [null, null]), negate: fn('negate', 'negate', [null]), times: fn('times', 'times', [null, null]) })
  assert.equal(sig(pass, 'plus'), 'AddSemigroup a ⇒ a → a → a')
  assert.equal(sig(pass, 'negate'), 'AddGroup a ⇒ a → a')
  assert.equal(sig(pass, 'times'), 'MulSemigroup a ⇒ a → a → a')
})

test('a literal wired into (+) keeps only Semiring (it entails AddSemigroup)', () => {
  const pass = infer({ five: num('five', '5'), plus: fn('plus', 'plus', ['five', null]) })
  assert.equal(sig(pass, 'plus'), 'Semiring a ⇒ a → a → a')
})

test('wiring into sqrt strengthens a literal to Transcendental', () => {
  const pass = infer({ two: num('two', '2'), sqrt: fn('sqrt', 'sqrt', ['two']) })
  assert.equal(sig(pass, 'two'), 'Transcendental a ⇒ a')
})

test('Natural cannot be negated: the edge leaves an unsatisfiable AddGroup', () => {
  const pass = infer({ n: num('n', '3', 'Natural'), negate: fn('negate', 'negate', ['n']) })
  assert.throws(() => reduce(pass.preds))
})

test('Natural can be added and multiplied (it is a semiring)', () => {
  const pass = infer({ n: num('n', '3', 'Natural'), plus: fn('plus', 'plus', ['n', null]), times: fn('times', 'times', ['n', null]) })
  assert.doesNotThrow(() => reduce(pass.preds))
})

test('select is polymorphic where ifThenElse stays pinned to Int', () => {
  const pass = infer({ c: bool('c'), b: bool('b'), select: fn('select', 'select', ['c', 'b', null]), ite: fn('ite', 'ifThenElse', [null, null, null]) })
  assert.equal(sig(pass, 'select'), 'Bool → Bool → Bool → Bool')
  assert.equal(sig(pass, 'ite'), 'Bool → Int → Int → Int')
})

test('(>=) needs Ord, which functions lack', () => {
  const pass = infer({ id: fn('id', 'identity', [null]), geq: fn('geq', 'geq', ['id', null]) })
  assert.throws(() => reduce(pass.preds))
})

// ---- Applied slots: a function node's value is its callee applied to its
// mounted/literal slots (the same meaning src/evaluator.js gives it).
const valueSig = (pass, id) => showQual(pass.perNode.get(id).preds, valueTypeOfEntry(pass.perNode.get(id)))

test('a function node used as a value only keeps its open slots', () => {
  const pass = infer({ plus: { ...fn('plus', 'plus', [null, null]), params: ['2', ''] } })
  assert.equal(valueSig(pass, 'plus'), 'Semiring a ⇒ a → a')
  const both = infer({ plus: { ...fn('plus', 'plus', [null, null]), params: ['2', '3'] } })
  assert.equal(valueSig(both, 'plus'), 'Semiring a ⇒ a')
})

test('a fully applied call can feed a slot that expects its result', () => {
  const pass = infer({ inner: { ...fn('inner', 'succ', [null]), params: ['4'] }, outer: fn('outer', 'isZero', ['inner']) })
  assert.doesNotThrow(() => reduce(pass.preds))
  assert.equal(valueSig(pass, 'outer'), 'Bool')
})

test('an inline literal that does not fit is flagged, not trusted', () => {
  const pass = infer({ z: { ...fn('z', 'isZero', [null]), params: ['true'] } })
  assert.deepEqual(pass.perNode.get('z').invalidSlots, [0])
})

test('an unsatisfiable literal is dropped so it cannot block other edges', () => {
  const pass = infer({ n: num('n', '3', 'Natural'), plus: { ...fn('plus', 'plus', ['n', null]), params: ['', '-1'] } })
  assert.deepEqual(pass.perNode.get('plus').invalidSlots, [1])
  assert.doesNotThrow(() => reduce(pass.preds))
})

test('custom function schemes see literal slots in the body', () => {
  const nodes = { inc: { id: 'inc', type: 'function', params: ['x'], mounted: [null], custom: true } }
  const bodies = { inc: { x: { id: 'x', type: 'parameter' }, call: { id: 'call', type: 'function', builtin: 'plus', params: ['', '1'], mounted: ['x', null] }, output: { id: 'output', type: 'output', source: 'call' } } }
  const pass = inferGraph(nodes, bodies, nodes)
  assert.equal(sig(pass, 'inc'), 'Semiring a ⇒ a → a')
})

test('a curried Play result keeps its constraints, instantiated fresh per use', () => {
  const resolvedScheme = { vars: ['a'], preds: [{ cls: 'Semiring', type: { kind: 'var', id: 'a' } }], type: { kind: 'fun', from: { kind: 'var', id: 'a' }, to: { kind: 'var', id: 'a' } } }
  const pass = infer({ c: { id: 'c', type: 'curried', resolvedScheme }, ap: { ...fn('ap', 'apply', ['c', null]), params: ['', 'true'] } })
  assert.deepEqual(pass.perNode.get('ap').invalidSlots, [1], 'Semiring Bool is unsatisfiable')
  assert.equal(valueSig(infer({ c: { id: 'c', type: 'curried', resolvedScheme } }), 'c'), 'Semiring a ⇒ a → a')
})

test('a reference is the same value: both uses constrain one type', () => {
  const pass = infer({
    lit: num('lit', '4'),
    r: { id: 'r', type: 'ref', target: 'lit' },
    z: fn('z', 'isZero', ['lit']),
    s: fn('s', 'sqrt', ['r']),
  })
  assert.throws(() => reduce(pass.preds), 'Int (from isZero) has no Transcendental instance')
  const ok = infer({ lit: num('lit', '4'), r: { id: 'r', type: 'ref', target: 'lit' }, p: fn('p', 'plus', ['lit', 'r']) })
  assert.equal(valueSig(ok, 'r'), 'Semiring a ⇒ a')
})
