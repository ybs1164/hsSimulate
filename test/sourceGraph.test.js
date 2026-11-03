import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileSource, evaluateSource } from '../src/sourceGraph.js'
import { SourceError, parseSource } from '../src/sourceParser.js'
import { SourceDocument, SOURCE_EXAMPLE } from '../src/sourceDocument.js'
import { createExecutionPlayback } from '../src/executionTrace.js'
import { classNames, setDynamicClasses } from '../src/prelude.js'

const compileRun = (source, name = 'result') => {
  const document = compileSource(source)
  const result = evaluateSource(document, document.functions.find(f => f.name === name).id)
  if (result.error) throw result.error
  return { ...result, document }
}
const valueCode = expr => `result :: Int\nresult = ${expr}`
for (const [label, source, expected] of [
  ['add/result', SOURCE_EXAMPLE, 8],
  ['renamed functions and values', 'sumTwo :: Int -> Int -> Int\nsumTwo left right = left + right\nresult :: Int\nresult = sumTwo 12 9', 21],
  ['precedence', valueCode('2 + 3 * 4'), 14],
  ['parentheses', valueCode('(2 + 3) * 4'), 20],
  ['left-associative subtraction', valueCode('20 - 5 - 3'), 12],
  ['negative values', valueCode('(-7) * 3 + 2'), -19],
  ['prefix minus precedence', valueCode('-3 * 2 + 1'), -5],
  ['nested applications', 'f :: Int -> Int\nf x = x * 2\nresult :: Int\nresult = f (f (3 + 1))', 16],
  ['forward references', 'result :: Int\nresult = twice (inc 2)\ntwice :: Int -> Int\ntwice x = x * 2\ninc :: Int -> Int\ninc x = x + 1', 6],
  ['top-level values and comments', '-- text 😀\r\nresult :: Int\r\nresult = base * base -- square\r\n\r\nbase :: Int\r\nbase = 4\r\n', 16],
  ['local shadowing', 'f :: Int -> Int\nf f = f + 1\nresult :: Int\nresult = f 4', 5],
  ['zero', valueCode('0'), 0],
  ['safe upper bound', valueCode('9007199254740991'), Number.MAX_SAFE_INTEGER],
  ['safe lower bound', valueCode('(-9007199254740991)'), -Number.MAX_SAFE_INTEGER],
]) test(`source compiler: ${label}`, () => assert.equal(compileRun(source).value, expected))

for (const [label, source, pattern] of [
  ['unknown name', valueCode('missing 1'), /정의되지 않은 이름/],
  ['duplicate definition', 'a :: Int\na = 1\na = 2', /중복/],
  ['duplicate signature', 'a :: Int\na :: Int\na = 1', /중복/],
  ['duplicate parameter', 'f :: Int -> Int -> Int\nf x x = x', /매개변수.*중복/],
  ['missing signature', 'a = 1', /시그니처/],
  ['missing definition', 'a :: Int\nresult :: Int\nresult = 1', /정의가 없습니다/],
  ['arity mismatch', 'f :: Int -> Int\nf = 1', /인자 1개/],
  ['function instead of Int', 'f :: Int -> Int\nf x = x\nresult :: Int\nresult = f + 1', /Int 값/],
  ['function argument mismatch', 'f :: Int -> Int\nf x = x\nresult :: Int\nresult = f f', /인자는 Int/],
  ['call Int', valueCode('3 5'), /Int\/Bool 값은 함수/],
  ['unclosed parenthesis', valueCode('(3 + 4'), /\)가 필요/],
  ['dangling operator', valueCode('3 +'), /표현식이 필요/],
  ['IO/import', 'import Prelude\nresult :: Int\nresult = 1', /import 구문/],
  ['invalid if condition', valueCode('if 1 then 2 else 3'), /조건은 Bool/],
  ['where', valueCode('x where x = 1'), /where 구문/],
  ['polymorphism', 'f :: a -> a\nf x = x', /Int·Bool/],
  ['higher-order result mismatch', 'f :: (Int -> Int) -> Int\nf x = x', /본문 결과/],
  ['unsafe literal', valueCode('9007199254740992'), /정수.*범위/],
  ['decimal', valueCode('3.5'), /지원하지 않는 문자/],
  ['division', valueCode('8 / 2'), /지원하지 않는 문자/],
  ['symbol following dashes is not a comment', valueCode('1 --+ 2'), /지원하지 않는 연산자/],
  ['guards', 'f :: Int -> Int\nf x | x = 1', /지원하지 않는 문자/],
  ['negative argument needs grouping', valueCode('3 * -2'), /괄호로/],
]) test(`source compiler rejects ${label} with a source location`, () => {
  assert.throws(() => compileSource(source), error => error instanceof SourceError && pattern.test(error.message) && error.line >= 1 && error.column >= 1 && error.span.start >= 0)
})

