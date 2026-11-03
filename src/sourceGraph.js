import { parseAndAnalyze, showSourceType } from './sourceAnalysis.js'
import { SourceError, sourceLocation } from './sourceParser.js'
import { sourceOps } from './sourceBuiltins.js'
import { scheme, tfun } from './typeSystem.js'
import { inferGraph } from './inferGraph.js'
import { createTypedEvaluator } from './typedEvaluator.js'
import { createExecutionTrace } from './executionTrace.js'
import { withDynamicClasses, withDynamicInstances } from './prelude.js'
import { serializeSourceValue } from './sourceValue.js'
import { createSourceTrace } from './sourceTrace.js'

const isolated=fn=>withDynamicClasses([],()=>withDynamicInstances([],fn))
export const SOURCE_LIMITS=Object.freeze({depth:48,demandDepth:128,calls:6000,nodes:6000,listSteps:6000,milliseconds:1500,events:20000})
export function sourceIntegerDivision(a,b,remainder) {
  const x=BigInt(a),y=BigInt(b);let q=x/y
  if(x%y!==0n&&(x<0n)!==(y<0n))q--
  return Number(remainder?x-y*q:q)
}
export function compileSource(source,version=1){
  const analyzed=parseAndAnalyze(source),nodes={},functionBodies={},locations={},functions=[]
  const definitionId=name=>`code:${version}:${name}`
  for(const [builtin,label,arity] of Object.values(sourceOps)){
    const id=`code:op:${builtin}`;nodes[id]={id,type:'function',builtin,label,params:Array(arity).fill(''),mounted:Array(arity).fill(null)}
  }
  nodes['code:op:listOf']={id:'code:op:listOf',type:'function',builtin:'listOf',label:'[ … ]',params:[],mounted:[]}
  const arrow=(args,result)=>args.reduceRight((r,a)=>tfun(a,r),result)
  for(const def of analyzed.definitions){
    const id=definitionId(def.name),split=def.equations.length>1||def.params.some(p=>p.kind!=='variable')
    nodes[id]={id,type:'function',custom:true,label:def.name,params:def.params.map((p,i)=>split?`arg${i+1}`:p.name),mounted:def.params.map(()=>null),scope:'main',scheme:scheme([],[],def.type)}
    locations[id]={...def.span,version,kind:'definition',signatureSpan:def.signatureSpan}
    const fn={id,name:def.name,arity:def.params.length,signature:showSourceType(def.type),equations:[]};functions.push(fn)
    if(split)for(const [i,eq] of def.equations.entries()){
      const branchId=`${id}:equation:${i}`
      nodes[branchId]={id:branchId,type:'function',custom:true,label:`${def.name} · 방정식 ${i+1}`,params:eq.binders.map(b=>b.name),mounted:eq.binders.map(()=>null),sourceOwner:id,equationIndex:i,scheme:scheme([],[],arrow(eq.binders.map(b=>b.type),def.returnType))}
      locations[branchId]={...eq.span,version,kind:'equation',owner:id}
      fn.equations.push({id:branchId,span:eq.span,patterns:eq.params.map(p=>({span:p.span,text:source.slice(p.span.start,p.span.end)}))})
    }
  }
  function buildGraph(owner,def,eq,binders,dispatch){
    const graph={},params=new Map();let serial=0
    const put=(node,span,kind,extra={})=>{
      const id=`${owner}:n${serial++}`
      if(serial>1000)throw new SourceError('support','한 함수의 그래프는 최대 1,000개 노드입니다.',source,span)
      graph[id]={...node,id,scope:'local'};locations[id]={...span,version,kind,owner,...extra};return id
    }
    for(const b of binders)params.set(b.name,put({type:'parameter',label:b.name,value:b.name,annotation:showSourceType(b.type)},b.span,dispatch?'argument':'parameter'))
    const unwrap=e=>e.kind==='group'?unwrap(e.expr):e
    const call=(callee,label,args,expr,extra={})=>put({type:'function',sourceFunctionId:callee,label,params:args.map(()=>''),mounted:args,paramScopes:args.map(()=>'local'),resultType:showSourceType(expr.type)},expr.span,'call',extra)
    const op=(name,args,expr)=>call(`code:op:${sourceOps[name][0]}`,sourceOps[name][1],args,expr)
    const named=(head,args,expr)=>call(head.binding==='builtin'?`code:op:${head.name}`:definitionId(head.name),head.name,args,expr,head.binding==='definition'?{targetDefinition:definitionId(head.name),calleeSpan:head.span}:{calleeSpan:head.span})
    function expression(expr){
      if(expr.kind==='group')return expression(expr.expr)
      if(expr.kind==='integer')return put({type:'number',label:expr.text,value:expr.text,annotation:'Int',typeName:'Int'},expr.span,'literal')
      if(expr.kind==='boolean')return put({type:'boolean',label:expr.value?'True':'False',value:String(expr.value),annotation:'Bool'},expr.span,'literal')
      if(expr.kind==='list')return call(expr.items.length?'code:op:listOf':'code:op:nil',expr.items.length?'[ … ]':'[]',expr.items.map(expression),expr)
      if(expr.kind==='name'){
        if(expr.binding==='parameter')return put({type:'ref',target:params.get(expr.name),label:expr.name,annotation:showSourceType(expr.type)},expr.span,'reference')
        return named(expr,[],expr)
      }
      if(expr.kind==='application'){
        const args=[];let head=unwrap(expr)
        while(head.kind==='application'){args.unshift(head.arg);head=unwrap(head.fn)}
        const global=head.kind==='name'&&head.binding!=='parameter'
        const callee=global?(head.binding==='builtin'?`code:op:${head.name}`:definitionId(head.name)):null
        if(global&&args.length<=nodes[callee].params.length)return named(head,args.map(expression),expr)
        return op('apply',[expression(expr.fn),expression(expr.arg)],expr)
      }
      if(expr.kind==='operator')return op(expr.op,[],expr)
      if(expr.kind==='section')return op(expr.op,[null,expression(expr.right)],expr)
      if(expr.callee){
        if(expr.callee.binding!=='parameter')return named(expr.callee,[expression(expr.left),expression(expr.right)],expr)
        const first=op('apply',[expression(expr.callee),expression(expr.left)],{...expr,type:expr.callee.type.to})
        return op('apply',[first,expression(expr.right)],expr)
      }
      return op(expr.kind==='if'?'if':expr.kind==='negate'?'negate':expr.op,(expr.kind==='if'?[expr.condition,expr.yes,expr.no]:expr.kind==='negate'?[expr.arg]:[expr.left,expr.right]).map(expression),expr)
    }
    const result=dispatch?call(dispatch,'방정식 선택',binders.map(b=>params.get(b.name)),{span:def.span,type:def.returnType}):expression(eq.expr)
    graph.output={id:'output',type:'output',label:'Output',source:result,annotation:showSourceType(def.returnType)}
    locations[`${owner}:output`]={...(dispatch?def.span:eq.expr.span),version,kind:'output',owner}
    const rows=new Map(),depths=new Map()
    for(const n of Object.values(graph)){
      const inputs=(n.mounted||(n.target?[n.target]:n.source?[n.source]:[])).filter(Boolean)
      const depth=inputs.length?1+Math.max(...inputs.map(id=>depths.get(id)||0)):0,row=rows.get(depth)||0
      rows.set(depth,row+1);depths.set(n.id,depth);n.x=30+depth*200;n.y=40+row*100
    }
    functionBodies[owner]=graph
  }
  for(const def of analyzed.definitions){
    const owner=definitionId(def.name),fn=functions.find(f=>f.id===owner)
    if(!fn.equations.length)buildGraph(owner,def,def.equations[0],def.equations[0].binders)
    else{
      const id=owner+':dispatch'
      nodes[id]={id,type:'function',label:def.name,params:def.params.map(()=>''),mounted:def.params.map(()=>null),scheme:scheme([],[],def.type),sourceEquations:def.equations.map((eq,i)=>({patterns:eq.params,branchId:fn.equations[i].id,binders:eq.binders.map(b=>b.name)}))}
      buildGraph(owner,def,null,def.params.map((p,i)=>({name:`arg${i+1}`,type:def.paramTypes[i],span:p.span})),id)
      def.equations.forEach((eq,i)=>buildGraph(fn.equations[i].id,def,eq,eq.binders))
    }
  }
  isolated(()=>{
    const probes=Object.fromEntries(Object.keys(functionBodies).map(id=>[`probe:${id}`,{id:`probe:${id}`,type:'function',sourceFunctionId:id,params:[],mounted:[]}]))
    const pass=inferGraph(nodes,functionBodies,probes)
    if(Object.keys(pass.brokenFunctions).length||Object.keys(pass.annotations.functions).length||pass.brokenEdges.length)throw new SourceError('graph-types','생성된 그래프의 타입이 선언과 일치하지 않습니다.',source,analyzed.definitions[0].span)
  })
  return {source,version,nodes,functionBodies,locations,functions}
}

