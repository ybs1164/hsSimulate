import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDice } from '../src/examples/dice.js'
import { createEvaluator } from '../src/evaluator.js'
import { createGame, pictureShapes } from '../src/runtime.js'
import { derivedDefinitions } from '../src/typeDecls.js'

const B = ['pCircle', 'pCircleSolid', 'pRectangleSolid', 'pTranslate', 'pColor', 'rgb', 'red', 'mappend', 'mempty']
const nodes = Object.fromEntries(B.map((b) => [b, { id: b, builtin: b, label: b }]))
const call = (id, f, slots) => ({ id, type: 'function', sourceFunctionId: f, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const g = (...ns) => Object.fromEntries(ns.map((x) => [x.id, x]))
const ev = createEvaluator({ nodes, functionBodies: {} })

test('pictures are a monoid of shapes: translate moves, color paints, <> overlays, mempty is blank', () => {
  const graph = g(
    call('c', 'pCircleSolid', ['10']), call('moved', 'pTranslate', ['5', '-3', { node: 'c' }]), call('r', 'red', []), call('redc', 'pColor', [{ node: 'r' }, { node: 'moved' }]),
    call('sq', 'pRectangleSolid', ['4', '2']), call('both', 'mappend', [{ node: 'redc' }, { node: 'sq' }]), call('e', 'mempty', []), call('withBlank', 'mappend', [{ node: 'both' }, { node: 'e' }]),
  )
  const shapes = pictureShapes(ev.run(graph, 'withBlank'))
  assert.deepEqual(shapes, [
    { shape: 'circle', x: 5, y: -3, r: 10, solid: true, color: 'rgb(255, 0, 0)' },
    { shape: 'rect', x: 0, y: 0, w: 4, h: 2, solid: true, color: 'rgb(0, 0, 0)' },
  ])
})

test('the dice template draws a red die whose white pip grows with the face', () => {
  const project = buildDice()
  const used = new Set(Object.values(project.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
  const defs = { ...Object.fromEntries([...used].filter((id) => !project.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, builtin: id.replace('prelude:', ''), label: id }])), ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])), ...project.nodes }
  const e2 = createEvaluator({ nodes: defs, functionBodies: project.functionBodies, types: project.types })
  const game = createGame(e2, e2.run(defs, 'main'))
  const drawing = game.view().children[1]
  assert.equal(drawing.kind, 'drawing')
  assert.deepEqual(drawing.shapes.map((s) => [s.shape, s.color, s.r ?? s.w]), [['rect', 'rgb(255, 0, 0)', 120], ['circle', 'rgb(255, 255, 255)', 8]])
  game.dispatch(game.view().children[3].msg)
  const face = game.model.args[0]
  assert.ok(face >= 1 && face <= 6)
  assert.equal(game.view().children[1].shapes[1].r, face * 8)
})
