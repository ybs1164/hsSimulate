// Read-only definition views: a function written as a graph must mean
// exactly what the builtin does, and a primitive is shown as itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDefinitionView, viewIdOf } from '../src/definitionViews.js'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { printDefinition } from '../src/haskellPrint.js'
import { inferGraph } from '../src/inferGraph.js'
import { declareTypes, derivedDefinitions } from '../src/typeDecls.js'
import { showQual } from '../src/typeSystem.js'

const fn = (id, builtin, label, params) => ({ id, type: 'function', builtin, label, params, mounted: params.map(() => null) })
const base = {
  apply: fn('apply', 'apply', 'apply', ['f', 'x']),
  compose: fn('compose', 'compose', 'compose', ['f', 'g', 'x']),
  identity: fn('identity', 'identity', 'identity', ['x']),
  isZero: fn('isZero', 'isZero', 'isZero', ['n']),
  plus: fn('plus', 'plus', '(+)', ['x', 'y']),
  minus: fn('minus', 'minus', '(-)', ['x', 'y']),
  eq: fn('eq', 'eq', '(==)', ['x', 'y']),
  select: fn('select', 'select', 'select', ['condition', 'whenTrue', 'whenFalse']),
  'prelude:foldr': fn('prelude:foldr', 'foldr', 'foldr', ['f', 'z', 'xs']),
  'prelude:cons': fn('prelude:cons', 'cons', '(:)', ['x', 'xs']),
  'prelude:nil': fn('prelude:nil', 'nil', '[]', []),
  'prelude:just': fn('prelude:just', 'just', 'Just', ['x']),
  'prelude:nothing': fn('prelude:nothing', 'nothing', 'Nothing', []),
  'prelude:mappend': fn('prelude:mappend', 'mappend', '(<>)', ['x', 'y']),
  'prelude:mempty': fn('prelude:mempty', 'mempty', 'mempty', []),
  'prelude:rgb': fn('prelude:rgb', 'rgb', 'rgb', ['r', 'g', 'b']),
  'prelude:listOf': fn('prelude:listOf', 'listOf', '[ , , ]', []),
  'prelude:map': fn('prelude:map', 'map', 'map', ['f', 'xs']),
  'prelude:length': fn('prelude:length', 'length', 'length', ['xs']),
  'prelude:append': fn('prelude:append', 'append', '(++)', ['xs', 'ys']),
  'prelude:index': fn('prelude:index', 'index', '(!?)', ['xs', 'i']),
  'prelude:mconcat': fn('prelude:mconcat', 'mconcat', 'mconcat', ['xs']),
  'prelude:red': fn('prelude:red', 'red', 'red', []),
  'prelude:maybe': fn('prelude:maybe', 'maybe', 'maybe', ['default', 'f', 'm']),
}

/** Evaluate `view of defId` and the function itself on the same argument graph; return both shown. */
function both(defs, defId, args, extra = {}) {
  const view = buildDefinitionView(defs[defId], (id) => defs[id])
  const registry = { nodes: { ...defs, ...view.defs }, functionBodies: view.bodies }
  const ev = createEvaluator(registry)
  const mk = (sourceFunctionId) => ({ id: 'call', type: 'function', sourceFunctionId, params: args.map((a) => (typeof a === 'string' ? a : '')), mounted: args.map((a) => (typeof a === 'string' ? null : a.id)) })
  const g = (sourceFunctionId) => ({ ...extra, call: mk(sourceFunctionId) })
  return [showValue(ev.run(g(view.viewId), 'call')), showValue(ev.run(g(defId), 'call'))]
}
const list = (id, items) => ({ id, type: 'function', sourceFunctionId: 'prelude:listOf', params: items, mounted: items.map(() => null) })
const node = (n) => ({ id: n.id, ...n })

test('Prelude functions written with foldr mean what the builtins do', () => {
  const xs = list('xs', ['1', '2', '3'])
  const add10 = node({ id: 'add10', type: 'function', sourceFunctionId: 'plus', params: ['10', ''], mounted: [null, null] })
  const [viewMap, realMap] = both(base, 'prelude:map', [add10, xs], { xs, add10 })
  assert.equal(viewMap, realMap)
  assert.equal(viewMap, '[11,12,13]')
  assert.deepEqual(...both(base, 'prelude:length', [xs], { xs }))
  const ys = list('ys', ['4'])
  assert.deepEqual(...both(base, 'prelude:append', [xs, ys], { xs, ys }))
  for (const i of ['0', '2', '3', '-1']) assert.deepEqual(...both(base, 'prelude:index', [xs, i], { xs }), `xs !? ${i}`)
  const strs = list('strs', ['"ab"', '"c"'])
  assert.deepEqual(...both(base, 'prelude:mconcat', [strs], { strs }))
  assert.deepEqual(...both(base, 'prelude:red', []))
  assert.deepEqual(...both(base, 'compose', [node({ id: 'inc', type: 'function', sourceFunctionId: 'plus', params: ['1', ''], mounted: [null, null] }), node({ id: 'dbl', type: 'function', sourceFunctionId: 'plus', params: ['5', ''], mounted: [null, null] }), '2'], { inc: node({ id: 'inc', type: 'function', sourceFunctionId: 'plus', params: ['1', ''], mounted: [null, null] }), dbl: node({ id: 'dbl', type: 'function', sourceFunctionId: 'plus', params: ['5', ''], mounted: [null, null] }) }))
  assert.deepEqual(...both(base, 'isZero', ['0']))
  assert.deepEqual(...both(base, 'identity', ['7']))
})

