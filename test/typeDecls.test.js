import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeclError, declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { showQual, showType } from '../src/typeSystem.js'

const SOURCE = `
data Model = Model { clicks :: Double, perClick :: Double } deriving (Eq, Ord, Show)
data Event = Click | Tick Double | Buy Int deriving (Eq, Show)
`
const types = declareTypes({}, SOURCE)
const defs = Object.fromEntries(derivedDefinitions(types).map((d) => [d.id, d]))
const sig = (label) => {
  const d = Object.values(defs).find((x) => x.label === label)
  return showQual(d.scheme.preds, d.scheme.type)
}

test('a record derives its constructor, projections and lens updates', () => {
  assert.equal(sig('Model'), 'Double → Double → Model')
  assert.equal(sig('clicks'), 'Model → Double')
  assert.equal(sig('set clicks'), 'Double → Model → Model')
  assert.equal(sig('over clicks'), '(Double → Double) → Model → Model')
  assert.equal(sig('caseModel'), '(Double → Double → a) → Model → a')
})

test('a sum type derives its injections and copairing (eliminator)', () => {
  assert.equal(sig('Click'), 'Event')
  assert.equal(sig('Tick'), 'Double → Event')
  assert.equal(sig('caseEvent'), 'a → (Double → a) → (Int → a) → Event → a')
})

