// Type parameters (`data Pair a = …`) and hand-written instances of builtin
// classes (`instance Show Money where show = showMoney`), end to end:
// declaration checking, derived polymorphic functions, instance contexts,
// runtime dispatch to the implementing custom functions (through
// dictionaries), and the law checker. A hand-written instance is kept with
// its class, `{ Show: [{ head, context, methods }] }`, like a user class's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { checkClassLaws } from '../src/laws.js'
import { entails, setDynamicInstances } from '../src/prelude.js'
import { classEnvironment, declareClasses, writtenEnvironment, writtenMethodProblem } from '../src/classDecls.js'
import { builtinMethodType, methodTypeAtHead } from '../src/instanceTable.js'
import { DeclError, declareTypes, declToDraft, derivedDefinitions, derivedInstances, draftToSource } from '../src/typeDecls.js'
import { pred, scheme, setUserTypeArities, showQual, showType, tapp, tcon, tfun, tlist, tvar } from '../src/typeSystem.js'
import { parseValue } from '../src/valueParser.js'

// Resolve and check hand-written `instances` against `types` (throws DeclError).
const declareInstances = (types, instances) => declareClasses({}, types, [], instances)
const one = (head, methods = {}, context = []) => ({ head, context, methods })

test('a type may take parameters; its functions are polymorphic in them', () => {
  const types = declareTypes({}, 'data Pair a = Pair { first :: a, second :: a } deriving stock (Eq, Show)')
  const sig = (label) => { const d = derivedDefinitions(types).find((x) => x.label === label); return showQual(d.scheme.preds, d.scheme.type) }
  assert.equal(sig('Pair'), 'a → a → Pair a')
  assert.equal(sig('first'), 'Pair a → a')
  assert.equal(sig('over second'), '(a → a) → Pair a → Pair a')
  assert.equal(sig('casePair'), '(a → a → b) → Pair a → b')
  assert.equal(draftToSource(declToDraft(types.Pair)), 'data Pair a = Pair { first :: a, second :: a } deriving stock (Eq, Show)')
})

test('derived instances of a parameterized type carry a context, as GHC infers', () => {
  const types = declareTypes({}, 'data Pair a = Pair a a deriving stock (Eq, Show)\ndata Tag a = Tag Int deriving stock Eq')
  setDynamicInstances(derivedInstances(types))
  setUserTypeArities({ Pair: 1, Tag: 1 })
  const pairOf = (t) => tapp(tcon('Pair'), t)
  assert.ok(entails([], pred('Eq', pairOf(tcon('Int')))))
  assert.ok(!entails([], pred('Eq', pairOf(tfun(tcon('Int'), tcon('Int'))))), 'no Eq for functions, so none for a pair of them')
  assert.ok(entails([], pred('Eq', tapp(tcon('Tag'), tfun(tcon('Int'), tcon('Int'))))), 'a phantom parameter needs nothing')
  setDynamicInstances([])
})

test('a recursive parameterized type gets its recursor', () => {
  const types = declareTypes({}, 'data Tree a = Leaf | Node (Tree a) a (Tree a)')
  const fold = derivedDefinitions(types).find((d) => d.label === 'foldTree')
  assert.equal(showType(fold.scheme.type), 'a → (a → b → a → a) → Tree b → a')
})

