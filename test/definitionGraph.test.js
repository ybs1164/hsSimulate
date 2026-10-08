// The DEFINITION text is a projection of the graph: every token points back
// at the node it was read from, and every part of the text — the function's
// name, its parameters' names and order, `where` names, a λ hole's binder —
// can be changed on the graph.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { printDefinition, printDefinitionTokens, tokensText } from '../src/haskellPrint.js'
import { moveParameter, renameFunction } from '../src/signature.js'
import { createEvaluator } from '../src/evaluator.js'

// f x y = select y 1 x  — plus a shared value and a λ hole.
function fixture() {
  const nodes = {
    plus: { id: 'plus', type: 'function', builtin: 'plus', label: '(+)', params: ['x', 'y'], mounted: [null, null] },
    select: { id: 'select', type: 'function', builtin: 'select', label: 'select', params: ['condition', 'whenTrue', 'whenFalse'], mounted: [null, null, null] },
    f: { id: 'f', type: 'function', label: 'f', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], custom: true },
    callMain: { id: 'callMain', type: 'function', sourceFunctionId: 'f', label: 'f', params: ['', 'True'], mounted: ['two', null], paramScopes: ['local', 'local'] },
    two: { id: 'two', type: 'number', value: '2', mountedTo: 'callMain:0', connected: true },
  }
  const functionBodies = {
    f: {
      'input-f-0': { id: 'input-f-0', type: 'parameter', label: 'x' },
      'input-f-1': { id: 'input-f-1', type: 'parameter', label: 'y' },
      s: { id: 's', type: 'function', sourceFunctionId: 'select', label: 'select', params: ['', '1', ''], mounted: ['input-f-1', null, 'input-f-0'] },
      output: { id: 'output', type: 'output', source: 's' },
    },
  }
  return { nodes, functionBodies }
}

test('tokens join to the plain definition and point back at their nodes', () => {
  const { nodes, functionBodies } = fixture()
  const tokens = printDefinitionTokens('f', nodes, functionBodies)
  assert.equal(tokensText(tokens), 'f x y = select y 1 x')
  assert.equal(tokensText(tokens), printDefinition('f', nodes, functionBodies))
  const find = (text) => tokens.find((t) => t.text === text && t.id)
  assert.deepEqual({ id: find('f').id, role: find('f').role }, { id: 'header', role: 'name' })
  assert.equal(find('select').id, 's')
  assert.deepEqual({ id: find('1').id, slot: find('1').slot }, { id: 's', slot: 1 }, 'an inline literal points at its slot')
  assert.ok(tokens.every((t) => !t.id || t.scope === 'f'))
})

test('a shared value prints under its chosen where-name; clashes fall back', () => {
  const body = {
    'input-g-0': { id: 'input-g-0', type: 'parameter', label: 'n' },
    sum: { id: 'sum', type: 'function', sourceFunctionId: 'plus', params: ['', '1'], mounted: ['input-g-0', null], bindName: 'next' },
    r: { id: 'r', type: 'ref', target: 'sum' },
    p: { id: 'p', type: 'function', sourceFunctionId: 'plus', params: ['', ''], mounted: ['sum', 'r'] },
    output: { id: 'output', type: 'output', source: 'p' },
  }
  const defs = { plus: { id: 'plus', label: '(+)' }, g: { id: 'g', label: 'g' } }
  assert.equal(printDefinition('g', defs, { g: body }), 'g n = next + next\n  where\n    next = n + 1')
  const tokens = printDefinitionTokens('g', defs, { g: body })
  assert.deepEqual(tokens.filter((t) => t.role === 'binding').map((t) => t.id), ['sum', 'r', 'sum'], 'each use points at the node standing there')
  body.sum.bindName = 'n' // the parameter's name: not allowed
  assert.equal(printDefinition('g', defs, { g: body }), 'g n = sum + sum\n  where\n    sum = n + 1', 'falls back to the node id')
})

test('a gap before an applied slot binds the hole under its chosen name', () => {
  const { nodes, functionBodies } = fixture()
  const s = functionBodies.f.s
  s.mounted[0] = null
  assert.equal(printDefinition('f', nodes, functionBodies), 'f x y = \\x1 -> select x1 1 x', 'x is taken by a parameter')
  s.holeNames = ['cond']
  assert.equal(printDefinition('f', nodes, functionBodies), 'f x y = \\cond -> select cond 1 x')
  const hole = printDefinitionTokens('f', nodes, functionBodies).find((t) => t.role === 'hole')
  assert.deepEqual({ id: hole.id, slot: hole.slot }, { id: 's', slot: 0 })
})

test('moving a parameter reorders the body, the definition and every call', () => {
  const p = fixture()
  assert.ok(moveParameter(p, 'f', 1, 0))
  assert.equal(printDefinition('f', p.nodes, p.functionBodies), 'f y x = select y 1 x')
  assert.deepEqual(p.nodes.callMain.params, ['True', ''])
  assert.deepEqual(p.nodes.callMain.mounted, [null, 'two'])
  assert.equal(p.nodes.two.mountedTo, 'callMain:1', 'what is plugged in follows its slot')
  // the meaning is unchanged: f True 2 still picks 1
  const ev = createEvaluator(p)
  assert.equal(ev.run(p.nodes, 'callMain'), 1)
  assert.equal(moveParameter(p, 'f', 0, 5), false)
})

test('renaming a function renames every call; names must be free identifiers', () => {
  const p = fixture()
  assert.ok(renameFunction(p, 'f', 'pick'))
  assert.equal(p.nodes.f.label, 'pick')
  assert.equal(p.nodes.callMain.label, 'pick')
  assert.equal(renameFunction(p, 'f', 'select'), false, 'taken by a builtin')
  assert.equal(renameFunction(p, 'f', 'map', ['map']), false, 'taken by the Prelude')
  assert.equal(renameFunction(p, 'f', 'Pick'), false, 'not a function name')
})
