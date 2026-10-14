// Conversions in and out of the numeric tower on user types. Out is a
// method on the source side (toInteger, toRational, round, sqrt),
// hand-written or newtype-derived; in is fromInteger, the unique ring map
// from ℤ — `fromIntegral = fromInteger . toInteger` — built at the user type
// the type pass found for the result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator, elaborationIndex } from '../src/evaluator.js'
import { inferGraph } from '../src/inferGraph.js'
import { checkClassLaws } from '../src/laws.js'
import { classClosure, setDynamicInstances } from '../src/prelude.js'
import { DeclError, declareTypes, declToDraft, derivedDefinitions, derivedInstances, draftToSource } from '../src/typeDecls.js'
import { setUserTypeArities, tcon } from '../src/typeSystem.js'

const withInstances = (types, name, instances) => declareTypes(types, draftToSource(declToDraft(types[name])), { replacing: name, instances })
const ADDITIVE = ['AddSemigroup', 'AddMonoid', 'AddCommutativeMonoid', 'AddGroup', 'AddAbelianGroup']
const RING = [...ADDITIVE, 'MulSemigroup', 'MulMonoid', 'Semiring', 'Ring']
const n = (id) => ({ node: id })

// A project over `types`: builtins, derived functions, custom functions; runs through the type pass.
function project(types) {
  setUserTypeArities({})
  setDynamicInstances(derivedInstances(types))
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
  const evaluator = (pass) => createEvaluator({ nodes: registry, functionBodies: bodies, types, elaboration: () => pass && elaborationIndex(pass.elaboration, main, bodies) })
  const run = (graphNodes, id, { typed = true } = {}) => {
    Object.assign(main, Object.fromEntries(graphNodes.map((x) => [x.id, x])))
    const pass = typed ? inferGraph(registry, bodies, main) : null
    try {
      return { v: evaluator(pass).run(main, id), pass }
    } finally {
      graphNodes.forEach((x) => delete main[x.id])
    }
  }
  return { call, define, run, ev: evaluator(null) }
}

// ---- Out of the tower: methods on the source side -------------------------

// A score: an ordered ring whose embedding into ℤ is hand-written.
function score(intBody = 'points') {
  let types = declareTypes({}, `data Score = Score { points :: Int } deriving stock (Eq, Ord, Show) deriving anyclass (${RING.join(', ')})`)
  types = withInstances(types, 'Score', [{ cls: 'OrderedRing', methods: { toRational: 'ratScore' } }, { cls: 'EuclideanRing', methods: { toInteger: 'intScore', div: 'divScore', mod: 'modScore' } }])
  const p = project(types)
  p.define('ratScore', ['s'], [p.call('out', 'points', [n('s')])], 'out')
  for (const op of ['div', 'mod']) p.define(`${op}Score`, ['x', 'y'], [p.call('a', 'points', [n('x')]), p.call('b', 'points', [n('y')]), p.call('q', op, [n('a'), n('b')]), p.call('out', 'Score', [n('q')])], 'out')
  if (intBody === 'points') p.define('intScore', ['s'], [p.call('out', 'points', [n('s')])], 'out')
  if (intBody === 'double') p.define('intScore', ['s'], [p.call('k', 'points', [n('s')]), p.call('out', 'times', [n('k'), '2'])], 'out')
  if (intBody === 'half') p.define('intScore', ['s'], [p.call('out', 'toRational', ['2.5'])], 'out')
  return { types, p }
}

test('the classes the conversions belong to can be written by hand', () => {
  const { types } = score()
  assert.deepEqual(types.Score.instances.map((i) => i.cls), ['OrderedRing', 'EuclideanRing'])
  // Still Haskell's rules: an instance needs its superclasses.
  const bare = declareTypes({}, 'data Money = Money Int deriving stock (Eq, Ord)')
  assert.throws(() => withInstances(bare, 'Money', [{ cls: 'EuclideanRing', methods: {} }]), (e) => e instanceof DeclError && /needs an \w+ instance/.test(e.message))
})

