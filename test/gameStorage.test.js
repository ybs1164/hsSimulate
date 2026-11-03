import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gameStorageSlot, LEGACY_GAME_KEY, migrateLegacyGame, readGameSave, writeGameSave } from '../src/gameStorage.js'
import { parseProject, serializeProject } from '../src/project.js'
import { tcon, tlist } from '../src/typeSystem.js'

const Model = tcon('Model'), Msg = tcon('Msg')
const field = (name, type) => ({ name, type })
const blank = {
  Model: { constructors: [{ name: 'Model', fields: [field('count', tcon('Double'))] }] },
  Msg: { constructors: [{ name: 'Increment', fields: [] }] },
}
const counter = {
  Model: { constructors: [{ name: 'Model', fields: [field('wallet', tcon('Wallet')), field('rate', tcon('Int'))] }] },
  Wallet: { constructors: [{ name: 'Wallet', fields: [field('clicks', tcon('Int'))] }] },
  Msg: { constructors: [{ name: 'Click', fields: [] }] },
}
const slot = (project, types = blank, entry = 'main') => gameStorageSlot(project, entry, Model, Msg, types)
const data = (type, ctor, args = [], ctorIndex = 0) => ({ kind: 'data', type, ctor, ctorIndex, args })
const snapshot = { model: data('Model', 'Model', [2]), log: [data('Msg', 'Increment')], time: 0.5 }
const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
}

test('game saves are isolated by project, entry and declared model/message schema', () => {
  const store = storage()
  writeGameSave(store, slot('template:blank'), snapshot, 100)
  assert.deepEqual(readGameSave(store, slot('template:blank'))?.model, snapshot.model)
  assert.equal(readGameSave(store, slot('project:other')), null)
  assert.equal(readGameSave(store, slot('template:blank', blank, 'otherEntry')), null)
  assert.equal(readGameSave(store, slot('template:blank', counter)), null)
  assert.equal(readGameSave(store, slot('template:blank', { ...blank, Msg: counter.Msg })), null)
  assert.equal(readGameSave(store, slot('template:blank', { ...blank, Unrelated: counter.Wallet })).savedAt, 100)
  assert.notEqual(slot('x', counter).schema, slot('x', { ...counter, Wallet: blank.Model }).schema)
})

test('legacy snapshot migration checks constructor payloads and messages and preserves the original slot', () => {
  const store = storage()
  const old = JSON.stringify({ ...snapshot, entry: 'main', modelType: 'Model', savedAt: 100 })
  store.setItem(LEGACY_GAME_KEY, old)
  const migrate = types => migrateLegacyGame(store, slot('project:old', types), { entry: 'main', model: Model, message: Msg, types })
  migrate(counter)
  assert.equal(readGameSave(store, slot('project:old', counter)), null)
  migrate({ ...blank, Msg: counter.Msg })
  assert.equal(readGameSave(store, slot('project:old', { ...blank, Msg: counter.Msg })), null)
  migrate(blank)
  assert.deepEqual(readGameSave(store, slot('project:old'))?.model, snapshot.model)
  assert.equal(store.getItem(LEGACY_GAME_KEY), old)
  assert.equal(readGameSave(store, slot('project:other')), null)
  writeGameSave(store, slot('project:old'), { ...snapshot, model: data('Model', 'Model', [3]) }, 200)
  migrate(blank)
  assert.equal(readGameSave(store, slot('project:old')).savedAt, 200)
})

test('legacy validation checks the inner type of a list field', () => {
  const store = storage(), List = tlist(tcon('Bool'))
  const types = { ...blank, Model: { constructors: [{ name: 'Model', fields: [field('flags', List)] }] } }
  const current = slot('project:list', types)
  const saveLegacy = item => store.setItem(LEGACY_GAME_KEY, JSON.stringify({
    ...snapshot, entry: 'main', modelType: 'Model', savedAt: 100,
    model: data('Model', 'Model', [data('List', ':', [item, data('List', '[]')], 1)]),
  }))
  const migrate = () => migrateLegacyGame(store, current, { entry: 'main', model: Model, message: Msg, types })
  saveLegacy(1); migrate()
  assert.equal(readGameSave(store, current), null)
  saveLegacy(true); migrate()
  assert.equal(readGameSave(store, current).model.args[0].args[0], true)
})

test('old project JSON and identified project JSON both round-trip', () => {
  const project = { nodes: {}, functionBodies: {} }
  assert.equal(parseProject(serializeProject(project)).projectId, undefined)
  assert.equal(parseProject(serializeProject({ ...project, projectId: 'template:clickCounter' })).projectId, 'template:clickCounter')
})
