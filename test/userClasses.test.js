// User class declarations, compiled by dictionary passing: the type pass
// picks each call's instance (even with no argument to look at), a
// class-polymorphic function receives the dictionary, instance contexts and
// superclasses chain dictionaries, and class defaults fill missing methods.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classEnvironment, classMethodDefinitions, declareClasses, instanceEvidence, instanceMethodProblem } from '../src/classDecls.js'
import { createEvaluator, elaborationIndex } from '../src/evaluator.js'
import { inferGraph } from '../src/inferGraph.js'
import { setDynamicClasses, setDynamicInstances } from '../src/prelude.js'
import { DeclError, declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { scheme, setUserTypeArities, showType, tcon, tfun, tlist, tvar } from '../src/typeSystem.js'

const types = declareTypes({}, 'data Money = Money { cents :: Int } deriving stock (Show)')

const CLASSES = {
  Pretty: {
    name: 'Pretty', param: 'a', supers: [],
    methods: [{ name: 'pretty', sig: 'a -> String', default: null }, { name: 'defaultValue', sig: 'a', default: null }],
    instances: [
      { head: 'Money', context: [], methods: { pretty: 'prettyMoney', defaultValue: 'zeroMoney' } },
      { head: 'Int', context: [], methods: { pretty: 'prettyInt', defaultValue: 'zeroInt' } },
      { head: 'Double', context: [], methods: { pretty: 'prettyDouble', defaultValue: 'zeroInt' } },
      { head: 'Maybe', context: [{ cls: 'Pretty', var: 'a' }], methods: { pretty: 'prettyMaybe', defaultValue: 'nothingValue' } },
    ],
  },
  Fancy: {
    name: 'Fancy', param: 'a', supers: ['Pretty'],
    methods: [{ name: 'fancy', sig: 'a -> String', default: 'fancyDefault' }],
    instances: [{ head: 'Money', context: [], methods: {} }],
  },
}

// A project: builtins, derived and class-method definitions, custom functions, and a top-level graph.
function setup(classes = CLASSES) {
  const resolved = declareClasses(classes, types)
  const env = classEnvironment(resolved)
  setUserTypeArities({})
  setDynamicClasses(env.classes)
  setDynamicInstances([...derivedInstances(types), ...env.instances])
  const builtin = (b) => ({ id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] })
  const main = {}
  const registry = new Proxy({}, { get: (_, id) => main[id] ?? defs[id] })
  const defs = Object.fromEntries([...['show', 'append', 'maybe', 'just', 'fromIntegral'].map(builtin), ...derivedDefinitions(types), ...classMethodDefinitions(resolved)].map((d) => [d.id, d]))
  const bodies = {}
  const call = (id, callee, slots = []) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
  const define = (name, params, body, out) => {
    main[name] = { id: name, type: 'function', label: name, params, mounted: params.map(() => null), custom: true }
    bodies[name] = Object.fromEntries([...params.map((p) => ({ id: p, type: 'parameter', label: p })), ...body, { id: 'output', type: 'output', source: out }].map((x) => [x.id, x]))
  }
  const m = (cls, name) => `class:${cls}:${name}`
  // Instances: pretty, and defaultValue (a method with no argument at all).
  define('prettyMoney', ['x'], [call('c', 'type:Money:cents', [n('x')]), call('s', 'show', [n('c')]), call('out', 'append', ['"$"', n('s')])], 'out')
  define('prettyInt', ['x'], [call('s', 'show', [n('x')]), call('out', 'append', ['"int "', n('s')])], 'out')
  define('prettyDouble', ['x'], [call('s', 'show', [n('x')]), call('out', 'append', ['"double "', n('s')])], 'out')
  define('zeroMoney', [], [call('out', 'type:Money:Money', ['0'])], 'out')
  define('zeroInt', [], [{ id: 'out', type: 'number', value: '0', label: '0' }], 'out')
  define('nothingValue', [], [call('out', 'nothing')], 'out')
  defs.nothing = builtin('nothing')
  // pretty (Maybe a) = maybe "none" pretty — uses Pretty a, from the instance's context
  define('prettyMaybe', ['mx'], [call('p', m('Pretty', 'pretty'), ['']), call('out', 'maybe', ['"none"', n('p'), n('mx')])], 'out')
  // fancy's default: "*" ++ pretty x — uses Pretty a, from Fancy's superclass
  define('fancyDefault', ['x'], [call('p', m('Pretty', 'pretty'), [n('x')]), call('out', 'append', ['"*"', n('p')])], 'out')
  // A class-polymorphic function: twice x = pretty x ++ pretty x  (Pretty a ⇒ a → String)
  define('twice', ['x'], [{ id: 'x2', type: 'ref', target: 'x' }, call('p1', m('Pretty', 'pretty'), [n('x')]), call('p2', m('Pretty', 'pretty'), [n('x2')]), call('out', 'append', [n('p1'), n('p2')])], 'out')
  const run = (graphNodes, id) => {
    Object.assign(main, Object.fromEntries(graphNodes.map((x) => [x.id, x])))
    const pass = inferGraph(registry, bodies, main)
    const instances = instanceEvidence(resolved, (fnId) => pass.schemes.get(fnId))
    const ev = createEvaluator({ nodes: registry, functionBodies: bodies, types, elaboration: () => elaborationIndex({ ...pass.elaboration, instances }, main, bodies) })
    const v = ev.run(main, id)
    graphNodes.forEach((x) => delete main[x.id])
    return { v, pass }
  }
  return { resolved, call, m, run, main, bodies }
}
const n = (id) => ({ node: id })
const text = (v) => { let s = ''; for (let l = v; l.ctorIndex === 1; l = l.args[1]) s += l.args[0]; return s }