test('a view prints as the Haskell definition it is, with the real type', () => {
  const print = (defId) => {
    const view = buildDefinitionView(base[defId], (id) => base[id])
    return printDefinition(view.viewId, { ...base, ...view.defs }, view.bodies)
  }
  assert.equal(print('prelude:length'), 'length xs = foldr (\\x n -> n + 1) 0 xs')
  assert.equal(print('prelude:append'), '(++) xs ys = foldr (:) ys xs')
  assert.equal(print('prelude:map'), 'map f xs = foldr ((\\f x acc -> apply f x : acc) f) [] xs')
  assert.equal(print('prelude:red'), 'red = rgb 1 0 0')
  const view = buildDefinitionView(base['prelude:map'], (id) => base[id])
  const pass = inferGraph({ ...base, ...view.defs }, view.bodies, { v: view.defs[view.viewId] })
  const e = pass.perNode.get('v')
  assert.equal(showQual(e.preds, e.paramTypes.reduceRight((acc, t) => ({ kind: 'fun', from: t, to: acc }), e.resultType)), '(a → b) → [a] → [b]')
})

test('a primitive is shown as its parameters applied to it, with a note', () => {
  const view = buildDefinitionView(base['prelude:maybe'], (id) => base[id])
  const def = view.defs[viewIdOf('prelude:maybe')]
  assert.match(def.note, /eliminator of Maybe/)
  assert.equal(printDefinition(view.viewId, { ...base, ...view.defs }, view.bodies), 'maybe default f m = maybe default f m')
})

test('projections, updates and the recursor of a declared type are written with its eliminator', () => {
  const types = declareTypes({}, 'data Model = Model { clicks :: Double, perClick :: Double }\ndata Nat = Z | S Nat')
  const defs = { ...base, ...Object.fromEntries(derivedDefinitions(types).map((d) => [d.id, d])) }
  const print = (defId) => {
    const view = buildDefinitionView(defs[defId], (id) => defs[id])
    return printDefinition(view.viewId, { ...defs, ...view.defs }, view.bodies)
  }
  assert.equal(print('type:Model:clicks'), 'clicks model = caseModel (\\clicks perClick -> clicks) model')
  assert.equal(print('type:Model:set clicks'), "set clicks clicks model = caseModel ((\\clicks clicks' perClick -> Model clicks perClick) clicks) model")
  assert.equal(print('type:Model:over perClick'), 'over perClick f model = caseModel ((\\f clicks perClick -> Model clicks (apply f perClick)) f) model')
  assert.equal(print('type:Nat:foldNat'), 'foldNat z s nat = caseNat z ((\\z s x1 -> apply s (foldNat z s x1)) z s) nat')
  const m = { id: 'm', type: 'function', sourceFunctionId: 'type:Model:Model', params: ['3', '4'], mounted: [null, null] }
  assert.deepEqual(...both(defs, 'type:Model:clicks', [m], { m }))
  assert.deepEqual(...both(defs, 'type:Model:set clicks', ['9', m], { m }))
  const inc = { id: 'inc', type: 'function', sourceFunctionId: 'plus', params: ['1', ''], mounted: [null, null] }
  assert.deepEqual(...both(defs, 'type:Model:over perClick', [inc, m], { m, inc }))
  // foldNat 0 (+1) (S (S Z)) = 2
  const z = { id: 'z', type: 'function', sourceFunctionId: 'type:Nat:Z', params: [], mounted: [] }
  const s1 = { id: 's1', type: 'function', sourceFunctionId: 'type:Nat:S', params: [''], mounted: ['z'] }
  const s2 = { id: 's2', type: 'function', sourceFunctionId: 'type:Nat:S', params: [''], mounted: ['s1'] }
  const [viewFold, realFold] = both(defs, 'type:Nat:foldNat', ['0', inc, s2], { z, s1, s2, inc })
  assert.equal(viewFold, realFold)
  assert.equal(viewFold, '2')
})

test('a list literal is shown as the (:) chain it stands for, for its own length', () => {
  const view = buildDefinitionView(base['prelude:listOf'], (id) => base[id], { slots: 3 })
  assert.equal(view.viewId, 'view:prelude:listOf/3')
  assert.match(view.defs[view.viewId].note, /^syntax/)
  const text = printDefinition(view.viewId, { ...base, ...view.defs }, view.bodies)
  assert.equal(text, '[x1, x2, x3] = x1 : x2 : x3 : []')
  const ev = createEvaluator({ nodes: { ...base, ...view.defs }, functionBodies: view.bodies })
  const call = { id: 'call', type: 'function', sourceFunctionId: view.viewId, params: ['1', '2', '3'], mounted: [null, null, null] }
  assert.equal(showValue(ev.run({ call }, 'call')), '[1,2,3]')
})
