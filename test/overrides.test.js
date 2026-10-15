// Taken-over Prelude definitions: a Prelude function written as a graph,
// taken over (definitionViews.js's takeOverDefinition), is a custom function
// under the Prelude id that shadows the library's — what every call runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { buildDefinitionView, isEditableView, restoreDefinition, takeOverDefinition } from '../src/definitionViews.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { customizeDerived, resetDerived } from '../src/typeEdits.js'
import { inferGraph } from '../src/inferGraph.js'
import { libraryDefs } from '../src/library.js'
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
  const library = { ...libraryDefs, ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])) }
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

test('a Prelude primitive is taken over as itself, name#, and can then be rewired', () => {
  const app = clickCounter()
  setDynamicInstances(derivedInstances(app.project.types))
  try {
    const node = edit(app, 'prelude:showCompact')
    assert.ok(node?.library)
    const body = app.project.functionBodies['prelude:showCompact']
    assert.equal(body[body.output.source].sourceFunctionId, 'prim:prelude:showCompact')
    assert.equal(body[body.output.source].label, 'showCompact#')
    assert.ok(texts(app).includes('Clicks: 3'), 'left as it was, it is the primitive')
    assert.equal(inferGraph(app.definitions, app.project.functionBodies, app.project.nodes).annotations.functions['prelude:showCompact'], undefined)
    // showCompact x = showFFloat 2 x
    const x = Object.values(body).find((n) => n.type === 'parameter')
    body.ff = { id: 'ff', type: 'function', sourceFunctionId: 'prelude:showFFloat', label: 'showFFloat', params: ['2', ''], mounted: [null, x.id], paramScopes: ['local', 'local'], connected: true }
    delete body.prim
    x.mountedTo = 'ff:1'
    body.output.source = 'ff'
    assert.ok(texts(app).includes('Clicks: 3.00'))
    restoreDefinition(app.project, 'prelude:showCompact')
    assert.ok(texts(app).includes('Clicks: 3'))
  } finally {
    setDynamicInstances([])
  }
})

test('class methods, the ring maps, derived functions and the protected builtins are not taken over here', () => {
  const app = clickCounter()
  for (const id of ['prelude:show', 'prelude:mappend', 'prelude:toInteger', 'prelude:properFraction', 'prelude:fromInteger', 'type:Widget:Text', 'type:Program:caseProgram', 'type:Model:perClick', 'compose', 'identity', 'plus']) {
    const view = buildDefinitionView(app.definitions[id], (x) => app.definitions[x])
    assert.equal(isEditableView(view.viewId, view.defs), false, id)
    assert.equal(edit(app, id), null, id)
  }
})

test('a customized constructor of a Prelude type is what its smart constructor runs', () => {
  const app = clickCounter()
  const def = app.definitions['type:Widget:Text']
  customizeDerived(app.project, def)
  assert.ok(texts(app).includes('Clicks: 3'), 'left as it was, it is Text#')
  // Text s = Text# ("> " ++ s): every `text` call now shows the prefix.
  const body = app.project.functionBodies['type:Widget:Text']
  const s = Object.values(body).find((n) => n.type === 'parameter')
  body.pre = { id: 'pre', type: 'function', sourceFunctionId: 'prelude:append', label: '(++)', params: ['"> "', ''], mounted: [null, s.id], paramScopes: ['local', 'local'], connected: true }
  s.mountedTo = 'pre:1'
  body.prim.mounted[0] = 'pre'
  assert.ok(texts(app).includes('> Clicks: 3'))
  resetDerived(app.project, 'type:Widget:Text')
  assert.ok(texts(app).includes('Clicks: 3'))
})

test('a taken-over rgb is what every named colour runs', () => {
  const app = clickCounter()
  edit(app, 'prelude:rgb')
  const ev = createEvaluator({ nodes: app.definitions, functionBodies: app.project.functionBodies, types: app.project.types })
  const graph = { r: { id: 'r', type: 'function', sourceFunctionId: 'prelude:red', label: 'red', params: [], mounted: [] } }
  assert.deepEqual(ev.run(graph, 'r').args, [1, 0, 0])
  // rgb r g b = RGB b g r
  const body = app.project.functionBodies['prelude:rgb']
  const ctor = body[body.output.source]
  ctor.mounted = [...ctor.mounted].reverse()
  assert.deepEqual(ev.run(graph, 'r').args, [0, 0, 1])
})