test('a method call is resolved by type: Money, Int and Double each get their own instance', () => {
  const { call, m, run } = setup()
  assert.equal(text(run([call('w', 'type:Money:Money', ['5']), call('r', m('Pretty', 'pretty'), [n('w')])], 'r').v), '$5')
  // Int and Double are both numbers at runtime — only the types tell them apart.
  const int = { id: 'i', type: 'number', value: '3', label: '3', annotation: 'Int' }
  const dbl = { id: 'd', type: 'number', value: '3', label: '3', annotation: 'Double' }
  assert.equal(text(run([int, call('r', m('Pretty', 'pretty'), [n('i')])], 'r').v), 'int 3')
  assert.equal(text(run([dbl, call('r', m('Pretty', 'pretty'), [n('d')])], 'r').v), 'double 3')
})

test('a method with no argument (return-type polymorphism) is picked by where its result goes', () => {
  const { call, m, run } = setup()
  // cents defaultValue — defaultValue must be a Money here
  const { v } = run([call('dv', m('Pretty', 'defaultValue')), call('c', 'type:Money:cents', [n('dv')])], 'c')
  assert.equal(v, 0)
})

test('an instance with a context passes the inner dictionary on', () => {
  const { call, m, run } = setup()
  const { v } = run([call('w', 'type:Money:Money', ['7']), call('j', 'just', [n('w')]), call('r', m('Pretty', 'pretty'), [n('j')])], 'r')
  assert.equal(text(v), '$7')
})

test('a class-polymorphic function takes the dictionary as a hidden argument', () => {
  const { call, run } = setup()
  const { v, pass } = run([call('w', 'type:Money:Money', ['2']), call('r', 'twice', [n('w')])], 'r')
  assert.equal(text(v), '$2$2')
  assert.equal(pass.elaboration.functions.twice.params, 1)
  const int = { id: 'i', type: 'number', value: '4', label: '4', annotation: 'Int' }
  assert.equal(text(run([int, call('r', 'twice', [n('i')])], 'r').v), 'int 4int 4')
})

test('a class default fills a missing method, reaching the superclass through the dictionary', () => {
  const { call, m, run } = setup()
  const { v } = run([call('w', 'type:Money:Money', ['9']), call('r', m('Fancy', 'fancy'), [n('w')])], 'r')
  assert.equal(text(v), '*$9')
})

test('a partially applied method is a closure that carries its dictionary', () => {
  const { call, m, run } = setup()
  // maybe "none" pretty (Just (Money 3)) — `pretty` with its slot open is passed as a function
  const { v } = run([call('p', m('Pretty', 'pretty'), ['']), call('w', 'type:Money:Money', ['3']), call('j', 'just', [n('w')]), call('r', 'maybe', ['"none"', n('p'), n('j')])], 'r')
  assert.equal(text(v), '$3')
})

