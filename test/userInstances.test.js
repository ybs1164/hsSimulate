// Type parameters (`data Pair a = …`) and hand-written instances
// (`instance Show Money where show = showMoney`), end to end: declaration
// checking, derived polymorphic functions, instance contexts, runtime
// dispatch to the implementing custom functions, and the law checker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinSchemes } from '../src/builtinSchemes.js'
import { createEvaluator } from '../src/evaluator.js'
import { checkClassLaws } from '../src/laws.js'
import { entails, setDynamicInstances } from '../src/prelude.js'
import { DeclError, declareTypes, declToDraft, derivedDefinitions, derivedInstances, draftToSource, methodTypeAt, methodTypeProblem } from '../src/typeDecls.js'
import { pred, scheme, setUserTypeArities, showQual, showType, tapp, tcon, tfun, tlist, tvar } from '../src/typeSystem.js'
import { parseValue } from '../src/valueParser.js'

const withInstances = (types, name, instances) => declareTypes(types, draftToSource(declToDraft(types[name])), { replacing: name, instances })

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
  bad('data Box a = Box (Maybe a a)', /wrong number of type arguments/)
  bad('data Box a = Box a\ndata Use = Use Box', /wrong number of type arguments/)
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
  const bad = (name, instances, re) => assert.throws(() => withInstances(types, name, instances), (e) => e instanceof DeclError && re.test(e.message))
  bad('Money', [{ cls: 'Eq', methods: {} }], /already has Eq/)
  bad('Money', [{ cls: 'Show', methods: {} }, { cls: 'Show', methods: {} }], /written twice/)
  bad('Money', [{ cls: 'Functor', methods: {} }], /type constructors/)
  bad('Money', [{ cls: 'AddMonoid', methods: {} }], /needs an AddSemigroup instance/)
  bad('Money', [{ cls: 'Transcendental', methods: {} }], /can't be written by hand/)
  assert.ok(withInstances(types, 'Box', [{ cls: 'Functor', methods: {} }]).Box.instances.length)
  // Instances survive a later edit of the declaration.
  const withShow = withInstances(types, 'Money', [{ cls: 'Show', methods: { show: 'showMoney' } }])
  const edited = declareTypes(withShow, 'data Money = Money Int deriving stock (Eq, Ord)', { replacing: 'Money' })
  assert.deepEqual(edited.Money.instances, [{ cls: 'Show', methods: { show: 'showMoney' } }])
})

test("a method's required type is the class method's type at the instance", () => {
  const types = declareTypes({}, 'data Pair a = Pair a a\ndata Box a = Box a')
  const show = methodTypeAt(types.Pair, 'Show', builtinSchemes.show)
  assert.equal(showQual(show.given, show.type, (id) => id), 'Show a ⇒ Pair a → String')
  const fmap = methodTypeAt(types.Box, 'Functor', builtinSchemes.fmap)
  assert.equal(showType(fmap.type, (id) => id), '(m:a → m:b) → Box m:a → Box m:b')
})

// ---- Runtime --------------------------------------------------------------

const BUILTINS = ['plus', 'minus', 'join', 'show', 'append', 'leq', 'eq', 'mappend', 'mempty', 'addZero', 'fmap', 'times']
function project(types) {
  const nodes = Object.fromEntries(BUILTINS.map((b) => [b, { id: b, type: 'function', builtin: b, label: b, params: [], mounted: [] }]))
  derivedDefinitions(types).forEach((d) => { nodes[d.label] = d })
  const functionBodies = {}
  const call = (id, callee, slots = []) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
  const define = (name, params, body, out) => {
    nodes[name] = { id: name, type: 'function', label: name, params, mounted: params.map(() => null), custom: true }
    functionBodies[name] = Object.fromEntries([...params.map((p) => ({ id: p, type: 'parameter', label: p })), ...body, { id: 'output', type: 'output', source: out }].map((x) => [x.id, x]))
  }
  const ev = createEvaluator({ nodes, functionBodies, types })
  const run = (graphNodes, id) => ev.run(Object.fromEntries(graphNodes.map((x) => [x.id, x])), id)
  return { nodes, functionBodies, call, define, ev, run }
}
const n = (id) => ({ node: id })

test('show dispatches to a hand-written Show, at any depth', () => {
  let types = declareTypes({}, 'data Money = Money { cents :: Int }')
  types = withInstances(types, 'Money', [{ cls: 'Show', methods: { show: 'showMoney' } }])
  types = declareTypes(types, 'data Account = Account { balance :: Money } deriving stock (Show)')
  const p = project(types)
  // showMoney m = "$" ++ show (cents m)
  p.define('showMoney', ['m'], [p.call('c', 'cents', [n('m')]), p.call('s', 'show', [n('c')]), p.call('out', 'append', ['"$"', n('s')])], 'out')
  const asText = (v) => { let s = ''; for (let l = v; l.ctorIndex === 1; l = l.args[1]) s += l.args[0]; return s }
  assert.equal(asText(p.run([p.call('m', 'Money', ['5']), p.call('s', 'show', [n('m')])], 's')), '$5')
  assert.equal(asText(p.run([p.call('m', 'Money', ['5']), p.call('a', 'Account', [n('m')]), p.call('s', 'show', [n('a')])], 's')), 'Account {balance = $5}')
})

