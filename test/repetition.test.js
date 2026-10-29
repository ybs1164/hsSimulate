import { test } from 'node:test'
import assert from 'node:assert/strict'
import { libraryDefs, preludeDefs, PRELUDE } from '../src/library.js'
import { createTypedEvaluator } from '../src/typedEvaluator.js'
import { createEvaluator, MAX_REPEAT_COUNT, showValue } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { unify, applySubst, pred } from '../src/typeSystem.js'
import { reduce } from '../src/prelude.js'
import { createBlankProject, programRunTarget } from '../src/programEntry.js'
import { createExecutionTrace, createExecutionPlayback } from '../src/executionTrace.js'
import { buildDefinitionView } from '../src/definitionViews.js'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { call, n, body } from '../src/examples/build.js'
import { derivedDefinitions } from '../src/typeDecls.js'
import { serializeProject, parseProject } from '../src/project.js'
import { syntaxLessons } from '../src/learningContent.js'

const basics = Object.fromEntries(['plus', 'times', 'eq', 'apply', 'identity', 'isZero', 'select'].map(id => [id, { id, type: 'function', builtin: id, label: id }]))
const reg = () => ({ nodes: { ...libraryDefs, ...basics }, functionBodies: {} })
const c = (id, fn, args = []) => call(id, fn, fn, args)
const g = (...nodes) => Object.fromEntries(nodes.map(node => [node.id, node]))
const xs = values => c('xs', 'prelude:listOf', values.map(String))
const run = (graph, registry = reg(), id = 'result', options) => showValue(createTypedEvaluator(registry).run(graph, id, options), registry.types)

test('each helper is registered once with correct ports; repeatN is explicitly an app helper', () => {
  for (const [id, ports] of [['repeatN', ['n','f','x']], ['any',['p','xs']], ['all',['p','xs']]]) {
    assert.equal(PRELUDE.flatMap(([, fns]) => fns).filter(([name]) => name === id).length, 1)
    assert.deepEqual(preludeDefs[`prelude:${id}`].params, ports)
    assert.ok(preludeDefs[`prelude:${id}`].description)
  }
  assert.match(preludeDefs['prelude:repeatN'].description, /앱 전용.*Prelude 표준 아님/)
})

test('repeatN handles addition, multiplication, zero, negative and maximum count', () => {
  for (const [count, fn, fixed, start, expected] of [['3','plus','2','0','6'], ['4','times','2','1','16'], ['0','plus','2','5','5'], ['-9','plus','2','5','5'], [String(MAX_REPEAT_COUNT),'plus','1','0',String(MAX_REPEAT_COUNT)]]) {
    assert.equal(run(g(c('f',fn,[fixed,'']), c('result','prelude:repeatN',[count,n('f'),start]))), expected)
  }
  assert.equal(run(g(c('f','prelude:not',['']),c('result','prelude:repeatN',['3',n('f'),'True']))), 'False')
})

test('zero and negative repeatN do not evaluate f or any captured failing computation', () => {
  for (const count of ['0','-1']) {
    const graph = g(c('bomb','prelude:div',['1','0']),c('f','plus',[n('bomb'),'']),c('result','prelude:repeatN',[count,n('f'),'5']))
    const trace = createExecutionTrace(graph)
    assert.equal(run(graph,reg(),'result',{onNode:trace.record}), '5')
    assert.ok(!trace.events.some(e => e.nodeId === 'f' || e.nodeId === 'bomb'))
  }
})

test('repeatN does not demand an ignored initial value on a positive iteration', () => {
  const registry = reg()
  registry.nodes.constant = {id:'constant',type:'function',custom:true,label:'constant',params:['x'],mounted:[null]}
  registry.functionBodies.constant = body('constant',['x'],[c('seven','plus',['3','4'])],'seven')
  assert.equal(run(g(c('bomb','prelude:div',['1','0']),c('f','constant',['']),c('result','prelude:repeatN',['1',n('f'),n('bomb')])),registry), '7')
})