test('an unresolved constraint is reported when used', () => {
  const { call, m, run } = setup()
  // pretty True: no Pretty Bool instance
  assert.throws(() => run([{ id: 'b', type: 'boolean', value: 'true', label: 'true' }, call('r', m('Pretty', 'pretty'), [n('b')])], 'r'), /No instance for Pretty Bool/)
})

test('method types are polymorphic in the class', () => {
  const { resolved } = setup()
  const defs = classMethodDefinitions(resolved)
  const sig = (name) => { const d = defs.find((x) => x.label === name); return `${d.scheme.preds.map((p) => p.cls).join(',')} | ${showType(d.scheme.type)}` }
  assert.equal(sig('pretty'), 'Pretty | a → String')
  assert.equal(sig('defaultValue'), 'Pretty | a')
  assert.equal(sig('fancy'), 'Fancy | a → String')
})

test('class declarations are checked like GHC would', () => {
  const base = { name: 'C', param: 'a', supers: [], methods: [{ name: 'op', sig: 'a -> a', default: null }], instances: [] }
  const bad = (classes, re) => assert.throws(() => declareClasses(classes, types), (e) => e instanceof DeclError && re.test(e.message))
  bad({ C: { ...base, methods: [{ name: 'op', sig: 'Int -> Int', default: null }] } }, /doesn't mention a/)
  bad({ C: { ...base, supers: ['Nope'] } }, /no superclass named Nope/)
  bad({ C: { ...base, supers: ['D'] }, D: { ...base, name: 'D', methods: [{ name: 'op2', sig: 'a', default: null }], supers: ['C'] } }, /circle/)
  bad({ Show: { ...base, name: 'Show' } }, /builtin class/)
  bad({ C: { ...base, instances: [{ head: 'Money', methods: {} }, { head: 'Money', methods: {} }] } }, /written twice/)
  bad({ C: { ...base, instances: [{ head: 'Nope', methods: {} }] } }, /no type named Nope/)
  bad({ C: { ...base, supers: ['Eq'], instances: [{ head: 'Money', methods: {} }] } }, /needs an Eq instance/)
  bad({ C: { ...base, methods: [{ name: 'op', sig: 'a -> a', default: null }, { name: 'op', sig: 'a', default: null }] } }, /clashes/)
  assert.throws(() => declareClasses({ C: base }, types, ['op']), /clashes with an existing function/)
})

test('a constructor class: the class variable stands for a type constructor', () => {
  const box = declareTypes(types, 'data Box a = Box a')
  setUserTypeArities({ Box: 1 })
  const resolved = declareClasses({ Container: { name: 'Container', param: 'f', supers: [], methods: [{ name: 'empty', sig: 'f a', default: null }, { name: 'insert', sig: 'a -> f a -> f a', default: null }], instances: [{ head: 'List', context: [], methods: {} }, { head: 'Box', context: [], methods: {} }] } }, box)
  assert.equal(resolved[0].arity, 1)
  assert.throws(() => declareClasses({ Container: { name: 'Container', param: 'f', supers: [], methods: [{ name: 'empty', sig: 'f a', default: null }], instances: [{ head: 'Int', context: [], methods: {} }] } }, box), /needs a type constructor/)
})

test('an implementation is checked against the method type at the instance', () => {
  const { resolved } = setup()
  const pretty = resolved[0]
  const maybeInst = pretty.instances.find((i) => i.headName === 'Maybe')
  const moneyInst = pretty.instances.find((i) => i.headName === 'Money')
  const String = tlist(tcon('Char'))
  assert.equal(instanceMethodProblem(scheme([], [], tfun(tcon('Money'), String)), pretty, pretty.methods[0], moneyInst), '')
  assert.match(instanceMethodProblem(scheme([], [], tfun(tcon('Int'), String)), pretty, pretty.methods[0], moneyInst), /has type/)
  const a = tvar('a')
  assert.equal(instanceMethodProblem(scheme(['a'], [{ cls: 'Pretty', type: a }], tfun({ kind: 'app', fn: tcon('Maybe'), arg: a }, String)), pretty, pretty.methods[0], maybeInst), '', 'may use the context Pretty a')
  setDynamicClasses([])
  setDynamicInstances([])
})
