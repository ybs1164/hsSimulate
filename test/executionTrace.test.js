import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTypedEvaluator } from '../src/typedEvaluator.js'
import { createExecutionTrace, createExecutionPlayback } from '../src/executionTrace.js'
import { preludeDefs } from '../src/library.js'
import { serializeProject } from '../src/project.js'

const basic = ['plus', 'times', 'eq', 'select', 'identity']
const registry = () => ({ nodes: { ...preludeDefs, ...Object.fromEntries(basic.map((id) => [id, { id, type: 'function', builtin: id, label: id }])) }, functionBodies: {} })
const ref = (node) => ({ node })
const call = (id, callee, slots) => ({ id, type: 'function', sourceFunctionId: callee, label: id, params: slots.map((s) => typeof s === 'string' ? s : ''), mounted: slots.map((s) => typeof s === 'string' ? null : s.node) })
const graphOf = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]))
const doneIds = (trace) => trace.events.filter((e) => e.phase === 'done').map((e) => e.nodeId)
function arithmetic() {
  return graphOf(
    { id: 'four', type: 'literal', value: '4' },
    { id: 'seven', type: 'literal', value: '7' },
    { id: 'three', type: 'literal', value: '3' },
    call('sum', 'plus', [ref('four'), ref('seven')]),
    call('product', 'times', [ref('sum'), ref('three')]),
    call('unrelated', 'prelude:div', ['1', '0']),
  )
}
function runWithTrace(graph, id, reg = registry()) {
  const trace = createExecutionTrace(graph)
  try { return { result: createTypedEvaluator(reg).run(graph, id, { onNode: trace.record }), trace } }
  catch (error) { trace.fail(id, error); return { error, trace } }
}
function clock() {
  let next = 0, time = 0
  const jobs = new Map()
  return {
    setTimer(fn, delay) { const id = ++next; jobs.set(id, { fn, time: time + delay }); return id },
    clearTimer(id) { jobs.delete(id) },
    step() { const [id, job] = [...jobs].sort((a, b) => a[1].time - b[1].time)[0] || []; if (!job) return false; jobs.delete(id); time = job.time; job.fn(); return true },
    flush() { let n = 0; while (this.step()) assert.ok(++n < 1000, 'timer loop') },
    get time() { return time },
    get pending() { return jobs.size },
  }
}
function playback(fake = clock()) {
  let updates = 0
  const player = createExecutionPlayback({ onChange: () => updates++, setTimer: fake.setTimer, clearTimer: fake.clearTimer })
  return { player, fake, updates: () => updates }
}

test('(4 + 7) * 3 evaluates to 33; completion follows demand rather than screen order', () => {
  const graph = arithmetic(), { result, trace } = runWithTrace(graph, 'product')
  assert.equal(result, 33)
  assert.deepEqual(trace.events.map((e) => `${e.nodeId}:${e.phase}`), [
    'product:start', 'sum:start', 'four:start', 'four:done', 'seven:start', 'seven:done',
    'sum:done', 'three:start', 'three:done', 'product:done',
  ])
  const { player, fake } = playback()
  player.play(trace.events, { resultId: 'result-33' })
  assert.equal(player.states.get('product').state, 'running')
  assert.equal(player.playing, true)
  fake.flush()
  assert.deepEqual([...player.states.keys()].sort(), doneIds(trace).sort())
  assert.ok([...player.states.values()].every((s) => s.state === 'done'))
  assert.ok(!player.states.has('unrelated') && !player.states.has('result-33'))
  assert.equal(player.info.resultId, 'result-33') // output is linked, not fabricated as an evaluated node
  assert.equal(player.playing, false)
  assert.ok(fake.time >= 180)
})

