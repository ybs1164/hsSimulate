import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addParameter, removeParameter, renameParameter } from '../src/signature.js'
import { createEvaluator } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { showType } from '../src/typeSystem.js'

// f x y = x + y, called once from main and once from g's body.
function fixture() {
  const nodes = {
    plus: { id: 'plus', type: 'function', builtin: 'plus', label: '(+)', params: ['x', 'y'], mounted: [null, null] },
    f: { id: 'f', type: 'function', label: 'f', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], custom: true, x: 0, y: 0 },
    g: { id: 'g', type: 'function', label: 'g', params: [], mounted: [], custom: true },
    callMain: { id: 'callMain', type: 'function', sourceFunctionId: 'f', label: 'f', params: ['2', ''], mounted: [null, 'three'], paramScopes: ['local', 'local'], x: 0, y: 0 },
    three: { id: 'three', type: 'number', value: '3', mountedTo: 'callMain:1', connected: true, x: 0, y: 0 },
  }
  const functionBodies = {
    f: {
      'input-f-0': { id: 'input-f-0', type: 'parameter', label: 'x', mountedTo: 'sum:0' },
      'input-f-1': { id: 'input-f-1', type: 'parameter', label: 'y' },
      ry: { id: 'ry', type: 'ref', target: 'input-f-1', mountedTo: 'sum:1' },
      sum: { id: 'sum', type: 'function', sourceFunctionId: 'plus', params: ['', ''], mounted: ['input-f-0', 'ry'] },
      output: { id: 'output', type: 'output', source: 'sum' },
    },
    g: { c: { id: 'c', type: 'function', sourceFunctionId: 'f', params: ['1', '1'], mounted: [null, null] }, output: { id: 'output', type: 'output', source: 'c' } },
  }
  return { nodes, functionBodies }
}

test('adding a parameter adds a body parameter node and a slot to the definition and every call', () => {
  const p = fixture()
  assert.equal(addParameter(p, 'f'), 'p3')
  assert.deepEqual(Object.values(p.functionBodies.f).filter((n) => n.type === 'parameter').map((n) => n.label), ['x', 'y', 'p3'])
  assert.equal(p.nodes.f.params.length, 3)
  assert.equal(p.nodes.callMain.params.length, 3)
  assert.equal(p.functionBodies.g.c.mounted.length, 3)
  // the call in g now has an open third slot: g's value is a function
  const pass = inferGraph(p.nodes, p.functionBodies, p.nodes)
  assert.equal(valueTypeOfEntry(pass.perNode.get('g')).kind, 'fun', `g = f 1 1 _ is now a function: ${showType(valueTypeOfEntry(pass.perNode.get('g')))}`)
})

test('removing a parameter cuts what it fed, drops its references, and frees what calls plugged into that slot', () => {
  const p = fixture()
  assert.ok(removeParameter(p, 'f', 1)) // remove y
  const body = p.functionBodies.f
  assert.equal(body['input-f-1'], undefined)
  assert.equal(body.ry, undefined, 'the reference to y is gone')
  assert.deepEqual(body.sum.mounted, ['input-f-0', null])
  assert.deepEqual(p.nodes.callMain.params, ['2'])
  assert.equal(p.nodes.three.mountedTo, null, 'the 3 plugged into the removed slot is freed')
  // f x = x + _ : the body is now a partial application, and the call still evaluates
  const ev = createEvaluator(p)
  const v = ev.run(p.nodes, 'callMain')
  assert.equal(v.kind, 'closure', 'f 2 = (2 +), still waiting for the slot that y used to fill')
})

test('renaming checks the name and keeps the definition slot label in step', () => {
  const p = fixture()
  assert.equal(renameParameter(p, 'f', 0, 'Bad'), false)
  assert.equal(renameParameter(p, 'f', 0, 'y'), false, 'taken')
  assert.ok(renameParameter(p, 'f', 0, 'amount'))
  assert.equal(p.functionBodies.f['input-f-0'].label, 'amount')
  assert.equal(p.nodes.f.params[0], 'amount')
})
