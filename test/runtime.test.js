import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { createEvaluator, showValue } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { checkFunctionLaw } from '../src/laws.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { createGame, isProgram } from '../src/runtime.js'
import { derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { showType, tcon, tfun } from '../src/typeSystem.js'

const example = buildClickCounter()
// The registry the app would have: builtins (by the ids the example uses), derived definitions, the custom functions.
const usedIds = new Set(Object.values(example.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
const builtinDefs = Object.fromEntries([...usedIds].filter((id) => !example.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, type: 'function', builtin: id.replace('prelude:', ''), label: id, params: [], mounted: [] }]))
const derived = Object.fromEntries(derivedDefinitions(example.types).map((d) => [d.id, d]))
const nodes = { ...builtinDefs, compose: { id: 'compose', builtin: 'compose' }, ...derived, ...example.nodes }
const ev = createEvaluator({ nodes, functionBodies: example.functionBodies, types: example.types })
const show = (v) => showValue(v, example.types)
const clicks = (game) => game.model.args[0].args[0]

test('the example entry point evaluates to a Program', () => {
  assert.ok(isProgram(ev.run(nodes, 'main')))
})

test('the view is a widget tree of texts, buttons and a progress bar', () => {
  const game = createGame(ev, ev.run(nodes, 'main'))
  const tree = game.view()
  assert.equal(tree.kind, 'column')
  assert.deepEqual(tree.children.map((w) => w.kind), ['text', 'text', 'text', 'button', 'button', 'button', 'progress'])
  assert.equal(tree.children[0].text, 'Clicks: 0')
  assert.equal(tree.children[3].label, 'Click!')
  assert.equal(show(tree.children[3].msg), 'Click')
})

test('messages run through handle: click, buy, and a purchase you cannot afford', () => {
  const game = createGame(ev, ev.run(nodes, 'main'))
  const [click, buy, buyAuto] = game.view().children.slice(3, 6).map((b) => b.msg)
  for (let i = 0; i < 12; i++) game.dispatch(click)
  assert.equal(clicks(game), 12)
  game.dispatch(buy)
  assert.equal(show(game.model), 'Model {wallet = Wallet {clicks = 2}, perClick = 2, rate = 0, elapsed = 0}')
  game.dispatch(buyAuto)
  assert.equal(clicks(game), 2, 'cannot afford 25')
  assert.equal(game.log.length, 14)
  assert.equal(game.view().children[1].text, 'Per click: 2')
  assert.ok(Math.abs(game.view().children[6].value - 2 / 25) < 1e-12)
})

test('time passes through step: whole seconds pay rate, the elapsedeconds short of one are carried', () => {
  const game = createGame(ev, ev.run(nodes, 'main'))
  game.restore({ model: { ...game.model, args: [game.model.args[0], 1, 3, 0] } }) // rate 3
  game.tick(0.5)
  assert.equal(clicks(game), 0)
  assert.equal(show(game.model), 'Model {wallet = Wallet {clicks = 0}, perClick = 1, rate = 3, elapsed = 500}')
  game.tick(0.75)
  assert.equal(clicks(game), 3)
  assert.equal(game.model.args[3], 1250)
  assert.equal(game.time, 1.25)
})

test('step is a monoid action, so offline progress is one call — and agrees with slicing', () => {
  setDynamicInstances(derivedInstances(example.types))
  try {
    // the type program gives it (on its own, onTick :: OrderedField a => a → Model → Model)
    const stepType = tfun(tcon('Double'), tfun(tcon('Model'), tcon('Model')))
    const law = checkFunctionLaw('action', { kind: 'closure', callee: 'onTick', args: [null, null] }, stepType, { ev, types: example.types })
    assert.ok(law.ok, law.counterexample)

    const exact = createGame(ev, ev.run(nodes, 'main'), { exactTime: true })
    const sliced = createGame(ev, ev.run(nodes, 'main'), { exactTime: false })
    for (const g of [exact, sliced]) g.restore({ model: { ...g.model, args: [g.model.args[0], 1, 2, 0] } })
    const a = exact.advance(3600)
    const b = sliced.advance(3600)
    assert.deepEqual([a.calls, a.exact], [1, true])
    assert.ok(b.calls > 1000 && !b.exact)
    assert.deepEqual([clicks(exact), clicks(sliced)], [7200, 7200], 'Int clicks: exactly, both ways')
  } finally {
    setDynamicInstances([])
  }
})

test('the example type-checks: main :: Program Model Msg', () => {
  setDynamicInstances(derivedInstances(example.types))
  try {
    const pass = inferGraph(nodes, example.functionBodies, example.nodes)
    assert.equal(showType(valueTypeOfEntry(pass.perNode.get('main'))), 'Program Model Msg')
    assert.equal(showType(valueTypeOfEntry(pass.perNode.get('view'))), 'Model → Widget Msg')
    assert.equal(showType(valueTypeOfEntry(pass.perNode.get('purchase'))), 'Wallet → (Model → Model) → Model → Model')
    assert.doesNotThrow(() => reduce(pass.preds))
  } finally {
    setDynamicInstances([])
  }
})

test('time travel: rewind to the state right after an earlier message', () => {
  const game = createGame(ev, ev.run(nodes, 'main'))
  const [click, buy] = game.view().children.slice(3, 5).map((b) => b.msg)
  for (let i = 0; i < 12; i++) game.dispatch(click)
  game.dispatch(buy)
  game.dispatch(click)
  assert.equal(clicks(game), 4)
  assert.ok(game.rewind(12))
  assert.equal(clicks(game), 12)
  assert.equal(game.log.length, 12)
  assert.equal(game.canRewind(13), false, 'messages after the rewind point are gone')
  game.dispatch(click)
  assert.equal(clicks(game), 13, 'and play continues from there')
})

test('program settings: the example runs at 20 steps per second and keeps the default offline cap', () => {
  const game = createGame(ev, ev.run(nodes, 'main'))
  assert.equal(game.stepsPerSecond, 20)
  assert.equal(game.maxOffline, 7 * 24 * 3600)
  game.restore({ model: { ...game.model, args: [game.model.args[0], 1, 1, 0] } })
  const r = game.advance(30 * 24 * 3600)
  assert.equal(r.simulated, 7 * 24 * 3600, 'time away beyond maxOffline does not count')
})

test('subscriptions: onKey turns Space into Click; other keys do nothing', () => {
  const game = createGame(ev, ev.run(nodes, 'main'))
  assert.equal(game.subscriptions().keys.length, 1)
  assert.equal(game.keyPressed(' '), 1)
  assert.equal(game.keyPressed('a'), 0)
  assert.equal(clicks(game), 1)
  assert.equal(show(game.log[0]), 'Click')
})