test('type parameters are checked', () => {
  const bad = (src, re) => assert.throws(() => declareTypes({}, src), (e) => e instanceof DeclError && re.test(e.message))
  bad('data Box = Box a', /isn't a parameter/)
  bad('data Box a = Box (Maybe a a)', /too many type arguments/)
  bad('data Box a = Box a\ndata Use = Use Box', /doesn't fit together/) // Box :: * -> *, not a type of values
  bad('data Box r = Box r', /kept for the result/)
})

test('a value of a parameterized type can be written at a concrete type', () => {
  const types = declareTypes({}, 'data Pair a = Pair { first :: a, second :: a }')
  const v = parseValue('Pair {first = 1, second = 2.5}', tapp(tcon('Pair'), tcon('Double')), types)
  assert.deepEqual(v.args, [1, 2.5])
  assert.throws(() => parseValue('Pair {first = True, second = False}', tapp(tcon('Pair'), tcon('Double')), types))
})

test('hand-written instances are checked like GHC would', () => {
  const types = declareTypes({}, 'data Money = Money Int deriving stock (Eq)\ndata Box a = Box a')
  setDynamicInstances(derivedInstances(types))
  setUserTypeArities({ Box: 1 })
  const bad = (instances, re) => assert.throws(() => declareInstances(types, instances), (e) => e instanceof DeclError && re.test(e.message))
  bad({ Eq: [one('Money')] }, /already has Eq \(derived/)
  bad({ Show: [one('Int')] }, /already has Show \(builtin\)/)
  bad({ Show: [one('Money'), one('Money')] }, /written twice/)
  bad({ Functor: [one('Money')] }, /needs a type constructor/)
  bad({ AddMonoid: [one('Money')] }, /needs an AddSemigroup instance/)
  bad({ Transcendental: [one('Money')] }, /needs an \w+ instance/) // writable, but only on top of a Field
  bad({ Show: [one('Box', {}, [{ cls: 'Show', var: 'z' }])] }, /isn't one of a/)
  bad({ Pretty: [one('Money')] }, /isn't a builtin class/)
  assert.equal(declareInstances(types, { Functor: [one('Box')] }).written.length, 1)
  assert.equal(declareInstances(types, { Semigroup: [one('Int')] }).written.length, 1, 'a builtin type without the class may get it')
  // The context is the instance's own to choose: none (a phantom-like use), or more than deriving would ask.
  assert.equal(declareInstances(types, { Show: [one('Box', {}, [{ cls: 'Show', var: 'a' }, { cls: 'Ord', var: 'a' }])] }).written[0].context.length, 2)
  // deriving a class a hand-written instance already gives is refused.
  assert.throws(() => declareTypes(types, 'data Money = Money Int deriving stock (Eq, Show)', { replacing: 'Money', assumed: (ts) => writtenEnvironment({ Show: [one('Money')] }, ts) }), /already has a hand-written Show/)
  setDynamicInstances([])
})

test("a method's required type is the class method's type at the instance", () => {
  const show = methodTypeAtHead(builtinMethodType('Show', 'show'), tapp(tcon('Pair'), tvar('a')))
  assert.equal(showType(show.type, (id) => id), 'Pair a → String')
  const fmap = methodTypeAtHead(builtinMethodType('Functor', 'fmap'), tcon('Box'))
  assert.equal(showType(fmap.type, (id) => id), '(m:a → m:b) → Box m:a → Box m:b')
  const foldMap = methodTypeAtHead(builtinMethodType('Foldable', 'foldMap'), tcon('Box'))
  assert.equal(showQual(foldMap.extras, foldMap.type, (id) => id), 'Monoid m:m ⇒ (m:a → m:m) → Box m:a → m:m', "foldMap's own Monoid comes with the call")
})

// ---- Runtime --------------------------------------------------------------

const BUILTINS = ['plus', 'minus', 'join', 'show', 'append', 'leq', 'eq', 'mappend', 'mempty', 'addZero', 'fmap', 'times']
function project(types, instances = {}) {
  const nodes = Object.fromEntries(BUILTINS.map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }]))
  derivedDefinitions(types).forEach((d) => { nodes[d.label] = d })
  const functionBodies = {}
  const call = (id, callee, slots = []) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
  const define = (name, params, body, out) => {
    nodes[name] = { id: name, type: 'function', label: name, params, mounted: params.map(() => null), custom: true }
    functionBodies[name] = Object.fromEntries([...params.map((p) => ({ id: p, type: 'parameter', label: p })), ...body, { id: 'output', type: 'output', source: out }].map((x) => [x.id, x]))
  }
  const ev = createEvaluator({ nodes, functionBodies, types, instances })
  const run = (graphNodes, id) => ev.run(Object.fromEntries(graphNodes.map((x) => [x.id, x])), id)
  return { nodes, functionBodies, call, define, ev, run }
}
const n = (id) => ({ node: id })

test('show dispatches to a hand-written Show, at any depth', () => {
  const instances = { Show: [one('Money', { show: 'showMoney' })] }
  let types = declareTypes({}, 'data Money = Money { cents :: Int }')
  // deriving Show for Account relies on the hand-written Show Money
  types = declareTypes(types, 'data Account = Account { balance :: Money } deriving stock (Show)', { assumed: (ts) => writtenEnvironment(instances, ts) })
  const p = project(types, instances)
  // showMoney m = "$" ++ show (cents m)
  p.define('showMoney', ['m'], [p.call('c', 'cents', [n('m')]), p.call('s', 'show', [n('c')]), p.call('out', 'append', ['"$"', n('s')])], 'out')
  const asText = (v) => { let s = ''; for (let l = v; l.ctorIndex === 1; l = l.args[1]) s += l.args[0]; return s }
  assert.equal(asText(p.run([p.call('m', 'Money', ['5']), p.call('s', 'show', [n('m')])], 's')), '$5')
  assert.equal(asText(p.run([p.call('m', 'Money', ['5']), p.call('a', 'Account', [n('m')]), p.call('s', 'show', [n('a')])], 's')), 'Account {balance = $5}')
})

// The max-plus semiring on a newtype: its (+) is max — not the pointwise
// (+) deriving would give — so the law checker and literals must go through it.
function maxPlus() {
  const types = declareTypes({}, 'newtype MaxP = MaxP { getMax :: Double } deriving stock (Eq, Show)')
  const instances = { AddSemigroup: [one('MaxP', { plus: 'maxPlus' })], AddMonoid: [one('MaxP', { addZero: 'maxZero' })], AddCommutativeMonoid: [one('MaxP')] }
  const p = project(types, instances)
  p.define('maxPlus', ['x', 'y'], [p.call('a', 'getMax', [n('x')]), p.call('b', 'getMax', [n('y')]), p.call('m', 'join', [n('a'), n('b')]), p.call('out', 'MaxP', [n('m')])], 'out')
  p.define('maxZero', [], [p.call('out', 'MaxP', ['-1000000'])], 'out')
  return { types, instances, p }
}

test('arithmetic dispatches to hand-written instances, picked by the types', () => {
  const { p } = maxPlus()
  const sum = p.run([p.call('a', 'MaxP', ['3']), p.call('b', 'MaxP', ['5']), p.call('s', 'plus', [n('a'), n('b')])], 's')
  assert.deepEqual(sum.args, [5], 'MaxP 3 + MaxP 5 = MaxP 5')
  const withZero = p.run([p.call('a', 'MaxP', ['3']), p.call('z', 'addZero'), p.call('s', 'plus', [n('a'), n('z')])], 's')
  assert.deepEqual(withZero.args, [3], "addZero is MaxP's own zero (max with it changes nothing)")
})

test('a literal at a hand-written ring is fromInteger of it: n · mulOne by its own (+)', () => {
  const types = declareTypes({}, 'newtype Cnt = Cnt { count :: Int } deriving stock (Eq, Show)')
  const instances = {
    AddSemigroup: [one('Cnt', { plus: 'cntPlus' })], AddMonoid: [one('Cnt', { addZero: 'cntZero' })], AddCommutativeMonoid: [one('Cnt')],
    MulSemigroup: [one('Cnt', { times: 'cntTimes' })], MulMonoid: [one('Cnt', { mulOne: 'cntOne' })], Semiring: [one('Cnt')],
  }
  const p = project(types, instances)
  // (+) adds the counts plus one more each time (a deliberately odd ring, so the literal shows how it's built)
  p.define('cntPlus', ['x', 'y'], [p.call('a', 'count', [n('x')]), p.call('b', 'count', [n('y')]), p.call('s', 'plus', [n('a'), n('b')]), p.call('out', 'Cnt', [n('s')])], 'out')
  p.define('cntZero', [], [p.call('out', 'Cnt', ['0'])], 'out')
  p.define('cntTimes', ['x', 'y'], [p.call('out', 'Cnt', ['1'])], 'out')
  p.define('cntOne', [], [p.call('out', 'Cnt', ['10'])], 'out')
  // 3 :: Cnt = 1 + 1 + 1 by Cnt's own mulOne (Cnt 10) and (+)
  const three = p.run([p.call('c', 'Cnt', ['0']), p.call('s', 'plus', [n('c'), '3'])], 's')
  assert.deepEqual(three.args, [30])
  assert.deepEqual(p.run([p.call('c', 'Cnt', ['0']), p.call('s', 'plus', [n('c'), '0'])], 's').args, [0], '0 is addZero')
})

test('the law checker checks hand-written instances', () => {
  const { types, instances, p } = maxPlus()
  setDynamicInstances([...derivedInstances(types), ...classEnvironment(declareInstances(types, instances)).instances])
  const { results } = checkClassLaws('AddCommutativeMonoid', tcon('MaxP'), { ev: p.ev, types })
  assert.ok(results.length >= 3 && results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)))
  // A broken (+) — subtraction — is caught.
  p.define('maxPlus', ['x', 'y'], [p.call('a', 'getMax', [n('x')]), p.call('b', 'getMax', [n('y')]), p.call('m', 'minus', [n('a'), n('b')]), p.call('out', 'MaxP', [n('m')])], 'out')
  const broken = checkClassLaws('AddCommutativeMonoid', tcon('MaxP'), { ev: p.ev, types })
  assert.ok(broken.results.some((r) => !r.ok && /associativity/.test(r.law)))
  setDynamicInstances([])
})

