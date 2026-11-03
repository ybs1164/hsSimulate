import { parseAndAnalyze, showSourceType } from './sourceAnalysis.js'
import { SourceError } from './sourceParser.js'
import { inferGraph } from './inferGraph.js'
import { createTypedEvaluator } from './typedEvaluator.js'
import { createExecutionTrace } from './executionTrace.js'
import { withDynamicClasses, withDynamicInstances } from './prelude.js'

// No manual-project registry or special main is used here.
const isolated = fn => withDynamicClasses([], () => withDynamicInstances([], fn))
const ops = {
  '+':['plus','+',2], '-':['minus','−',2], '*':['times','×',2], negate:['negate','negate',1],
  '==':['eq','==',2], '/=':['neq','/=',2], '<':['lt','<',2], '<=':['le','<=',2], '>':['gt','>',2], '>=':['geq','>=',2],
  '&&':['and','&&',2], '||':['or','||',2], if:['select','if',3],
  abs:['abs','abs',1], div:['div','div',2], mod:['mod','mod',2],
}
export const SOURCE_LIMITS = Object.freeze({ depth:48, demandDepth:128, calls:6000, nodes:6000, milliseconds:1500, events:20000 })
// Floor division within the documented safe-integer subset; never JS remainder.
export function sourceIntegerDivision(a,b,remainder) {
  const x=BigInt(a), y=BigInt(b)
  let q=x/y
  if(x%y!==0n && (x<0n)!==(y<0n))q--
  return Number(remainder ? x-y*q : q)
}
export function compileSource(source, version = 1) {
  const analyzed = parseAndAnalyze(source)
  const nodes = {}, functionBodies = {}, locations = {}, functions = []
  const definitionId = name => `code:${version}:${name}`
  for (const [builtin, label, arity] of Object.values(ops)) {
    const id = `code:op:${builtin}`
    nodes[id] = { id, type: 'function', builtin, label, params: Array(arity).fill(''), mounted: Array(arity).fill(null) }
  }
  for (const def of analyzed.definitions) {
    const id = definitionId(def.name)
    nodes[id] = { id, type: 'function', custom: true, label: def.name, params: def.params.map(p => p.text), mounted: def.params.map(() => null), scope: 'main' }
    locations[id] = { ...def.span, version, kind: 'definition', signatureSpan: def.signatureSpan }
    functions.push({ id, name: def.name, arity: def.params.length, signature: showSourceType(def.type) })
  }
  for (const def of analyzed.definitions) {
    const owner = definitionId(def.name), graph = {}, params = new Map()
    let serial = 0
    const put = (node, span, kind, extra = {}) => {
      const id = `${owner}:n${serial++}`
      if (serial > 1000) throw new SourceError('support', '한 함수의 그래프는 최대 1,000개 노드입니다.', source, span)
      graph[id] = { ...node, id, scope: 'local' }
      locations[id] = { ...span, version, kind, owner, ...extra }
      return id
    }
    for (const [i,p] of def.params.entries()) params.set(p.text, put({ type:'parameter', label:p.text, value:p.text, annotation:showSourceType(def.paramTypes[i]) },p,'parameter'))
    const unwrap = expr => expr.kind === 'group' ? unwrap(expr.expr) : expr
    function call(callee, label, args, span, extra = {}, resultType) {
      return put({ type: 'function', sourceFunctionId: callee, label, params: args.map(() => ''), mounted: args, paramScopes: args.map(() => 'local'),resultType }, span, 'call', extra)
    }
    const calleeId = expr => expr.binding==='builtin' ? `code:op:${expr.name}` : definitionId(expr.name)
    const callName = (head,args,expr) => call(calleeId(head),head.name,args,expr.span,head.binding==='definition' ? {targetDefinition:definitionId(head.name),calleeSpan:head.span}: {calleeSpan:head.span},showSourceType(expr.type))
    function expression(expr) {
      if (expr.kind === 'group') return expression(expr.expr)
      if (expr.kind === 'integer') return put({ type: 'number', label: expr.text, value: expr.text, annotation: 'Int', typeName: 'Int' }, expr.span, 'literal')
      if (expr.kind === 'boolean') return put({type:'boolean',label:expr.value?'True':'False',value:String(expr.value),annotation:'Bool'},expr.span,'literal')
      if (expr.kind === 'name') {
        if (expr.binding === 'parameter') return put({ type: 'ref', target: params.get(expr.name), label: expr.name, annotation: showSourceType(expr.type) }, expr.span, 'reference')
        return callName(expr,[],expr)
      }
      if (expr.kind === 'application') {
        const args = []; let head = unwrap(expr)
        while (head.kind === 'application') { args.unshift(head.arg); head = unwrap(head.fn) }
        return callName(head,args.map(expression),expr)
      }
      if(expr.callee) return callName(expr.callee,[expression(expr.left),expression(expr.right)],expr)
      const op = expr.kind === 'if' ? 'if' : expr.kind === 'negate' ? 'negate' : expr.op
      const [builtin, label] = ops[op]
      return call(`code:op:${builtin}`, label, (expr.kind==='if'?[expr.condition,expr.yes,expr.no]:expr.kind === 'negate' ? [expr.arg] : [expr.left, expr.right]).map(expression), expr.span,{},showSourceType(expr.type))
    }
    const result = expression(def.expr)
    graph.output = { id: 'output', type: 'output', label: 'Output', source: result, annotation: showSourceType(def.returnType) }
    // Output IDs are graph-local in the existing engine; use a qualified map key.
    locations[`${owner}:output`] = { ...def.expr.span, version, kind: 'output', owner }
    const rows = new Map(), depths = new Map()
    for (const n of Object.values(graph)) {
      const inputs = n.mounted || (n.target ? [n.target] : n.source ? [n.source] : [])
      const depth = inputs.length ? 1 + Math.max(...inputs.map(id => depths.get(id) || 0)) : 0
      const row = rows.get(depth) || 0
      rows.set(depth, row + 1); depths.set(n.id, depth)
      n.x = 30 + depth * 200; n.y = 40 + row * 100
    }
    functionBodies[owner] = graph
  }
  // Check the generated model with the app's type engine as a separate gate.
  isolated(() => {
    const probes = Object.fromEntries(functions.map(f => [`probe:${f.id}`, { id: `probe:${f.id}`, type: 'function', sourceFunctionId: f.id, params: [], mounted: [] }]))
    const pass = inferGraph(nodes, functionBodies, probes)
    if (Object.keys(pass.brokenFunctions).length || Object.keys(pass.annotations.functions).length || pass.brokenEdges.length) {
      throw new SourceError('graph-types', '생성된 그래프의 타입이 선언과 일치하지 않습니다.', source, analyzed.definitions[0].span)
    }
  })
  return { source, version, nodes, functionBodies, locations, functions }
}

