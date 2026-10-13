import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeclError, declToDraft, declareTypes, draftToSource } from '../src/typeDecls.js'

const roundTrip = (source) => {
  const types = declareTypes({}, source)
  const name = Object.keys(types)[0]
  const again = declareTypes({}, draftToSource(declToDraft(types[name])))
  assert.deepEqual(again[name].constructors, types[name].constructors)
  assert.deepEqual(again[name].deriving.flatMap((c) => c.classes).sort(), types[name].deriving.flatMap((c) => c.classes).sort())
}

test('a declaration survives being edited as constructor functions and turned back into source', () => {
  roundTrip('data Model = Model { clicks :: Double, log :: [String], f :: Double -> Double }')
  roundTrip('data Event = Click | Tick Double | Buy (Maybe Int) deriving stock (Eq, Show)')
  roundTrip('data W = W { a :: Double } deriving stock (Eq) deriving anyclass (AddSemigroup, AddMonoid, PartialOrd)')
  roundTrip('data M = M { s :: Sum Double } deriving (Semigroup, Monoid) via Generically M')
  roundTrip('newtype Score = Score Int deriving newtype (Eq, Ord)')
})

test('a new type starts as one constructor with no fields', () => {
  assert.equal(draftToSource(declToDraft(null)), 'data NewType = NewType')
})

test('fields must be all named (a record) or all unnamed', () => {
  const draft = { name: 'P', keyword: 'data', constructors: [{ name: 'P', fields: [{ name: 'x', type: 'Int' }, { name: '', type: 'Int' }] }], deriving: { stock: [], anyclass: [], via: [], newtype: [] } }
  assert.throws(() => draftToSource(draft), DeclError)
})