test('a hand-written Functor for a parameterized type', () => {
  const types = declareTypes({}, 'data Box a = Box a')
  const p = project(types, { Functor: [one('Box', { fmap: 'fmapBox' })] })
  // fmapBox f b = Box (f (unbox b)), with unbox = caseBox identity
  p.nodes.identity = { id: 'identity', type: 'function', builtin: 'identity', label: 'identity', params: [], mounted: [] }
  p.nodes.apply = { id: 'apply', type: 'function', builtin: 'apply', label: 'apply', params: [], mounted: [] }
  p.define('fmapBox', ['f', 'b'], [p.call('i', 'identity', ['']), p.call('x', 'caseBox', [n('i'), n('b')]), p.call('y', 'apply', [n('f'), n('x')]), p.call('out', 'Box', [n('y')])], 'out')
  const v = p.run([p.call('inc', 'plus', ['1', '']), p.call('b', 'Box', ['41']), p.call('m', 'fmap', [n('inc'), n('b')])], 'm')
  assert.deepEqual(v.args, [42])
  assert.equal(v.type, 'Box')
})

test('a missing method is a clear runtime error', () => {
  const types = declareTypes({}, 'data Money = Money Int')
  const p = project(types, { Show: [one('Money')] })
  assert.throws(() => p.run([p.call('m', 'Money', ['5']), p.call('s', 'show', [n('m')])], 's'), /instance Show Money defines neither show nor showsPrec/)
})

