// Editing a type declaration rewires the project (call ids, labels, slots),
// and every function derived from a type can be customized — on the
// click-counter example, which must keep playing and type-checking.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { createGame } from '../src/runtime.js'
import { declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { customizeDerived, isPristineOverride, migrateTypeEdit, primitiveDefinitions, resetDerived } from '../src/typeEdits.js'
import { showType } from '../src/typeSystem.js'

function registryOf(project) {
  const used = new Set(Object.values(project.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
  const derived = derivedDefinitions(project.types)
  return {
    ...Object.fromEntries([...used].filter((id) => !project.nodes[id] && !id.startsWith('type:') && !id.startsWith('prim:')).map((id) => [id, { id, type: 'function', builtin: id.replace('prelude:', ''), label: id }])),
    compose: { id: 'compose', builtin: 'compose' },
    ...Object.fromEntries([...derived, ...primitiveDefinitions(derived)].map((d) => [d.id, d])),
    ...project.nodes,
  }
}

/** Click "Click!" three times and buy once; the texts on screen. */
function play(project) {
  const nodes = registryOf(project)
  const ev = createEvaluator({ nodes, functionBodies: project.functionBodies, types: project.types })
  const game = createGame(ev, ev.run(nodes, 'main'))
  const buttons = () => { const out = []; const walk = (w) => { if (w.kind === 'button') out.push(w); (w.children || []).forEach(walk) }; walk(game.view()); return out }
  for (let i = 0; i < 12; i++) game.dispatch(buttons().find((b) => b.label === 'Click!').msg)
  game.dispatch(buttons().find((b) => /per click/.test(b.label)).msg)
  const texts = []
  const collect = (w) => { if (w.kind === 'text') texts.push(w.text); (w.children || []).forEach(collect) }
  collect(game.view())
  return texts
}

function typeOfMain(project) {
  setDynamicInstances(derivedInstances(project.types))
  try {
    const pass = inferGraph(registryOf(project), project.functionBodies, project.nodes)
    reduce(pass.preds)
    return showType(valueTypeOfEntry(pass.perNode.get('main')))
  } finally {
    setDynamicInstances([])
  }
}

/** Replace declaration `name` by `source`, migrating the project with `keys`. */
function edit(project, name, source, keys) {
  const before = project.types[name]
  project.types = declareTypes(project.types, source, { replacing: name })
  const after = project.types[source.match(/^(?:data|newtype) ([A-Z]\w*)/)[1]]
  return migrateTypeEdit(project, before, after, keys)
}
const calls = (project, id) => [project.nodes, ...Object.values(project.functionBodies)].flatMap((g) => Object.values(g)).filter((n) => n.sourceFunctionId === id)
const MODEL = (fields) => `data Model = Model { ${fields} } deriving stock (Show)`

test('the example plays as shipped', () => {
  const texts = play(buildClickCounter())
  assert.ok(texts.includes('Clicks: 2') && texts.includes('Per click: 2'), texts.join(' | '))
})

test('renaming a field renames its projection and lens calls everywhere', () => {
  const project = buildClickCounter()
  const n = edit(project, 'Model', MODEL('purse :: Wallet, perClick :: Int, rate :: Int, elapsed :: Int'), { ctors: [0], fields: [[0, 1, 2, 3]] })
  assert.ok(n > 0)
  assert.equal(calls(project, 'type:Model:wallet').length, 0)
  assert.ok(calls(project, 'type:Model:purse').length > 0)
  assert.ok(calls(project, 'type:Model:over purse').every((c) => c.label === 'over purse'))
  assert.equal(typeOfMain(project), 'Program Model Msg')
  assert.ok(play(project).includes('Clicks: 2'))
})

test('adding a field gives every constructor call an empty slot in the right place', () => {
  const project = buildClickCounter()
  edit(project, 'Model', MODEL('wallet :: Wallet, bonus :: Int, perClick :: Int, rate :: Int, elapsed :: Int'), { ctors: [0], fields: [[0, 2, 3, 4]] })
  const [ctor] = calls(project, 'type:Model:Model')
  assert.deepEqual(ctor.params, ['', '', '1', '0', '0'], 'perClick, rate and elapsed keep their literals, bonus is new')
  assert.ok(ctor.mounted[0], 'the Wallet stays plugged into wallet')
  // Fill the new slot and the game plays again.
  ctor.params[1] = '0'
  assert.equal(typeOfMain(project), 'Program Model Msg')
  assert.ok(play(project).includes('Clicks: 2'))
})

test('adding a constructor gives every case call a new branch slot before the scrutinee', () => {
  const project = buildClickCounter()
  edit(project, 'Msg', 'data Msg = Click | Buy | BuyAuto | Reset deriving stock (Eq, Show)', { ctors: [0, 1, 2], fields: [[], [], []] })
  const [kase] = calls(project, 'type:Msg:caseMsg')
  const body = project.functionBodies.handle
  assert.equal(kase.params.length, 5)
  assert.equal(kase.mounted[3], null, 'the new Reset branch is empty')
  assert.equal(body[kase.mounted[4]].type, 'parameter', 'the scrutinee moved to the last slot')
  assert.equal(body[kase.mounted[4]].mountedTo, `${kase.id}:4`, "and knows where it's plugged")
})

test('removing a field drops its constructor slot and unplugs what was in it', () => {
  const project = buildClickCounter()
  edit(project, 'Model', MODEL('wallet :: Wallet, perClick :: Int'), { ctors: [0], fields: [[0, 1]] })
  const [ctor] = calls(project, 'type:Model:Model')
  assert.deepEqual(ctor.params, ['', '1'])
  assert.ok(calls(project, 'type:Model:rate').length > 0, 'calls to the removed projection are left for the editor to flag as broken')
})

test('renaming a constructor renames its calls (and the case slot stays)', () => {
  const project = buildClickCounter()
  edit(project, 'Msg', 'data Msg = Tap | Buy | BuyAuto deriving stock (Eq, Show)', { ctors: [0, 1, 2], fields: [[], [], []] })
  assert.equal(calls(project, 'type:Msg:Click').length, 0)
  assert.ok(calls(project, 'type:Msg:Tap').every((c) => c.label === 'Tap'))
  assert.ok(play(project).includes('Clicks: 2'))
})

test('renaming a type renames its constructor, lenses and case', () => {
  const project = buildClickCounter()
  edit(project, 'Msg', 'data Action = Click | Buy | BuyAuto deriving stock (Eq, Show)', { ctors: [0, 1, 2], fields: [[], [], []] })
  assert.ok(calls(project, 'type:Action:caseAction').length === 1 && calls(project, 'type:Msg:caseMsg').length === 0)
  assert.equal(typeOfMain(project), 'Program Model Action')
})

test('a derived function can be customized; its body starts as its primitive and plays the same', () => {
  const project = buildClickCounter()
  const def = derivedDefinitions(project.types).find((d) => d.id === 'type:Wallet:Wallet')
  customizeDerived(project, def)
  assert.ok(isPristineOverride(project, def))
  assert.equal(project.functionBodies[def.id].prim.sourceFunctionId, 'prim:type:Wallet:Wallet')
  assert.equal(project.functionBodies[def.id].prim.label, 'Wallet#')
  assert.ok(play(project).includes('Clicks: 2'))
  assert.equal(typeOfMain(project), 'Program Model Msg')
})

test('a customized constructor changes the game (a smart constructor doubling every wallet)', () => {
  const project = buildClickCounter()
  const def = derivedDefinitions(project.types).find((d) => d.id === 'type:Wallet:Wallet')
  customizeDerived(project, def)
  const body = project.functionBodies[def.id]
  // Wallet c = Wallet# (c * 2)
  body.dbl = { id: 'dbl', type: 'function', sourceFunctionId: 'times', label: '(*)', params: ['', '2'], mounted: ['input-type:Wallet:Wallet-0', null], paramScopes: ['local', 'local'] }
  body.prim.mounted = ['dbl']
  project.nodes.times = { id: 'times', type: 'function', builtin: 'times', label: '(*)', params: ['x', 'y'], mounted: [null, null] }
  assert.ok(!isPristineOverride(project, def))
  // 12 clicks of 2 = 24, then a purchase that costs Wallet 10 → 20: 24 - 20 = 4.
  assert.ok(play(project).includes('Clicks: 4'), play(project).join(' | '))
  assert.equal(typeOfMain(project), 'Program Model Msg')
  resetDerived(project, def.id)
  assert.ok(play(project).includes('Clicks: 2'))
})

test('customizations follow type edits: an untouched one is re-made, a changed one keeps its body', () => {
  const project = buildClickCounter()
  const defs = derivedDefinitions(project.types)
  customizeDerived(project, defs.find((d) => d.id === 'type:Model:perClick'))
  customizeDerived(project, defs.find((d) => d.id === 'type:Model:rate'))
  project.functionBodies['type:Model:rate'].marker = { id: 'marker', type: 'number', value: '7', label: '7' } // a user change
  edit(project, 'Model', MODEL('wallet :: Wallet, perTap :: Int, speed :: Int, elapsed :: Int'), { ctors: [0], fields: [[0, 1, 2, 3]] })
  assert.ok(!project.nodes['type:Model:perClick'] && project.nodes['type:Model:perTap'].override)
  assert.equal(project.functionBodies['type:Model:perTap'].prim.sourceFunctionId, 'prim:type:Model:perTap')
  assert.ok(project.functionBodies['type:Model:speed'].marker, 'the changed body moved along')
  assert.equal(project.functionBodies['type:Model:speed'].prim.sourceFunctionId, 'prim:type:Model:speed', 'its primitive call was rewired too')
  assert.ok(play(project).includes('Clicks: 2'))
})

test("a changed customization whose definition is removed becomes an ordinary function", () => {
  const project = buildClickCounter()
  customizeDerived(project, derivedDefinitions(project.types).find((d) => d.id === 'type:Model:rate'))
  project.functionBodies['type:Model:rate'].marker = { id: 'marker', type: 'number', value: '7', label: '7' }
  edit(project, 'Model', MODEL('wallet :: Wallet, perClick :: Int'), { ctors: [0], fields: [[0, 1]] })
  const kept = Object.values(project.nodes).find((n) => n.custom && n.label === 'rate')
  assert.ok(kept && !kept.override)
  assert.ok(calls(project, kept.id).length > 0, 'its callers now call the ordinary function')
})
