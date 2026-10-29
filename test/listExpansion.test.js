import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preludeDefs, libraryDefs, PRELUDE } from '../src/library.js'
import { createTypedEvaluator } from '../src/typedEvaluator.js'
import { createEvaluator, showValue, showString } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { unify, applySubst, pred } from '../src/typeSystem.js'
import { reduce } from '../src/prelude.js'
import { buildDefinitionView } from '../src/definitionViews.js'
import { createBlankProject, programRunTarget } from '../src/programEntry.js'
import { createExecutionTrace, createExecutionPlayback } from '../src/executionTrace.js'
import { serializeProject, parseProject } from '../src/project.js'
import { call, n, body } from '../src/examples/build.js'

const basics = Object.fromEntries(['eq', 'geq', 'minus', 'plus', 'times', 'apply', 'select', 'identity'].map(id => [id, { id, type: 'function', builtin: id, label: id }]))
const registry = () => ({ nodes: { ...libraryDefs, ...basics }, functionBodies: {} })
const graph = (...nodes) => Object.fromEntries(nodes.map(node => [node.id, node]))
const c = (id, fn, slots = []) => call(id, fn, fn, slots)
const list = (values, id = 'xs') => c(id, 'prelude:listOf', values.map(String))
const run = (g, id = 'result', reg = registry(), options) => showValue(createTypedEvaluator(reg).run(g, id, options))

test('new functions occur once in Lists, with named slots, help and type schemes', () => {
  for (const [id, params] of [['filter', ['p', 'xs']], ['take', ['n', 'xs']], ['drop', ['n', 'xs']]]) {
    assert.equal(PRELUDE.flatMap(([, entries]) => entries).filter(([name]) => name === id).length, 1)
    assert.deepEqual(preludeDefs[`prelude:${id}`].params, params)
    assert.ok(preludeDefs[`prelude:${id}`].description.includes('원본'))
    const pass = inferGraph(registry().nodes, {}, graph(c('open', `prelude:${id}`, ['', ''])))
    assert.equal(pass.perNode.get('open').invalidSlots.length, 0)
  }
})

test('filter applies a partial equality predicate, preserving order and duplicates', () => {
  const g = graph(list([1, 2, 3, 2]), c('p', 'eq', ['2', '']), c('result', 'prelude:filter', [n('p'), n('xs')]))
  assert.equal(run(g), '[2,2]')
  g.p.params[0] = '9'
  assert.equal(run(g), '[]')
  g.xs = list([])
  assert.equal(run(g), '[]')
})

for (const [fn, expected] of [['take', ['[]', '[]', '[1,2]', '[1,2,3]', '[]']], ['drop', ['[1,2,3]', '[1,2,3]', '[3]', '[]', '[]']]]) {
  test(`${fn}: negative, zero, prefix, overlong count and empty list`, () => {
    for (const [index, [count, xs]] of [['-1', [1, 2, 3]], ['0', [1, 2, 3]], ['2', [1, 2, 3]], ['5', [1, 2, 3]], ['2', []]].entries()) {
      assert.equal(run(graph(list(xs), c('result', `prelude:${fn}`, [count, n('xs')]))), expected[index])
    }
  })
}

test('String is [Char]: filtering, taking and dropping preserve Unicode characters', () => {
  assert.equal(run(graph(c('p', 'eq', ["'a'", '']), c('result', 'prelude:filter', [n('p'), '"banana"']))), '"aaa"')
  assert.equal(run(graph(c('result', 'prelude:take', ['2', '"하스켈"']))), showString('하스'))
  assert.equal(run(graph(c('result', 'prelude:drop', ['2', '"하스켈"']))), showString('켈'))
  assert.equal(run(graph(c('result', 'prelude:take', ['1', '"😀a"']))), showString('😀'))
  const emptyString = graph(c('p', 'eq', ["'z'", '']), c('result', 'prelude:filter', [n('p'), '"abc"']))
  assert.equal(run(emptyString), '[]') // existing untyped value display loses the empty String/list distinction
  assert.equal(valueTypeOfEntry(inferGraph(registry().nodes, {}, emptyString).perNode.get('result')).arg.name, 'Char')
})

test('all three functions can themselves be partially applied', () => {
  for (const [fn, first, expected] of [['take', '2', '[1,2]'], ['drop', '2', '[3]'], ['filter', n('p'), '[2]']]) {
    const g = graph(list([1, 2, 3]), c('p', 'eq', ['2', '']), c('partial', `prelude:${fn}`, [first, '']), c('result', 'apply', [n('partial'), n('xs')]))
    assert.equal(run(g), expected)
  }
})