test('declarations are checked like GHC would', () => {
  const bad = (src, re) => assert.throws(() => declareTypes(types, src, { functionLabels: ['add'] }), (e) => e instanceof DeclError && re.test(e.message))
  bad('data Foo = Foo Bar', /Unknown type "Bar"/)
  bad('data Model = M Int', /already declared/)
  bad('data Foo = Foo { add :: Int }', /"add" .* clashes with an existing function/)
  bad('data Foo = Foo { clicks :: Int }', /"clicks" .* clashes/)
  bad('data Foo = Foo (Double -> Double) deriving Eq', /no Eq instance/)
  bad('data Foo = Foo Int deriving Ord', /needs an Eq instance/)
  bad('data Foo = Foo a', /"a" isn't a parameter/)
  bad('data Foo a a = Foo a', /appears twice/)
  bad('data Foo a = Foo (a -> a) deriving Eq', /no Eq instance/)
  bad('data Foo a = Foo a deriving (Semigroup, Monoid) via Generically Foo', /without parameters/)
  bad('data Foo a = Foo Foo', /wrong number of type arguments/)
  bad('newtype Foo = Foo Int Int', /exactly one field/)
  bad('data Foo = Foo (Maybe)', /wrong number of type arguments/)
})

test('a type with parameters derives polymorphic functions and instances with a context', () => {
  const t = declareTypes({}, `data Tree a = Leaf | Node (Tree a) a (Tree a) deriving (Eq, Show)
data Pair a b = Pair { first :: a, second :: b }`)
  assert.equal(t.Tree.source, 'data Tree a = Leaf | Node (Tree a) a (Tree a) deriving (Eq, Show)')
  const d = Object.fromEntries(derivedDefinitions(t).map((x) => [x.label, x]))
  const show = (label) => showQual(d[label].scheme.preds, d[label].scheme.type)
  assert.equal(show('Node'), 'Tree a → a → Tree a → Tree a')
  assert.equal(show('caseTree'), 'a → (Tree b → b → Tree b → a) → Tree b → a')
  assert.equal(show('foldTree'), 'a → (a → b → a → a) → Tree b → a')
  assert.equal(show('over second'), '(a → a) → Pair b a → Pair b a')
  const eq = derivedInstances(t).find((i) => i.cls === 'Eq')
  assert.equal(showQual(eq.context, eq.head), 'Eq a ⇒ Tree a')
  // used at Int, Tree Int has Eq; used at a function type it doesn't
  setDynamicInstances(derivedInstances(t))
  try {
    assert.doesNotThrow(() => reduce([{ cls: 'Eq', type: { kind: 'app', fn: { kind: 'con', name: 'Tree' }, arg: { kind: 'con', name: 'Int' } } }]))
  } finally {
    setDynamicInstances([])
  }
  // its constructors build ordinary (lazy) data values
  const defsT = Object.fromEntries(derivedDefinitions(t).map((x) => [x.id, x]))
  const evT = createEvaluator({ nodes: defsT, functionBodies: {} })
  const g = {
    leaf: { id: 'leaf', type: 'function', sourceFunctionId: 'type:Tree:Leaf', params: [], mounted: [] },
    one: { id: 'one', type: 'function', sourceFunctionId: 'type:Tree:Node', params: ['', '1', ''], mounted: ['leaf', null, 'leaf'] },
    two: { id: 'two', type: 'function', sourceFunctionId: 'type:Tree:Node', params: ['', '2', ''], mounted: ['one', null, 'one'] },
  }
  assert.equal(showValue(evT.run(g, 'two'), t), 'Node (Node Leaf 1 Leaf) 2 (Node Leaf 1 Leaf)')
})

test('recursive types may derive classes that rely on themselves', () => {
  const t = declareTypes({}, 'data Nat = Z | S Nat deriving (Eq, Show)')
  assert.deepEqual(derivedInstances(t).map((i) => i.cls), ['Eq', 'Show'])
})

test('String is [Char] and fields may mention other declared types', () => {
  const t = declareTypes(types, 'data Save = Save { name :: String, model :: Model, log :: [Event] }', { replacing: null })
  assert.equal(showType(t.Save.constructors[0].fields[0].type), 'String')
  assert.equal(showType(t.Save.constructors[0].fields[2].type), '[Event]')
})

// ---- Evaluation: the categorical laws of products and coproducts ----------
const registry = { nodes: { ...defs, plus: { id: 'plus', builtin: 'plus', label: '(+)' }, eq: { id: 'eq', builtin: 'eq', label: '(==)' }, geq: { id: 'geq', builtin: 'geq', label: '(>=)' }, negate: { id: 'negate', builtin: 'negate', label: 'negate' } }, functionBodies: {} }
const ev = createEvaluator(registry)
const id = (label) => Object.values(defs).find((d) => d.label === label).id
const call = (key, label, slots) => ({ id: key, type: 'function', sourceFunctionId: registry.nodes[label] ? label : id(label), label, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const graphOf = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))

test('projection after pairing gives the component back (π₁ ∘ ⟨f, g⟩ = f)', () => {
  const g = graphOf(call('m', 'Model', ['3', '2']), call('c', 'clicks', [{ node: 'm' }]), call('p', 'perClick', [{ node: 'm' }]))
  assert.equal(ev.run(g, 'c'), 3)
  assert.equal(ev.run(g, 'p'), 2)
  assert.equal(showValue(ev.run(g, 'm'), types), 'Model {clicks = 3, perClick = 2}')
})

test('lens laws: get-set, set-get, set-set', () => {
  const g = graphOf(
    call('m', 'Model', ['3', '2']),
    call('get', 'clicks', [{ node: 'm' }]),
    call('setGet', 'set clicks', [{ node: 'get' }, { node: 'm' }]), // set (get m) m = m
    call('set9', 'set clicks', ['9', { node: 'm' }]),
    call('getSet', 'clicks', [{ node: 'set9' }]), // get (set 9 m) = 9
    call('set5', 'set clicks', ['5', { node: 'm' }]),
    call('setSet', 'set clicks', ['9', { node: 'set5' }]), // set 9 (set 5 m) = set 9 m
  )
  assert.deepEqual(ev.run(g, 'setGet'), ev.run(g, 'm'))
  assert.equal(ev.run(g, 'getSet'), 9)
  assert.deepEqual(ev.run(g, 'setSet'), ev.run(g, 'set9'))
})

test('over applies a function to one field', () => {
  const g = graphOf(call('m', 'Model', ['3', '2']), call('inc', 'plus', ['10', '']), call('o', 'over clicks', [{ node: 'inc' }, { node: 'm' }]))
  assert.equal(showValue(ev.run(g, 'o'), types), 'Model {clicks = 13, perClick = 2}')
})

test('copairing after an injection picks that branch ([f, g] ∘ ι₂ = g)', () => {
  const g = graphOf(
    call('tick', 'Tick', ['0.5']),
    call('click', 'Click', []),
    call('neg', 'negate', ['']),
    call('onTick', 'caseEvent', ['100', { node: 'neg' }, { node: 'neg' }, { node: 'tick' }]),
    call('onClick', 'caseEvent', ['100', { node: 'neg' }, { node: 'neg' }, { node: 'click' }]),
  )
  assert.equal(ev.run(g, 'onTick'), -0.5)
  assert.equal(ev.run(g, 'onClick'), 100)
})

test('constructor fields are lazy, like Haskell', () => {
  const reg = { ...registry, nodes: { ...registry.nodes, loop: { id: 'loop', label: 'loop', custom: true } }, functionBodies: { loop: { output: { id: 'output', type: 'output', source: 'r' }, r: { id: 'r', type: 'function', sourceFunctionId: 'loop', params: [], mounted: [] } } } }
  const g = graphOf({ id: 'bottom', type: 'function', sourceFunctionId: 'loop', label: 'loop', params: [], mounted: [] }, call('m', 'Model', ['1', { node: 'bottom' }]), call('c', 'clicks', [{ node: 'm' }]))
  assert.equal(createEvaluator(reg).run(g, 'c'), 1, 'the diverging perClick field is never forced')
})

test('derived Eq/Ord compare structurally and lexicographically', () => {
  const g = graphOf(
    call('a', 'Model', ['1', '9']), call('b', 'Model', ['2', '0']), call('a2', 'Model', ['1', '9']),
    call('eqAA', 'eq', [{ node: 'a' }, { node: 'a2' }]), call('geqBA', 'geq', [{ node: 'b' }, { node: 'a' }]), call('geqAB', 'geq', [{ node: 'a' }, { node: 'b' }]),
    call('c', 'Click', []), call('t', 'Tick', ['1']), call('eqCT', 'eq', [{ node: 'c' }, { node: 't' }]),
  )
  assert.equal(ev.run(g, 'eqAA'), true)
  assert.equal(ev.run(g, 'geqBA'), true)
  assert.equal(ev.run(g, 'geqAB'), false)
  assert.equal(ev.run(g, 'eqCT'), false)
})

test('the type pass uses derived schemes and derived instances', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    const g = graphOf(call('m', 'Model', ['3', '2']), call('e', 'eq', [{ node: 'm' }, '']))
    const pass = inferGraph(registry.nodes, {}, g)
    assert.equal(showType(valueTypeOfEntry(pass.perNode.get('e'))), 'Model → Bool')
    assert.doesNotThrow(() => reduce(pass.preds), 'Eq Model is derived')
    const noShowEq = inferGraph(registry.nodes, {}, graphOf(call('t', 'Tick', ['1']), call('g', 'geq', [{ node: 't' }, ''])))
    assert.throws(() => reduce(noShowEq.preds), 'Event does not derive Ord')
  } finally {
    setDynamicInstances([])
  }
})