for (const [other, expected, selected, skipped] of [['4', 10, 'thenCalc', 'elseCalc'], ['5', 0, 'elseCalc', 'thenCalc']]) {
  test(`if 4 == ${other}: only ${selected} is recorded and displayed`, () => {
    const graph = graphOf(
      call('condition', 'eq', ['4', other]),
      call('thenCalc', 'plus', ['6', '4']),
      call('elseCalc', 'times', ['0', '9']),
      call('choose', 'select', [ref('condition'), ref('thenCalc'), ref('elseCalc')]),
    )
    const { result, trace } = runWithTrace(graph, 'choose')
    assert.equal(result, expected)
    assert.deepEqual(doneIds(trace), ['condition', selected, 'choose'])
    assert.ok(!trace.events.some((e) => e.nodeId === skipped))
    const { player, fake } = playback()
    player.play(trace.events, {})
    fake.flush()
    assert.equal(player.states.get(selected).state, 'done')
    assert.ok(!player.states.has(skipped))
  })
}
test('an unchosen failing branch is not forced for tracing', () => {
  const graph = graphOf(call('safe', 'plus', ['6', '4']), call('bad', 'prelude:div', ['1', '0']), call('choose', 'select', ['True', ref('safe'), ref('bad')]))
  const { result, error, trace } = runWithTrace(graph, 'choose')
  assert.equal(result, 10)
  assert.equal(error, undefined)
  assert.ok(!trace.events.some((e) => e.nodeId === 'bad'))
})
test('divide by zero identifies its origin and the failed caller; fixing it clears old error states', () => {
  const graph = graphOf(call('bad', 'prelude:div', ['4', '0']), call('outer', 'plus', [ref('bad'), '3']))
  const failed = runWithTrace(graph, 'outer')
  assert.match(failed.error.message, /divide by zero/)
  assert.deepEqual(failed.trace.events.filter((e) => e.phase === 'error').map((e) => [e.nodeId, e.origin]), [['bad', true], ['outer', false]])
  assert.deepEqual(doneIds(failed.trace), [])
  const { player, fake } = playback()
  player.play(failed.trace.events, { error: failed.error.message }); fake.flush()
  assert.equal(player.states.get('bad').state, 'error')
  graph.bad.params[1] = '2'
  const fixed = runWithTrace(graph, 'outer')
  assert.equal(fixed.result, 5)
  player.play(fixed.trace.events, { resultId: 'five' })
  assert.ok(![...player.states.values()].some((s) => s.state === 'error'))
  fake.flush()
  assert.equal(player.states.get('bad').state, 'done')
  assert.equal(player.info.error, undefined)
})
test('shared values are computed once and a throwing diagnostic callback cannot change the result', () => {
  const graph = graphOf({ id: 'value', type: 'literal', value: '4' }, { id: 'again', type: 'ref', target: 'value' }, call('sum', 'plus', [ref('value'), ref('again')]))
  const { result, trace } = runWithTrace(graph, 'sum')
  assert.equal(result, 8)
  assert.equal(trace.events.filter((e) => e.nodeId === 'value' && e.phase === 'start').length, 1)
  assert.equal(createTypedEvaluator(registry()).run(graph, 'sum', { onNode() { throw new Error('broken observer') } }), 8)
})
test('instrumentation and playback do not repeat evaluation or side effects', () => {
  function counted(traced) {
    let reads = 0, runs = 0
    const graph = graphOf({ id: 'n', type: 'literal', get value() { reads++; return '4' } }, call('sum', 'plus', [ref('n'), '7']))
    const ev = createTypedEvaluator(registry()), trace = createExecutionTrace(graph)
    runs++
    const result = ev.run(graph, 'sum', traced ? { onNode: trace.record } : {})
    return { graph, trace, result, counts: () => ({ reads, runs }) }
  }
  const plain = counted(false), traced = counted(true)
  assert.equal(plain.result, traced.result)
  assert.deepEqual(plain.counts(), traced.counts())
  const before = traced.counts(), { player, fake } = playback()
  const snapshot = serializeProject({ nodes: traced.graph, functionBodies: {} })
  const readsBeforePlayback = traced.counts()
  player.play(traced.trace.events, {}); fake.flush()
  assert.deepEqual(traced.counts(), readsBeforePlayback)
  assert.equal(serializeProject({ nodes: traced.graph, functionBodies: {} }), snapshot)
  assert.equal(before.runs, 1)
})
test('internal frames (including colliding node IDs) are not painted onto the caller graph', () => {
  const reg = registry()
  reg.nodes.double = { id: 'double', type: 'function', label: 'double', params: ['x'], custom: true }
  reg.functionBodies.double = graphOf({ id: 'x', type: 'parameter', label: 'x' }, call('root', 'plus', [ref('x'), ref('x')]), { id: 'output', type: 'output', source: 'root' })
  const graph = graphOf(call('root', 'double', ['7']))
  const trace = createExecutionTrace(graph), all = []
  assert.equal(createTypedEvaluator(reg).run(graph, 'root', { onNode(e) { all.push(e); trace.record(e) } }), 14)
  assert.ok(all.some((e) => e.graph === reg.functionBodies.double))
  assert.deepEqual(trace.events.map((e) => e.phase), ['start', 'done'])
  const differentFrame = new Map()
  trace.record({ phase: 'done', graph, frame: differentFrame, nodeId: 'recursive-detail' })
  assert.ok(!doneIds(trace).includes('recursive-detail'))
})
test('trace is per run, also after failure; subsequent untraced operations do not leak events', () => {
  const graph = graphOf(call('bad', 'prelude:div', ['1', '0'])), ev = createTypedEvaluator(registry())
  const trace = createExecutionTrace(graph)
  assert.throws(() => ev.run(graph, 'bad', { onNode: trace.record }), /divide by zero/)
  const n = trace.events.length
  graph.bad.params[1] = '1'
  assert.equal(ev.run(graph, 'bad'), 1)
  assert.equal(trace.events.length, n)
})
test('rerun, edit, graph switch, reset and import cancel scheduled marks, even already queued callbacks', () => {
  for (const reason of ['rerun', 'edit', 'switch', 'reset', 'import']) {
    const delivered = []
    const player = createExecutionPlayback({ onChange() {}, setTimer(fn) { delivered.push(fn); return delivered.length }, clearTimer() {} })
    player.play([{ phase: 'start', nodeId: 'old' }, { phase: 'done', nodeId: 'old' }], { rootId: 'old' })
    if (reason === 'rerun') player.play([{ phase: 'start', nodeId: 'new' }, { phase: 'done', nodeId: 'new' }], { rootId: 'new' })
    else player.cancel()
    delivered[0]() // clearing a timeout cannot undo a callback already dispatched
    assert.ok(!player.states.has('old'), reason)
    if (reason === 'rerun') {
      assert.equal(player.states.get('new').state, 'running')
      delivered[1]()
      assert.equal(player.states.get('new').state, 'done')
    } else {
      assert.equal(player.info, null)
      assert.equal(player.playing, false)
    }
  }
})
test('canceling inside a playback notification cannot schedule another stale step', () => {
  const fake = clock()
  let player
  player = createExecutionPlayback({ onChange() { player.cancel(false) }, setTimer: fake.setTimer, clearTimer: fake.clearTimer })
  player.play([{ phase: 'start', nodeId: 'a' }, { phase: 'done', nodeId: 'a' }], {})
  assert.equal(fake.pending, 0)
  assert.equal(player.states.size, 0)
})
