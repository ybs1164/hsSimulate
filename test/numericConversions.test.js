// Conversions in and out of the numeric tower on user types. Out is a
// method on the source side (toInteger, toRational, round, sqrt),
// hand-written or newtype-derived; in is fromInteger, the unique ring map
// from ℤ — `fromIntegral = fromInteger . toInteger` — built by the Ring
// dictionary of the result's type, which the type pass found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTypedEvaluator } from '../src/typedEvaluator.js'
import { inferGraph } from '../src/inferGraph.js'
import { checkClassLaws } from '../src/laws.js'
import { classClosure, setDynamicInstances } from '../src/prelude.js'
import { classEnvironment, declareClasses } from '../src/classDecls.js'
import { DeclError, declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { setUserTypeArities, tcon } from '../src/typeSystem.js'

const one = (head, methods = {}) => ({ head, context: [], methods })
const ADDITIVE = ['AddSemigroup', 'AddMonoid', 'AddCommutativeMonoid', 'AddGroup', 'AddAbelianGroup']
const RING = [...ADDITIVE, 'MulSemigroup', 'MulMonoid', 'Semiring', 'Ring']
const n = (id) => ({ node: id })

// A project over `types` and hand-written `instances`: builtins, derived functions, custom functions; runs through the type pass.
function project(types, instances = {}) {
  setUserTypeArities({})
  setDynamicInstances([...derivedInstances(types), ...classEnvironment(declareClasses({}, types, [], instances)).instances])
  const builtin = (b) => ({ id: b, type: 'function', builtin: b, label: b, params: ['x'], mounted: [null] })
  const main = {}
  const defs = Object.fromEntries(['fromIntegral', 'toInteger', 'toRational', 'round', 'sqrt', 'plus', 'times', 'geq', 'eq', 'negate', 'mulOne', 'div', 'mod'].map((b) => [b, builtin(b)]))
  derivedDefinitions(types).forEach((d) => { defs[d.label] = d })
  const registry = new Proxy({}, { get: (_, id) => main[id] ?? defs[id] })
  const bodies = {}
  const call = (id, callee, slots = []) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
  const define = (name, params, body, out) => {
    main[name] = { id: name, type: 'function', label: name, params, mounted: params.map(() => null), custom: true }
    bodies[name] = Object.fromEntries([...params.map((p) => ({ id: p, type: 'parameter', label: p })), ...body, { id: 'output', type: 'output', source: out }].map((x) => [x.id, x]))
  }
  const evaluator = () => createTypedEvaluator({ nodes: registry, functionBodies: bodies, types, instances })
  const run = (graphNodes, id) => {
    Object.assign(main, Object.fromEntries(graphNodes.map((x) => [x.id, x])))
    try {
      return { v: evaluator().run(main, id), pass: inferGraph(registry, bodies, main) }
    } finally {
      graphNodes.forEach((x) => delete main[x.id])
    }
  }
  return { call, define, run, get ev() { return evaluator() } }
}

// ---- Out of the tower: methods on the source side -------------------------

// A score: an ordered ring whose embedding into ℤ is hand-written.
function score(intBody = 'points') {
  const types = declareTypes({}, `data Score = Score { points :: Int } deriving stock (Eq, Ord, Show) deriving anyclass (${RING.join(', ')})`)
  const instances = { OrderedRing: [one('Score', { toRational: 'ratScore' })], EuclideanRing: [one('Score', { toInteger: 'intScore', div: 'divScore', mod: 'modScore' })] }
  const p = project(types, instances)
  p.define('ratScore', ['s'], [p.call('k', 'points', [n('s')]), p.call('out', 'toRational', [n('k')])], 'out')
  for (const op of ['div', 'mod']) p.define(`${op}Score`, ['x', 'y'], [p.call('a', 'points', [n('x')]), p.call('b', 'points', [n('y')]), p.call('q', op, [n('a'), n('b')]), p.call('out', 'Score', [n('q')])], 'out')
  if (intBody === 'points') p.define('intScore', ['s'], [p.call('k', 'points', [n('s')]), p.call('out', 'toInteger', [n('k')])], 'out')
  if (intBody === 'double') p.define('intScore', ['s'], [p.call('k', 'points', [n('s')]), p.call('i', 'toInteger', [n('k')]), p.call('out', 'times', [n('i'), '2'])], 'out')
  if (intBody === 'half') p.define('intScore', ['s'], [p.call('out', 'toRational', ['2.5'])], 'out')
  return { types, instances, p }
}

test('the classes the conversions belong to can be written by hand', () => {
  const { types, instances } = score()
  assert.deepEqual(declareClasses({}, types, [], instances).written.map((i) => i.cls), ['OrderedRing', 'EuclideanRing'])
  // Still Haskell's rules: an instance needs its superclasses.
  const bare = declareTypes({}, 'data Money = Money Int deriving stock (Eq, Ord)')
  setDynamicInstances(derivedInstances(bare))
  assert.throws(() => declareClasses({}, bare, [], { EuclideanRing: [one('Money')] }), (e) => e instanceof DeclError && /needs an \w+ instance/.test(e.message))
  setDynamicInstances([])
})

test('fromIntegral and toRational go through a hand-written instance', () => {
  const { p } = score()
  const at = (callee) => p.run([p.call('s', 'Score', ['7']), p.call('f', callee, [n('s')])], 'f').v
  assert.equal(at('fromIntegral'), 7)
  assert.equal(at('toInteger'), 7)
  assert.equal(at('toRational'), 7)
})

test('toInteger must give an Integer: a function giving a Rational has the wrong type', () => {
  const { p } = score('half')
  assert.throws(() => p.run([p.call('s', 'Score', ['7']), p.call('f', 'fromIntegral', [n('s')])], 'f'), /toInteger for EuclideanRing Score: its function has the wrong type/)
})

test('the law checker checks the conversions: ring maps, faithful, agreeing', () => {
  const good = score()
  const { results } = checkClassLaws('EuclideanRing', tcon('Score'), { ev: good.p.ev, types: good.types })
  const conversions = results.filter((r) => ['OrderedRing', 'EuclideanRing'].includes(r.cls))
  assert.equal(conversions.length, 6)
  assert.ok(conversions.every((r) => r.ok), JSON.stringify(conversions.filter((r) => !r.ok)))
  // toInteger s = 2 · points s respects + but not *, nor agrees with toRational.
  const bad = score('double')
  const broken = checkClassLaws('EuclideanRing', tcon('Score'), { ev: bad.p.ev, types: bad.types }).results
  assert.ok(broken.some((r) => !r.ok && /toInteger is a ring map/.test(r.law)))
  assert.ok(broken.some((r) => !r.ok && /toRational x = fromInteger/.test(r.law)))
  setDynamicInstances([])
})

test("a newtype's derived conversions are its field's", () => {
  const classes = [...new Set(['Eq', 'Ord', 'Show', ...classClosure('IEEEFloat')])]
  const types = declareTypes({}, `newtype Meters = Meters Double deriving newtype (${classes.join(', ')})`)
  const p = project(types)
  const at = (callee, x) => p.run([p.call('m', 'Meters', [x]), p.call('f', callee, [n('m')])], 'f').v
  assert.equal(at('round', '2.5'), 2, 'halves to even, as Haskell')
  assert.equal(at('toRational', '1.5'), 1.5)
  assert.deepEqual(at('sqrt', '9').args, [3], 'sqrt stays in Meters')
  setDynamicInstances(derivedInstances(types))
  const { results } = checkClassLaws('IEEEFloat', tcon('Meters'), { ev: p.ev, types })
  assert.ok(results.length && results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)))
  setDynamicInstances([])
})