// The max-plus semiring on a newtype: its (+) is max — not the pointwise
// (+) deriving would give — so the law checker and literals must go through it.
function maxPlus() {
  let types = declareTypes({}, 'newtype MaxP = MaxP { getMax :: Double } deriving stock (Eq, Show)')
  types = withInstances(types, 'MaxP', [
    { cls: 'AddSemigroup', methods: { plus: 'maxPlus' } },
    { cls: 'AddMonoid', methods: { addZero: 'maxZero' } },
    { cls: 'AddCommutativeMonoid', methods: {} },
  ])
  const p = project(types)
  p.define('maxPlus', ['x', 'y'], [p.call('a', 'getMax', [n('x')]), p.call('b', 'getMax', [n('y')]), p.call('m', 'join', [n('a'), n('b')]), p.call('out', 'MaxP', [n('m')])], 'out')
  p.define('maxZero', [], [p.call('out', 'MaxP', ['-1000000'])], 'out')
  return { types, p }
}

test('arithmetic dispatches to hand-written instances; literals become their identities', () => {
  const { p } = maxPlus()
  const sum = p.run([p.call('a', 'MaxP', ['3']), p.call('b', 'MaxP', ['5']), p.call('s', 'plus', [n('a'), n('b')])], 's')
  assert.deepEqual(sum.args, [5], 'MaxP 3 + MaxP 5 = MaxP 5')
  const withZero = p.run([p.call('a', 'MaxP', ['3']), p.call('s', 'plus', [n('a'), '0'])], 's')
  assert.deepEqual(withZero.args, [3], '0 is addZero, not a broadcast 0')
  assert.throws(() => p.run([p.call('a', 'MaxP', ['3']), p.call('s', 'plus', [n('a'), '2'])], 's'), /needs MulMonoid/)
})

test('the law checker checks hand-written instances', () => {
  const { types, p } = maxPlus()
  setDynamicInstances(derivedInstances(types))
  const { results } = checkClassLaws('AddCommutativeMonoid', tcon('MaxP'), { ev: p.ev, types })
  assert.ok(results.length >= 3 && results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)))
  // A broken (+) — subtraction — is caught.
  p.define('maxPlus', ['x', 'y'], [p.call('a', 'getMax', [n('x')]), p.call('b', 'getMax', [n('y')]), p.call('m', 'minus', [n('a'), n('b')]), p.call('out', 'MaxP', [n('m')])], 'out')
  const broken = checkClassLaws('AddCommutativeMonoid', tcon('MaxP'), { ev: p.ev, types })
  assert.ok(broken.results.some((r) => !r.ok && /associativity/.test(r.law)))
  setDynamicInstances([])
})

test('a hand-written Functor for a parameterized type', () => {
  let types = declareTypes({}, 'data Box a = Box a')
  types = withInstances(types, 'Box', [{ cls: 'Functor', methods: { fmap: 'fmapBox' } }])
  const p = project(types)
  // fmapBox f b = Box (f (unbox b)), with unbox = caseBox identity
  p.nodes.identity = { id: 'identity', type: 'function', builtin: 'identity', label: 'identity', params: [], mounted: [] }
  p.nodes.apply = { id: 'apply', type: 'function', builtin: 'apply', label: 'apply', params: [], mounted: [] }
  p.define('fmapBox', ['f', 'b'], [p.call('i', 'identity', ['']), p.call('x', 'caseBox', [n('i'), n('b')]), p.call('y', 'apply', [n('f'), n('x')]), p.call('out', 'Box', [n('y')])], 'out')
  const v = p.run([p.call('inc', 'plus', ['1', '']), p.call('b', 'Box', ['41']), p.call('m', 'fmap', [n('inc'), n('b')])], 'm')
  assert.deepEqual(v.args, [42])
  assert.equal(v.type, 'Box')
})

test('a missing method is a clear runtime error', () => {
  let types = declareTypes({}, 'data Money = Money Int')
  types = withInstances(types, 'Money', [{ cls: 'Show', methods: {} }])
  const p = project(types)
  assert.throws(() => p.run([p.call('m', 'Money', ['5']), p.call('s', 'show', [n('m')])], 's'), /instance Show Money has no show yet/)
})

test('an implementation must have (at least) the method type at the instance', () => {
  let types = declareTypes({}, 'data Money = Money Int\ndata Pair a = Pair a a')
  types = withInstances(types, 'Pair', [{ cls: 'Show', methods: {} }])
  setDynamicInstances(derivedInstances(types))
  setUserTypeArities({ Pair: 1 })
  const String = tlist(tcon('Char'))
  const a = tvar('a')
  const pairA = tapp(tcon('Pair'), a)
  const check = (have, d) => methodTypeProblem(have, types[d], 'Show', builtinSchemes.show)
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
