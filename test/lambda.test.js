// λ nodes are lambda-lifted: a hidden custom function plus a call to it.
// Capturing an outer value = plugging it into one of the λ's slots.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { printDefinition } from '../src/haskellPrint.js'
import { inferGraph } from '../src/inferGraph.js'
import { showQual, tfun } from '../src/typeSystem.js'

// f c xs = map (\x -> x + c) xs
const nodes = {
  plus: { id: 'plus', type: 'function', builtin: 'plus', label: '(+)' },
  map: { id: 'map', type: 'function', builtin: 'map', label: 'map' },
  listOf: { id: 'listOf', type: 'function', builtin: 'listOf', label: '[ , , ]' },
  lam: { id: 'lam', type: 'function', label: 'λ', params: ['c', 'x'], mounted: [null, null], custom: true, lambda: true },
  f: { id: 'f', type: 'function', label: 'f', params: ['c', 'xs'], mounted: [null, null], custom: true },
}
const functionBodies = {
  lam: {
    'input-lam-0': { id: 'input-lam-0', type: 'parameter', label: 'c' },
    'input-lam-1': { id: 'input-lam-1', type: 'parameter', label: 'x' },
    sum: { id: 'sum', type: 'function', sourceFunctionId: 'plus', params: ['', ''], mounted: ['input-lam-1', 'input-lam-0'] },
    output: { id: 'output', type: 'output', source: 'sum' },
  },
  f: {
    'input-f-0': { id: 'input-f-0', type: 'parameter', label: 'c' },
    'input-f-1': { id: 'input-f-1', type: 'parameter', label: 'xs' },
    λ: { id: 'λ', type: 'function', sourceFunctionId: 'lam', label: 'λ', params: ['', ''], mounted: ['input-f-0', null] }, // captures c, still takes x
    m: { id: 'm', type: 'function', sourceFunctionId: 'map', params: ['', ''], mounted: ['λ', 'input-f-1'] },
    output: { id: 'output', type: 'output', source: 'm' },
  },
}

test('a λ capturing an outer parameter evaluates as a closure over it', () => {
  const ev = createEvaluator({ nodes, functionBodies })
  const g = { xs: { id: 'xs', type: 'function', sourceFunctionId: 'listOf', params: ['1', '2'], mounted: [null, null] }, call: { id: 'call', type: 'function', sourceFunctionId: 'f', params: ['10', ''], mounted: [null, 'xs'] } }
  assert.equal(showValue(ev.run(g, 'call')), '[11,12]')
})

test('its type flows through: f :: AddSemigroup a ⇒ a → [a] → [a]', () => {
  const pass = inferGraph(nodes, functionBodies, { f: nodes.f })
  const e = pass.perNode.get('f')
  assert.equal(showQual(e.preds, e.paramTypes.reduceRight((acc, t) => tfun(t, acc), e.resultType)), 'AddSemigroup a ⇒ a → [a] → [a]')
})

test('it prints as an applied lambda — a β-redex', () => {
  assert.equal(printDefinition('f', nodes, functionBodies), 'f c xs = map ((\\c x -> x + c) c) xs')
})