test('fromIntegral and toRational go through a hand-written instance', () => {
  const { p } = score()
  const at = (callee) => p.run([p.call('s', 'Score', ['7']), p.call('f', callee, [n('s')])], 'f').v
  assert.equal(at('fromIntegral'), 7)
  assert.equal(at('toInteger'), 7)
  assert.equal(at('toRational'), 7)
})

test('toInteger must give a whole number', () => {
  const { p } = score('half')
  assert.throws(() => p.run([p.call('s', 'Score', ['7']), p.call('f', 'fromIntegral', [n('s')])], 'f'), /must give a whole number/)
})

test('the law checker checks the conversions: ring maps, faithful, agreeing', () => {
  const good = score()
  setDynamicInstances(derivedInstances(good.types))
  const { results } = checkClassLaws('EuclideanRing', tcon('Score'), { ev: good.p.ev, types: good.types })
  const conversions = results.filter((r) => ['OrderedRing', 'EuclideanRing'].includes(r.cls))
  assert.equal(conversions.length, 6)
  assert.ok(conversions.every((r) => r.ok), JSON.stringify(conversions.filter((r) => !r.ok)))
  // toInteger s = 2 · points s respects + but not *, nor agrees with toRational.
  const bad = score('double')
  setDynamicInstances(derivedInstances(bad.types))
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
  let types = declareTypes({}, `data Cents = Cents { cents :: Int } deriving stock (Eq, Show) deriving anyclass (${ADDITIVE.join(', ')})`)
  types = withInstances(types, 'Cents', [{ cls: 'MulSemigroup', methods: { times: 'timesCents' } }, { cls: 'MulMonoid', methods: { mulOne: 'oneCents' } }, { cls: 'Semiring', methods: {} }, { cls: 'Ring', methods: {} }])
  const p = project(types)
  p.define('oneCents', [], [p.call('out', 'Cents', ['100'])], 'out')
  p.define('timesCents', ['x', 'y'], [p.call('a', 'cents', [n('x')]), p.call('out', 'Cents', [n('a')])], 'out') // (not lawful — never called here)
  return p
}

test('a conversion into a user type is elaborated with that type, and built by its fromInteger', () => {
  const p = cents()
  // cents (fromIntegral 3): the result of fromIntegral is Cents.
  const graph = [p.call('f', 'fromIntegral', ['3']), p.call('c', 'cents', [n('f')])]
  const { v, pass } = p.run(graph, 'f')
  assert.deepEqual(pass.elaboration.main.f, [{ fromInteger: 'Cents' }])
  assert.equal(v.type, 'Cents')
  assert.deepEqual(v.args, [300], '3 · mulOne = 3 · Cents 100')
  assert.equal(p.run(graph, 'c').v, 300)
  // Untyped, the number stands for the integer and becomes Cents when observed as one.
  assert.equal(p.run(graph, 'f', { typed: false }).v, 3)
  assert.equal(p.run(graph, 'c', { typed: false }).v, 300)
})

test('a conversion into a number type, or a type variable, passes nothing', () => {
  const p = cents()
  const toDouble = p.run([p.call('f', 'fromIntegral', ['3']), p.call('r', 'sqrt', [n('f')])], 'r')
  assert.equal(toDouble.pass.elaboration.main.f, undefined)
  assert.equal(toDouble.v, Math.sqrt(3))
  // grow n = fromIntegral n — polymorphic in its result: Ring b ⇒ … → b.
  p.define('grow', ['k'], [p.call('out', 'fromIntegral', [n('k')])], 'out')
  const { v, pass } = p.run([p.call('g', 'grow', ['4']), p.call('c', 'cents', [n('g')])], 'c')
  assert.deepEqual(pass.elaboration.functions.grow.nodes, {})
  assert.equal(v, 400, 'still Cents 400 once it meets Cents')
})
