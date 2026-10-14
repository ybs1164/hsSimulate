// A derived instance written out as graphs (deriveGraphs.js): the generated
// method functions must type-check as the instance's methods and behave
// exactly like the derived instance they replace.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinSchemes } from '../src/builtinSchemes.js'
import { graphableDerivings, instanceGraphs } from '../src/deriveGraphs.js'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { inferGraph } from '../src/inferGraph.js'
import { setDynamicInstances } from '../src/prelude.js'
import { declareTypes, declToDraft, derivedDefinitions, derivedInstances, draftToSource, methodTypeProblem, typeArities } from '../src/typeDecls.js'
import { generalize, setUserTypeArities, tapp, tcon, tfun } from '../src/typeSystem.js'
import { parseValue } from '../src/valueParser.js'

const MAIN = ['eq', 'geq', 'plus', 'negate', 'times', 'addZero', 'mulOne', 'divide', 'select']
const PRELUDE = ['and', 'show', 'showsPrec', 'append', 'mappend', 'mempty', 'leq', 'join', 'meet', 'scale']

// `cls` of `typeName` (declared in `source`), derived and written out as graphs.
function convert(source, typeName, cls) {
  const derived = declareTypes({}, source)
  const d = derived[typeName]
  let k = 0
  const g = instanceGraphs(d, cls, { newId: (hint) => `${hint}-${++k}`, label: (m) => `${m}${typeName}` })
  const draft = declToDraft(d)
  for (const list of Object.values(draft.deriving)) if (list.includes(cls)) list.splice(list.indexOf(cls), 1)
  const written = declareTypes(derived, draftToSource(draft), { replacing: typeName, instances: [...d.instances, { cls, methods: g.methods }] })
  const nodes = {}
  for (const id of MAIN) nodes[id] = { id, type: 'function', builtin: id, label: id, params: [], mounted: [] }
  for (const b of PRELUDE) nodes[`prelude:${b}`] = { id: `prelude:${b}`, type: 'function', builtin: b, label: b, params: [], mounted: [] }
  derivedDefinitions(derived).forEach((def) => { nodes[def.id] = def })
  const functionBodies = {}
  for (const f of g.functions) { nodes[f.node.id] = f.node; functionBodies[f.node.id] = f.body }
  return { derived, written, g, nodes, functionBodies, d: written[typeName] }
}

// Run builtin `method` on values (Haskell text at `type`) under `types`.
function runMethod(p, types, method, type, args) {
  const ev = createEvaluator({ nodes: p.nodes, functionBodies: p.functionBodies, types })
  const graph = {}
  const slots = args.map((a, i) => {
    if (typeof a === 'number') return String(a)
    graph[`v${i}`] = { id: `v${i}`, type: 'value', data: parseValue(a, type, p.derived) }
    return ''
  })
  const callee = MAIN.includes(method) ? method : `prelude:${method}`
  graph.call = { id: 'call', type: 'function', sourceFunctionId: callee, label: method, params: slots, mounted: args.map((a, i) => (typeof a === 'number' ? null : `v${i}`)) }
  const v = ev.run(graph, 'call')
  return showValue(v, types)
}

// The written-out instance gives the same answers as the derived one.
function sameAsDerived(p, method, type, argLists) {
  for (const args of argLists) assert.equal(runMethod(p, p.written, method, type, args), runMethod(p, p.derived, method, type, args), `${method} ${args.join(' ')}`)
}

// Each generated method type-checks as the method at the instance.
function typeChecks(p, cls) {
  setDynamicInstances(derivedInstances(p.written))
  setUserTypeArities(typeArities(p.written))
  try {
    for (const [m, fnId] of Object.entries(p.g.methods)) {
      const pass = inferGraph(p.nodes, p.functionBodies, { [fnId]: p.nodes[fnId] })
      const e = pass.perNode.get(fnId)
      assert.ok(e?.paramTypes, `${m}: no type`)
      const have = generalize(e.preds || [], e.paramTypes.reduceRight((acc, t) => tfun(t, acc), e.resultType))
      assert.equal(methodTypeProblem(have, p.d, cls, builtinSchemes[m]), '', `${m}`)
    }
  } finally {
    setDynamicInstances([])
  }
}

