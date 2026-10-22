// The builtin functions as the reorganized classes show them: grouped like
// the Prelude, every class in a palette group, and (-) written as Num's
// default x + negate y.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_GROUPS, CLASS_GROUPS, CLASS_NOTES } from '../src/classGroups.js'
import { builtinSchemes } from '../src/builtinSchemes.js'
import { buildDefinitionView } from '../src/definitionViews.js'
import { printDefinition } from '../src/haskellPrint.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { classNames } from '../src/prelude.js'
import { showValue } from '../src/evaluator.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { preludeDefs } from '../src/library.js'
import { showQual } from '../src/typeSystem.js'

const fn = (id, label, params) => ({ id, type: 'function', builtin: id, label, params, mounted: params.map(() => null) })
const defs = {
  ...preludeDefs,
  plus: fn('plus', '(+)', ['x', 'y']), minus: fn('minus', '(-)', ['x', 'y']), negate: fn('negate', 'negate', ['x']),
}

test('every builtin function sits in exactly one group, and every builtin class in the palette', () => {
  const ids = BUILTIN_GROUPS.flatMap((g) => g.ids)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.ok(builtinSchemes[id === 'add' ? 'succ' : id], id)
  // What nothing calls, and the Int-only duplicates of (==) 0 and select, start folded.
  const advanced = BUILTIN_GROUPS.filter((g) => g.advanced).flatMap((g) => g.ids).sort()
  assert.deepEqual(advanced, ['add', 'addZero', 'ifThenElse', 'isZero', 'mulOne', 'sqrt', 'zero'])
  const listed = new Set(CLASS_GROUPS.flatMap((g) => g.names))
  for (const cls of classNames()) assert.ok(listed.has(cls), `${cls} has no palette group`)
  // The pieces of Num (what (+), (*) and their identities ask for) are explained, not hidden.
  const pieces = CLASS_GROUPS.find((g) => g.group.includes('pieces of Num'))
  assert.ok(pieces && !pieces.advanced)
  for (const cls of pieces.names) assert.ok(CLASS_NOTES[cls], cls)
})

test('(-) is written as x + negate y, of its declared type, and means what the builtin does', () => {
  const view = buildDefinitionView(defs.minus, (x) => defs[x])
  assert.equal(printDefinition(view.viewId, { ...defs, ...view.defs }, view.bodies), '(-) x y = x + negate y')
  const pass = inferGraph({ ...defs, ...view.defs }, view.bodies, { v: view.defs[view.viewId] })
  const declared = view.defs[view.viewId].scheme
  assert.equal(showQual(pass.perNode.get('v').preds, valueTypeOfEntry(pass.perNode.get('v'))), showQual(declared.preds, declared.type))
  const ev = createEvaluator({ nodes: { ...defs, ...view.defs }, functionBodies: view.bodies })
  const call = (callee) => ({ out: { id: 'out', type: 'function', sourceFunctionId: callee, params: ['10', '3'], mounted: [null, null] } })
  assert.equal(showValue(ev.run(call(view.viewId), 'out')), '7')
  assert.equal(showValue(ev.run(call('minus'), 'out')), '7')
})