test('connection inference rejects numeric predicates, wrong count types and non-lists', () => {
  const cases = [
    [graph(list([1, 2]), c('p', 'prelude:length', ['']), c('result', 'prelude:filter', [n('p'), n('xs')])), 0],
    [graph(list([1, 2]), c('result', 'prelude:take', ['True', n('xs')])), 0],
    [graph(list([1, 2]), c('result', 'prelude:drop', ['1.5', n('xs')])), 0],
    [graph(c('p', 'eq', ["'a'", '']), list([1, 2]), c('result', 'prelude:filter', [n('p'), n('xs')])), 0, 'xs'],
    [graph(c('result', 'prelude:take', ['2', 'True'])), 1],
  ]
  for (const [g, slot, host = 'result'] of cases) {
    const pass = inferGraph(registry().nodes, {}, g), entry = pass.perNode.get(host)
    assert.ok(entry.invalidSlots.includes(slot) || pass.brokenEdges.some(e => e.nodeId === host && e.index === slot), JSON.stringify({ entry, broken: pass.brokenEdges }))
  }
  const mixed = graph(list(['True', 'False']), c('ys', 'prelude:listOf', ["'a'"]), c('result', 'prelude:append', [n('xs'), n('ys')]))
  const mixedPass = inferGraph(registry().nodes, {}, mixed)
  assert.ok(mixedPass.perNode.get('ys').invalidSlots.includes(0))
  // The editor also checks outstanding class obligations BEFORE accepting a
  // candidate edge. A polymorphic (*) could unify its result with Bool, but
  // Bool has no MulSemigroup/Semiring instance, so that connection is refused.
  const candidate = graph(list([1, 2]), c('p', 'times', ['2', '']), c('result', 'prelude:filter', ['', n('xs')]))
  const pass = inferGraph(registry().nodes, {}, candidate)
  assert.throws(() => {
    const subst = unify(valueTypeOfEntry(pass.perNode.get('p')), pass.perNode.get('result').paramTypes[0], pass.subst)
    reduce(pass.preds.map(p => pred(p.cls, applySubst(subst, p.type))))
  })
})

