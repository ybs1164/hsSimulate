// How the game courses are graded, past "the template passes"
// (gameCourses.test.js): wrong declarations and wrong rules are caught,
// a build over the project's types asks for them first, and test values
// can be applications, constructors of the Prelude, and arguments past a
// function's own parameters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gradeBuild, gradeDeclare, gradeTypeAnswer } from '../src/grader.js'
import { BLACKJACK_TYPES } from '../src/examples/blackjack.js'
import { declareTypes } from '../src/typeDecls.js'
import { HELPERS, courseProject, exercisesOf, failed, withTypes } from './courseHarness.js'

const ex = (course, id) => exercisesOf(course).find((e) => e.id === id)

test('a declaration with the constructors out of order, a missing field or no Eq fails', () => {
  const swapped = declareTypes({}, 'data Phase = Won | Playing | Lost | Push deriving (Eq, Show)')
  assert.deepEqual(failed(gradeDeclare(ex('blackjack', 'bj-phase'), swapped)).map((c) => c.id), ['constructors'])
  const noEq = declareTypes({}, 'data Phase = Playing | Won | Lost | Push deriving (Show)')
  assert.deepEqual(failed(gradeDeclare(ex('blackjack', 'bj-phase'), noEq)).map((c) => c.id), ['deriving'])
  const short = declareTypes({}, 'data Phase = Playing | Won | Lost | Push deriving (Eq, Show)\ndata Model = Model { deck :: [Int], player :: [Int], dealer :: [Int], gen :: StdGen, phase :: Phase, wins :: Int } deriving (Show)')
  assert.deepEqual(failed(gradeDeclare(ex('blackjack', 'bj-model'), short)).map((c) => c.id), ['fields0'])
  assert.deepEqual(failed(gradeDeclare(ex('blackjack', 'bj-model'), {})).map((c) => c.id), ['exists'])
})

test('a field-carrying constructor is compared by its field (data Msg = Throw Hand)', () => {
  const wrong = declareTypes({}, 'data Hand = Rock | Paper | Scissors deriving (Eq, Show)\ndata Msg = Throw Int deriving (Eq, Show)')
  assert.deepEqual(failed(gradeDeclare(ex('rps', 'rps-msg'), wrong)).map((c) => c.id), ['fields0'])
})

test('a build over Model asks for the types first', () => {
  const project = courseProject('blackjack', { typeSource: 'data Unused = Unused', overrides: { isPlaying: HELPERS.blackjack.handSum } })
  const r = gradeBuild(ex('blackjack', 'bj-isplaying'), project)
  assert.deepEqual(failed(r).map((c) => c.id), ['types'])
  assert.match(failed(r)[0].detail, /Model, Phase/)
})

test('a rule that computes the wrong thing fails its test (the dealer never draws)', () => {
  const project = courseProject('blackjack', { overrides: { dealerPlay: [['m'], [], 'm'] } })
  withTypes(project.types, () => {
    const r = gradeBuild(ex('blackjack', 'bj-dealerplay'), project)
    assert.ok(failed(r).some((c) => c.id === 'test0'), JSON.stringify(r.checks))
    assert.match(r.checks.find((c) => c.id === 'test0').label, /^dealer \(dealerPlay \(Model /)
  })
})

test('a type question about a declared type needs the declaration', () => {
  const r = gradeTypeAnswer(ex('blackjack', 'bj-casephase-type'), 'r -> r -> r -> r -> Phase -> r', () => null)
  assert.ok(!r.ok)
  withTypes(declareTypes({}, BLACKJACK_TYPES), () => assert.ok(gradeTypeAnswer(ex('blackjack', 'bj-casephase-type'), 'x -> x -> x -> x -> Phase -> x', () => null).ok))
})

test('a function returning a function: one parameter, and the test applies what it returns', () => {
  const project = courseProject('damage')
  withTypes(project.types, () => {
    const r = gradeBuild(ex('damage', 'dm-weapon'), project)
    assert.equal(r.checks.find((c) => c.id === 'arity').detail, 'b')
    assert.equal(r.checks.find((c) => c.id === 'test0').label, 'weapon True 10 == 15')
    assert.ok(r.ok, JSON.stringify(failed(r)))
  })
  // Naming both parameters is a different definition from the one asked for.
  const both = courseProject('damage', { overrides: { weapon: [['b', 'x'], [], 'x'] } })
  withTypes(both.types, () => assert.deepEqual(failed(gradeBuild(ex('damage', 'dm-weapon'), both)).map((c) => c.id), ['arity']))
})

test("test values may use the Prelude's Just and Nothing, and results read back their characters", () => {
  const project = courseProject('rps')
  withTypes(project.types, () => {
    const r = gradeBuild(ex('rps', 'rps-handtext'), project)
    assert.ok(r.ok, JSON.stringify(failed(r)))
    assert.equal(r.checks.find((c) => c.id === 'test0').label, 'handText Nothing == "—"')
  })
  const wrong = courseProject('rps', { overrides: { handText: [['mh'], [], 'mh'] } })
  withTypes(wrong.types, () => {
    const r = gradeBuild(ex('rps', 'rps-handtext'), wrong)
    assert.ok(failed(r).length)
  })
})
