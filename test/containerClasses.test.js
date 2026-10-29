// Foldable on any container, Data.Monoid's wrappers, and the Functor /
// Applicative / Monad / Traversable functions written with the methods:
// each is a graph of its declared type that means what the native does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDefinitionView, hasDefinitionGraph } from '../src/definitionViews.js'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { showValue } from '../src/evaluator.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { showQual } from '../src/typeSystem.js'

const fn = (id, label, params) => ({ id, type: 'function', builtin: id, label, params, mounted: params.map(() => null) })
const library = {
  ...preludeDefs, ...preludeTypeDefs,
  apply: fn('apply', 'apply', ['f', 'x']), identity: fn('identity', 'identity', ['x']), compose: fn('compose', 'compose', ['f', 'g', 'x']), select: fn('select', 'select', ['condition', 'whenTrue', 'whenFalse']),
  plus: fn('plus', '(+)', ['x', 'y']), minus: fn('minus', '(-)', ['x', 'y']), times: fn('times', '(*)', ['x', 'y']),
  addZero: fn('addZero', 'addZero', []), mulOne: fn('mulOne', 'mulOne', []), eq: fn('eq', '(==)', ['x', 'y']), geq: fn('geq', '(>=)', ['x', 'y']),
}
const FOLDABLE = ['length', 'toList', 'null', 'elem', 'any', 'all', 'sum', 'product', 'concat', 'concatMap']
const WRITTEN = ['mconcat', 'fmapOp', 'constMap', 'liftA2', 'thenA', 'when', 'replicateM', 'returnM', 'thenM', 'kleisli', 'joinM', 'mapM_', 'sequenceA', 'forT', 'mapM', 'state', 'stateGet', 'statePut', 'stateModify', 'stateGets', 'evalState', 'execState']

const call = (id, callee, slots) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const list = (id, items) => call(id, 'prelude:listOf', items)
const graphOf = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))

/** Run `callee args` both through its definition graph and natively; return both shown. */
function both(callee, args, extra) {
  const view = buildDefinitionView(library[callee], (id) => library[id])
  const ev = createEvaluator({ nodes: { ...library, ...view.defs }, functionBodies: view.bodies })
  return [view.viewId, callee].map((id) => showValue(ev.run({ ...extra, out: call('out', id, args) }, 'out')))
}

test('each is written as a graph of its declared type', () => {
  for (const name of [...FOLDABLE, ...WRITTEN]) {
    const id = `prelude:${name}`
    assert.ok(hasDefinitionGraph(library[id]), name)
    const view = buildDefinitionView(library[id], (x) => library[x])
    const pass = inferGraph({ ...library, ...view.defs }, view.bodies, { v: view.defs[view.viewId] })
    const declared = view.defs[view.viewId].scheme
    assert.equal(showQual(pass.perNode.get('v').preds, valueTypeOfEntry(pass.perNode.get('v'))), showQual(declared.preds, declared.type), name)
  }
})

// The arguments: lists, Maybes, and functions given as partial applications.
const ctx = {
  ...graphOf(list('xs', ['3', '1', '2']), list('bs', ['True', 'False']), list('a', ['1', '2']), list('c', ['3'])),
  xss: list('xss', [{ node: 'a' }, { node: 'c' }]),
  j5: call('j5', 'prelude:just', ['5']), j2: call('j2', 'prelude:just', ['2']), none: call('none', 'prelude:nothing', []),
  jxs: call('jxs', 'prelude:just', [{ node: 'xs' }]),
  just: call('just', 'prelude:just', ['']), // \x -> Just x
  ret: call('ret', 'prelude:returnM', ['']), // \x -> return x
  pairUp: call('pairUp', 'prelude:replicate', ['2', '']), // \x -> [x, x]
  add: call('add', 'plus', ['', '']),
  is2: call('is2', 'eq', ['', '2']),
  unit: call('unit', 'prelude:unit', []), ju: call('ju', 'prelude:just', [{ node: 'unit' }]),
  jj: call('jj', 'prelude:just', [{ node: 'j5' }]),
  mjs: list('mjs', [{ node: 'j5' }, { node: 'j2' }]), mjn: list('mjn', [{ node: 'j5' }, { node: 'none' }]),
  bits: list('bits', ['0', '1']),
  s1: call('s1', 'type:Sum:Sum', ['1']), s2: call('s2', 'type:Sum:Sum', ['2']),
  sums: list('sums', [{ node: 's1' }, { node: 's2' }]),
  m1: call('m1', 'type:Max:Max', ['1']), m4: call('m4', 'type:Max:Max', ['4']),
  any0: call('any0', 'type:Any:Any', ['False']), any1: call('any1', 'type:Any:Any', ['True']),
  anys: list('anys', [{ node: 'any0' }, { node: 'any1' }]),
}
const same = (name, args, expected) => {
  const [viewed, native] = both(`prelude:${name}`, args, ctx)
  assert.equal(viewed, native, `${name} ${JSON.stringify(args)}`)
  if (expected !== undefined) assert.equal(native, expected, `${name} ${JSON.stringify(args)}`)
}

