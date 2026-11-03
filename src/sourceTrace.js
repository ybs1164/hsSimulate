import { observeThunk } from './evaluator.js'

export const SOURCE_DEBUG_STEPS = 4000
const MAX_VALUE_REFERENCES = 10000

// Capture identities and settle notifications, never demand a runtime value.
// The timeline contains plain data and is independent of the result preview.
export function createSourceTrace(limit = SOURCE_DEBUG_STEPS) {
  const steps = [], identities = new WeakMap()
  let pending = [], references = 0, omitted = 0, valuesOmitted = false

  function reference(value, depth = 0) {
    if (value === null) return { open: true }
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (!value || typeof value !== 'object') return { omitted: true }
    if (identities.has(value)) return { ref: identities.get(value) }
    if (depth >= 110 || references >= MAX_VALUE_REFERENCES) {
      valuesOmitted = true
      return { omitted: true }
    }
    const ref = ++references
    identities.set(value, ref)
    const child = item => reference(item, depth + 1)
    if (observeThunk(value, (settled, failed) => {
      if (steps.length < limit) pending.push([ref, failed ? { failed: true } : child(settled)])
    })) return { ref }
    let snapshot
    if (value.kind === 'data' && value.type === 'List') {
      snapshot = value.ctorIndex === 0 ? { nil: true } : { cell: value.args.map(child) }
    } else if (value.kind === 'closure') {
      snapshot = { callee: value.callee, captures: value.args.slice(0, 100).map(child) }
    } else snapshot = { omitted: true }
    pending.push([ref, snapshot])
    return { ref }
  }

  return {
    record({ args, value, ...event }) {
      if (steps.length >= limit) { omitted++; return }
      if (args) event.args = args.map(argument => reference(argument))
      if (value !== undefined) event.value = reference(value)
      if (event.message) event.message = event.message.slice(0, 400)
      event.values = pending
      pending = []
      steps.push(event)
    },
    finish() { return { steps, omitted, valuesOmitted } },
  }
}