for (const [fn, cases] of [['any',[[[1,2,3],'True'],[[1,3],'False'],[[],'False']]],['all',[[[2,2],'True'],[[2,3],'False'],[[],'True']]]]) {
  test(`${fn}: documented examples and empty list`, () => {
    for (const [values, expected] of cases) assert.equal(run(g(xs(values),c('p','eq',['2','']),c('result',`prelude:${fn}`,[n('p'),n('xs')]))), expected)
  })
  test(`${fn}: short-circuit skips a failing later element and its trace`, () => {
    const first = fn === 'any' ? '2' : '3'
    const graph = g(c('bomb','prelude:div',['1','0']),c('xs','prelude:listOf',[first,n('bomb')]),c('p','eq',['2','']),c('result',`prelude:${fn}`,[n('p'),n('xs')]))
    const trace = createExecutionTrace(graph)
    assert.equal(run(graph,reg(),'result',{onNode:trace.record}), fn === 'any' ? 'True' : 'False')
    assert.ok(!trace.events.some(e => e.nodeId === 'bomb'))
    graph.xs.params[0] = fn === 'any' ? '3' : '2'
    assert.throws(() => run(graph), /zero/)
  })
  test(`${fn}: custom predicate runs only until decisive result; empty list never calls it`, () => {
    const registry = reg()
    registry.nodes.predicate = {id:'predicate',type:'function',custom:true,label:'predicate',params:['x'],mounted:[null]}
    registry.functionBodies.predicate = body('predicate',['x'],[
      c('test','eq',[n('x'),'2']),c('bomb','prelude:div',['1','0']),c('bad','isZero',[n('bomb')]),
      c('answer','select',[n('test'),fn === 'any' ? 'True' : 'False',n('bad')]),
    ],'answer')
    const graph = g(xs([2,9]),c('p','predicate',['']),c('result',`prelude:${fn}`,[n('p'),n('xs')]))
    const events=[]
    assert.equal(run(graph,registry,'result',{onNode:e=>events.push(e)}), fn === 'any' ? 'True' : 'False')
    assert.equal(events.filter(e=>e.graph===registry.functionBodies.predicate && e.nodeId==='answer' && e.phase==='start').length,1)
    assert.ok(!events.some(e=>e.nodeId==='bomb'))
    graph.xs=xs([]); events.length=0
    assert.equal(run(graph,registry,'result',{onNode:e=>events.push(e)}), fn === 'any' ? 'False' : 'True')
    assert.ok(!events.some(e=>e.graph===registry.functionBodies.predicate))
  })
}

test('all helpers support partial application and String/Bool types without coercion', () => {
  for (const [fn, args, tail, expected] of [['repeatN',['3',n('p'),''],'True','False'], ['any',[n('q'),''],'"banana"','True'], ['all',[n('q'),''],'"aaa"','True']]) {
    const graph=g(c('p','prelude:not',['']),c('q','eq',["'a'",'']),c('partial',`prelude:${fn}`,args),c('result','apply',[n('partial'),tail]))
    assert.equal(run(graph),expected)
  }
})

test('connection checks reject a -> b for repeatN, numeric predicates and wrong initial/count types', () => {
  const graphs=[g(c('f','isZero',['']),c('result','prelude:repeatN',['3',n('f'),'0'])),g(c('p','prelude:length',['']),xs([1,2]),c('result','prelude:any',[n('p'),n('xs')])),g(c('result','prelude:repeatN',['True','','0'])),g(c('result','prelude:repeatN',['1.5','','0']))]
  for(const graph of graphs){const pass=inferGraph(reg().nodes,{},graph);assert.ok(pass.brokenEdges.length || [...pass.perNode.values()].some(e=>e.invalidSlots?.length))}
  for(const fn of ['any','all']){
    const graph=g(xs([1,2]),c('p','times',['2','']),c('result',`prelude:${fn}`,['',n('xs')]))
    const pass=inferGraph(reg().nodes,{},graph)
    assert.throws(()=>{const subst=unify(valueTypeOfEntry(pass.perNode.get('p')),pass.perNode.get('result').paramTypes[0],pass.subst);reduce(pass.preds.map(p=>pred(p.cls,applySubst(subst,p.type))))})
  }
  const wrongStart=g(c('f','isZero',['']),c('result','prelude:repeatN',['1',n('f'),'"x"']))
  assert.ok(inferGraph(reg().nodes,{},wrongStart).brokenEdges.length)
})

test('repeat limits and Int validation fail before f, then normal execution recovers', () => {
  const registry=reg(), ev=createTypedEvaluator(registry)
  const graph=g(c('f','plus',['1','']),c('result','prelude:repeatN',[String(MAX_REPEAT_COUNT+1),n('f'),'0']))
  const trace=createExecutionTrace(graph)
  assert.throws(()=>ev.run(graph,'result',{onNode:trace.record}), /반복 한도/)
  assert.ok(trace.events.some(e=>e.nodeId==='result'&&e.phase==='error'&&e.origin))
  assert.ok(!trace.events.some(e=>e.nodeId==='f'))
  graph.result.params[0]='3'
  assert.equal(ev.run(graph,'result'),3)
  const plain=createEvaluator(registry)
  for(const count of [1.5,Number.MAX_SAFE_INTEGER+1,Infinity]){
    const bad=g({id:'count',type:'number',value:String(count)},c('f','identity',['']),c('result','prelude:repeatN',[n('count'),n('f'),'0']))
    assert.throws(()=>plain.run(bad,'result'),/safe Int/)
  }
  for(const fn of ['any','all'])assert.throws(()=>plain.run(g({id:'one',type:'number',value:'1'},c('xs','prelude:listOf',[n('one')]),c('p','identity',['']),c('result',`prelude:${fn}`,[n('p'),n('xs')])),'result'),/Expected a Bool/)
})

