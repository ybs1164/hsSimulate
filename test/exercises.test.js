// The practice course: every exercise's expected types parse, the type
// answers are compared as types (renaming, entailment), and each build
// exercise has a reference solution that passes — while a wrong signature,
// a body of the wrong type or a wrong result each fail their own check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ALL_EXERCISES } from '../src/exerciseContent.js'
import { acceptedTypes, compareQual, gradeBuild, gradeChoice, gradeTypeAnswer, parseQualType } from '../src/grader.js'
import { builtinSchemes } from '../src/builtinSchemes.js'
import { buildProject, call, n, P, ref } from '../src/examples/build.js'
import { libraryDefs } from '../src/library.js'
import { registryOf } from './curriculumHarness.js'

const ex = (id) => ALL_EXERCISES.find((e) => e.id === id)
const schemeOf = (name) => builtinSchemes[name]

// Reference solutions: [params, body nodes, output source].
const SOLUTIONS = {
  double: [['x'], [call('out', 'times', '(*)', [n('x'), '2'])], 'out'],
  square: [['x'], [ref('x2', 'x'), call('out', 'times', '(*)', [n('x'), n('x2')])], 'out'],
  average: [['x', 'y'], [call('s', 'plus', '(+)', [n('x'), n('y')]), call('out', 'divide', '(/)', [n('s'), '2'])], 'out'],
  lastDigit: [['n'], [call('out', P('mod'), 'mod', [n('n'), '10'])], 'out'],
  nand: [['p', 'q'], [call('a', P('and'), '(&&)', [n('p'), n('q')]), call('out', P('not'), 'not', [n('a')])], 'out'],
  xor: [['p', 'q'], [call('out', P('neq'), '(/=)', [n('p'), n('q')])], 'out'],
  inRange: [['x'], [ref('x2', 'x'), call('lo', 'geq', '(>=)', [n('x'), '1']), call('hi', P('le'), '(<=)', [n('x2'), '10']), call('out', P('and'), '(&&)', [n('lo'), n('hi')])], 'out'],
  prependZero: [['xs'], [call('out', P('cons'), '(:)', ['0', n('xs')])], 'out'],
  total: [['xs'], [call('out', P('sum'), 'sum', [n('xs')])], 'out'],
  doubleAll: [['xs'], [call('d', 'times', '(*)', ['', '2']), call('out', P('map'), 'map', [n('d'), n('xs')])], 'out'],
  countPositive: [['xs'], [call('pos', P('gt'), '(>)', ['', '0']), call('f', P('filter'), 'filter', [n('pos'), n('xs')]), call('out', P('length'), 'length', [n('f')])], 'out'],
  isPalindrome: [['s'], [ref('s2', 's'), call('r', P('reverse'), 'reverse', [n('s2')]), call('out', 'eq', '(==)', [n('s'), n('r')])], 'out'],
}

// The signature as the body's annotations: one per parameter, then the result's.
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

function grade(exercise, solution, { sig = sigOf(exercise.signature) } = {}) {
  const project = buildProject('data Unused = Unused', { [exercise.name]: [...solution, sig] })
  return gradeBuild(exercise, { registry: { ...libraryDefs, ...registryOf(project) }, functionBodies: project.functionBodies, userNodes: project.nodes, types: project.types })
}
const failed = (result) => result.checks.filter((c) => !c.ok).map((c) => c.id)

test('every expected type parses, and every exercise is well-formed', () => {
  for (const e of ALL_EXERCISES) {
    if (e.kind === 'type') assert.ok(acceptedTypes(e, schemeOf).length >= 1, e.id)
    if (e.kind === 'build') { parseQualType(e.signature); assert.ok(SOLUTIONS[e.name], `a solution for ${e.name}`); assert.ok(e.tests.length, e.id) }
    if (e.kind === 'choice') assert.equal(e.options.filter((o) => o.correct).length, 1, e.id)
  }
})

test('type answers are compared as types: renaming, spacing, arrows, String = [Char]', () => {
  assert.ok(gradeTypeAnswer(ex('arith-plus-type'), 'Num b => b -> b -> b', schemeOf).ok)
  assert.ok(gradeTypeAnswer(ex('arith-plus-type'), 'Num a ⇒ a → a → a', schemeOf).ok)
  assert.ok(gradeTypeAnswer(ex('lists-string-type'), '[Char]', schemeOf).ok)
  assert.ok(gradeTypeAnswer(ex('lists-map-type'), '(x -> y) -> [x] -> [y]', schemeOf).ok)
  assert.ok(gradeTypeAnswer(ex('lists-length-type'), 'Foldable f => f x -> Int', schemeOf).ok)
})

test("the app's finer classes count too: (+) needs only AddSemigroup", () => {
  const r = gradeTypeAnswer(ex('arith-plus-type'), 'AddSemigroup a => a -> a -> a', schemeOf)
  assert.ok(r.ok, r.message)
})

