import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferGraph } from '../src/inferGraph.js'
import { reduce } from '../src/numericClasses.js'
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