test('an inductive type gets its recursor (structural recursion)', () => {
  const t = declareTypes({}, 'data Nat = Z | S Nat deriving (Eq, Show)')
  const d = Object.fromEntries(derivedDefinitions(t).map((x) => [x.id, x]))
  const fold = Object.values(d).find((x) => x.label === 'foldNat')
  assert.equal(showQual(fold.scheme.preds, fold.scheme.type), 'a → (a → a) → Nat → a')
  assert.ok(!derivedDefinitions(types).some((x) => x.label.startsWith('fold')), 'non-recursive types have no recursor')
  // toInt = foldNat 0 succ, applied to S (S (S Z)) = 3
  const reg = { nodes: { ...d, succ: { id: 'succ', builtin: 'succ', label: 'add' } }, functionBodies: {} }
  const c = (key, label, slots) => ({ id: key, type: 'function', sourceFunctionId: reg.nodes[label] ? label : Object.values(d).find((x) => x.label === label).id, label, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
  const g = graphOf(c('z', 'Z', []), c('s1', 'S', [{ node: 'z' }]), c('s2', 'S', [{ node: 's1' }]), c('s3', 'S', [{ node: 's2' }]), c('inc', 'succ', ['']), c('toInt', 'foldNat', ['0', { node: 'inc' }, { node: 's3' }]))
  assert.equal(createEvaluator(reg).run(g, 'toInt'), 3)
  assert.equal(showValue(createEvaluator(reg).run(g, 's3'), t), 'S (S (S Z))')
})
