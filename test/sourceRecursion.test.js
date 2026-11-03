import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileSource, evaluateSource, SOURCE_LIMITS } from '../src/sourceGraph.js'
import { SourceDocument } from '../src/sourceDocument.js'
import { createSourceRunner } from '../src/sourceRunner.js'

const run=(source,limits)=>{const doc=compileSource(source);return {...evaluateSource(doc,doc.functions.find(f=>f.name==='result').id,limits),doc}}
const int=expression=>`result :: Int\nresult = ${expression}`
const bool=expression=>`result :: Bool\nresult = ${expression}`
const factorial='fact :: Int -> Int\nfact n = if n <= 1 then 1 else n * fact (n - 1)\n'
for(const [expr,expected] of [
  ['if True then 10 else 0',10],['if False then 10 else 0',0],
  ['if 4 == 4 then 10 else 0',10],['if 4 == 5 then 10 else 0',0],
  ['if True then if False then 1 else 2 else 3',2],['abs (-7)',7],
  ['(-7) `div` 3',-3],['(-7) `mod` 3',2],['7 `div` (-3)',-3],['7 `mod` (-3)',-2],
  ['(-7) `div` (-3)',2],['(-7) `mod` (-3)',-1],['10 * 6 `div` 4',15],
  ['9007199254740987 `mod` 9007199254740989',9007199254740987],
  ['div 0 3',0],
])test(`source conditions/integers: ${expr}`,()=>assert.equal(run(int(expr)).value,expected))
for(const [expr,expected] of [
  ['True',true],['False',false],['1 /= 2',true],['1 < 2',true],['2 <= 2',true],['3 > 2',true],['3 >= 3',true],
  ['1 == 2 || True && False',false],['True || False && False',true],['False && (1 `div` 0 == 0)',false],['True || (1 `div` 0 == 0)',true],
])test(`source Bool: ${expr}`,()=>assert.equal(run(bool(expr)).value,expected))
for(const source of [int('if 1 then 2 else 3'),int('if True then 1 else False'),int('True + 1'),bool('1 && True'),bool('True == False'),int('if True then True else False'),
  'f :: Int -> Bool\nf n = if n == 0 then True else f False\nresult :: Bool\nresult = f 1',
])test(`source rejects incompatible declared types: ${source.split('\n').at(-1)}`,()=>assert.throws(()=>compileSource(source),/Bool|Int|타입/))

