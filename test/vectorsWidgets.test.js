// Pairs of vectors are vectors (componentwise), lerp moves between two,
// and fmap relabels a widget tree's messages (Elm's Html.map).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDefinitionView } from '../src/definitionViews.js'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { showValue } from '../src/evaluator.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { entails } from '../src/prelude.js'
import { pred, showQual, tcon, ttuple } from '../src/typeSystem.js'
import { checkClassLaws } from '../src/laws.js'

const fn = (id, label, params) => ({ id, type: 'function', builtin: id, label, params, mounted: params.map(() => null) })
const library = {
  ...preludeDefs, ...preludeTypeDefs,
  plus: fn('plus', '(+)', ['x', 'y']), minus: fn('minus', '(-)', ['x', 'y']), negate: fn('negate', 'negate', ['x']), addZero: fn('addZero', 'addZero', []),
}
const call = (id, callee, slots) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const graphOf = (...ns) => Object.fromEntries(ns.map((x) => [x.id, x]))
const run = (graph) => showValue(createEvaluator({ nodes: library, functionBodies: {} }).run(graph, 'out'))
const Double = tcon('Double')
const point = ttuple(Double, Double)

test('(Double, Double) is a vector space, and its laws hold', () => {
  assert.ok(entails([], pred('VectorSpace', point)))
  assert.ok(entails([], pred('AddAbelianGroup', ttuple(tcon('Int'), Double))))
  assert.ok(!entails([], pred('VectorSpace', ttuple(tcon('Int'), Double))), 'Int has no scaling by a Double')
  const ctx = { ev: createEvaluator({ nodes: library, functionBodies: {}, types: {} }), types: {} }
  const r = checkClassLaws('VectorSpace', point, ctx)
  assert.ok(r.results.length > 0, r.skipped)
  for (const law of r.results) assert.ok(law.ok, `${law.cls}: ${law.law} @ ${law.counterexample}`)
})

const p = (id, x, y) => call(id, 'prelude:pair', [x, y])
test('points add, negate and scale componentwise', () => {
  assert.equal(run(graphOf(p('a', '1.5', '2'), p('b', '3', '4'), call('out', 'plus', [{ node: 'a' }, { node: 'b' }]))), '(4.5,6)')
  assert.equal(run(graphOf(p('a', '1.5', '2'), call('out', 'prelude:scale', ['2', { node: 'a' }]))), '(3,4)')
  assert.equal(run(graphOf(p('a', '1.5', '2'), call('out', 'negate', [{ node: 'a' }]))), '(-1.5,-2)')
})

test('lerp is written as a + t *^ (b - a), and finds the point between', () => {
  const view = buildDefinitionView(library['prelude:lerp'], (x) => library[x])
  const pass = inferGraph({ ...library, ...view.defs }, view.bodies, { v: view.defs[view.viewId] })
  const declared = view.defs[view.viewId].scheme
  assert.equal(showQual(pass.perNode.get('v').preds, valueTypeOfEntry(pass.perNode.get('v'))), showQual(declared.preds, declared.type))
  const g = graphOf(p('a', '0', '0'), p('b', '10', '20'))
  assert.equal(run({ ...g, out: call('out', 'prelude:lerp', ['0.25', { node: 'a' }, { node: 'b' }]) }), '(2.5,5)')
  const ev = createEvaluator({ nodes: { ...library, ...view.defs }, functionBodies: view.bodies })
  assert.equal(showValue(ev.run({ ...g, out: call('out', view.viewId, ['0.25', { node: 'a' }, { node: 'b' }]) }, 'out')), '(2.5,5)')
})

test("fmap relabels a widget tree's messages", () => {
  // fmap (+ 10) (column [button "a" 1, text "t", withColor red (button "b" 2)])
  const g = graphOf(
    call('b1', 'prelude:wButton', ['"a"', '1']), call('t', 'prelude:wText', ['"t"']),
    call('red', 'prelude:red', []), call('b2', 'prelude:wButton', ['"b"', '2']), call('tint', 'prelude:wColor', [{ node: 'red' }, { node: 'b2' }]),
    call('ws', 'prelude:listOf', [{ node: 'b1' }, { node: 't' }, { node: 'tint' }]), call('col', 'prelude:wColumn', [{ node: 'ws' }]),
    call('add', 'plus', ['', '10']), call('out', 'prelude:fmap', [{ node: 'add' }, { node: 'col' }]),
  )
  const shown = run(g)
  assert.match(shown, /Button "a" 11/)
  assert.match(shown, /Button "b" 12/)
  assert.match(shown, /Text "t"/)
})
