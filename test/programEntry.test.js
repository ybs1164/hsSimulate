import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBlankProject, isManagedMain, managedMain, MAIN_GUIDANCE, programRunTarget, returnsProgram } from '../src/programEntry.js'
import { addParameter, renameFunction } from '../src/signature.js'
import { createTypedEvaluator } from '../src/typedEvaluator.js'
import { createExecutionTrace, createExecutionPlayback } from '../src/executionTrace.js'
import { createHistory, mergeBuiltins, parseProject, serializeProject, upgradeProject } from '../src/project.js'
import { printDefinition } from '../src/haskellPrint.js'
import { call, n, body } from '../src/examples/build.js'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { buildBlankGame } from '../src/examples/blankGame.js'
import { preludeDefs } from '../src/library.js'
import { tapp, tcon, tfun } from '../src/typeSystem.js'

const builtins = Object.fromEntries([['plus','(+)'],['times','(*)'],['eq','(==)'],['select','select']].map(([id,label])=>[id,{id,type:'function',builtin:id,label,params:['x','y'],mounted:[null,null]}]))
const fresh = () => createBlankProject(builtins, {})
function arithmetic() {
  const p = fresh()
  p.functionBodies.main = body('main', [], [call('sum','plus','(+)',['4','7']),call('product','times','(*)',[n('sum'),'3'])], 'product')
  return p
}
function run(p) {
  const target = programRunTarget(p)
  assert.equal(target.problem, null)
  const trace = createExecutionTrace(target.displayGraph), all = []
  const ev = createTypedEvaluator({ ...p, nodes: { ...preludeDefs, ...p.nodes } })
  const value = ev.run(target.graph, target.fn.id, { onNode(e) { all.push(e); trace.record(e) } })
  return { value, trace, all, target }
}

test('only a new project gets one empty main, with independent data on every full reset', () => {
  const p = fresh()
  assert.equal(managedMain(p.nodes).label,'main')
  assert.equal(p.entry,'main')
  assert.equal(Object.values(p.nodes).filter(isManagedMain).length,1)
  assert.deepEqual(Object.keys(p.functionBodies.main),['output'])
  assert.equal(programRunTarget(p).problem,MAIN_GUIDANCE)
  p.functionBodies.main.output.source = 'changed'
  p.nodes.plus.params[0] = 'changed'
  const reset = fresh()
  assert.equal(reset.functionBodies.main.output.source,undefined)
  assert.equal(reset.nodes.plus.params[0],'x')
  assert.equal(builtins.plus.params[0],'x')
})

test('save/import/upgrade/merge preserve populated main and its protection without reseeding', () => {
  const p = arithmetic(), before = serializeProject(p)
  for (let i=0;i<3;i++) {
    const restored = mergeBuiltins(upgradeProject(parseProject(before)),builtins,{})
    assert.deepEqual(restored.functionBodies.main,p.functionBodies.main)
    assert.equal(Object.values(restored.nodes).filter(isManagedMain).length,1)
    assert.equal(restored.entry,'main')
    assert.equal(run(restored).value,33)
  }
  assert.equal(serializeProject(p),before)
})

test('main arithmetic returns 33 once and visualizes its body, not unrelated frames', () => {
  const p = arithmetic()
  p.nodes.unused = { id:'unused', type:'function',custom:true,label:'unused',params:[] }
  p.functionBodies.unused = body('unused',[],[call('mustNotRun','prelude:div','div',['1','0'])],'mustNotRun')
  const { value, trace, all, target } = run(p)
  assert.equal(value,33)
  assert.deepEqual(trace.events.map(e=>`${e.nodeId}:${e.phase}`),['product:start','sum:start','sum:done','product:done'])
  assert.equal(all.filter(e=>e.graph===p.nodes && e.nodeId==='main' && e.phase==='start').length,1)
  assert.ok(!all.some(e=>e.nodeId==='mustNotRun' || e.nodeId==='unused'))
  const before = serializeProject(p), calls = all.length, queue = []
  const player = createExecutionPlayback({onChange(){},setTimer(fn){queue.push(fn);return queue.length},clearTimer(){}})
  player.play(trace.events,{rootId:target.fn.id}); while(queue.length)queue.shift()()
  assert.equal(all.length,calls)
  assert.equal(serializeProject(p),before)
  assert.equal(player.states.get('product').state,'done')
})

