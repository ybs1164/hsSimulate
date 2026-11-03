import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceWidthRange, storedWorkspaceWidth } from '../src/workspaceResize.js'

test('Workspace upper bound reserves only Inspector and a usable canvas', () => {
  assert.deepEqual(workspaceWidthRange(900, 200 + 360, 160), { min: 160, max: 340 })
  assert.deepEqual(workspaceWidthRange(1000, 200 + 360, 160), { min: 160, max: 440 })
  assert.deepEqual(workspaceWidthRange(1280, 220 + 360, 180), { min: 160, max: 520 })
})
test('closing Inspector releases its space for Workspace', () => {
  assert.equal(workspaceWidthRange(900, 200 + 360, 160).max, 340)
  assert.equal(workspaceWidthRange(900, 360, 160).max, 520)
})
test('an overflowing narrow layout preserves its responsive default and usable minimum', () => {
  assert.deepEqual(workspaceWidthRange(1050, 960, 180), { min: 160, max: 180 })
  assert.deepEqual(workspaceWidthRange(390, 910, 160), { min: 160, max: 160 })
})
test('shrinking then growing the viewport clamps without destroying the saved preference', () => {
  const preferred = storedWorkspaceWidth('480')
  const effective = (available, reserved, initial) => Math.max(160, Math.min(preferred, workspaceWidthRange(available, reserved, initial).max))
  assert.equal(effective(1440, 610, 200), 480)
  assert.equal(effective(900, 560, 160), 340)
  assert.equal(effective(1440, 610, 200), 480)
})
test('missing or invalid preference does not override the default', () => {
  for (const value of [null, '', '  ', 'null', 'undefined', '{}', 'NaN', 'Infinity', '-10', '0', '300px']) assert.equal(storedWorkspaceWidth(value), null)
  assert.equal(storedWorkspaceWidth('320.5'), 320.5)
  assert.equal(storedWorkspaceWidth('10000'), 10000) // current viewport limits apply separately
})
