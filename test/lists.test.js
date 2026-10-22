// The list library: each Prelude function on lists is written as a graph
// (with foldr, the recursor, and uncons, the eliminator) that has exactly
// the type the builtin is given and means what the builtin does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDefinitionView, hasDefinitionGraph } from '../src/definitionViews.js'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { showValue } from '../src/evaluator.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { printDefinition } from '../src/haskellPrint.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { showQual } from '../src/typeSystem.js'

const fn = (id, label, params) => ({ id, type: 'function', builtin: id, label, params, mounted: params.map(() => null) })
const library = {
  ...preludeDefs, ...preludeTypeDefs,
  apply: fn('apply', 'apply', ['f', 'x']), identity: fn('identity', 'identity', ['x']), select: fn('select', 'select', ['condition', 'whenTrue', 'whenFalse']),
  plus: fn('plus', '(+)', ['x', 'y']), minus: fn('minus', '(-)', ['x', 'y']), times: fn('times', '(*)', ['x', 'y']), negate: fn('negate', 'negate', ['x']),
  addZero: fn('addZero', 'addZero', []), mulOne: fn('mulOne', 'mulOne', []), eq: fn('eq', '(==)', ['x', 'y']), geq: fn('geq', '(>=)', ['x', 'y']),
}
const NEW = ['uncons', 'null', 'foldl', 'filter', 'reverse', 'concat', 'concatMap', 'elem', 'any', 'all', 'sum', 'product', 'take', 'drop', 'splitAt', 'replicate', 'enumFromTo', 'zip', 'zipWith', 'lookup', 'insertBy', 'sortBy', 'sort']

const call = (id, callee, slots) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.node)) })
const list = (id, items) => call(id, 'prelude:listOf', items)
const graphOf = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))

/** Run `callee args` both through its definition graph and natively; return both shown. */
function both(callee, args, extra) {
  const view = buildDefinitionView(library[callee], (id) => library[id])
  const ev = createEvaluator({ nodes: { ...library, ...view.defs }, functionBodies: view.bodies })
  return [view.viewId, callee].map((id) => showValue(ev.run({ ...extra, out: call('out', id, args) }, 'out')))
}
const run = (g, id) => showValue(createEvaluator({ nodes: library, functionBodies: {} }).run(g, id))

test('every new list function is written as a graph of its declared type, except uncons (the eliminator)', () => {
  for (const name of NEW) {
    const id = `prelude:${name}`
    assert.equal(hasDefinitionGraph(library[id]), name !== 'uncons', name)
    const view = buildDefinitionView(library[id], (x) => library[x])
    const pass = inferGraph({ ...library, ...view.defs }, view.bodies, { v: view.defs[view.viewId] })
    const declared = view.defs[view.viewId].scheme
    assert.equal(showQual(pass.perNode.get('v').preds, valueTypeOfEntry(pass.perNode.get('v'))), showQual(declared.preds, declared.type), name)
  }
})

