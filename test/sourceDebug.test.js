import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileSource, evaluateSource, SOURCE_LIMITS } from '../src/sourceGraph.js'
import { createSourceHistory, describeTraceValue } from '../src/sourceHistory.js'
import { SOURCE_EXAMPLE } from '../src/sourceDocument.js'

function run(source, limits) {
  const doc = compileSource(source)
  const result = evaluateSource(doc, doc.functions.find(fn => fn.name === 'result').id, limits)
  const history = createSourceHistory(() => {})
  history.load(structuredClone(result.debug).steps)
  const name = call => doc.nodes[call.functionId]?.label
  const show = value => describeTraceValue(value, history.values, id => doc.nodes[id]?.label || id)
  const calls = label => [...history.calls.values()].filter(call => name(call) === label)
  return { doc, result, history, show, calls }
}

test('add arguments and return are revealed at their recorded steps and undo restores them', () => {
  const { result, history, show, calls, doc } = run(SOURCE_EXAMPLE)
  assert.equal(result.value, 8)
  const steps = result.debug.steps
  const entered = steps.findIndex(e => e.kind === 'enter' && doc.nodes[e.functionId]?.label === 'add')
  history.seek(entered + 1)
  assert.deepEqual(calls('add')[0].args.map(show), ['미평가', '미평가'])
  assert.equal(show(calls('add')[0].value), '미평가')
  history.seek(history.length)
  assert.deepEqual(calls('add')[0].args.map(show), ['3', '5'])
  assert.equal(show(calls('add')[0].value), '8')
  const call = calls('add')[0]
  const site = doc.locations[call.site.nodeId]
  assert.equal(doc.source.slice(site.start, site.end), 'add 3 5')
  const returned = steps.findIndex(e => e.kind === 'return' && e.callId === call.callId)
  history.seek(returned)
  assert.equal(show(calls('add')[0].value), '미평가')
  history.seek(0)
  assert.equal(history.calls.size + history.nodes.size + history.values.size, 0)
  assert.equal(result.value, 8)
})

test('recursive calls have separate arguments, returns and parents', () => {
  const { history, show, calls, result } = run('fac :: Int -> Int\nfac n = if n <= 1 then 1 else n * fac (n - 1)\nresult :: Int\nresult = fac 4')
  assert.equal(result.value, 24)
  history.seek(history.length)
  const frames = calls('fac')
  assert.deepEqual(frames.map(c => show(c.args[0])), ['4','3','2','1'])
  assert.deepEqual(frames.map(c => show(c.value)), ['24','6','2','1'])
  assert.equal(new Set(frames.map(c => c.callId)).size, 4)
  assert.deepEqual(frames.slice(1).map(c => c.parentCallId), frames.slice(0,-1).map(c => c.callId))
})

test('mutual recursion and deferred map callbacks keep their logical caller', () => {
  const a = run('evenN :: Int -> Bool\nevenN n = if n == 0 then True else oddN (n - 1)\noddN :: Int -> Bool\noddN n = if n == 0 then False else evenN (n - 1)\nresult :: Bool\nresult = evenN 2')
  a.history.seek(a.history.length)
  assert.equal(a.history.calls.get(a.calls('oddN')[0].parentCallId).functionId, a.calls('evenN')[0].functionId)
  const b = run('shift :: Int -> Int -> Int\nshift d x = d + x\nresult :: [Int]\nresult = map (shift 2) [1,3] ++ map (shift 10) [1,3]')
  b.history.seek(b.history.length)
  const frames = b.calls('shift')
  assert.deepEqual(frames.map(c => c.args.map(b.show)), [['2','1'],['2','3'],['10','1'],['10','3']])
  assert.deepEqual(frames.map(c => b.show(c.value)), ['3','5','11','13'])
  assert.equal(new Set(frames.map(c => c.site.nodeId)).size, 2)
  assert.ok(frames.every(c => b.doc.functionBodies[c.site.functionId][c.site.nodeId].label === 'map'))
})

test('pattern, unused arguments and list elements are observed without extra evaluation', () => {
  const r = run('loop :: Int -> Int\nloop x = loop x\nfirst :: [Int] -> Int -> Int\nfirst [] _ = loop 0\nfirst (x:xs) y = x\nresult :: Int\nresult = if True then first [8,loop 0] (loop 0) else loop 0')
  assert.equal(r.result.value, 8)
  r.history.seek(r.history.length)
  assert.equal(r.calls('loop').length, 0)
  const first = r.calls('first')[0]
  assert.match(first.equationId, /:equation:1$/)
  assert.equal(r.show(first.args[1]), '미평가')
  assert.equal(r.show(first.args[0]), '[8, 미평가]')
  assert.equal(r.result.debug.steps.filter(e => e.kind === 'equation').length, 1)
})

test('a clipped debugger retains the real result and errors retain the origin span', () => {
  const short = run(SOURCE_EXAMPLE, { ...SOURCE_LIMITS, debugSteps: 4 })
  assert.equal(short.result.value, 8)
  assert.equal(short.result.debug.steps.length, 4)
  assert.ok(short.result.debug.omitted > 0)
  const error = run('bad :: Int -> Int\nbad x = div 1 x\nresult :: Int\nresult = bad 0')
  assert.match(error.result.error.message, /divide by zero/i)
  assert.ok(error.result.debug.steps.some(e => e.origin && e.phase === 'error'))
  assert.equal(error.result.debug.steps.at(-1).span.start, error.doc.source.indexOf('div 1 x'))
})