// ---- Into the tower: fromInteger, the unique ring map from ℤ --------------

// Cents: its one is a hundred cents, so the integer 3 is Cents 300.
function cents() {
  const types = declareTypes({}, `data Cents = Cents { cents :: Int } deriving stock (Eq, Show) deriving anyclass (${ADDITIVE.join(', ')})`)
  const p = project(types, { MulSemigroup: [one('Cents', { times: 'timesCents' })], MulMonoid: [one('Cents', { mulOne: 'oneCents' })], Semiring: [one('Cents')], Ring: [one('Cents')] })
  p.define('oneCents', [], [p.call('out', 'Cents', ['100'])], 'out')
  p.define('timesCents', ['x', 'y'], [p.call('a', 'cents', [n('x')]), p.call('out', 'Cents', [n('a')])], 'out') // (not lawful — never called here)
  return p
}

test("a conversion into a user type gets that type's Ring dictionary, and is built by its fromInteger", () => {
  const p = cents()
  // cents (fromIntegral 3): the result of fromIntegral is Cents; the 3 defaults to an Integer.
  const graph = [p.call('f', 'fromIntegral', ['3']), p.call('c', 'cents', [n('f')])]
  const { v, pass } = p.run(graph, 'f')
  assert.deepEqual(pass.elaboration.main.f, [{ inst: 'EuclideanRing@Integer', sub: [] }, { inst: 'Ring@Cents', sub: [] }])
  assert.equal(v.type, 'Cents')
  assert.deepEqual(v.args, [300], '3 · mulOne = 3 · Cents 100')
  assert.equal(p.run(graph, 'c').v, 300)
})

test('a conversion into a number type gets its dictionary; a polymorphic one takes it as a parameter', () => {
  const p = cents()
  const toDouble = p.run([p.call('f', 'fromIntegral', ['3']), p.call('r', 'sqrt', [n('f')])], 'r')
  assert.deepEqual(toDouble.pass.elaboration.main.f, [{ inst: 'EuclideanRing@Integer', sub: [] }, { inst: 'Ring@Double', sub: [] }])
  assert.equal(toDouble.v, Math.sqrt(3))
  // grow n = fromIntegral n — polymorphic in its result: (EuclideanRing a, Ring b) ⇒ a → b, both dictionaries its parameters.
  p.define('grow', ['k'], [p.call('out', 'fromIntegral', [n('k')])], 'out')
  const { v, pass } = p.run([p.call('g', 'grow', ['4']), p.call('c', 'cents', [n('g')])], 'c')
  assert.equal(pass.elaboration.functions.grow.params, 2)
  assert.deepEqual(pass.elaboration.functions.grow.nodes.out, [{ param: 0 }, { param: 1 }])
  assert.equal(v, 400, 'Cents 400: the caller passed Cents\' Ring')
})