test('an implementation must have (at least) the method type at the instance', () => {
  const types = declareTypes({}, 'data Money = Money Int\ndata Pair a = Pair a a')
  setUserTypeArities({ Pair: 1 })
  const written = declareInstances(types, { Show: [one('Money'), one('Pair', {}, [{ cls: 'Show', var: 'a' }])] }).written
  setDynamicInstances(classEnvironment([], written).instances)
  const String = tlist(tcon('Char'))
  const a = tvar('a')
  const pairA = tapp(tcon('Pair'), a)
  const check = (have, d) => writtenMethodProblem(have, written.find((w) => w.headName === d), 'show')
  assert.equal(check(scheme([], [], tfun(tcon('Money'), String)), 'Money'), '')
  assert.equal(check(scheme(['a'], [], tfun(a, String)), 'Money'), '', 'more general is fine')
  assert.match(check(scheme([], [], tfun(tcon('Money'), tcon('Int'))), 'Money'), /needs Money → String/)
  assert.match(check(scheme([], [], tfun(tcon('Int'), String)), 'Money'), /has type Int → String/)
  // Pair a: may use Show a (the instance's context), but not Ord a.
  assert.equal(check(scheme(['a'], [pred('Show', a)], tfun(pairA, String)), 'Pair'), '')
  assert.match(check(scheme(['a'], [pred('Ord', a)], tfun(pairA, String)), 'Pair'), /needs Ord a/)
  // Too specific: only works for Pair Int.
  assert.match(check(scheme([], [], tfun(tapp(tcon('Pair'), tcon('Int')), String)), 'Pair'), /has type/)
  setDynamicInstances([])
})