test('graph mapping distinguishes definitions, call sites and parameter uses, with exact UTF-16 spans', () => {
  const source = '-- 😀\n' + SOURCE_EXAMPLE, doc = compileSource(source, 7)
  const add = doc.functions.find(f => f.name === 'add'), result = doc.functions.find(f => f.name === 'result')
  assert.equal(source.slice(doc.locations[add.id].start, doc.locations[add.id].end), 'add x y = x + y')
  const call = Object.values(doc.functionBodies[result.id]).find(n => n.sourceFunctionId === add.id)
  const location = doc.locations[call.id]
  assert.equal(location.kind, 'call'); assert.equal(location.version, 7)
  assert.equal(source.slice(location.start, location.end), 'add 3 5')
  assert.equal(source.slice(location.calleeSpan.start, location.calleeSpan.end), 'add')
  assert.equal(location.targetDefinition, add.id)
  for (const n of Object.values(doc.functionBodies[add.id]).filter(n => n.type === 'ref')) {
    const range = doc.locations[n.id]
    assert.equal(source.slice(range.start, range.end), n.label)
    assert.equal(doc.functionBodies[add.id][n.target].type, 'parameter')
  }
})
test('generated add and main are namespaced ordinary definitions, with no manual builtin overwrite', () => {
  const doc = compileSource(SOURCE_EXAMPLE + '\nmain :: Int\nmain = result')
  assert.equal(Object.values(doc.nodes).some(n => n.programEntry), false)
  assert.equal(doc.nodes.add, undefined); assert.equal(doc.nodes.main, undefined)
  assert.equal(evaluateSource(doc, doc.functions.find(f => f.name === 'main').id).value, 8)
})
test('only actual demand is traced; replay never recalculates and ignores inner call frames', () => {
  const { document, events, allEvents } = compileRun(SOURCE_EXAMPLE + '\nunused :: Int\nunused = 9007199254740991 * 2')
  const fn = document.functions.find(f => f.name === 'result'), body = document.functionBodies[fn.id]
  assert.ok(events.every(e => body[e.nodeId]))
  assert.ok(allEvents.some(e => e.graph === document.functionBodies[document.functions[0].id]))
  assert.ok(!allEvents.some(e => e.nodeId.includes('unused')))
  assert.equal(allEvents.filter(e => e.nodeId === fn.id && e.phase === 'start').length, 1)
  const count = allEvents.length, queue = []
  const player = createExecutionPlayback({ onChange() {}, setTimer(fn) { queue.push(fn); return queue.length }, clearTimer() {} })
  player.play(events, { rootId: fn.id }); while (queue.length) queue.shift()()
  assert.equal(allEvents.length, count)
  assert.equal(player.states.get(body.output.source).state, 'done')
  player.play(events, { rootId: fn.id }); player.cancel(); while (queue.length) queue.shift()()
  assert.equal(player.states.size, 0)
})
test('unsafe intermediate result fails even if later subtraction would mask it, without extra runs', () => {
  const doc = compileSource(valueCode('(9007199254740991 + 1) - 1'))
  const result = evaluateSource(doc, doc.functions[0].id)
  assert.match(result.error.message, /중간 계산/)
  assert.ok(result.events.some(e => e.phase === 'error' && e.origin))
  const origin = result.allEvents.find(e => e.phase === 'error' && e.origin)
  assert.equal(doc.source.slice(doc.locations[origin.nodeId].start, doc.locations[origin.nodeId].end), '9007199254740991 + 1')
})
test('the range policy and animation do not force an unused Int argument', () => {
  const source = 'first :: Int -> Int -> Int\nfirst x y = x\nresult :: Int\nresult = first 8 (9007199254740991 + 1)'
  const { value, document, events } = compileRun(source)
  assert.equal(value, 8)
  const owner = document.functions.find(f => f.name === 'result').id
  const unused = Object.values(document.functionBodies[owner]).find(n => n.sourceFunctionId === 'code:op:plus')
  assert.ok(unused)
  assert.ok(!events.some(e => e.nodeId === unused.id))
})
test('conversion is atomic: failure preserves last document and storage; edits invalidate results and ranges', () => {
  const writes = [], model = new SourceDocument({ save: data => writes.push(data) })
  assert.equal(model.convert(), true)
  const before = JSON.stringify(model.document), first = model.document
  assert.equal(model.evaluate().value, 8)
  model.selectNode(first.functionBodies[model.selected].output.source)
  assert.ok(model.highlight)
  model.edit('result :: Int\nresult = unknown')
  assert.equal(model.stale, true); assert.equal(model.result, null); assert.equal(model.highlight, null)
  assert.equal(model.convert(), false); assert.equal(writes.length, 1)
  assert.equal(JSON.stringify(model.document), before); assert.equal(model.evaluate(), null)
  model.edit(valueCode('6 * 7')); assert.equal(model.convert(), true)
  assert.equal(model.document.version, 2); assert.equal(model.result, null); assert.equal(model.highlight, null)
  assert.equal(model.evaluate().value, 42)
  assert.equal(JSON.stringify(first), before)
})
test('analysis restoration has no runtime highlights or evaluation and preserves the document version', () => {
  const model = new SourceDocument({ save() { throw new Error('storage unavailable') } })
  assert.equal(model.convert(), true)
  const restored = new SourceDocument()
  restored.edit(model.document.source); assert.equal(restored.convert(model.document.version, false), true)
  assert.equal(restored.result, null); assert.equal(restored.highlight, null); assert.equal(restored.stale, false)
})
test('analysis does not leak or depend on manual dynamic class declarations', () => {
  setDynamicClasses([{ name: 'ManualOnly', supers: [] }])
  const before = classNames()
  try { assert.equal(compileRun(SOURCE_EXAMPLE).value, 8); assert.deepEqual(classNames(), before) } finally { setDynamicClasses([]) }
})
test('bounded nesting is diagnosed instead of overflowing the parser/checker stack', () => {
  assert.throws(() => parseSource(valueCode('('.repeat(110) + '1' + ')'.repeat(110))), SourceError)
  assert.throws(() => compileSource(valueCode(Array(200).fill('1').join(' + '))), SourceError)
})
