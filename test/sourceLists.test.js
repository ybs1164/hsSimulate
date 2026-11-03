import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compileSource,evaluateSource,SOURCE_LIMITS} from '../src/sourceGraph.js'
import {SourceError} from '../src/sourceParser.js'
import {formatSourceValue,sourceValueTruncated,serializeSourceValue} from '../src/sourceValue.js'
import {SourceDocument} from '../src/sourceDocument.js'

const value=(type,expr)=>`result :: ${type}\nresult = ${expr}`
const run=source=>{
  const doc=compileSource(source),fn=doc.functions.find(f=>f.name==='result'),r=evaluateSource(doc,fn.id)
  return {...r,doc,text:r.error?'error':formatSourceValue(r.value)}
}
const sum='sumL :: [Int] -> Int\nsumL [] = 0\nsumL (x:xs) = x + sumL xs\n'
for(const [type,expr,expected] of [
  ['[Int]','[]','[]'],['[Bool]','[]','[]'],['[Int]','[1]','[1]'],['[Int]','[-2,0,2,-2]','[-2,0,2,-2]'],
  ['[Bool]','[True,False,True]','[True,False,True]'],['[[Int]]','[[],[1,2],[]]','[[],[1,2],[]]'],
  ['[Int]','1 : 2 : []','[1,2]'],['[Int]','[1] ++ [2] ++ [3]','[1,2,3]'],['[Int]','1 : [2] ++ []','[1,2]'],
  ['[Bool]','map (< 2) [1,2,3]','[True,False,False]'],['[Int]','filter (< 2) [1,2,0,-1]','[1,0,-1]'],
  ['[Int]','filter (>= 2) [1,2,3]','[2,3]'],['Int','foldl (+) 7 []','7'],
  ['[Int]','map (abs) [-2,0,3]','[2,0,3]'],['[Int]','map (if True then abs else abs) [-2]','[2]'],
])test(`source list/HOF ${expr}`,()=>{const r=run(value(type,expr));assert.equal(r.error,undefined);assert.equal(r.text,expected)})

for(const [label,source,expected] of [
  ['ordered overlapping equations','f :: [Int] -> Int\nf _ = 8\nf [] = 0\nf (x:xs) = div 1 0\n'+value('Int','f [1,2]'),'8'],
  ['singleton before cons','f :: [Int] -> Int\nf [] = 0\nf [x] = 10\nf (x:y:xs) = x + y\n'+value('Int','f [3] + f [2,4,99]'),'16'],
  ['grouped variable','f :: Int -> Int\nf (x) = x + 1\n'+value('Int','f 7'),'8'],
  ['wildcard avoids entire argument','f :: [Int] -> Int\nf _ = 8\n'+value('Int','f (div 1 0 : [])'),'8'],
  ['cons wildcard avoids head','f :: [Int] -> Int\nf (_:xs) = 8\n'+value('Int','f [div 1 0]'),'8'],
  ['singleton checks spine, not head','f :: [Int] -> Int\nf [x] = 8\n'+value('Int','f [div 1 0]'),'8'],
  ['second element ignores first error','f :: [Int] -> Int\nf (_:y:xs) = y\n'+value('Int','f [div 1 0,9]'),'9'],
  ['unused infinite element','loop :: Int -> Int\nloop n = loop n\nf :: [Int] -> Int\nf (_:y:xs) = y\n'+value('Int','f [loop 0,9]'),'9'],
  ['Bool list pattern','f :: [Bool] -> Bool\nf [] = False\nf (x:xs) = x\n'+value('Bool','f [True,False]'),'True'],
  ['partial application captures remain distinct','offset :: Int -> Int -> Int\noffset a x = a + x\n'+sum+value('Int','sumL (map (offset 2) [1,2]) + sumL (map (offset 9) [1,2])'),'28'],
  ['function parameter called through apply','transform :: (Int -> Int) -> [Int] -> [Int]\ntransform f xs = map f xs\ninc :: Int -> Int\ninc n = n + 1\n'+value('[Int]','transform inc [1,2]'),'[2,3]'],
  ['local name shadows builtin','use :: (Int -> Int) -> Int\nuse abs = abs 3\ninc :: Int -> Int\ninc n = n + 1\n'+value('Int','use inc'),'4'],
  ['user definition shadows builtin','map :: Int -> Int\nmap n = n + 8\n'+value('Int','map 2'),'10'],
  ['lazy foldl does not force an unused previous accumulator','step :: Int -> Int -> Int\nstep a x = if x == 2 then 8 else div 1 0\n'+value('Int','foldl step 0 [1,2]'),'8'],
  ['foldl keeps left association','step :: Int -> Int -> Int\nstep a x = a * 10 + x\n'+value('Int','foldl step 0 [1,2,3]'),'123'],
  ['map/filter do not inspect elements on empty list','bad :: Int -> Int\nbad n = div 1 0\n'+value('[Int]','map bad []'),'[]'],
  ['noncommutative partial application','minus :: Int -> Int -> Int\nminus a b = a - b\n'+value('[Int]','map (minus 10) [1,2]'),'[9,8]'],
  ['nested list pattern','f :: [[Int]] -> Int\nf [x:xs] = x\n'+value('Int','f [[3,4]]'),'3'],
  ['multiple parameter patterns are left-to-right and lazy','f :: [Int] -> [Int] -> Int\nf [] _ = 1\nf _ [] = 2\nf (x:xs) (y:ys) = x + y\n'+value('Int','f [] [div 1 0] + f [div 1 0] []'),'3'],
  ['higher-order builtin result can receive another argument','pick :: (Int -> Int) -> (Int -> Int) -> Int -> Int\npick f g x = f x\n'+value('Int','foldl pick abs [abs] (-3)'),'3'],
])test(`source patterns/closures ${label}`,()=>{const r=run(source);assert.equal(r.error,undefined);assert.equal(r.text,expected)})

