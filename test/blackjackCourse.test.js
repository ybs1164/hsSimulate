// The Blackjack course (exerciseContent.js): every exercise is well-formed,
// and graded in one project — the template's types and, as the reference
// solutions, the template's own functions (plus the course's helpers) — each
// build passes, each declaration matches, and a wrong one is caught.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ALL_EXERCISES, EXERCISE_UNITS } from '../src/exerciseContent.js'
import { acceptedTypes, gradeBuild, gradeDeclare, gradeTypeAnswer, parseQualType } from '../src/grader.js'
import { builtinSchemes } from '../src/builtinSchemes.js'
import { BLACKJACK_FUNCTIONS, BLACKJACK_TYPES } from '../src/examples/blackjack.js'
import { buildProject, call, n, P } from '../src/examples/build.js'
import { libraryDefs } from '../src/library.js'
import { declareTypes, derivedInstances, typeArities, typeKinds } from '../src/typeDecls.js'
import { setDynamicInstances } from '../src/prelude.js'
import { setUserTypeArities } from '../src/typeSystem.js'
import { registryOf } from './curriculumHarness.js'

const course = ALL_EXERCISES.filter((e) => EXERCISE_UNITS.find((u) => u.id === e.unit).course === 'blackjack')
const ex = (id) => course.find((e) => e.id === id)

// The course's own helpers; everything else is the template's definition.
const HELPERS = {
  handSum: [['h'], [call('cv', 'cardValue', 'cardValue', ['']), call('vals', P('map'), 'map', [n('cv'), n('h')]), call('out', P('sum'), 'sum', [n('vals')])], 'out'],
  fullDeck: [[], [call('ranks', P('enumFromTo'), 'enumFromTo', ['1', '13']), call('four', P('replicate'), 'replicate', ['4', '']), call('out', P('concatMap'), 'concatMap', [n('four'), n('ranks')])], 'out'],
}

// A signature as annotations: one per parameter, then the result's.
function sigOf(signature) {
  const parts = []
  let depth = 0, start = 0
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && signature.startsWith('->', i)) { parts.push(signature.slice(start, i).trim()); start = i + 2 }
  }
  return [...parts, signature.slice(start).trim()]
}

function courseProject(typeSource = BLACKJACK_TYPES, overrides = {}) {
  const sigs = Object.fromEntries(course.filter((e) => e.kind === 'build').map((e) => [e.name, sigOf(e.signature)]))
  const fns = { ...BLACKJACK_FUNCTIONS, ...HELPERS, ...overrides }
  const project = buildProject(typeSource, Object.fromEntries(Object.entries(fns).map(([name, def]) => [name, [...def.slice(0, 3), sigs[name]]])))
  return { registry: { ...libraryDefs, ...registryOf(project) }, functionBodies: project.functionBodies, userNodes: project.nodes, types: project.types }
}

// With the project's types in scope, as the app sets them.
function withTypes(types, fn) {
  setUserTypeArities(typeArities(types), typeKinds(types))
  setDynamicInstances(derivedInstances(types))
  try { return fn() } finally { setUserTypeArities({}); setDynamicInstances([]) }
}
const failed = (r) => r.checks.filter((c) => !c.ok)

test('the course follows the basics and every exercise is well-formed', () => {
  assert.ok(course.length > 30)
  const project = courseProject()
  withTypes(project.types, () => {
    for (const e of course) {
      if (e.kind === 'type') assert.ok(acceptedTypes(e, (name) => builtinSchemes[name]).length >= 1, e.id)
      if (e.kind === 'build') parseQualType(e.signature)
      if (e.kind === 'choice') assert.equal(e.options.filter((o) => o.correct).length, 1, e.id)
      if (e.kind === 'declare') assert.ok(e.declaration.startsWith('data '), e.id)
    }
  })
})

test("every build passes with the template's functions", () => {
  const project = courseProject()
  withTypes(project.types, () => {
    for (const e of course.filter((x) => x.kind === 'build')) {
      const r = gradeBuild(e, project)
      assert.deepEqual(failed(r), [], `${e.name}: ${JSON.stringify(failed(r))}`)
    }
  })
})

test("the template's declarations pass every declare exercise", () => {
  const types = declareTypes({}, BLACKJACK_TYPES)
  for (const e of course.filter((x) => x.kind === 'declare')) {
    const r = gradeDeclare(e, types)
    assert.deepEqual(failed(r), [], `${e.name}: ${JSON.stringify(failed(r))}`)
  }
})

test('a declaration with the constructors out of order, a missing field or no Eq fails', () => {
  const swapped = declareTypes({}, 'data Phase = Won | Playing | Lost | Push deriving (Eq, Show)')
  assert.deepEqual(failed(gradeDeclare(ex('bj-phase'), swapped)).map((c) => c.id), ['constructors'])
  const noEq = declareTypes({}, 'data Phase = Playing | Won | Lost | Push deriving (Show)')
  assert.deepEqual(failed(gradeDeclare(ex('bj-phase'), noEq)).map((c) => c.id), ['deriving'])
  const short = declareTypes({}, 'data Phase = Playing | Won | Lost | Push deriving (Eq, Show)\ndata Model = Model { deck :: [Int], player :: [Int], dealer :: [Int], gen :: StdGen, phase :: Phase, wins :: Int } deriving (Show)')
  assert.deepEqual(failed(gradeDeclare(ex('bj-model'), short)).map((c) => c.id), ['fields0'])
  assert.deepEqual(failed(gradeDeclare(ex('bj-model'), {})).map((c) => c.id), ['exists'])
})

test('a build over Model asks for the types first', () => {
  const project = courseProject('data Unused = Unused', { isPlaying: HELPERS.handSum })
  const r = gradeBuild(ex('bj-isplaying'), project)
  assert.deepEqual(failed(r).map((c) => c.id), ['types'])
  assert.match(failed(r)[0].detail, /Model, Phase/)
})

test('a rule that computes the wrong thing fails its test (the dealer never draws)', () => {
  const lazy = [['m'], [], 'm']
  const project = courseProject(BLACKJACK_TYPES, { dealerPlay: lazy })
  withTypes(project.types, () => {
    const r = gradeBuild(ex('bj-dealerplay'), project)
    assert.ok(failed(r).some((c) => c.id === 'test0'), JSON.stringify(r.checks))
    assert.match(r.checks.find((c) => c.id === 'test0').label, /^dealer \(dealerPlay \(Model /)
  })
})

test('a type question about a declared type needs the declaration', () => {
  const r = gradeTypeAnswer(ex('bj-casephase-type'), 'r -> r -> r -> r -> Phase -> r', () => null)
  assert.ok(!r.ok)
  const types = declareTypes({}, BLACKJACK_TYPES)
  withTypes(types, () => assert.ok(gradeTypeAnswer(ex('bj-casephase-type'), 'x -> x -> x -> x -> Phase -> x', () => null).ok))
})