test('lazy if and logical operators trace neither dead errors nor dead recursion',()=>{
  const prefix='loop :: Int -> Int\nloop x = loop x\n'
  for(const expression of ['if True then 8 else 1 `div` 0','if False then loop 0 else 8']){
    const {value,allEvents,doc}=run(prefix+int(expression))
    assert.equal(value,8)
    assert.ok(!allEvents.some(e=>e.functionId?.endsWith(':loop')))
    const unused=Object.values(doc.functionBodies[doc.functions.at(-1).id]).find(n=>n.label==='div'||n.label==='loop')
    assert.ok(unused);assert.ok(!allEvents.some(e=>e.nodeId===unused.id))
  }
  for(const expression of ['False && (loop 0 == 0)','True || (loop 0 == 0)']){
    const r=run(prefix+bool(expression));assert.ok(!r.error);assert.ok(!r.allEvents.some(e=>e.functionId?.endsWith(':loop')))
  }
  const r=run(prefix+'first :: Int -> Int -> Int\nfirst a b = a\n'+int('first 8 (loop 0)'))
  assert.equal(r.value,8);assert.ok(!r.allEvents.some(e=>e.functionId?.endsWith(':loop')))
})
test('self recursion reuses finite definitions but isolates calls and lazily demanded argument environments',()=>{
  const {value,allEvents,doc}=run(factorial+int('fact 4 + fact 5'))
  assert.equal(value,144)
  assert.equal(doc.functions.length,2)
  assert.ok(Object.keys(doc.functionBodies[doc.functions[0].id]).length<20)
  const starts=allEvents.filter(e=>e.phase==='start'), frames=new Map()
  for(const e of starts)if(e.functionId){
    if(frames.has(e.callId))assert.equal(frames.get(e.callId),e.frame)
    frames.set(e.callId,e.frame)
    assert.ok(e.parentCallId===0||starts.some(p=>p.callId===e.parentCallId))
  }
  assert.equal(frames.size,10) // result + four factorial + five factorial invocations
  assert.equal(new Set(frames.values()).size,10)
})
test('mutual recursion and Bool argument/result types, irrespective of source order',()=>{
  const s='result :: Bool\nresult = evenN 10\noddN :: Int -> Bool\noddN n = if n == 0 then False else evenN (n - 1)\nevenN :: Int -> Bool\nevenN n = if n == 0 then True else oddN (n - 1)'
  assert.equal(run(s).value,true)
  assert.equal(run('selectN :: Bool -> Int\nselectN b = if b then 4 else 5\n'+int('selectN (3 < 4)')).value,4)
})
test('zero division and intermediate range errors point to the demanded original expression',()=>{
  for(const expr of ['4 `div` 0','mod 4 0','9007199254740991 * 2']){
    const r=run(int(expr));assert.ok(r.error);assert.equal(r.value,undefined)
    assert.equal(r.doc.source.slice(r.error.span.start,r.error.span.end),expr)
    assert.ok(r.allEvents.some(e=>e.phase==='error'&&e.origin))
  }
})
test('infinite self/mutual recursion ends at explicit depth limit, not JS overflow, and fresh runs recover',()=>{
  for(const s of ['loop :: Int -> Int\nloop n = loop (n + 1)\n'+int('loop 0'),'a :: Int\na = b\nb :: Int\nb = a\n'+int('a')]){
    const r=run(s);assert.match(r.error.message,/호출 깊이 제한/);assert.doesNotMatch(r.error.message,/stack|Recursion too deep/i)
    assert.ok(r.allEvents.length<=SOURCE_LIMITS.events);assert.equal(r.value,undefined)
    assert.equal(run(int('6 * 7')).value,42)
  }
})
test('node/call/time/trace budgets report failure rather than a partial normal result',()=>{
  for(const limits of [{...SOURCE_LIMITS,nodes:2},{...SOURCE_LIMITS,calls:1},{...SOURCE_LIMITS,demandDepth:2},{...SOURCE_LIMITS,milliseconds:-1},{...SOURCE_LIMITS,events:2}]){
    const r=run(factorial+int('fact 3'),limits);assert.match(r.error.message,/제한/);assert.equal(r.value,undefined)
    assert.ok(r.allEvents.length<=limits.events)
  }
})
test('deep recursive expressions hit demand-depth protection before a native stack overflow',()=>{
  const body='1 + ('.repeat(25)+'loop n'+')'.repeat(25)
  const r=run('loop :: Int -> Int\nloop n = '+body+'\n'+int('loop 0'))
  assert.match(r.error.message,/평가 깊이 제한/)
  assert.doesNotMatch(r.error.message,/stack|Recursion too deep/i)
})
test('async result is discarded on edit, conversion or selection; stop is distinct from replay and terminates calculation',async()=>{
  const model=new SourceDocument();model.convert()
  let finish
  const waiting=model.evaluateWith(()=>new Promise(resolve=>finish=resolve));model.edit(int('12'));finish({value:8,events:[]})
  assert.equal(await waiting,null);assert.equal(model.result,null)
  model.convert();const old=model.evaluateWith(()=>new Promise(resolve=>finish=resolve));model.convert();finish({value:12,events:[]});assert.equal(await old,null)
  let worker, callback
  const runner=createSourceRunner({makeWorker:()=>worker={terminate(){this.dead=true},postMessage(){}},setTimer:fn=>{callback=fn;return 1},clearTimer(){}})
  const pending=runner.run({},'f'), previous=worker;runner.cancel();assert.ok(previous.dead);assert.equal(await pending,null)
  previous.onmessage({data:{value:999}}) // late message after termination is ignored
  const next=runner.run({},'f');worker.onmessage({data:{value:42,events:[]}});assert.equal((await next).value,42)
  const timed=runner.run({},'f');callback();assert.match((await timed).error.message,/4초/);assert.ok(worker.dead)
})

const fixtures=new URL('./fixtures/source-complex/',import.meta.url)
const manifest=JSON.parse(readFileSync(new URL('manifest.json',fixtures),'utf8'))
for(const c of manifest.cases)for(const [i,check] of c.checks.entries())test(`complex raw ${c.id}: ${check.expression} = ${check.expected}`,()=>{
  const raw=readFileSync(new URL(c.file,fixtures),'utf8')
  // Original source is intact; a distinct zero-argument probe supplies variant inputs.
  const source=i?raw+`\nprobeValue :: Int\nprobeValue = ${check.expression}\n`:raw
  const doc=compileSource(source), r=evaluateSource(doc,doc.functions.find(f=>f.name===(i?'probeValue':'result')).id)
  assert.equal(r.error,undefined);assert.equal(String(r.value),check.expected)
  for(const body of Object.values(doc.functionBodies))for(const node of Object.values(body)){
    if(node.id==='output')continue
    const span=doc.locations[node.id];assert.ok(span.start>=0&&span.end<=source.length&&span.start<span.end)
    for(const arg of node.mounted||[])assert.ok(body[arg])
    if(node.sourceFunctionId)assert.ok(doc.nodes[node.sourceFunctionId])
  }
})
