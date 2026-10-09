import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, mergeBuiltins, parseProject, ProjectError, serializeProject, upgradeProject } from '../src/project.js'

const builtinNodes = {
  add: { id: 'add', type: 'function', label: 'add', builtin: 'succ', readonly: true, params: ['n'], mounted: [null], x: 0, y: 0 },
  zero: { id: 'zero', type: 'function', label: 'zero', builtin: 'zero', readonly: true, params: [], mounted: [], x: 0, y: 0 },
}
const builtinBodies = { add: { output: { id: 'add-output', type: 'output' } } }

test('snapshots round-trip', () => {
  const types = { Score: { name: 'Score', keyword: 'newtype', constructors: [{ name: 'Score', record: false, fields: [{ name: null, type: { kind: 'con', name: 'Int' } }] }], deriving: [], source: 'newtype Score = Score Int' } }
  const text = serializeProject({ nodes: builtinNodes, functionBodies: builtinBodies, types, entry: 'add', outputId: 3 })
  assert.deepEqual(parseProject(text), { nodes: builtinNodes, functionBodies: builtinBodies, types, entry: 'add', outputId: 3 })
})

test('malformed files are rejected with a ProjectError', () => {
  assert.throws(() => parseProject('not json'), ProjectError)
  assert.throws(() => parseProject('{"version": 99, "nodes": {}, "functionBodies": {}}'), ProjectError)
  assert.throws(() => parseProject('{"version": 2, "nodes": {}, "functionBodies": {}, "types": []}'), ProjectError)
  assert.throws(() => parseProject('{"version": 1, "nodes": {"a": {"id": "b", "type": "number"}}, "functionBodies": {}}'), ProjectError)
})

test('version 1 files still load, with no type declarations', () => {
  assert.deepEqual(parseProject('{"version": 1, "nodes": {}, "functionBodies": {}}').types, {})
})

test('a dangling entry is cleared', () => {
  assert.equal(parseProject(serializeProject({ nodes: {}, functionBodies: {}, entry: 'gone' })).entry, null)
})

test('mergeBuiltins keeps user layout but takes code-owned fields from code', () => {
  const saved = {
    nodes: {
      add: { ...builtinNodes.add, label: 'old label', x: 42, params: ['7'] },
      retired: { id: 'retired', type: 'function', builtin: 'retired', params: [], mounted: [] },
      five: { id: 'five', type: 'number', value: '5', mountedTo: 'retired:0', connected: true },
      custom: { id: 'custom', type: 'function', custom: true, params: [], mounted: [] },
    },
    functionBodies: { add: { tampered: {} }, custom: { output: { id: 'custom-output', type: 'output' } } },
    entry: 'retired',
    outputId: 0,
  }
  const merged = mergeBuiltins(saved, builtinNodes, builtinBodies)
  assert.equal(merged.nodes.add.label, 'add')
  assert.equal(merged.nodes.add.x, 42)
  assert.deepEqual(merged.nodes.add.params, ['7'])
  assert.ok(merged.nodes.zero, 'missing builtin added')
  assert.equal(merged.nodes.retired, undefined, 'retired builtin dropped')
  assert.equal(merged.nodes.five.mountedTo, null, 'freed from the dropped builtin')
  assert.ok(merged.nodes.custom)
  assert.deepEqual(merged.functionBodies.add, builtinBodies.add)
  assert.equal(merged.entry, null)
})

test('history skips no-op records and supports undo/redo', () => {
  const h = createHistory()
  h.reset('a')
  assert.equal(h.record('a'), false)
  assert.equal(h.record('b'), true)
  h.record('c')
  assert.equal(h.undo(), 'b')
  assert.equal(h.undo(), 'a')
  assert.equal(h.undo(), null)
  assert.equal(h.redo(), 'b')
  h.record('d')
  assert.equal(h.canRedo, false, 'a new edit clears the redo stack')
})

test('older saves that hid the Output source are migrated', () => {
  const text = JSON.stringify({ version: 1, nodes: {}, functionBodies: { f: { c: { id: 'c', type: 'function', mountedTo: 'f-output:source' }, d: { id: 'd', type: 'number', mountedTo: 'c:0' } } }, entry: null, outputId: 0 })
  const body = upgradeProject(parseProject(text)).functionBodies.f
  assert.equal(upgradeProject(parseProject(JSON.stringify({ version: 1, nodes: {}, functionBodies: { g: { output: { id: 'g-output', type: 'output' } } } }))).functionBodies.g.output.id, 'output')
  assert.equal(body.c.mountedTo, null)
  assert.equal(body.d.mountedTo, 'c:0', 'slot mounts are untouched')
})

test('fromIntegral and round moved from the main canvas to the Prelude: older saves call them there', () => {
  const nodes = {
    fromIntegral: { id: 'fromIntegral', type: 'function', builtin: 'fromIntegral', readonly: true, params: ['x'], mounted: [null] },
    round: { id: 'round', type: 'function', label: 'round', params: ['x'], mounted: [null], custom: true }, // the project's own function
    c: { id: 'c', type: 'function', sourceFunctionId: 'fromIntegral', params: ['3'], mounted: [null] },
  }
  const functionBodies = { round: { d: { id: 'd', type: 'function', sourceFunctionId: 'fromIntegral', params: [''], mounted: [null] }, e: { id: 'e', type: 'function', sourceFunctionId: 'round', params: [''], mounted: [null] } } }
  const project = upgradeProject(parseProject(JSON.stringify({ version: 2, nodes, functionBodies, types: {}, entry: null, outputId: 0 })))
  assert.equal(project.nodes.fromIntegral, undefined)
  assert.equal(project.nodes.c.sourceFunctionId, 'prelude:fromIntegral')
  assert.equal(project.functionBodies.round.d.sourceFunctionId, 'prelude:fromIntegral')
  assert.ok(project.nodes.round, 'a function of your own named round stays')
  assert.equal(project.functionBodies.round.e.sourceFunctionId, 'round', '…and calls to it too')
})
