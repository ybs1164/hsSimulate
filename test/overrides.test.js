// Taken-over Prelude definitions: a Prelude function written as a graph,
// taken over (definitionViews.js's takeOverDefinition), is a custom function
// under the Prelude id that shadows the library's — what every call runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { buildDefinitionView, isEditableView, restoreDefinition, takeOverDefinition } from '../src/definitionViews.js'
import { createEvaluator } from '../src/evaluator.js'
import { inferGraph } from '../src/inferGraph.js'
import { preludeDefs, preludeTypeDefs } from '../src/library.js'
import { setDynamicInstances } from '../src/prelude.js'
import { createGame } from '../src/runtime.js'
import { derivedDefinitions, derivedInstances } from '../src/typeDecls.js'

const fn = (id, builtin, label, params) => ({ id, type: 'function', builtin, label, params, mounted: params.map(() => null), readonly: true })
const BUILTINS = {
  apply: fn('apply', 'apply', 'apply', ['f', 'x']),
  compose: fn('compose', 'compose', 'compose', ['f', 'g', 'x']),
  identity: fn('identity', 'identity', 'identity', ['x']),
  plus: fn('plus', 'plus', '(+)', ['x', 'y']),
  minus: fn('minus', 'minus', '(-)', ['x', 'y']),
  times: fn('times', 'times', '(*)', ['x', 'y']),
  divide: fn('divide', 'divide', '(/)', ['x', 'y']),
  eq: fn('eq', 'eq', '(==)', ['x', 'y']),
  select: fn('select', 'select', 'select', ['condition', 'whenTrue', 'whenFalse']),
}

/** The click counter as the app holds it: `nodes` (builtins and your functions) shadowing the library, as main.js's `definitions`. */
function clickCounter() {
  const project = buildClickCounter()
  Object.assign(project.nodes, BUILTINS)
  const library = { ...preludeDefs, ...preludeTypeDefs, ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])) }
  const definitions = new Proxy({}, { get: (_, id) => project.nodes[id] ?? library[id], ownKeys: () => [...new Set([...Object.keys(library), ...Object.keys(project.nodes)])], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) })
  return { project, definitions }
}

const edit = ({ project, definitions }, id) => takeOverDefinition(project, definitions[id], (x) => definitions[x])

function texts({ project, definitions }, clicks = 3) {
  const ev = createEvaluator({ nodes: definitions, functionBodies: project.functionBodies, types: project.types })
  const game = createGame(ev, ev.run(project.nodes, 'main'))
  const all = []
  const walk = (w) => { if (w.kind === 'text') all.push(w.text); (w.children || []).forEach(walk) }
  const button = (w) => (w.kind === 'button' && w.label === 'Click!' ? w : (w.children || []).map(button).find(Boolean))
  for (let i = 0; i < clicks; i++) game.dispatch(button(game.view()).msg)
  walk(game.view())
  return all
}

test('a taken-over definition, left as it was, plays exactly like the library', () => {
  const before = texts(clickCounter())
  const app = clickCounter()
  for (const id of ['prelude:append', 'prelude:wText', 'prelude:wButton', 'prelude:program', 'prelude:setStepsPerSecond', 'prelude:setSubscriptions', 'prelude:onKey', 'prelude:fromIntegral', 'prelude:round']) assert.ok(edit(app, id), id)
  assert.ok(Object.keys(app.project.nodes).some((id) => id.startsWith('prelude:setStepsPerSecond/λ')), 'its λs come along, renamed')
  assert.deepEqual(texts(app), before)
  assert.ok(before.includes('Clicks: 3'))
})

test('every call runs the edited graph', () => {
  const app = clickCounter()
  edit(app, 'prelude:append')
  const body = app.project.functionBodies['prelude:append']
  // (++) xs ys = foldr (:) ys xs  →  foldr (:) xs ys: the arguments swap.
  const fold = Object.values(body).find((n) => n.sourceFunctionId === 'prelude:foldr')
  ;[fold.mounted[1], fold.mounted[2]] = [fold.mounted[2], fold.mounted[1]]
  fold.mounted.forEach((id, i) => { if (id) body[id].mountedTo = `${fold.id}:${i}` })
  assert.ok(texts(app).includes('3Clicks: '))
  restoreDefinition(app.project, 'prelude:append')
  assert.ok(texts(app).includes('Clicks: 3'), 'restored: the library runs again')
  assert.equal(app.project.functionBodies['prelude:append'], undefined)
})

test('a taken-over definition keeps the library type, and is checked against it', () => {
  const app = clickCounter()
  setDynamicInstances(derivedInstances(app.project.types))
  try {
    edit(app, 'prelude:wText')
    const body = app.project.functionBodies['prelude:wText']
    assert.deepEqual(Object.values(body).filter((n) => n.annotation).map((n) => n.annotation).sort(), ['String', 'Widget e'])
    const ok = inferGraph(app.definitions, app.project.functionBodies, app.project.nodes)
    assert.equal(ok.annotations.functions['prelude:wText'], undefined)
    // text s = s: String, not Widget e.
    const root = body[body.output.source]
    body.output.source = Object.values(body).find((n) => n.type === 'parameter').id
    root.connected = false
    const bad = inferGraph(app.definitions, app.project.functionBodies, app.project.nodes)
    assert.ok(Object.keys(bad.annotations.functions['prelude:wText'] || {}).length, 'the body no longer has the type its callers rely on')
  } finally {
    setDynamicInstances([])
  }
})

test('primitives, derived functions and the protected builtins are not taken over here', () => {
  const app = clickCounter()
  for (const id of ['prelude:foldr', 'prelude:just', 'prelude:show', 'prelude:toInteger', 'prelude:properFraction', 'type:Widget:Text', 'type:Program:caseProgram', 'type:Model:perClick', 'compose', 'identity', 'plus']) {
    const view = buildDefinitionView(app.definitions[id], (x) => app.definitions[x])
    assert.equal(isEditableView(view.viewId, view.defs), false, id)
    assert.equal(edit(app, id), null, id)
  }
})
