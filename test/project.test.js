import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, mergeBuiltins, parseProject, ProjectError, serializeProject } from '../src/project.js'

const builtinNodes = {
  add: { id: 'add', type: 'function', label: 'add', builtin: 'succ', readonly: true, params: ['n'], mounted: [null], x: 0, y: 0 },
  zero: { id: 'zero', type: 'function', label: 'zero', builtin: 'zero', readonly: true, params: [], mounted: [], x: 0, y: 0 },
}
const builtinBodies = { add: { output: { id: 'add-output', type: 'output' } } }

test('snapshots round-trip', () => {
  const text = serializeProject({ nodes: builtinNodes, functionBodies: builtinBodies, entry: 'add', outputId: 3 })
  assert.deepEqual(parseProject(text), { nodes: builtinNodes, functionBodies: builtinBodies, entry: 'add', outputId: 3 })
})

test('malformed files are rejected with a ProjectError', () => {
  assert.throws(() => parseProject('not json'), ProjectError)
  assert.throws(() => parseProject('{"version": 99, "nodes": {}, "functionBodies": {}}'), ProjectError)
  assert.throws(() => parseProject('{"version": 1, "nodes": {"a": {"id": "b", "type": "number"}}, "functionBodies": {}}'), ProjectError)
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