export function evaluateSource(document, functionId, limits = SOURCE_LIMITS) {
  const fn = document.functions.find(f => f.id === functionId)
  if (!fn || fn.arity) throw new SourceError('evaluation', '인자가 없는 최상위 Int/Bool 값을 선택하세요. 함수 직접 테스트는 후속 기능입니다.', document.source, document.locations[functionId])
  const graph = document.functionBodies[functionId], trace = createExecutionTrace(graph), events = []
  let exceededTrace=false
  const ev = createTypedEvaluator({ ...document, types: {}, classes: {}, instances: {}, executionLimits:limits, integerDivision:sourceIntegerDivision,
    validateNodeValue(value, context) {
      if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        const owner = document.functions.find(f => document.functionBodies[f.id] === context.graph)?.id
        throw new SourceError('range', '중간 계산 또는 결과가 지원 정수 범위를 벗어났습니다 (±9007199254740991).', document.source, document.locations[context.nodeId === 'output' ? `${owner}:output` : context.nodeId])
      }
    },
  })
  try {
    const value = isolated(() => ev.run(document.nodes, functionId, { onNode(event) {
      if(events.length>=limits.events){exceededTrace=true;return}
      events.push(event);trace.record(event)
    } }))
    if(exceededTrace)throw new SourceError('limit','실행 기록 제한을 초과했습니다. 결과로 처리하지 않습니다.',document.source,document.locations[functionId])
    return { value, events: trace.events, allEvents: events }
  } catch (error) {
    const origin=events.find(e=>e.phase==='error'&&e.origin)
    if(!(error instanceof SourceError)) {
      const owner=origin?.functionId || functionId
      const range=document.locations[origin?.nodeId==='output'?`${owner}:output`:origin?.nodeId] || document.locations[functionId]
      error=new SourceError('evaluation',error.message,document.source,range)
    }
    trace.fail(graph.output.source, error)
    return { error, events: trace.events, allEvents: events }
  }
}