test('main calls double 4 = 8; individual tests still use their own inputs', () => {
  const p = fresh()
  p.nodes.double = {id:'double',type:'function',custom:true,label:'double',params:['x'],mounted:[null]}
  p.functionBodies.double = body('double',['x'],[call('multiply','times','(*)',[n('x'),'2'])],'multiply')
  p.functionBodies.main = body('main',[],[call('doubleCall','double','double',['4'])],'doubleCall')
  const {value,trace,all} = run(p)
  assert.equal(value,8)
  assert.deepEqual(trace.events.map(e=>`${e.nodeId}:${e.phase}`),['doubleCall:start','doubleCall:done'])
  assert.ok(all.some(e=>e.nodeId==='multiply')) // actual inner computation; not painted onto main
  const testGraph = { individual:call('individual','double','double',['6']) }
  const ev=createTypedEvaluator({...p,nodes:{...preludeDefs,...p.nodes}})
  assert.equal(ev.run(testGraph,'individual'),12)
  assert.equal(run(p).value,8)
})

test('empty/dangling main is diagnosed without evaluating or fabricating defaults', () => {
  const p=fresh()
  assert.equal(programRunTarget(p).problem,MAIN_GUIDANCE)
  p.functionBodies.main.output.source='gone'
  assert.equal(programRunTarget(p).problem,MAIN_GUIDANCE)
  assert.equal(serializeProject(p).includes('"value":"0"'),false)
})

test('only the managed entry is protected; old functions named main remain editable', () => {
  const p=fresh()
  assert.equal(renameFunction(p,'main','renamed'),false)
  assert.equal(addParameter(p,'main','x'),null)
  const old={nodes:{main:{id:'main',type:'function',custom:true,label:'main',params:[],mounted:[]}},functionBodies:{main:{output:{id:'output',type:'output'}}}}
  assert.equal(isManagedMain(old.nodes.main),false)
  assert.equal(renameFunction(old,'main','renamed'),true)
  assert.equal(addParameter(old,'main','x'),'x')
})

test('legacy files without main, with ordinary main, and game templates keep their entry and graphs', () => {
  const legacy = {nodes:{old:{id:'old',type:'function',custom:true,label:'old',params:[]}},functionBodies:{old:body('old',[],[call('sum','plus','(+)',['4','7'])],'sum')},entry:'old'}
  const restored=mergeBuiltins(upgradeProject(parseProject(serializeProject(legacy))),builtins,{})
  assert.equal(managedMain(restored.nodes),null)
  assert.equal(restored.nodes.main,undefined)
  assert.equal(run(restored).value,11)
  assert.equal(programRunTarget({...restored,entry:null}),null)
  for(const build of [buildClickCounter,buildBlankGame]) {
    const example=build(), before=serializeProject(example)
    const merged=mergeBuiltins(upgradeProject(parseProject(before)),builtins,{})
    assert.equal(programRunTarget(merged).fn.id,example.entry)
    assert.equal(managedMain(merged.nodes),null)
    assert.deepEqual(merged.functionBodies,example.functionBodies)
    assert.equal(serializeProject(example),before)
  }
})

test('full reset and undo preserve the old project; local Output disconnect leaves other bodies intact', () => {
  const p=arithmetic(), original=serializeProject(p), history=createHistory()
  history.reset(original);history.record(serializeProject(fresh()))
  assert.equal(history.undo(),original)
  const other=structuredClone(p.nodes)
  p.functionBodies.main.output.source=null // existing Disconnect, not a full Reset
  assert.deepEqual(p.nodes,other)
  assert.equal(Object.values(p.nodes).filter(isManagedMain).length,1)
  assert.equal(programRunTarget(p).problem,MAIN_GUIDANCE)
})

test('program detection inspects types, without calling the evaluator to probe pure entries', () => {
  assert.equal(returnsProgram(tcon('Int')),false)
  assert.equal(returnsProgram(tfun(tcon('Int'),tcon('Int'))),false)
  assert.equal(returnsProgram(tapp(tapp(tcon('Program'),tcon('Model')),tcon('Msg'))),true)
})

test('the definition view remains a pure graph definition, not a fabricated IO action', () => {
  const p=arithmetic()
  assert.equal(printDefinition('main',p.nodes,p.functionBodies),'main = (4 + 7) * 3')
  assert.ok(!printDefinition('main',p.nodes,p.functionBodies).includes('print'))
})