test('the graphs mean what the builtins do', () => {
  const xs = list('xs', ['3', '1', '2'])
  const ys = list('ys', ['10', '20'])
  const empty = call('empty', 'prelude:nil', [])
  const nested = graphOf(list('a', ['1', '2']), list('b', []), list('c', ['3']))
  const xss = call('xss', 'prelude:listOf', [{ node: 'a' }, { node: 'b' }, { node: 'c' }])
  const odd = call('odd', 'eq', ['', '1']) // (== 1)
  const big = call('big', 'geq', ['', '2']) // (>= 2)
  const pairUp = call('pairUp', 'prelude:replicate', ['2', '']) // \x -> [x, x]
  const sub = call('sub', 'minus', ['', ''])
  const cmp = call('cmp', 'prelude:compare', ['', ''])
  const ctx = { xs, ys, empty, ...nested, xss, odd, big, pairUp, sub, cmp }
  const same = (name, args) => {
    const [viewed, native] = both(`prelude:${name}`, args, ctx)
    assert.equal(viewed, native, `${name} ${JSON.stringify(args)}`)
    return native
  }
  assert.equal(same('uncons', [{ node: 'xs' }]), 'Just (3,[1,2])')
  assert.equal(same('null', [{ node: 'xs' }]), 'False')
  assert.equal(same('null', [{ node: 'empty' }]), 'True')
  assert.equal(same('foldl', [{ node: 'sub' }, '100', { node: 'xs' }]), '94')
  assert.equal(same('filter', [{ node: 'big' }, { node: 'xs' }]), '[3,2]')
  assert.equal(same('reverse', [{ node: 'xs' }]), '[2,1,3]')
  assert.equal(same('concat', [{ node: 'xss' }]), '[1,2,3]')
  assert.equal(same('concatMap', [{ node: 'pairUp' }, { node: 'xs' }]), '[3,3,1,1,2,2]')
  assert.equal(same('elem', ['2', { node: 'xs' }]), 'True')
  assert.equal(same('elem', ['7', { node: 'xs' }]), 'False')
  assert.equal(same('any', [{ node: 'odd' }, { node: 'xs' }]), 'True')
  assert.equal(same('all', [{ node: 'big' }, { node: 'xs' }]), 'False')
  assert.equal(same('sum', [{ node: 'xs' }]), '6')
  assert.equal(same('product', [{ node: 'xs' }]), '6')
  assert.equal(same('sum', [{ node: 'empty' }]), '0')
  for (const n of ['-1', '0', '2', '5']) {
    same('take', [n, { node: 'xs' }])
    same('drop', [n, { node: 'xs' }])
    same('splitAt', [n, { node: 'xs' }])
    same('replicate', [n, '7'])
  }
  assert.equal(same('splitAt', ['1', { node: 'xs' }]), '([3],[1,2])')
  assert.equal(same('enumFromTo', ['1', '5']), '[1,2,3,4,5]')
  assert.equal(same('enumFromTo', ['3', '1']), '[]')
  assert.equal(same('zip', [{ node: 'xs' }, { node: 'ys' }]), '[(3,10),(1,20)]')
  assert.equal(same('zipWith', [{ node: 'sub' }, { node: 'ys' }, { node: 'xs' }]), '[7,19]')
  assert.equal(same('insertBy', [{ node: 'cmp' }, '2', { node: 'xs' }]), '[2,3,1,2]')
  assert.equal(same('sortBy', [{ node: 'cmp' }, { node: 'xs' }]), '[1,2,3]')
  assert.equal(same('sort', [{ node: 'xs' }]), '[1,2,3]')
})

test('lookup finds the first pair with the key', () => {
  const g = graphOf(
    call('p1', 'prelude:pair', ['1', '"one"']), call('p2', 'prelude:pair', ['2', '"two"']),
    call('ps', 'prelude:listOf', [{ node: 'p1' }, { node: 'p2' }]),
  )
  for (const [k, want] of [['2', 'Just "two"'], ['9', 'Nothing']]) {
    const [viewed, native] = both('prelude:lookup', [k, { node: 'ps' }], g)
    assert.equal(native, want)
    assert.equal(viewed, native)
  }
})

test('the list functions are lazy where Haskell is: on an infinite list', () => {
  // [1..] is enumFromTo 1 (a huge bound); take, filter, zip, any, elem stop early.
  const g = graphOf(
    call('nat', 'prelude:enumFromTo', ['1', '1000000000']),
    call('big', 'geq', ['', '5']),
    call('t', 'prelude:take', ['3', { node: 'nat' }]),
    call('f', 'prelude:filter', [{ node: 'big' }, { node: 'nat' }]),
    call('ft', 'prelude:take', ['2', { node: 'f' }]),
    call('z', 'prelude:zip', [{ node: 't' }, { node: 'nat' }]),
    call('a', 'prelude:any', [{ node: 'big' }, { node: 'nat' }]),
    call('e', 'prelude:elem', ['42', { node: 'nat' }]),
  )
  assert.equal(run(g, 't'), '[1,2,3]')
  assert.equal(run(g, 'ft'), '[5,6]')
  assert.equal(run(g, 'z'), '[(1,1),(2,2),(3,3)]')
  assert.equal(run(g, 'a'), 'True')
  assert.equal(run(g, 'e'), 'True')
})

test('the definitions print as Haskell', () => {
  const print = (name) => {
    const view = buildDefinitionView(library[`prelude:${name}`], (id) => library[id])
    return printDefinition(view.viewId, { ...library, ...view.defs }, view.bodies)
  }
  assert.equal(print('filter'), 'filter p xs = foldr ((\\p x acc -> select (apply p x) (x : acc) acc) p) [] xs')
  assert.equal(print('sum'), 'sum xs = getSum (foldMap Sum xs)')
  assert.equal(print('sort'), 'sort xs = sortBy compare xs')
})