test('runtime rejects non-Bool predicates and unsafe/fractional counts without coercion', () => {
  const reg = registry()
  const num = (id, value) => ({ id, type: 'number', value: String(value) })
  const plain = g => showValue(createEvaluator(reg).run(g, 'result'))
  const numeric = graph(num('one', 1), c('xs', 'prelude:listOf', [n('one')]), c('p', 'identity', ['']), c('result', 'prelude:filter', [n('p'), n('xs')]))
  assert.throws(() => plain(numeric), /Expected a Bool/)
  for (const fn of ['take', 'drop']) {
    for (const count of [1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      assert.throws(() => plain(graph(num('count', count), list([]), c('result', `prelude:${fn}`, [n('count'), n('xs')]))), /safe Int/)
    }
    for (const count of [{ id: 'count', type: 'boolean', value: 'true' }, { id: 'count', type: 'text', value: '2' }]) {
      assert.throws(() => plain(graph(count, list([]), c('result', `prelude:${fn}`, [n('count'), n('xs')]))), /Expected a number/)
    }
  }
})

test('lazy prefixes avoid unused tails, skipped elements and empty-list predicates', () => {
  const reg = registry()
  reg.nodes.bomb = { id: 'bomb', type: 'function', custom: true, label: 'bomb', params: [], mounted: [] }
  reg.functionBodies.bomb = { output: { id: 'output', type: 'output' } }
  const common = [
    { id: 'zero', type: 'number', value: '0' }, { id: 'one', type: 'number', value: '1' },
    c('bad', 'bomb'), c('nil', 'prelude:nil'), c('xs', 'prelude:cons', [n('one'), n('bad')]),
  ]
  const plain = (nodes) => showValue(createEvaluator(reg).run(graph(...common, ...nodes), 'result'))
  assert.equal(plain([c('result', 'prelude:take', [n('zero'), n('bad')])]), '[]')
  assert.equal(plain([c('result', 'prelude:take', [n('one'), n('xs')])]), '[1]')
  assert.equal(plain([c('badHead', 'prelude:cons', [n('bad'), n('nil')]), c('result', 'prelude:drop', [n('one'), n('badHead')])]), '[]')
  assert.equal(plain([c('result', 'prelude:filter', [n('bad'), n('nil')])]), '[]')
  assert.equal(plain([c('ones', 'prelude:cons', [n('one'), n('ones')]), c('result', 'prelude:take', [n('one'), n('ones')])]), '[1]')
})

test('shared source lists are not mutated by any new function', () => {
  const uses = ['forFilter', 'forTake', 'forDrop', 'original'].map(id => ({ id, type: 'ref', target: 'xs' }))
  const g = graph(list([1, 2, 3, 2]), ...uses, c('p', 'eq', ['2', '']), c('f', 'prelude:filter', [n('p'), n('forFilter')]), c('t', 'prelude:take', ['2', n('forTake')]), c('d', 'prelude:drop', ['2', n('forDrop')]), c('result', 'prelude:listOf', [n('f'), n('t'), n('d'), n('original')]))
  const before = JSON.stringify(g)
  assert.equal(run(g), '[[2,2],[1,2],[3,2],[1,2,3,2]]')
  assert.equal(JSON.stringify(g), before)
})

test('filter accepts a custom predicate: main/individual execution, save/restore and tracing', () => {
  const reg = registry()
  const p = createBlankProject(basics, {})
  p.nodes.matches = { id: 'matches', type: 'function', custom: true, label: 'matches', params: ['x'], mounted: [null] }
  p.functionBodies.matches = body('matches', ['x'], [c('predicate', 'eq', [n('x'), '2'])], 'predicate')
  p.functionBodies.main = body('main', [], [list([1, 2, 3, 2]), c('p', 'matches', ['']), c('result', 'prelude:filter', [n('p'), n('xs')]), c('unrelated', 'prelude:div', ['1', '0'])], 'result')
  for (const project of [p, parseProject(serializeProject(p))]) {
    const target = programRunTarget(project)
    assert.equal(target.problem, null)
    const r = { ...project, nodes: { ...reg.nodes, ...project.nodes } }
    const trace = createExecutionTrace(target.displayGraph), events = []
    assert.equal(run(target.graph, target.fn.id, r, { onNode(e) { events.push(e); trace.record(e) } }), '[2,2]')
    assert.equal(events.filter(e => e.nodeId === 'predicate' && e.phase === 'start').length, 4)
    assert.ok(!events.some(e => e.nodeId === 'unrelated'))
    assert.ok(trace.events.some(e => e.nodeId === 'result' && e.phase === 'done'))
    assert.ok(!trace.events.some(e => e.nodeId === 'predicate')) // nested frames stay out of visible playback
    const count = events.length, queue = []
    const player = createExecutionPlayback({ onChange() {}, setTimer(fn) { queue.push(fn); return queue.length }, clearTimer() {} })
    player.play(trace.events, {}); while (queue.length) queue.shift()()
    assert.equal(events.length, count) // playback cannot compute again
    assert.equal(player.states.get('result').state, 'done')
    player.cancel(); assert.equal(player.states.size, 0)
    assert.equal(run(target.displayGraph, 'result', r), '[2,2]')
  }
})

for (const [fn, expected] of [['take', '[1,2]'], ['drop', '[3]']]) {
  test(`${fn} runs in main and individually with the same trace target`, () => {
    const p = createBlankProject(basics, {})
    p.functionBodies.main = body('main', [], [list([1, 2, 3]), c('result', `prelude:${fn}`, ['2', n('xs')])], 'result')
    const reg = { ...p, nodes: { ...registry().nodes, ...p.nodes } }, target = programRunTarget(p)
    const trace = createExecutionTrace(target.displayGraph)
    assert.equal(run(target.graph, target.fn.id, reg, { onNode: trace.record }), expected)
    assert.ok(trace.events.some(e => e.nodeId === 'result' && e.phase === 'done'))
    assert.equal(run(target.displayGraph, 'result', reg), expected)
  })
}

test('runtime list errors identify the new node; fixing and rerunning clears error records', () => {
  const g = graph(list([1]), c('result', 'prelude:take', ['9007199254740992', n('xs')]))
  const first = createExecutionTrace(g)
  assert.throws(() => run(g, 'result', registry(), { onNode: first.record }), /safe Int/)
  assert.ok(first.events.some(e => e.nodeId === 'result' && e.phase === 'error' && e.origin))
  g.result.params[0] = '1'
  const second = createExecutionTrace(g)
  assert.equal(run(g, 'result', registry(), { onNode: second.record }), '[1]')
  assert.ok(second.events.every(e => e.phase !== 'error'))
})

test('filter/take/drop definition graphs preserve runtime behavior after merging the full Prelude', () => {
  for (const fn of ['filter', 'take', 'drop']) {
    const reg = registry(), view = buildDefinitionView(preludeDefs[`prelude:${fn}`], id => reg.nodes[id])
    Object.assign(reg.nodes, view.defs); Object.assign(reg.functionBodies, view.bodies)
    const g = graph(list([1, 2, 3, 2]), c('p', 'eq', ['2', '']), c('result', view.viewId, [fn === 'filter' ? n('p') : '2', n('xs')]))
    assert.equal(run(g, 'result', reg), fn === 'filter' ? '[2,2]' : fn === 'take' ? '[1,2]' : '[3,2]')
  }
})

test('existing length, append, mod, abs and not retain Haskell results and errors', () => {
  for (const [count, expected] of [[[], '0'], [[1, 2, 3], '3']]) assert.equal(run(graph(list(count), c('result', 'prelude:length', [n('xs')]))), expected)
  assert.equal(run(graph(list([1, 2]), list([3], 'ys'), c('result', 'prelude:append', [n('xs'), n('ys')]))), '[1,2,3]')
  assert.equal(run(graph(c('result', 'prelude:append', ['"ab"', '"c"']))), '"abc"')
  for (const [a, b, expected] of [['-7', '3', '2'], ['7', '-3', '-2'], ['-7', '-3', '-1']]) assert.equal(run(graph(c('result', 'prelude:mod', [a, b]))), expected)
  assert.throws(() => run(graph(c('result', 'prelude:mod', ['7', '0']))), /zero/)
  for (const x of [-3, 0, 3]) assert.equal(run(graph(c('result', 'prelude:abs', [String(x)]))), String(Math.abs(x)))
  for (const [p, result] of [['True', 'False'], ['False', 'True']]) assert.equal(run(graph(c('result', 'prelude:not', [p]))), result)
})
