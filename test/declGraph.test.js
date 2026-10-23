import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classDraftOf, classGraph, layoutGraph, renameLayout, typeDraftOf, typeGraph, universeGraph } from '../src/declGraph.js'
import { declToDraft, declareTypes } from '../src/typeDecls.js'
import { BLACKJACK_TYPES } from '../src/examples/blackjack.js'
import { CLICK_COUNTER_TYPES } from '../src/examples/clickCounter.js'
import { HIGH_LOW_TYPES } from '../src/examples/highLow.js'

const SOURCES = [
  BLACKJACK_TYPES,
  CLICK_COUNTER_TYPES,
  HIGH_LOW_TYPES,
  'data Shape a = Circle { r :: Double } | Poly [a] deriving stock (Eq, Show)',
  'data Tree a = Leaf | Node (Tree a) a (Tree a)',
  'newtype Score = Score Int deriving newtype (Eq, Ord)',
  'data M = M { s :: [Double] } deriving (Semigroup, Monoid) via Generically M',
]
const allDrafts = () => SOURCES.flatMap((src) => Object.values(declareTypes({}, src)).map(declToDraft))

test('a type declaration survives being drawn as a graph and read back', () => {
  for (const d of allDrafts()) assert.deepEqual(typeDraftOf(typeGraph(d)), d, d.name)
})

test('editor keys ride along on the constructor nodes', () => {
  const d = declToDraft(declareTypes({}, 'data E = A | B Int')['E'])
  d.constructors[0].key = 7
  d.constructors[1].key = 8
  const g = typeGraph(d)
  assert.deepEqual(g.nodes.filter((n) => n.kind === 'ctor').map((n) => [n.id, n.key]), [['ctor:A', 7], ['ctor:B', 8]])
  assert.deepEqual(typeDraftOf(g), d)
})

test('a type graph: constructors inject into the type, parameters feed what mentions them, recursion points back', () => {
  const d = declToDraft(declareTypes({}, 'data Tree a = Leaf | Node (Tree a) a (Tree a)')['Tree'])
  const { edges } = typeGraph(d, { derived: [{ id: 'type:Tree:foldTree', label: 'foldTree', op: 'fold' }] })
  const has = (from, to, kind) => edges.some((e) => e.from === from && e.to === to && e.kind === kind)
  assert.ok(has('ctor:Leaf', 'type', 'inject') && has('ctor:Node', 'type', 'inject'))
  assert.equal(edges.find((e) => e.from === 'ctor:Node').label, 'ι₂')
  assert.ok(has('param:a', 'type', 'param'))
  assert.deepEqual(edges.filter((e) => e.kind === 'uses').map((e) => e.field), [0, 1, 2])
  assert.deepEqual(edges.filter((e) => e.kind === 'recursive').map((e) => e.field), [0, 2])
  assert.ok(has('type', 'derived:fold', 'derive'))
})

test('what a type derives is grouped by kind: projections, updates, the copairing, the recursor', () => {
  const d = declToDraft(declareTypes({}, 'data P = P { x :: Int, y :: Int }')['P'])
  const derived = [['x', 'get'], ['y', 'get'], ['set x', 'set'], ['over x', 'over'], ['caseP', 'case']].map(([label, op]) => ({ id: `type:P:${label}`, label, op }))
  const groups = typeGraph(d, { derived }).nodes.filter((n) => n.kind === 'derived')
  assert.deepEqual(groups.map((g) => [g.op, g.fns.map((f) => f.label)]), [['get', ['x', 'y']], ['update', ['set x', 'over x']], ['case', ['caseP']]])
})

test('a constructor name used twice (an edit not valid yet) still gets nodes of its own', () => {
  const d = declToDraft(declareTypes({}, 'data E = A | B')['E'])
  d.constructors[1].name = 'A'
  const ids = typeGraph(d).nodes.map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(typeDraftOf(typeGraph(d)), d)
})