test('the Foldable functions fold any container — a list or a Maybe', () => {
  same('length', [{ node: 'xs' }], '3')
  same('length', [{ node: 'j5' }], '1')
  same('length', [{ node: 'none' }], '0')
  same('toList', [{ node: 'j5' }], '[5]')
  same('toList', [{ node: 'none' }], '[]')
  same('null', [{ node: 'none' }], 'True')
  same('null', [{ node: 'xs' }], 'False')
  same('elem', ['2', { node: 'xs' }], 'True')
  same('elem', ['2', { node: 'j5' }], 'False')
  same('any', [{ node: 'is2' }, { node: 'j2' }], 'True')
  same('all', [{ node: 'is2' }, { node: 'xs' }], 'False')
  same('sum', [{ node: 'xs' }], '6')
  same('sum', [{ node: 'j5' }], '5')
  same('product', [{ node: 'xs' }], '6')
  same('concat', [{ node: 'xss' }], '[1,2,3]')
  same('concat', [{ node: 'jxs' }], '[3,1,2]')
  same('concatMap', [{ node: 'pairUp' }, { node: 'j5' }], '[5,5]')
})

test("Data.Monoid's wrappers pick how mconcat combines", () => {
  same('mconcat', [{ node: 'sums' }])
  same('mconcat', [{ node: 'xss' }], '[1,2,3]')
  same('mconcat', [{ node: 'anys' }])
  const run = (g) => showValue(createEvaluator({ nodes: library, functionBodies: {} }).run({ ...ctx, ...g }, 'out'))
  assert.match(run({ m: call('m', 'prelude:mconcat', [{ node: 'sums' }]), out: call('out', 'type:Sum:getSum', [{ node: 'm' }]) }), /^3$/)
  assert.equal(run({ m: call('m', 'prelude:mappend', [{ node: 'm1' }, { node: 'm4' }]), out: call('out', 'type:Max:getMax', [{ node: 'm' }]) }), '4')
  assert.equal(run({ m: call('m', 'prelude:mconcat', [{ node: 'anys' }]), out: call('out', 'type:Any:getAny', [{ node: 'm' }]) }), 'True')
  assert.equal(run({ m: call('m', 'prelude:mempty', []), out: call('out', 'type:All:getAll', [{ node: 'm' }]) }), 'True')
})

test('the Functor, Applicative and Monad functions mean what their definitions say', () => {
  same('fmapOp', [{ node: 'add' }, { node: 'j5' }])
  same('constMap', ['0', { node: 'xs' }], '[0,0,0]')
  same('liftA2', [{ node: 'add' }, { node: 'j5' }, { node: 'j2' }], 'Just 7')
  same('liftA2', [{ node: 'add' }, { node: 'j5' }, { node: 'none' }], 'Nothing')
  same('thenA', [{ node: 'j5' }, { node: 'j2' }], 'Just 2')
  same('when', ['False', { node: 'ju' }], 'Just ()')
  same('replicateM', ['2', { node: 'bits' }], '[[0,0],[0,1],[1,0],[1,1]]')
  same('kleisli', [{ node: 'just' }, { node: 'ret' }, '3'], 'Just 3') // return, its monad fixed by Just
  same('thenM', [{ node: 'none' }, { node: 'j2' }], 'Nothing')
  same('thenM', [{ node: 'a' }, { node: 'c' }], '[3,3]')
  same('kleisli', [{ node: 'just' }, { node: 'just' }, '4'], 'Just 4')
  same('joinM', [{ node: 'jj' }], 'Just 5')
  same('joinM', [{ node: 'xss' }], '[1,2,3]')
  same('mapM_', [{ node: 'just' }, { node: 'xs' }], 'Just ()')
})

test('the Traversable functions: sequenceA, for, mapM', () => {
  same('sequenceA', [{ node: 'mjs' }], 'Just [5,2]')
  same('sequenceA', [{ node: 'mjn' }], 'Nothing')
  same('forT', [{ node: 'xs' }, { node: 'just' }], 'Just [3,1,2]')
  same('mapM', [{ node: 'just' }, { node: 'xs' }], 'Just [3,1,2]')
})
