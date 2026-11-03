import { BUILTIN_SHAPES } from './dataTypes.js'
import { applySubst, showType, tcon } from './typeSystem.js'

export const LEGACY_GAME_KEY = 'hs-simulate:game'

export function gameStorageSlot(projectId, entry, model, message, types) {
  const shapes = new Map()
  function collect(type) {
    if (type.kind === 'app') { collect(type.fn); collect(type.arg); return }
    if (type.kind === 'fun') { collect(type.from); collect(type.to); return }
    if (type.kind !== 'con' || !Object.hasOwn(types, type.name) || shapes.has(type.name)) return
    const { params = [], constructors } = types[type.name]
    shapes.set(type.name, [params, constructors.map(ctor => [ctor.name, ctor.fields.map(field => [field.name, field.type])])])
    for (const ctor of constructors) for (const field of ctor.fields) collect(field.type)
  }
  collect(model); collect(message)
  return {
    key: `${LEGACY_GAME_KEY}:v2:${encodeURIComponent(projectId)}:${encodeURIComponent(entry)}`,
    schema: JSON.stringify([showType(model), showType(message), [...shapes.keys()].sort().map(name => [name, shapes.get(name)])]),
  }
}

function read(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null') }
  catch { return null }
}

function isSnapshot(saved) {
  return saved && Object.hasOwn(saved, 'model') && Array.isArray(saved.log) &&
    Number.isFinite(saved.time) && saved.time >= 0 && Number.isFinite(saved.savedAt)
}

export function readGameSave(storage, slot) {
  const saved = read(storage, slot.key)
  return isSnapshot(saved) && saved.schema === slot.schema ? saved : null
}

export function writeGameSave(storage, slot, snapshot, savedAt = Date.now()) {
  try { storage.setItem(slot.key, JSON.stringify({ ...snapshot, savedAt, schema: slot.schema })) }
  catch { /* Storage is optional while playing. */ }
}

const numeric = new Set(['Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational'])
const whole = new Set(['Int', 'Integer', 'Word', 'Natural'])
const stdGen = [{ name: 'StdGen', fields: [tcon('Int')] }]

function matchesValue(value, type, types) {
  // The old slot had no owner or schema. Validate its actual constructors and
  // fields before migrating it from the old autosaved project.
  const work = [[value, type]]
  while (work.length) {
    const [current, expected] = work.pop()
    const args = []
    let head = expected
    while (head.kind === 'app') { args.unshift(head.arg); head = head.fn }
    if (head.kind !== 'con') return false
    const name = head.name
    if (numeric.has(name)) {
      if (typeof current !== 'number' || (whole.has(name) && !Number.isInteger(current)) ||
          ((name === 'Word' || name === 'Natural') && current < 0)) return false
      continue
    }
    if (name === 'Bool' || name === 'Char') {
      if (name === 'Bool' ? typeof current !== 'boolean' : typeof current !== 'string' || [...current].length !== 1) return false
      continue
    }
    if (current?.kind !== 'data' || current.type !== name || !Array.isArray(current.args)) return false
    const decl = Object.hasOwn(types, name) ? types[name] : null
    const builtins = Object.hasOwn(BUILTIN_SHAPES, name) ? BUILTIN_SHAPES[name] : name === 'StdGen' ? stdGen : null
    const ctor = (decl?.constructors || builtins)?.[current.ctorIndex]
    if (!ctor || ctor.name !== current.ctor || ctor.fields.length !== current.args.length) return false
    const params = decl?.params || ['$a', '$b'].slice(0, args.length)
    if (params.length !== args.length) return false
    const substitution = new Map(params.map((param, i) => [param, args[i]]))
    ctor.fields.forEach((field, i) => work.push([current.args[i], applySubst(substitution, decl ? field.type : field)]))
  }
  return true
}

export function migrateLegacyGame(storage, slot, { entry, model, message, types }) {
  const saved = read(storage, LEGACY_GAME_KEY)
  if (!isSnapshot(saved) || saved.entry !== entry || saved.modelType !== showType(model) || readGameSave(storage, slot)) return
  if (!matchesValue(saved.model, model, types) || !saved.log.every(value => matchesValue(value, message, types))) return
  writeGameSave(storage, slot, { model: saved.model, log: saved.log, time: saved.time }, saved.savedAt)
}
