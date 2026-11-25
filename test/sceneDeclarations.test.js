import { test } from 'node:test'
import assert from 'node:assert/strict'
import { declarationNode, declarationSceneEdges, isDeclarationNode, renameDeclarationNode, syncDeclarationBodies, syncDeclarationNodes } from '../src/sceneDeclarations.js'
import { declareTypes, derivedDefinitions } from '../src/typeDecls.js'
import { createHistory, parseProject, serializeProject } from '../src/project.js'
import { createTypedEvaluator } from '../src/typedEvaluator.js'

const declarations = () => declareTypes({}, 'data Item = Item Int\ndata Model = Model { item :: Item }\ndata Tree = Leaf | Node Tree Tree')

test('types and classes become main-scene nodes without moving existing functions', () => {
  const nodes = { f: { id: 'f', type: 'function', custom: true, x: 120, y: 100 } }
  const classes = { Pretty: { name: 'Pretty', param: 'a', supers: [], methods: [], instances: [] } }
  const types = declarations()
  syncDeclarationNodes(nodes, types, classes)
  assert.equal(Object.values(nodes).filter(isDeclarationNode).length, 4)
  assert.equal(declarationNode(nodes, 'type', 'Model').type, 'declaration')
  assert.ok(declarationNode(nodes, 'class', 'Pretty'))
  assert.deepEqual([nodes.f.x, nodes.f.y], [120, 100])
  const count = Object.keys(nodes).length
  syncDeclarationNodes(nodes, types, classes)
  assert.equal(Object.keys(nodes).length, count)
})

test('renames preserve node identity and position; deletion removes only the declaration node', () => {
  const nodes = {}, types = declarations()
  syncDeclarationNodes(nodes, types, {})
  const model = declarationNode(nodes, 'type', 'Model')
  model.x = 1234; model.y = 567
  const renamed = { ...types, State: { ...types.Model, name: 'State' } }
  delete renamed.Model
  renameDeclarationNode(nodes, 'type', 'Model', 'State')
  syncDeclarationNodes(nodes, renamed, {})
  assert.equal(declarationNode(nodes, 'type', 'State'), model)
  assert.deepEqual([model.x, model.y], [1234, 567])
  delete renamed.State
  syncDeclarationNodes(nodes, renamed, {})
  assert.ok(!nodes[model.id])
  assert.ok(declarationNode(nodes, 'type', 'Item'))
})

test('old universe positions migrate once and saved positions survive reload and undo', () => {
  const nodes = {}, types = declarations()
  syncDeclarationNodes(nodes, types, {}, {}, { universe: { 'type:Model': { x: 20, y: 30 } } })
  const node = declarationNode(nodes, 'type', 'Model')
  assert.deepEqual([node.x, node.y], [360, 330])
  const before = serializeProject({ nodes, functionBodies: {}, types })
  const history = createHistory()
  history.reset(before)
  node.x += 250; node.y += 100
  history.record(serializeProject({ nodes, functionBodies: {}, types }))
  const restored = parseProject(history.undo())
  assert.deepEqual([restored.nodes[node.id].x, restored.nodes[node.id].y], [360, 330])
  const redo = parseProject(history.redo())
  syncDeclarationNodes(redo.nodes, redo.types, {}, {}, { universe: { 'type:Model': { x: 0, y: 0 } } })
  assert.deepEqual([redo.nodes[node.id].x, redo.nodes[node.id].y], [610, 430])
})

test('field, recursive, instance and function-use relations share the scene ids', () => {
  const types = declarations()
  const nodes = { f: { id: 'f', type: 'function', label: 'f', custom: true } }
  const instances = { Show: [{ head: 'Model', context: [], methods: {} }] }
  syncDeclarationNodes(nodes, types, {}, instances)
  const defs = Object.fromEntries(derivedDefinitions(types).map((d) => [d.id, d]))
  const bodies = { f: { use: { id: 'use', type: 'function', sourceFunctionId: 'type:Model:item' } } }
  const edges = declarationSceneEdges(nodes, types, {}, instances, bodies, { ...defs, ...nodes })
  const id = (kind, name) => declarationNode(nodes, kind, name).id
  assert.ok(edges.some((e) => e.from === id('type', 'Item') && e.to === id('type', 'Model') && e.kind === 'field'))
  assert.ok(edges.some((e) => e.from === id('type', 'Tree') && e.to === e.from && e.kind === 'recursive'))
  assert.ok(edges.some((e) => e.from === id('type', 'Model') && e.to === id('class', 'Show') && e.kind === 'instance'))
  assert.ok(edges.some((e) => e.from === id('type', 'Model') && e.to === 'f' && e.kind === 'function-type'))
})

test('declaration cards do not change execution of functions in the same main scene', () => {
  const nodes = { f: { id: 'f', type: 'function', label: 'f', custom: true, params: [], mounted: [] } }
  const types = declarations()
  const functionBodies = { f: { value: { id: 'value', type: 'literal', value: 'True' }, output: { id: 'output', type: 'output', source: 'value' } } }
  syncDeclarationNodes(nodes, types, {})
  assert.equal(createTypedEvaluator({ nodes, functionBodies, types }).run(nodes, 'f'), true)
})

test('main shares the canonical declaration nodes and saves their metadata only once', () => {
  const types = declarations()
  const nodes = { main: { id: 'main', type: 'function', label: 'main', custom: true, programEntry: true, params: [], mounted: [] } }
  const functionBodies = { main: { output: { id: 'output', type: 'output' } }, f: { output: { id: 'output', type: 'output' } } }
  syncDeclarationNodes(nodes, types, {})
  syncDeclarationBodies(nodes, functionBodies)
  const model = declarationNode(nodes, 'type', 'Model')
  assert.equal(functionBodies.main[model.id], model)
  assert.ok(!functionBodies.f[model.id])
  functionBodies.main[model.id].x = 1400
  const saved = parseProject(serializeProject({ nodes, functionBodies, types }))
  assert.equal(saved.nodes[model.id].x, 1400)
  assert.ok(!saved.functionBodies.main[model.id])
  syncDeclarationBodies(saved.nodes, saved.functionBodies)
  assert.equal(saved.functionBodies.main[model.id], saved.nodes[model.id])
  delete saved.nodes[model.id]
  syncDeclarationBodies(saved.nodes, saved.functionBodies)
  assert.ok(!saved.functionBodies.main[model.id])
})