test('wrong type answers say what is wrong', () => {
  const plus = ex('arith-plus-type')
  assert.match(gradeTypeAnswer(plus, 'a -> a -> a', schemeOf).message, /제약이 부족/)
  assert.match(gradeTypeAnswer(plus, 'Num a => a -> a', schemeOf).message, /인자 개수/)
  assert.match(gradeTypeAnswer(plus, '(Num a, Show a) => a -> a -> a', schemeOf).message, /필요 없는 제약/)
  assert.match(gradeTypeAnswer(ex('lists-map-type'), 'a -> b -> [a] -> [b]', schemeOf).message, /인자 개수/)
  assert.match(gradeTypeAnswer(ex('logic-eq-type'), 'Eq a => a -> a -> a', schemeOf).message, /모양/)
  assert.ok(!gradeTypeAnswer(ex('lists-cons-type'), 'a -> [b] -> [a]', schemeOf).ok)
  assert.match(gradeTypeAnswer(plus, 'a ->', schemeOf).message, /읽을 수 없/)
  assert.ok(!gradeTypeAnswer(plus, '', schemeOf).ok)
})

test('a constraint implied by another one is the same type (Ord a entails Eq a)', () => {
  const a = parseQualType('(Eq a, Ord a) => a -> a -> Bool')
  assert.ok(compareQual(a, parseQualType('Ord a => a -> a -> Bool')).ok)
})

test('choices', () => {
  const e = ex('arith-error')
  assert.ok(gradeChoice(e, e.options.findIndex((o) => o.correct)).ok)
  assert.ok(!gradeChoice(e, 0).ok)
  assert.ok(!gradeChoice(e, null).ok)
})

test('every build exercise passes with its reference solution', () => {
  for (const e of ALL_EXERCISES.filter((x) => x.kind === 'build')) {
    const r = grade(e, SOLUTIONS[e.name])
    assert.deepEqual(failed(r), [], `${e.name}: ${JSON.stringify(r.checks.filter((c) => !c.ok))}`)
  }
})

test('a missing signature fails only the signature check', () => {
  const r = grade(ex('arith-double'), SOLUTIONS.double, { sig: null })
  assert.deepEqual(failed(r), ['signature'])
  assert.match(r.checks.find((c) => c.id === 'signature').detail, /x, 결과/)
})

test('a signature other than the asked one is caught', () => {
  const r = grade(ex('arith-double'), SOLUTIONS.double, { sig: ['Integer', 'Integer'] })
  assert.ok(failed(r).includes('signature'))
  assert.ok(failed(r).includes('type'), 'Integer -> Integer is not usable at Int -> Int')
})

test('a body of the wrong type fails the type check before any test runs', () => {
  // average with div: Double has no Integral instance.
  const wrong = [['x', 'y'], [call('s', 'plus', '(+)', [n('x'), n('y')]), call('out', P('div'), 'div', [n('s'), '2'])], 'out']
  const r = grade(ex('arith-average'), wrong)
  assert.ok(failed(r).includes('typecheck'), JSON.stringify(r.checks))
  assert.ok(!r.checks.some((c) => c.id.startsWith('test')))
  // Without the signature, the body infers Integral a => a -> a -> a — which Double can't be.
  const r2 = grade(ex('arith-average'), wrong, { sig: null })
  assert.ok(failed(r2).includes('type'), JSON.stringify(r2.checks))
})

test('a body that type-checks but computes the wrong thing fails its tests', () => {
  const r = grade(ex('arith-double'), [['x'], [call('out', 'plus', '(+)', [n('x'), '2'])], 'out'])
  assert.deepEqual(failed(r), ['test0', 'test1', 'test2'])
  assert.match(r.checks.find((c) => c.id === 'test0').detail, /6/)
})

test('a missing function, or the wrong number of parameters', () => {
  const project = buildProject('data Unused = Unused', { other: SOLUTIONS.double })
  const r = gradeBuild(ex('arith-double'), { registry: { ...libraryDefs, ...registryOf(project) }, functionBodies: project.functionBodies, userNodes: project.nodes })
  assert.deepEqual(failed(r), ['exists'])
  const r2 = grade(ex('arith-average'), [['x'], [call('out', 'divide', '(/)', [n('x'), '2'])], 'out'], { sig: null })
  assert.deepEqual(failed(r2), ['arity'])
})

test('an empty body fails before the type checks, and its tests are skipped', () => {
  const r = grade(ex('arith-double'), [['x'], [], null], { sig: null })
  assert.deepEqual(failed(r), ['body'])
  assert.equal(r.skipped, 3)
  assert.equal(grade(ex('arith-double'), SOLUTIONS.double).skipped, 0)
})
