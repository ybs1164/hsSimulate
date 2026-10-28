import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceWidthRange, storedWorkspaceWidth } from '../src/workspaceResize.js'

test('Workspace upper bound leaves room for adjacent panels and a usable canvas', () => {
  assert.deepEqual(workspaceWidthRange(1280, 190 + 190 + 220 + 360, 180), { min: 160, max: 320 })
  assert.deepEqual(workspaceWidthRange(1440, 220 + 220 + 250 + 360, 200), { min: 160, max: 390 })
  assert.deepEqual(workspaceWidthRange(1920, 220 + 220 + 250 + 360, 200), { min: 160, max: 520 })
})
test('collapsed panels and a closed Inspector can release space for Workspace', () => {
  assert.equal(workspaceWidthRange(1280, 44 + 190 + 220 + 360, 180).max, 466)
  assert.equal(workspaceWidthRange(1280, 44 + 44 + 220 + 360, 180).max, 520)
  assert.equal(workspaceWidthRange(1280, 190 + 190 + 360, 180).max, 520)
})
test('an overflowing narrow layout preserves its responsive default and usable minimum', () => {
  assert.deepEqual(workspaceWidthRange(1050, 960, 180), { min: 160, max: 180 })
  assert.deepEqual(workspaceWidthRange(390, 910, 160), { min: 160, max: 160 })
})
test('shrinking then growing the viewport clamps without destroying the saved preference', () => {
  const preferred = storedWorkspaceWidth('480')
  const effective = (available, reserved, initial) => Math.max(160, Math.min(preferred, workspaceWidthRange(available, reserved, initial).max))
  assert.equal(effective(1920, 1050, 200), 480)
  assert.equal(effective(1280, 960, 180), 320)
  assert.equal(effective(1920, 1050, 200), 480)
})
test('missing or invalid preference does not override the default', () => {
  for (const value of [null, '', '  ', 'null', 'undefined', '{}', 'NaN', 'Infinity', '-10', '0', '300px']) assert.equal(storedWorkspaceWidth(value), null)
  assert.equal(storedWorkspaceWidth('320.5'), 320.5)
  assert.equal(storedWorkspaceWidth('10000'), 10000) // current viewport limits apply separately
})
