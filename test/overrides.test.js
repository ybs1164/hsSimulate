// Edited library definitions: a Prelude or derived function taken over as
// a graph (definitionViews.js's overrideFromView) is what every call runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { buildDefinitionView, isEditableView, overrideFromView } from '../src/definitionViews.js'
import { createEvaluator } from '../src/evaluator.js'
import { inferGraph } from '../src/inferGraph.js'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { createGame } from '../src/runtime.js'
import { derivedDefinitions } from '../src/typeDecls.js'
import { drawSignature } from '../src/typeGraph.js'

const fn = (id, builtin, label, params) => ({ id, type: 'function', builtin, label, params, mounted: params.map(() => null), readonly: true })
const BUILTINS = {
  apply: fn('apply', 'apply', 'apply', ['f', 'x']),
  compose: fn('compose', 'compose', 'compose', ['f', 'g', 'x']),
  identity: fn('identity', 'identity', 'identity', ['x']),
  plus: fn('plus', 'plus', '(+)', ['x', 'y']),
  minus: fn('minus', 'minus', '(-)', ['x', 'y']),
  divide: fn('divide', 'divide', '(/)', ['x', 'y']),
  eq: fn('eq', 'eq', '(==)', ['x', 'y']),
  select: fn('select', 'select', 'select', ['condition', 'whenTrue', 'whenFalse']),
}

/** The click counter as the app holds it: every definition, and its bodies (overrides go in there). */
function clickCounter() {
  const project = buildClickCounter()
  const definitions = { ...BUILTINS, ...preludeDefs, ...preludeTypeDefs, ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])), ...project.nodes }
  return { project, definitions, bodies: project.functionBodies }
}

/** Take `defId` over, as the editor's "Edit definition" does. */
function edit({ definitions, bodies }, defId) {
  const view = buildDefinitionView(definitions[defId], (id) => definitions[id])
  let k = 0
  const sch = view.defs[view.viewId].scheme
  drawSignature(view.bodies[view.viewId], sch.preds, sch.type, () => `t${++k}`) // as the editor does
  assert.ok(isEditableView(view.viewId, view.defs), `${defId} is editable`)
  const { body, lambdas, lambdaBodies } = overrideFromView(view.viewId, view.defs, view.bodies)
  Object.assign(definitions, lambdas)
  Object.assign(bodies, lambdaBodies, { [defId]: body })
  return body
}

function texts({ definitions, bodies, project }, clicks = 3) {
  const ev = createEvaluator({ nodes: definitions, functionBodies: bodies, types: project.types })
  const game = createGame(ev, ev.run(definitions, 'main'))
  const all = []
  const walk = (w) => { if (w.kind === 'text') all.push(w.text); (w.children || []).forEach(walk) }
  const button = (w) => (w.kind === 'button' && w.label === 'Click!' ? w : (w.children || []).map(button).find(Boolean))
  for (let i = 0; i < clicks; i++) game.dispatch(button(game.view()).msg)
  walk(game.view())
  return all
}

test('an edited definition, left as it was, plays exactly like the builtin', () => {
  const before = texts(clickCounter())
  const app = clickCounter()
  for (const id of ['prelude:append', 'type:Model:over wallet', 'type:Model:perClick', 'type:Wallet:clicks', 'prelude:wText', 'prelude:wButton', 'prelude:program', 'prelude:setStepsPerSecond', 'prelude:setSubscriptions', 'prelude:onKey']) edit(app, id)
  assert.ok(Object.keys(app.definitions).some((id) => id.startsWith('type:Model:over wallet/λ')), 'its λs come along, renamed')
  assert.deepEqual(texts(app), before)
  assert.ok(before.includes('Clicks: 3'))
})

test('every call runs the edited graph', () => {
  const app = clickCounter()
  const body = edit(app, 'prelude:append')
  // (++) xs ys = foldr (:) ys xs  →  foldr (:) xs ys: the arguments swap.
  const fold = Object.values(body).find((n) => n.sourceFunctionId === 'prelude:foldr')
  ;[fold.mounted[1], fold.mounted[2]] = [fold.mounted[2], fold.mounted[1]]
  fold.mounted.forEach((id, i) => { if (id) body[id].mountedTo = `${fold.id}:${i}` })
  assert.ok(texts(app).includes('3Clicks: '))
})

test('an edited definition keeps its type, and is checked against it', () => {
  const app = clickCounter()
  const body = edit(app, 'type:Model:perClick')
  assert.ok(body.signature, 'the signature comes along')
  const ok = inferGraph(app.definitions, app.bodies, body)
  assert.equal(ok.signature.mismatch, null)
  // perClick m = rate m: still Model → Double — fine. perClick m = m: not.
  const root = body[body.output.source]
  body.output.source = Object.values(body).find((n) => n.type === 'parameter').id
  root.connected = false
  const bad = inferGraph(app.definitions, app.bodies, body)
  assert.ok(bad.signature.mismatch, 'Model → Model is not Model → Double')
})

test('primitives and the protected builtins have nothing to edit', () => {
  const { definitions } = clickCounter()
  for (const id of ['type:Wallet:Wallet', 'type:Msg:caseMsg', 'prelude:foldr', 'prelude:just', 'type:Widget:Text', 'type:Program:caseProgram', 'prelude:show', 'compose', 'identity', 'plus']) {
    const view = buildDefinitionView(definitions[id], (x) => definitions[x])
    assert.equal(isEditableView(view.viewId, view.defs), false, id)
  }
})