const MODEL = 'data Model = Model { clicks :: Double, rate :: Double } deriving stock (Eq, Ord, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, VectorSpace, MulSemigroup, MulMonoid, Semiring, Ring, PartialOrd, Lattice)'
const LOG = 'data Log = Log { entries :: [Int], note :: String } deriving stock (Eq, Show) deriving (Semigroup, Monoid) via Generically Log'
const SHAPE = 'data Shape = Dot | Circle Double | Rect Double Double | Named { tag :: String, size :: Int } deriving stock (Eq, Ord, Show)'
const NAT = 'data Nat = Z | S Nat deriving stock (Eq, Ord, Show)'
const V2 = 'data V2 = V2 Double Double deriving stock (Eq, Show) deriving anyclass (AddSemigroup, AddMonoid, AddGroup, VectorSpace, AddCommutativeMonoid, AddAbelianGroup)'

test('the graphable derivings are those with hand-writable methods', () => {
  const classes = graphableDerivings(declareTypes({}, MODEL).Model).map((x) => x.cls)
  assert.ok(classes.includes('Eq') && classes.includes('AddSemigroup') && classes.includes('Lattice'))
  assert.deepEqual(graphableDerivings(declareTypes({}, LOG).Log), [{ cls: 'Eq', strategy: 'stock' }, { cls: 'Show', strategy: 'stock' }, { cls: 'Semigroup', strategy: 'via' }, { cls: 'Monoid', strategy: 'via' }])
  assert.ok(!classes.includes('Ring') && !classes.includes('AddCommutativeMonoid'), 'no methods of their own')
})

test('a record: Eq, Ord and Show through its projections', () => {
  const samples = ['Model {clicks = 1, rate = 2}', 'Model {clicks = 1, rate = 3}', 'Model {clicks = 0, rate = 9}', 'Model {clicks = -1.5, rate = 2}']
  const pairs = samples.flatMap((a) => samples.map((b) => [a, b]))
  const type = tcon('Model')
  for (const [cls, m] of [['Eq', 'eq'], ['Ord', 'geq']]) {
    const p = convert(MODEL, 'Model', cls)
    typeChecks(p, cls)
    sameAsDerived(p, m, type, pairs)
    assert.ok(Object.values(p.functionBodies[p.g.methods[m]]).some((x) => x.sourceFunctionId === 'type:Model:clicks'), 'uses the projections')
    assert.ok(!p.g.functions.some((f) => f.node.lambda), 'no λs needed for a record')
  }
  const p = convert(MODEL, 'Model', 'Show')
  typeChecks(p, 'Show')
  sameAsDerived(p, 'show', type, samples.map((s) => [s]))
})

test('a record: the pointwise structures', () => {
  const type = tcon('Model')
  const a = 'Model {clicks = 1, rate = 2}'
  const b = 'Model {clicks = 4, rate = -3}'
  for (const [cls, m, argLists] of [
    ['AddSemigroup', 'plus', [[a, b]]], ['AddMonoid', 'addZero', [[]]], ['AddGroup', 'negate', [[a]]], ['MulSemigroup', 'times', [[a, b]]],
    ['MulMonoid', 'mulOne', [[]]], ['VectorSpace', 'scale', [[2.5, a]]], ['PartialOrd', 'leq', [[a, b], [a, a]]], ['Lattice', 'join', [[a, b]]],
    ['Lattice', 'meet', [[a, b]]],
  ]) {
    const p = convert(MODEL, 'Model', cls)
    typeChecks(p, cls)
    sameAsDerived(p, m, type, argLists)
  }
  // via Generically: (<>) and mempty fieldwise.
  const logs = ['Log {entries = [1,2], note = "a"}', 'Log {entries = [3], note = "b"}']
  const p = convert(LOG, 'Log', 'Semigroup')
  typeChecks(p, 'Semigroup')
  sameAsDerived(p, 'mappend', tcon('Log'), [logs])
  const q = convert(LOG, 'Log', 'Monoid')
  typeChecks(q, 'Monoid')
  const graph = Object.values(q.functionBodies[q.g.methods.mempty])
  assert.deepEqual(graph.filter((x) => x.sourceFunctionId).map((x) => x.sourceFunctionId).sort(), ['prelude:mempty', 'prelude:mempty', 'type:Log:Log'])
})

