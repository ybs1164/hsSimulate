// GHC's ambiguity check (Haskell Report §4.3.4) on graphs: a constraint on
// a type variable that the binding's type doesn't mention can't be solved
// by any use of it — rejected statically, unless defaulting applies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classEnvironment, classMethodDefinitions, declareClasses } from '../src/classDecls.js'
import { buildBlankGame } from '../src/examples/blankGame.js'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { buildDice } from '../src/examples/dice.js'
import { inferGraph } from '../src/inferGraph.js'
import { setDynamicClasses, setDynamicInstances } from '../src/prelude.js'
import { declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { setUserTypeArities } from '../src/typeSystem.js'

const types = declareTypes({}, 'data Money = Money { cents :: Int } deriving stock (Show, Eq)')
const CLASSES = {
  Pretty: {
    name: 'Pretty', param: 'a', supers: [],
    methods: [{ name: 'pretty', sig: 'a -> String', default: null }, { name: 'defaultValue', sig: 'a', default: null }],
    instances: [{ head: 'Money', context: [], methods: {} }, { head: 'Double', context: [], methods: {} }],
  },
}

function setup() {
  const resolved = declareClasses(CLASSES, types)
  const env = classEnvironment(resolved)
  setUserTypeArities({})
  setDynamicClasses(env.classes)
  setDynamicInstances([...derivedInstances(types), ...env.instances])
  const builtin = (b) => ({ id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] })
  const defs = Object.fromEntries([...['show', 'append', 'eq', 'mempty', 'plus', 'just', 'nothing'].map(builtin), ...derivedDefinitions(types), ...classMethodDefinitions(resolved)].map((d) => [d.id, d]))
  const main = {}
  const bodies = {}
  const registry = new Proxy({}, { get: (_, id) => main[id] ?? defs[id] })
  const call = (id, callee, slots = []) => ({ id, type: 'function', sourceFunctionId: callee, label: defs[callee]?.label ?? callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
  const define = (name, params, body, out) => {
    main[name] = { id: name, type: 'function', label: name, params, mounted: params.map(() => null), custom: true }
    bodies[name] = Object.fromEntries([...params.map((p) => ({ id: p, type: 'parameter', label: p })), ...body, { id: 'output', type: 'output', source: out }].map((x) => [x.id, x]))
  }
  // The ambiguities of a top-level graph made of `graphNodes`.
  const check = (graphNodes) => {
    const graph = { ...main, ...Object.fromEntries(graphNodes.map((x) => [x.id, x])) }
    return inferGraph(new Proxy({}, { get: (_, id) => graph[id] ?? defs[id] }), bodies, graph).ambiguities
  }
  return { call, define, check, registry, main, bodies }
}
const n = (id) => ({ node: id })
const P = (m) => `class:Pretty:${m}`

test('pretty defaultValue is ambiguous: nothing says which instance', () => {
  const { call, check } = setup()
  const { main } = check([call('dv', P('defaultValue')), call('r', P('pretty'), [n('dv')])])
  assert.ok(main.length, 'flagged')
  assert.deepEqual(new Set(main.map((a) => a.nodeId)), new Set(['dv', 'r']), 'blamed on both uses')
  assert.match(main[0].message, /Ambiguous type variable a: the constraint Pretty a arising from ‘defaultValue’, ‘pretty’/)
})

test('fixing the type removes the ambiguity', () => {
  const { call, check } = setup()
  // cents defaultValue: defaultValue must be a Money
  assert.equal(check([call('dv', P('defaultValue')), call('c', 'type:Money:cents', [n('dv')])]).main.length, 0)
  // pretty (Money 3)
  assert.equal(check([call('m', 'type:Money:Money', ['3']), call('r', P('pretty'), [n('m')])]).main.length, 0)
})

test('a polymorphic expression is not ambiguous: its variable is in its type', () => {
  const { call, check } = setup()
  assert.equal(check([call('dv', P('defaultValue'))]).main.length, 0, 'defaultValue :: Pretty a ⇒ a')
  assert.equal(check([call('r', P('pretty'), [''])]).main.length, 0, 'pretty :: Pretty a ⇒ a → String')
  assert.equal(check([call('j', 'just', [''])]).main.length, 0)
})

test('defaulting resolves builtin numeric ambiguity, as in GHC (show 3)', () => {
  const { call, check } = setup()
  assert.equal(check([call('s', 'show', ['3'])]).main.length, 0, 'Semiring t, Show t ⇒ t defaults to Integer')
  assert.equal(check([{ id: 'k', type: 'number', value: '2.5', label: '2.5' }, call('s', 'show', [n('k')])]).main.length, 0, 'Field t defaults to Double')
})

test('builtin ambiguity with no numeric class is rejected (show mempty, mempty == mempty)', () => {
  const { call, check } = setup()
  const a = check([call('e', 'mempty'), call('s', 'show', [n('e')])]).main
  assert.ok(a.length && /no default applies/.test(a[0].message), JSON.stringify(a))
  assert.ok(check([call('e1', 'mempty'), call('e2', 'mempty'), call('q', 'eq', [n('e1'), n('e2')])]).main.length)
})

test('a user class never defaults, even next to a numeric one', () => {
  const { call, check } = setup()
  // pretty 3 — Semiring t, Pretty t: GHC refuses to default a non-standard class
  assert.ok(check([call('r', P('pretty'), ['3'])]).main.length)
  // pretty (3 :: Double) is fine
  assert.equal(check([{ id: 'k', type: 'number', value: '3', label: '3', annotation: 'Double' }, call('r', P('pretty'), [n('k')])]).main.length, 0)
})

test('inside a function body: ambiguity is reported for the function and left out of its type', () => {
  const { call, define, check } = setup()
  // broken x = pretty defaultValue   — ambiguous whatever x is
  define('broken', ['x'], [call('dv', P('defaultValue')), call('out', P('pretty'), [n('dv')])], 'out')
  // fine x = pretty x                — Pretty a ⇒ a → String
  define('fine', ['x'], [call('out', P('pretty'), [n('x')])], 'out')
  const { functions } = check([])
  assert.deepEqual(Object.keys(functions), ['broken'])
  assert.deepEqual(new Set(functions.broken.map((a) => a.nodeId)), new Set(['dv', 'out']))
})

test('parameters count as known in a body being edited', () => {
  const { call, check } = setup()
  // Viewing a body: `pretty x` with x a parameter is not ambiguous (x's type is the function's).
  const amb = check([{ id: 'x', type: 'parameter', label: 'x' }, call('r', P('pretty'), [n('x')])])
  assert.equal(amb.main.length, 0)
})

test('loose scratch nodes are checked on their own', () => {
  const { call, check } = setup()
  const amb = check([call('dv', P('defaultValue')), call('r', P('pretty'), [n('dv')]), call('m', 'type:Money:Money', ['1']), call('ok', P('pretty'), [n('m')])])
  assert.ok(amb.main.every((a) => ['dv', 'r'].includes(a.nodeId)))
})

for (const [name, build] of [['click counter', buildClickCounter], ['blank game', buildBlankGame], ['dice', buildDice]]) {
  test(`${name}: nothing in the template is ambiguous`, () => {
    const project = build()
    setDynamicClasses([])
    setDynamicInstances(derivedInstances(project.types))
    const used = new Set(Object.values(project.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
    const nodes = {
      ...Object.fromEntries([...used].filter((id) => !project.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, type: 'function', builtin: id.replace('prelude:', ''), label: id }])),
      ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])),
      ...project.nodes,
    }
    const { ambiguities } = inferGraph(nodes, project.functionBodies, project.nodes)
    assert.deepEqual(ambiguities, { main: [], functions: {} })
    setDynamicInstances([])
  })
}
