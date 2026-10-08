// Class methods at a declared type (`(+) @Wallet`): written as the derived
// definition, equal to what the builtin does, and — once edited — what
// every use of the method at that type runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDefinitionView, isEditableView, overrideFromView } from '../src/definitionViews.js'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { printDefinition } from '../src/haskellPrint.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { setDynamicInstances } from '../src/prelude.js'
import { declareTypes, derivedDefinitions, derivedInstances, instanceDefinitions } from '../src/typeDecls.js'
import { showQual } from '../src/typeSystem.js'

const fn = (id, builtin, label, params) => ({ id, type: 'function', builtin, label, params, mounted: params.map(() => null), readonly: true })
const BUILTINS = Object.fromEntries([
  ['apply', 'apply', ['f', 'x']], ['identity', 'identity', ['x']], ['compose', 'compose', ['f', 'g', 'x']], ['select', 'select', ['condition', 'whenTrue', 'whenFalse']],
  ['plus', '(+)', ['x', 'y']], ['minus', '(-)', ['x', 'y']], ['negate', 'negate', ['x']], ['times', '(*)', ['x', 'y']], ['eq', '(==)', ['x', 'y']], ['geq', '(>=)', ['x', 'y']],
].map(([id, label, params]) => [id, fn(id, id, label, params)]))

const types = declareTypes({}, `data V2 = V2 { x :: Double, y :: Double } deriving stock (Eq, Ord, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, VectorSpace, PartialOrd, Lattice)
data Shape = Dot | Circle Double | Rect Double Double deriving stock (Eq, Show)
data Box = Box { v :: V2, label :: Double } deriving anyclass (AddSemigroup)`)
const defs = { ...BUILTINS, ...preludeDefs, ...preludeTypeDefs, ...Object.fromEntries([...derivedDefinitions(types), ...instanceDefinitions(types)].map((d) => [d.id, d])) }
const view = (id) => buildDefinitionView(defs[id], (x) => defs[x])
const print = (id) => { const v = view(id); return printDefinition(v.viewId, { ...defs, ...v.defs }, v.bodies) }

test('a derived instance gives its methods as definitions of their own, at the type', () => {
  const at = (id) => showQual(defs[id].scheme.preds, defs[id].scheme.type)
  assert.equal(defs['instance:V2:plus'].label, '(+) @V2')
  assert.equal(at('instance:V2:plus'), 'V2 → V2 → V2')
  assert.equal(at('instance:V2:scale'), 'Double → V2 → V2')
  assert.equal(at('instance:V2:leq'), 'V2 → V2 → Bool')
  assert.equal(at('instance:Shape:eq'), 'Shape → Shape → Bool')
  assert.ok(!defs['instance:Shape:geq'], 'Shape derives no Ord')
})

test('…written the way they are derived', () => {
  assert.equal(print('instance:V2:plus'), '(+) @V2 x y = caseV2 ((\\y x1 y1 -> caseV2 ((\\x1 y1 x2 y2 -> V2 (x1 + x2) (y1 + y2)) x1 y1) y) y) x')
  assert.equal(print('instance:V2:negate'), 'negate @V2 x = caseV2 (\\x1 y1 -> V2 (negate x1) (negate y1)) x')
  assert.equal(print('instance:V2:scale'), '(*^) @V2 k v = caseV2 ((\\k x1 y1 -> V2 (k *^ x1) (k *^ y1)) k) v')
  assert.match(print('instance:V2:leq'), /select \(leq x1 x2\) \(leq y1 y2\) False/)
  assert.match(print('instance:V2:geq'), /select \(x1 == x2\) \(y1 >= y2\) \(x1 >= x2\)/)
  assert.equal(print('instance:Shape:eq'), '(==) @Shape x y = caseShape (caseShape True (\\b1 -> False) (\\b1 b2 -> False) y) ((\\y a1 -> caseShape False ((\\a1 b1 -> a1 == b1) a1) (\\b1 b2 -> False) y) y) ((\\y a1 a2 -> caseShape False (\\b1 -> False) ((\\a1 a2 b1 b2 -> select (a1 == b1) (a2 == b2) False) a1 a2) y) y) x')
})

test('…with the type of the method at that type', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    for (const id of Object.keys(defs).filter((k) => k.startsWith('instance:'))) {
      const v = view(id)
      const pass = inferGraph({ ...defs, ...v.defs }, v.bodies, { v: v.defs[v.viewId] })
      const entry = pass.perNode.get('v')
      assert.equal(showQual(entry.preds, valueTypeOfEntry(entry)), showQual(defs[id].scheme.preds, defs[id].scheme.type), id)
      assert.ok(isEditableView(v.viewId, v.defs), `${id} is editable`)
    }
  } finally {
    setDynamicInstances([])
  }
})

