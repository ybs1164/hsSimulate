// Prelude types taken over (typeEdits.js's takeOverType): the declaration
// becomes the project's, edited like any other — fields named, classes
// derived, instances written by hand — while what the runtime reads (the
// constructors, in order, with their fields' types) stays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDice } from '../src/examples/dice.js'
import { showValue } from '../src/evaluator.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { declareClasses } from '../src/classDecls.js'
import { libraryDefs, preludeTypes } from '../src/library.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { createGame } from '../src/runtime.js'
import { showType } from '../src/typeSystem.js'
import { DeclError, declareTypes, declToDraft, derivedDefinitions, derivedInstances, draftToSource } from '../src/typeDecls.js'
import { TAKEABLE_TYPES, libraryTypeProblem, takeOverType } from '../src/typeEdits.js'

/** Re-declare taken-over type `name` from (an edit of) its draft, as the type editor does. */
function edit(types, name, change = () => {}, instances = []) {
  const draft = declToDraft(types[name])
  change(draft)
  const next = declareTypes(types, draftToSource(draft), { replacing: name, library: [name], instances })
  const problem = libraryTypeProblem(preludeTypes[name], next[name])
  if (problem) throw new DeclError(problem)
  return next
}

test('every takeable Prelude type is taken over as it is, and re-declares unchanged', () => {
  for (const name of TAKEABLE_TYPES) {
    const types = takeOverType({}, preludeTypes[name])
    assert.equal(types[name].library, true)
    const next = edit(types, name)
    assert.equal(next[name].library, true, `${name} stays marked as the Prelude's`)
    assert.equal(libraryTypeProblem(preludeTypes[name], next[name]), '')
  }
})

test('what the runtime reads stays: constructors, their order and their fields', () => {
  const types = takeOverType({}, preludeTypes.Color)
  const bad = (change, re) => assert.throws(() => edit(types, 'Color', change), (e) => e instanceof DeclError && re.test(e.message))
  bad((d) => { d.constructors.push({ name: 'Grey', fields: [{ name: '', type: 'Double' }] }) }, /constructors stay RGB/)
  bad((d) => { d.constructors[0].name = 'Rgb' }, /constructors stay RGB/)
  bad((d) => { d.constructors[0].fields[2].type = 'Int' }, /fields keep their types/)
  bad((d) => { d.constructors[0].fields.pop() }, /fields keep their types/)
  const widget = takeOverType({}, preludeTypes.Widget)
  assert.throws(() => edit(widget, 'Widget', (d) => { d.params = [] }), DeclError)
  // a Prelude type the project doesn't take over is still a built-in name
  assert.throws(() => declareTypes({}, 'data Color = RGB Double Double Double'), /built-in type/)
})

test('naming the fields derives projections and updates; deriving adds instances', () => {
  const types = edit(takeOverType({}, preludeTypes.Color), 'Color', (d) => {
    d.constructors[0].fields.forEach((f, i) => { f.name = ['r', 'g', 'b'][i] })
    d.deriving.anyclass.push('AddSemigroup')
  })
  assert.equal(draftToSource(declToDraft(types.Color)), 'data Color = RGB { r :: Double, g :: Double, b :: Double } deriving anyclass (AddSemigroup)')
  const nodes = { ...libraryDefs, ...Object.fromEntries(derivedDefinitions(types).map((d) => [d.id, d])), plus: { id: 'plus', type: 'function', builtin: 'plus', label: '(+)', params: ['x', 'y'], mounted: [null, null] } }
  const ev = createEvaluator({ nodes, functionBodies: {}, types })
  const call = (id, callee, params, mounted = params.map(() => null)) => ({ id, type: 'function', sourceFunctionId: callee, label: callee, params, mounted })
  const graph = {
    red: call('red', 'prelude:red', []), blue: call('blue', 'prelude:blue', []),
    mix: call('mix', 'plus', ['', ''], ['red', 'blue']),
    bOf: call('bOf', 'type:Color:b', [''], ['mix']),
  }
  assert.equal(showValue(ev.run(graph, 'bOf')), '1')
  assert.equal(showValue(ev.run(graph, 'mix'), types), 'RGB {r = 1, g = 0, b = 1}')
})

test("a hand-written instance replaces the Prelude's for a type the Prelude declares", () => {
  const instances = { Show: [{ head: 'Color', context: [], methods: { show: 'showColor' } }] }
  // showColor c = "a colour"
  const nodes = { ...libraryDefs, showColor: { id: 'showColor', type: 'function', label: 'showColor', params: ['c'], mounted: [null], custom: true } }
  const functionBodies = { showColor: { 'input-showColor-0': { id: 'input-showColor-0', type: 'parameter', label: 'c', annotation: 'Color' }, s: { id: 's', type: 'text', value: 'a colour' }, output: { id: 'output', type: 'output', source: 's' } } }
  const graph = { red: { id: 'red', type: 'function', sourceFunctionId: 'prelude:red', params: [], mounted: [] }, sh: { id: 'sh', type: 'function', sourceFunctionId: 'prelude:show', params: [''], mounted: ['red'] } }
  for (const types of [{}, takeOverType({}, preludeTypes.Color)]) {
    const ev = createEvaluator({ nodes, functionBodies, types, instances })
    assert.equal(showValue(ev.run(graph, 'sh')), '"a colour"')
  }
  const plain = createEvaluator({ nodes, functionBodies, types: {} })
  assert.match(showValue(plain.run(graph, 'sh')), /^"RGB /, "without it, the Prelude's")
  // a builtin instance of a type the Prelude doesn't declare stays
  assert.throws(() => declareClasses({}, {}, [], { Show: [{ head: 'Int', context: [], methods: { show: 'showColor' } }] }), /already has Show \(builtin\)/)
})

test('a game plays the same with its Prelude types taken over', () => {
  const play = (types) => {
    const project = buildDice()
    project.types = { ...project.types, ...types }
    const used = new Set(Object.values(project.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
    const nodes = {
      ...libraryDefs,
      ...Object.fromEntries([...used].filter((id) => !libraryDefs[id] && !project.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, type: 'function', builtin: id, label: id }])),
      ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])),
      ...project.nodes,
    }
    const ev = createEvaluator({ nodes, functionBodies: project.functionBodies, types: project.types })
    const game = createGame(ev, ev.run(nodes, 'main'))
    setDynamicInstances(derivedInstances(project.types))
    try {
      const pass = inferGraph(nodes, project.functionBodies, project.nodes)
      assert.equal(showType(valueTypeOfEntry(pass.perNode.get('main'))), 'Program Model Msg')
      assert.doesNotThrow(() => reduce(pass.preds))
    } finally {
      setDynamicInstances([])
    }
    return JSON.stringify(game.view())
  }
  let taken = {}
  for (const name of ['Color', 'Picture', 'Widget', 'Program', 'Maybe']) taken = takeOverType(taken, preludeTypes[name])
  assert.equal(play(taken), play({}))
})
