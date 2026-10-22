// The Functor, Applicative and Monad laws, checked on the builtin
// containers: List, Maybe, `Either e` and the writer `(,) w`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { checkClassLaws } from '../src/laws.js'
import { tapp, tcon, tlist } from '../src/typeSystem.js'

const ctx = { ev: createEvaluator({ nodes: {}, functionBodies: {}, types: {} }), types: {} }
const Int = tcon('Int')
const CONTAINERS = {
  List: tcon('List'),
  Maybe: tcon('Maybe'),
  'Either Int': tapp(tcon('Either'), Int),
  '((,) [Int])': tapp(tcon('(,)'), tlist(Int)), // the writer, logging into a list
}

for (const [name, f] of Object.entries(CONTAINERS)) {
  test(`${name}: the Functor, Applicative and Monad laws hold`, () => {
    const r = checkClassLaws('Monad', f, ctx)
    assert.equal(r.skipped, null)
    assert.deepEqual(r.results.map((x) => x.cls), ['Functor', 'Functor', 'Applicative', 'Applicative', 'Applicative', 'Applicative', 'Monad', 'Monad', 'Monad'])
    for (const law of r.results) assert.ok(law.ok, `${law.cls}: ${law.law} @ ${law.counterexample}`)
  })
}

test('a Functor alone is checked for the Functor laws only', () => {
  const r = checkClassLaws('Functor', tcon('Maybe'), ctx)
  assert.deepEqual(r.results.map((x) => x.law), ['identity: fmap id m = m', 'composition: fmap (g . h) m = fmap g (fmap h m)'])
  assert.ok(r.results.every((x) => x.ok))
})

test('a container with no samples is skipped, not failed', () => {
  const r = checkClassLaws('Monad', tapp(tcon('State'), Int), ctx)
  assert.match(r.skipped, /can't build samples/)
})