test('repeatN applies the clicker onClick to Model without events, mutation or unrelated field changes', () => {
  for(const [perClick,count] of [[1,3],[3,3],[1,MAX_REPEAT_COUNT]]){
    const project=buildClickCounter()
    project.functionBodies.initial.out.params[1]=String(perClick)
    const registry={...project,nodes:{...reg().nodes,...Object.fromEntries(derivedDefinitions(project.types).map(d=>[d.id,d])),...project.nodes}}
    const before=serializeProject(project),graph=g(c('start','initial'),c('f','onClick',['']),c('result','prelude:repeatN',[String(count),n('f'),n('start')]))
    assert.equal(run(graph,registry),`Model {wallet = Wallet {clicks = ${perClick*count}}, perClick = ${perClick}, rate = 0, elapsed = 0}`)
    assert.equal(run(graph,registry,'start'),`Model {wallet = Wallet {clicks = 0}, perClick = ${perClick}, rate = 0, elapsed = 0}`)
    assert.equal(serializeProject(project),before)
  }
})

test('main, individual runs, save/restore and playback preserve frame isolation and execute once', () => {
  for(const [fn,expected] of [['repeatN','6'],['any','True'],['all','False']]){
    const p=createBlankProject(basics,{})
    p.functionBodies.main=body('main',[],[xs([1,2,3]),c('f','plus',['2','']),c('p','eq',['2','']),c('result',`prelude:${fn}`,fn==='repeatN'?['3',n('f'),'0']:[n('p'),n('xs')]),c('unused','prelude:div',['1','0'])],'result')
    for(const project of [p,parseProject(serializeProject(p))]){
      const target=programRunTarget(project),registry={...project,nodes:{...reg().nodes,...project.nodes}},trace=createExecutionTrace(target.displayGraph),all=[]
      const before=serializeProject(project)
      assert.equal(run(target.graph,registry,target.fn.id,{onNode:e=>{all.push(e);trace.record(e)}}),expected)
      assert.ok(!all.some(e=>e.nodeId==='unused'))
      assert.ok(trace.events.some(e=>e.nodeId==='result'&&e.phase==='done'))
      const calls=all.length,queue=[],player=createExecutionPlayback({onChange(){},setTimer(fn){queue.push(fn);return queue.length},clearTimer(){}})
      player.play(trace.events,{});while(queue.length)queue.shift()()
      assert.equal(all.length,calls);assert.equal(player.states.get('result').state,'done')
      player.cancel();assert.equal(player.states.size,0)
      assert.equal(run(target.displayGraph,registry),expected)
      assert.equal(serializeProject(project),before)
    }
  }
})

test('any/all do not mutate a reused source list', () => {
  const graph=g(xs([1,2,3]),{id:'again',type:'ref',target:'xs'},c('p','eq',['2','']),c('result','prelude:any',[n('p'),n('again')]))
  const before=JSON.stringify(graph)
  assert.equal(run(graph),'True');assert.equal(run(graph,reg(),'xs'),'[1,2,3]');assert.equal(JSON.stringify(graph),before)
})

test('definition views agree with native short-circuit functions and helper primitive', () => {
  for(const fn of ['repeatN','any','all']){
    const registry=reg(),view=buildDefinitionView(preludeDefs[`prelude:${fn}`],id=>registry.nodes[id])
    Object.assign(registry.nodes,view.defs);Object.assign(registry.functionBodies,view.bodies)
    const graph=g(xs([1,2,3]),c('f','plus',['2','']),c('p','eq',['2','']),c('result',view.viewId,fn==='repeatN'?['3',n('f'),'0']:[n('p'),n('xs')]))
    assert.equal(run(graph,registry),fn==='repeatN'?'6':fn==='any'?'True':'False')
  }
})

test('any/all share the existing step budget and recover after a nonterminating input', () => {
  const ev=createEvaluator(reg())
  for(const fn of ['any','all']){
    const graph=g({id:'head',type:'boolean',value:fn==='any'?'false':'true'},c('cycle','prelude:cons',[n('head'),n('cycle')]),c('p','identity',['']),c('result',`prelude:${fn}`,[n('p'),n('cycle')]))
    assert.throws(()=>ev.run(graph,'result'),/too many steps/)
    graph.cycle=c('cycle','prelude:nil')
    assert.equal(ev.run(graph,'result'),fn==='all')
  }
})

test('learning keeps fifteen original lessons and runnable additional helper examples', () => {
  assert.equal(syntaxLessons.length,15)
  for(const [lessonId,title,expected,graph] of [
    ['recursion','repeatN','6',g(c('f','plus',['2','']),c('result','prelude:repeatN',['3',n('f'),'0']))],
    ['lists','any','True',g(xs([1,2,3]),c('p','eq',['2','']),c('result','prelude:any',[n('p'),n('xs')]))],
    ['lists','all','True',g(xs([2,2]),c('p','eq',['2','']),c('result','prelude:all',[n('p'),n('xs')]))],
  ]){
    const example=syntaxLessons.find(l=>l.id===lessonId).examples.find(e=>e.title.startsWith(title))
    assert.equal(example.expected,expected);assert.equal(run(graph),expected)
    assert.ok(example.steps.length>=3 && example.caution && example.experiment && example.explanation)
  }
})