const mk = (sourceFunctionId, slots) => ({ type: 'function', sourceFunctionId, params: slots.map((s) => (typeof s === 'string' ? s : '')), mounted: slots.map((s) => (typeof s === 'string' ? null : s.id)) })
const graph = {
  a: { id: 'a', ...mk('type:V2:V2', ['1', '5']) },
  b: { id: 'b', ...mk('type:V2:V2', ['3', '2']) },
  c1: { id: 'c1', ...mk('type:Shape:Circle', ['1']) },
  c2: { id: 'c2', ...mk('type:Shape:Circle', ['2']) },
  r: { id: 'r', ...mk('type:Shape:Rect', ['1', '2']) },
  dot: { id: 'dot', ...mk('type:Shape:Dot', []) },
  box: { id: 'box', ...mk('type:Box:Box', [{ id: 'a' }, '7']) },
  box2: { id: 'box2', ...mk('type:Box:Box', [{ id: 'b' }, '1']) },
}
const call = (callee, slots) => ({ ...graph, call: { id: 'call', ...mk(callee, slots) } })

test('…meaning what the builtins do', () => {
  const v = (id) => view(id)
  const cases = [
    ['plus', [{ id: 'a' }, { id: 'b' }]], ['minus', [{ id: 'a' }, { id: 'b' }]], ['negate', [{ id: 'a' }]], ['scale', ['2', { id: 'b' }]],
    ['leq', [{ id: 'a' }, { id: 'b' }]], ['join', [{ id: 'a' }, { id: 'b' }]], ['meet', [{ id: 'a' }, { id: 'b' }]],
    ['geq', [{ id: 'a' }, { id: 'b' }]], ['geq', [{ id: 'b' }, { id: 'a' }]], ['eq', [{ id: 'a' }, { id: 'a' }]], ['eq', [{ id: 'a' }, { id: 'b' }]],
  ]
  for (const [method, slots] of cases) {
    const viewed = v(`instance:V2:${method}`)
    const ev = createEvaluator({ nodes: { ...defs, ...viewed.defs }, functionBodies: viewed.bodies })
    assert.equal(showValue(ev.run(call(viewed.viewId, slots), 'call')), showValue(ev.run(call(method === 'scale' ? 'prelude:scale' : method === 'leq' || method === 'join' || method === 'meet' ? `prelude:${method}` : method, slots), 'call')), `${method} ${JSON.stringify(slots)}`)
  }
  for (const [p, q] of [['c1', 'c1'], ['c1', 'c2'], ['c1', 'r'], ['dot', 'dot'], ['dot', 'r'], ['r', 'r']]) {
    const viewed = v('instance:Shape:eq')
    const ev = createEvaluator({ nodes: { ...defs, ...viewed.defs }, functionBodies: viewed.bodies })
    assert.equal(ev.run(call(viewed.viewId, [{ id: p }, { id: q }]), 'call'), ev.run(call('eq', [{ id: p }, { id: q }]), 'call'), `${p} == ${q}`)
  }
})

test('an edited instance method is what (+) runs at that type — inside other records too', () => {
  const v = view('instance:V2:plus')
  const { body, lambdas, lambdaBodies } = overrideFromView(v.viewId, v.defs, v.bodies)
  // x + y = y: take the right operand (a lopsided "sum", to see it is used)
  const root = body[body.output.source]
  root.connected = false
  body.output.source = Object.values(body).find((n) => n.type === 'parameter' && n.label === 'y').id
  const ev = createEvaluator({ nodes: { ...defs, ...lambdas }, functionBodies: { ...lambdaBodies, 'instance:V2:plus': body } })
  assert.equal(showValue(ev.run(call('plus', [{ id: 'a' }, { id: 'b' }]), 'call'), types), 'V2 {x = 3.0, y = 2.0}'.replace(/\.0/g, ''))
  // Box's (+) is fieldwise: its V2 field goes through V2's edited (+), its Double through Double's
  assert.equal(showValue(ev.run(call('plus', [{ id: 'box' }, { id: 'box2' }]), 'call'), types), 'Box {v = V2 {x = 3, y = 2}, label = 8}')
  // other types are untouched
  const plain = createEvaluator({ nodes: defs, functionBodies: {} })
  assert.equal(showValue(plain.run(call('plus', [{ id: 'box' }, { id: 'box2' }]), 'call'), types), 'Box {v = V2 {x = 4, y = 7}, label = 8}')
})