test('a sum type: Eq, Ord and Show through its copairing and λs', () => {
  const samples = ['Dot', 'Circle 1', 'Circle 2', 'Rect 1 2', 'Rect 1 (-3)', 'Named {tag = "a", size = 1}', 'Named {tag = "b", size = 0}']
  const pairs = samples.flatMap((a) => samples.map((b) => [a, b]))
  const type = tcon('Shape')
  for (const [cls, m] of [['Eq', 'eq'], ['Ord', 'geq']]) {
    const p = convert(SHAPE, 'Shape', cls)
    typeChecks(p, cls)
    sameAsDerived(p, m, type, pairs)
    assert.ok(p.g.functions.some((f) => f.node.lambda))
  }
  const p = convert(SHAPE, 'Shape', 'Show')
  typeChecks(p, 'Show')
  sameAsDerived(p, 'show', type, samples.map((s) => [s]))
})

test('a recursive type recurses through its own (written) instance', () => {
  const samples = ['Z', 'S Z', 'S (S Z)', 'S (S (S Z))']
  const pairs = samples.flatMap((a) => samples.map((b) => [a, b]))
  for (const [cls, m] of [['Eq', 'eq'], ['Ord', 'geq']]) {
    const p = convert(NAT, 'Nat', cls)
    typeChecks(p, cls)
    sameAsDerived(p, m, tcon('Nat'), pairs)
  }
  const p = convert(NAT, 'Nat', 'Show')
  sameAsDerived(p, 'show', tcon('Nat'), samples.map((s) => [s]))
})

test('a positional product and a parameterized type', () => {
  const v = ['V2 1 2', 'V2 (-1) 0.5']
  for (const [cls, m, args] of [['Eq', 'eq', [[v[0], v[1]], [v[0], v[0]]]], ['Show', 'show', [[v[1]]]], ['AddSemigroup', 'plus', [[v[0], v[1]]]], ['AddGroup', 'negate', [[v[1]]]], ['VectorSpace', 'scale', [[3, v[0]]]], ['AddMonoid', 'addZero', [[]]]]) {
    const p = convert(V2, 'V2', cls)
    typeChecks(p, cls)
    sameAsDerived(p, m, tcon('V2'), args)
  }
  const PAIR = 'data Pair a = Pair { first :: a, second :: a } deriving stock (Eq, Ord, Show)'
  const pairD = tapp(tcon('Pair'), tcon('Double'))
  const ps = ['Pair {first = 1, second = 2}', 'Pair {first = 1, second = 1}']
  for (const [cls, m] of [['Eq', 'eq'], ['Ord', 'geq'], ['Show', 'show']]) {
    const p = convert(PAIR, 'Pair', cls)
    typeChecks(p, cls)
    sameAsDerived(p, m, pairD, m === 'show' ? ps.map((s) => [s]) : ps.flatMap((a) => ps.map((b) => [a, b])))
  }
})

test('literals still mean the same once part of the arithmetic is written', () => {
  const p = convert(MODEL, 'Model', 'AddSemigroup')
  const a = 'Model {clicks = 1, rate = 2}'
  sameAsDerived(p, 'plus', tcon('Model'), [[a, 0], [a, 3], [a, -2]])
})

test('a customized projection is bypassed: deriving means the structural one', () => {
  const derived = declareTypes({}, MODEL).Model
  const g = instanceGraphs(derived, 'Eq', { newId: (h) => h, label: (m) => m, customized: (id) => id === 'type:Model:clicks' })
  const callees = Object.values(g.functions[0].body).map((x) => x.sourceFunctionId).filter(Boolean)
  assert.ok(callees.includes('prim:type:Model:clicks') && callees.includes('type:Model:rate'))
})