for(const source of [
  value('[Int]','[1,True]'),value('[Int]','True : [1]'),value('[Int]','[1] ++ [True]'),value('[Int]','map (< 2) [1]'),
  value('[Int]','filter abs [1,2]'),value('[Int]','filter (< 2) [True]'),value('[Int]','map True [1]'),value('Bool','foldl (+) True [1]'),
  'f :: Int -> Int\nf [] = 0\n'+value('Int','f 1'),
  'f :: [Int] -> Int\nf (x:x) = x\n'+value('Int','f [1]'),
  'f :: [Int] -> Int\nf [] = 0\nf x y = 1\n'+value('Int','f []'),
  'f :: [Int] -> Int\nf [] = 0\nf (x:xs) = True\n'+value('Int','f []'),
  'f :: [Int] -> Int\nf [] = x\nf (x:xs) = x\n'+value('Int','f []'),
])test(`source list/HOF types rejected: ${source.split('\n').at(-1)}`,()=>assert.throws(()=>compileSource(source),e=>e instanceof SourceError&&['types','names'].includes(e.stage)&&e.line>=1&&e.column>=1))

test('only selected equation body executes; same pattern graph has distinct invocation frames',()=>{
  const r=run('f :: [Int] -> Int\nf [] = div 1 0\nf _ = 8\nf (x:xs) = 0\n'+value('Int','f [1] + f [2]'))
  assert.equal(r.value,16)
  const fn=r.doc.functions.find(f=>f.name==='f'),[first,chosen,last]=fn.equations
  assert.ok(!r.allEvents.some(e=>[first.id,last.id].includes(e.functionId)))
  const calls=r.allEvents.filter(e=>e.functionId===chosen.id&&e.phase==='start')
  assert.equal(new Set(calls.map(e=>e.callId)).size,2)
  assert.ok(calls.every(e=>r.allEvents.some(p=>p.callId===e.parentCallId)))
})
test('pattern mismatch points to the function/dispatch and recovers without stale result',()=>{
  const model=new SourceDocument();model.edit('headL :: [Int] -> Int\nheadL (x:xs) = x\n'+value('Int','headL []'));assert.ok(model.convert())
  const r=model.evaluate();assert.match(r.error.message,/headL.*패턴/);assert.ok(r.error.span)
  assert.match(r.error.message,/호출:/)
  assert.equal(model.document.source.slice(r.error.callSpan.start,r.error.callSpan.end),'headL []')
  const origin=r.allEvents.find(e=>e.phase==='error'&&e.origin);assert.ok(origin.nodeId.includes('headL'))
  model.edit(value('Int','8'));assert.equal(model.result,null);assert.ok(model.convert());assert.equal(model.evaluate().value,8)
})
test('bounded preview leaves later errors and recursive elements completely unevaluated',()=>{
  const safe=Array(100).fill('1').join(',')
  const r=run('loop :: Int -> Int\nloop n = loop n\n'+value('[Int]',`[${safe},loop 0,div 1 0]`))
  assert.equal(r.error,undefined);assert.equal(r.value.items.length,100);assert.equal(sourceValueTruncated(r.value),true)
  assert.ok(!r.allEvents.some(e=>e.functionId?.endsWith(':loop')))
  const owner=r.doc.functions.find(f=>f.name==='result').id,unused=Object.values(r.doc.functionBodies[owner]).filter(n=>n.label==='loop'||n.label==='div')
  assert.ok(unused.every(n=>!r.allEvents.some(e=>e.nodeId===n.id)))
  assert.match(r.text,/,…\]$/)
})
test('function preview never serializes/forces captured argument thunks',()=>{
  let forces=0
  const v={kind:'closure',callee:'f',args:[{get poison(){throw Error('forced')}}]}
  assert.deepEqual(serializeSourceValue(v,{force:x=>{forces++;return x}}),{kind:'source-function',name:'f'})
  assert.equal(forces,1)
})
test('total nested-preview budget stops before demanding an unnecessary outer tail',()=>{
  const xs='['+Array(100).fill('1').join(',')+']'
  const r=run('loop :: [[Int]]\nloop = loop\n'+value('[[Int]]',`[${xs},${xs},${xs}] ++ loop`))
  assert.equal(r.error,undefined);assert.ok(sourceValueTruncated(r.value))
  assert.ok(!r.allEvents.some(e=>e.functionId?.endsWith(':loop')))
})
test('lazy fold and productive lists remain bounded, with normal recovery',()=>{
  const deep=run(value('Int',`foldl (+) 0 [${Array(250).fill('1').join(',')}]`))
  assert.match(deep.error.message,/제한/);assert.doesNotMatch(deep.error.message,/Recursion too deep|stack/i)
  const bounded=run('ones :: [Int]\nones = 1 : ones\n'+value('[Int]','ones'))
  assert.equal(bounded.error,undefined);assert.equal(bounded.value.items.length,100);assert.ok(sourceValueTruncated(bounded.value))
  const infinite=run('ones :: [Int]\nones = 1 : ones\n'+value('Int','foldl (+) 0 ones'))
  assert.match(infinite.error.message,/제한/);assert.ok(infinite.allEvents.length<=SOURCE_LIMITS.events)
  assert.equal(run(value('Int','6 * 7')).value,42)
})
test('sections keep the right slot fixed, ++/: are right associative finite graphs',()=>{
  const r=run(value('[Int]','filter (< 3) (1 : [2] ++ [3] ++ [4])'))
  assert.equal(r.text,'[1,2]')
  const body=r.doc.functionBodies[r.doc.functions[0].id],section=Object.values(body).find(n=>n.sourceFunctionId==='code:op:lt')
  assert.deepEqual(section.mounted.map(id=>id?body[id].value:null),[null,'3'])
  const append=Object.values(body).filter(n=>n.sourceFunctionId==='code:op:append')
  assert.equal(append.length,2);assert.ok(append.some(n=>n.mounted[1]===append.find(a=>a!==n).id))
})
test('arithmetic inside higher-order calls enforces intermediate safe-integer bounds',()=>{
  for(const expr of ['foldl (+) 0 [9007199254740991,1,-1]','map ((+) 9007199254740991) [1]']){
    const r=run(value(expr.startsWith('map')?'[Int]':'Int',expr))
    assert.ok(r.error instanceof SourceError);assert.equal(r.error.stage,'range');assert.ok(r.error.span.start>0)
  }
})
test('long patterns and noncontiguous equations have bounded, located diagnostics',()=>{
  assert.throws(()=>compileSource('f :: [Int] -> Int\nf ['+Array.from({length:110},(_,i)=>'x'+i).join(',')+'] = 0'),/패턴 중첩/)
  assert.throws(()=>compileSource('f :: [Int] -> Int\nf [] = 0\ng :: Int\ng = 0\nf (x:xs) = x'),/붙여서/)
})