const CLASS = {
  name: 'Pretty', param: 'a', supers: ['Show'],
  methods: [{ name: 'pretty', sig: 'a -> String', default: 'prettyDefault' }, { name: 'width', sig: 'a -> Int', default: null }],
  instances: [
    { head: 'Wallet', context: [], methods: { pretty: 'prettyWallet', width: 'widthAny' } },
    { head: 'Maybe', context: [{ cls: 'Pretty', var: 'a' }], methods: { width: 'widthAny' } },
  ],
}

test('a class declaration survives being drawn as a graph and read back', () => {
  assert.deepEqual(classDraftOf(classGraph(CLASS)), CLASS)
  const builtin = { name: 'Show', instances: [{ head: 'Wallet', context: [], methods: { show: 'showWallet' } }] }
  assert.deepEqual(classDraftOf(classGraph(builtin, { builtin: true, methods: [{ name: 'show', label: 'show' }] })), builtin)
})

test('a class graph: an instance is its methods applied to implementations, one function node however often it is used', () => {
  const { nodes, edges } = classGraph(CLASS)
  assert.equal(nodes.filter((n) => n.fnId === 'widthAny').length, 1)
  assert.deepEqual(edges.filter((e) => e.from === 'fn:widthAny').map((e) => [e.to, e.method]), [['instance:Wallet', 'width'], ['instance:Maybe', 'width']])
  assert.ok(edges.some((e) => e.from === 'fn:prettyDefault' && e.to === 'method:pretty' && e.kind === 'default'))
  assert.ok(edges.some((e) => e.from === 'super:Show' && e.to === 'class' && e.kind === 'super'))
  assert.ok(edges.some((e) => e.from === 'instance:Maybe' && e.to === 'class' && e.kind === 'instance'))
})

test('the universe: field uses, superclasses and written instances', () => {
  const types = declareTypes({}, 'data Card = Card Int\ndata Hand = Hand [Card]\ndata Tree = Leaf | Node Tree Tree')
  const classes = { Pretty: { ...CLASS, supers: [], instances: [{ head: 'Hand', context: [], methods: {} }] }, Fancy: { name: 'Fancy', param: 'a', supers: ['Pretty'], methods: [], instances: [] } }
  const { nodes, edges } = universeGraph(types, classes, { Show: [{ head: 'Card', context: [], methods: {} }] })
  assert.deepEqual(nodes.map((n) => n.id).sort(), ['class:Fancy', 'class:Pretty', 'class:Show', 'type:Card', 'type:Hand', 'type:Tree'])
  const kinds = edges.map((e) => `${e.from}>${e.to}:${e.kind}`).sort()
  assert.deepEqual(kinds, ['class:Pretty>class:Fancy:super', 'type:Card>class:Show:instance', 'type:Card>type:Hand:field', 'type:Hand>class:Pretty:instance', 'type:Tree>type:Tree:recursive'])
  const at = layoutGraph({ nodes, edges }, {}, { universe: true })
  assert.ok(at['type:Card'].x < at['type:Hand'].x && at['type:Hand'].x < at['class:Pretty'].x && at['class:Pretty'].x < at['class:Fancy'].x)
})

test('layout: columns by kind, saved positions kept, renames followed', () => {
  const d = declToDraft(declareTypes({}, 'data P a = P a | Q')['P'])
  const g = typeGraph(d)
  const at = layoutGraph(g)
  assert.ok(at['param:a'].x < at['ctor:P'].x && at['ctor:P'].x < at.type.x)
  assert.ok(at['ctor:P'].y < at['ctor:Q'].y)
  assert.deepEqual(layoutGraph(g, { 'ctor:Q': { x: 5, y: 6 }, 'ctor:Gone': { x: 1, y: 1 } })['ctor:Q'], { x: 5, y: 6 })
  assert.deepEqual(renameLayout({ 'ctor:Q': { x: 1, y: 2 } }, { 'ctor:Q': 'ctor:R' }), { 'ctor:R': { x: 1, y: 2 } })
})