export function evaluateSource(document, functionId, limits = SOURCE_LIMITS) {
  const fn = document.functions.find(f => f.id === functionId)
  if (!fn || fn.arity) throw new SourceError('evaluation', '인자가 없는 최상위 값을 선택하세요. 함수 직접 테스트는 후속 기능입니다.', document.source, document.locations[functionId])
  const graph = document.functionBodies[functionId], trace = createExecutionTrace(graph), events = []
  const history = createSourceTrace(limits.debugSteps)
  let exceededTrace=false
  function validateValue(value,context) {
    if(typeof value==='number'&&!Number.isSafeInteger(value)) {
      const owner=context.functionId||functionId
      const range=document.locations[context.nodeId==='output'?`${owner}:output`:context.nodeId]||document.locations[owner]||document.locations[functionId]
      throw new SourceError('range','중간 계산 또는 결과가 지원 정수 범위를 벗어났습니다 (±9007199254740991).',document.source,range)
    }
  }
  const ev = createTypedEvaluator({ ...document, types: {}, classes: {}, instances: {}, executionLimits:limits, integerDivision:sourceIntegerDivision, sourceEvaluation:true, serializeResult:serializeSourceValue,
    validateNodeValue:validateValue, validateRuntimeValue:validateValue, onSourceCall:history.record,
  })
  try {
    const value = isolated(() => ev.run(document.nodes, functionId, { onNode({ value, ...event }) {
      const {graph, frame, ...step}=event
      history.record({kind:'node', ...step, value})
      if(events.length>=limits.events){exceededTrace=true;return}
      events.push(event);trace.record(event)
    } }))
    if(exceededTrace)throw new SourceError('limit','실행 기록 제한을 초과했습니다. 결과로 처리하지 않습니다.',document.source,document.locations[functionId])
    history.record({kind:'finish', functionId})
    return { value, events: trace.events, allEvents: events, debug:history.finish() }
  } catch (error) {
    const origin=events.find(e=>e.phase==='error'&&e.origin)
    if(!(error instanceof SourceError)) {
      const owner=origin?.functionId || functionId
      const range=document.locations[origin?.nodeId==='output'?`${owner}:output`:origin?.nodeId] || document.locations[functionId]
      error=new SourceError('evaluation',error.message,document.source,range)
    }
    const originOwner=document.nodes[origin?.functionId]?.sourceOwner||origin?.functionId
    const caller=events.find(e=>e.phase==='error'&&!e.origin&&document.locations[e.nodeId]?.targetDefinition===originOwner)
    if(caller){
      error.callSpan=document.locations[caller.nodeId]
      const at=sourceLocation(document.source,error.callSpan.start)
      error.message+=` (호출: ${at.line}행 ${at.column}열)`
    }
    trace.fail(graph.output.source, error)
    history.record({kind:'finish', functionId:origin?.functionId || functionId,
      callId:origin?.callId, nodeId:origin?.nodeId, span:error.span})
    return { error, events: trace.events, allEvents: events, debug:history.finish() }
  }
}
