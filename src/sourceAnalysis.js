import { SourceError, locateSourceError, parseSource } from './sourceParser.js'
import { sourceNames, sourceScheme } from './sourceBuiltins.js'
import { tcon, tfun, tlist, freshVar, unify, applySubst, instantiate } from './typeSystem.js'

export function showSourceType(t) {
  if(t.kind==='con')return t.name
  if(t.kind==='app')return `[${showSourceType(t.arg)}]`
  if(t.kind==='var')return '?'
  return `${t.from.kind==='fun'?`(${showSourceType(t.from)})`:showSourceType(t.from)} -> ${showSourceType(t.to)}`
}
const declared=t=>t.kind==='int'?tcon('Int'):t.kind==='bool'?tcon('Bool'):t.kind==='list'?tlist(declared(t.element)):tfun(declared(t.from),declared(t.to))
const Int=tcon('Int'), Bool=tcon('Bool')
export function analyzeSource(parsed, moduleName = 'Main', imported = new Map()) {
  const {source,definitions,signatures}=parsed, names=new Map(), sigs=new Map()
  const fail=(stage,message,span)=>{throw new SourceError(stage,message,source,span)}
  let subst=new Map()
  const fits=(want,have,span,message)=>{
    try{subst=unify(want,have,subst)}catch{fail('types',message||`인자는 ${showSourceType(applySubst(subst,want))}이어야 하지만 ${showSourceType(applySubst(subst,have))}입니다.`,span)}
  }
  for(const sig of signatures){if(sigs.has(sig.name))fail('names',`${sig.name}의 타입 시그니처가 중복됩니다.`,sig.span);sigs.set(sig.name,sig)}
  let previousName=null
  for(const eq of definitions){
    if(names.has(eq.name)&&previousName!==eq.name)fail('names',`${eq.name}의 여러 방정식은 서로 붙여서 작성하세요.`,eq.nameSpan)
    previousName=eq.name
    let def=names.get(eq.name)
    if(!def){
      const sig=sigs.get(eq.name)
      if(!sig)fail('types',`${eq.name}: 명시적인 Int/Bool/리스트/함수 타입 시그니처가 필요합니다.`,eq.nameSpan)
      const type=declared(sig.type),paramTypes=[];let result=type
      while(result.kind==='fun'){paramTypes.push(result.from);result=result.to}
      def={...eq,type,paramTypes,returnType:result,signatureSpan:sig.span,equations:[],dependencies:[],moduleName,key:`${moduleName}.${eq.name}`};names.set(eq.name,def)
    }
    if(eq.params.length!==def.paramTypes.length)fail('types',`${eq.name}: 시그니처의 인자 ${def.paramTypes.length}개를 모두 패턴/변수 매개변수로 적어 주세요.`,eq.nameSpan)
    if(def.equations.length&&!eq.params.length)fail('names',`${eq.name} 정의가 중복됩니다. 인자 없는 값은 한 번만 정의하세요.`,eq.nameSpan)
    eq.binders=[];const scope=new Map()
    function pattern(p,t,depth=0){
      if(depth>100)fail('support','패턴 중첩은 최대 100단계입니다.',p.span)
      p.type=t
      if(p.kind==='variable'){
        if(scope.has(p.name))fail('names',`매개변수 ${p.name}가 중복됩니다.`,p.nameSpan)
        scope.set(p.name,t);eq.binders.push({name:p.name,text:p.name,span:p.nameSpan,type:t});return
      }
      if(p.kind==='wildcard')return
      const element=freshVar();fits(t,tlist(element),p.span,'리스트 패턴에는 리스트 타입이 필요합니다.')
      if(p.kind==='cons'){pattern(p.head,element,depth+1);pattern(p.tail,tlist(element),depth+1)}
    }
    eq.params.forEach((p,i)=>pattern(p,def.paramTypes[i]));eq.scope=scope
    def.equations.push(eq);def.span={start:def.span.start,end:eq.span.end}
  }
  for(const sig of signatures)if(!names.has(sig.name))fail('names',`${sig.name}의 정의가 없습니다.`,sig.span)
  function check(expr,eq,def,depth=0){
    if(depth>100)fail('support','표현식 중첩은 최대 100단계입니다.',expr.span)
    const child=e=>check(e,eq,def,depth+1)
    let type
    if(expr.kind==='group')type=child(expr.expr)
    else if(expr.kind==='integer'){
      if(!Number.isSafeInteger(Number(expr.text)))fail('range','정수는 ±9007199254740991 범위만 지원합니다.',expr.span)
      type=Int
    }else if(expr.kind==='boolean')type=Bool
    else if(expr.kind==='list'){
      const element=freshVar();for(const item of expr.items)fits(element,child(item),item.span,'리스트 원소 타입은 모두 같아야 합니다.');type=tlist(element)
    }else if(expr.kind==='name'){
      if(!expr.qualifier && eq.scope.has(expr.name)){expr.binding='parameter';type=eq.scope.get(expr.name)}
      else {
        const written = expr.qualifier ? `${expr.qualifier}.${expr.name}` : expr.name
        const candidates = new Set(imported.get(written))
        if ((!expr.qualifier || expr.qualifier === moduleName) && names.has(expr.name)) candidates.add(names.get(expr.name))
        if (candidates.size > 1) fail('names', `모호한 이름 ${written}입니다. 후보: ${[...candidates].map(candidate => candidate.key).sort().join(', ')}.`, expr.span)
        const target = candidates.values().next().value
        if (target) {
          expr.binding='definition'; expr.targetKey=target.key; type=target.type
          def.dependencies.push({name:target.key,span:expr.span})
        } else if (!expr.qualifier && sourceNames.has(expr.name)) {
          expr.binding='builtin'; type=instantiate(sourceScheme(expr.name)).type
        } else fail('names', `정의되지 않은 이름 ${written}입니다. 모듈의 공개 이름과 import 목록을 확인하세요.`, expr.span)
      }
    }else if(expr.kind==='application'){
      const fn=child(expr.fn), arg=child(expr.arg), result=freshVar(), resolved=applySubst(subst,fn)
      if(resolved.kind!=='fun'&&resolved.kind!=='var')fail('types','Int/Bool 값은 함수처럼 호출할 수 없습니다. 리스트도 함수가 아닙니다.',expr.fn.span)
      fits(fn,tfun(arg,result),expr.arg.span,resolved.kind==='fun'?`인자는 ${showSourceType(resolved.from)}이어야 합니다. 실제 인자: ${showSourceType(applySubst(subst,arg))}`:undefined);type=result
    }else if(expr.kind==='if'){
      fits(Bool,child(expr.condition),expr.condition.span,'if 조건은 Bool이어야 합니다.')
      type=child(expr.yes);fits(type,child(expr.no),expr.no.span,'if의 두 분기 결과 타입이 같아야 합니다.')
    }else if(expr.kind==='operator'||expr.kind==='section'){
      const op=instantiate(sourceScheme(expr.op)).type
      if(expr.kind==='operator')type=op
      else{fits(op.to.from,child(expr.right),expr.right.span);type=tfun(op.from,op.to.to)}
    }else if(expr.callee){
      const fn=child(expr.callee),a=child(expr.left),b=child(expr.right),result=freshVar()
      fits(fn,tfun(a,tfun(b,result)),expr.span,'백틱 함수의 두 인자 타입이 시그니처와 맞지 않습니다.');type=result
    }else{
      const op=expr.kind==='negate'?'negate':expr.op, fn=instantiate(sourceScheme(op)).type
      const parts=expr.kind==='negate'?[expr.arg]:[expr.left,expr.right];let rest=fn
      for(const part of parts){fits(rest.from,child(part),part.span,['&&','||'].includes(op)?'논리 연산에는 Bool이 필요합니다.':op===':'||op==='++'?'리스트 연결의 원소 타입이 같아야 합니다.':'산술·비교 연산에는 Int 값이 필요합니다.');rest=rest.to}
      type=rest
    }
    expr.type=type;return type
  }
  for(const def of names.values())for(const eq of def.equations)fits(def.returnType,check(eq.expr,eq,def),eq.expr.span,def.name+'의 본문 결과가 시그니처 '+showSourceType(def.returnType)+'와 맞지 않습니다.')
  function resolve(expr){
    expr.type=applySubst(subst,expr.type)
    for(const key of ['expr','fn','arg','left','right','callee','condition','yes','no'])if(expr[key])resolve(expr[key])
    for(const item of expr.items||[])resolve(item)
  }
  for(const def of names.values())for(const eq of def.equations){resolve(eq.expr);for(const b of eq.binders)b.type=applySubst(subst,b.type)}
  return {source,definitions:[...names.values()]}
}

// The dependency graph is resolved before body analysis. Each body keeps its
// own names, and imported candidates only contain the defining module's exports.
export function analyzeSourceFiles(files) {
  if (!files.length) throw new SourceError('syntax', '분석할 .hs 파일을 선택하세요.', '')
  const modules = new Map()
  const fail = (file, stage, message, span) => { throw locateSourceError(new SourceError(stage, message, file.source, span), file) }
  for (const file of files) {
    let parsed
    try { parsed = parseSource(file.source) }
    catch (error) { throw locateSourceError(error, file) }
    const name = parsed.module?.name || 'Main'
    if (name === 'Prelude') fail(file, 'support', 'Prelude 모듈 선언은 지원하지 않습니다.', parsed.module.span)
    if (modules.has(name)) fail(file, 'names', `모듈 ${name}이 중복됩니다. ${modules.get(name).file.name}과 모듈 이름을 구분하세요.`, parsed.module?.span)
    modules.set(name, { name, file, parsed })
  }
  const visiting = []
  function visit(module) {
    if (module.exports) return
    const { name, file, parsed } = module
    visiting.push(name)
    const imported = new Map()
    const add = (key, definition) => {
      if (!imported.has(key)) imported.set(key, new Set())
      imported.get(key).add(definition)
    }
    for (const entry of parsed.imports) {
      if (entry.name === 'Prelude') fail(file, 'support', '명시적인 Prelude import 구문은 지원하지 않습니다. 기존 내장 함수는 바로 사용할 수 있습니다.', entry.span)
      const dependency = modules.get(entry.name)
      if (!dependency) fail(file, 'dependency', `import ${entry.name}: 제공한 .hs 파일에서 모듈을 찾을 수 없습니다.`, entry.span)
      if (visiting.includes(entry.name)) fail(file, 'dependency', `순환 import는 이 앱에서 지원하지 않습니다. ${[...visiting, entry.name].join(' → ')}`, entry.span)
      visit(dependency)
      const selected = entry.names || [...dependency.exports.keys()].map(name => ({ name }))
      for (const { name, span } of selected) {
        const target = dependency.exports.get(name)
        if (!target) fail(file, 'names', `${entry.name} 모듈이 ${name}을(를) 공개하지 않습니다.`, span)
        add(`${entry.alias || entry.name}.${name}`, target)
        if (!entry.qualified) add(name, target)
      }
    }
    try {
      module.definitions = analyzeSource(parsed, name, imported).definitions.map(def => ({ ...def, fileId: file.id }))
    } catch (error) { throw locateSourceError(error, file) }
    const local = new Map(module.definitions.map(def => [def.name, def]))
    const names = parsed.module?.exports
    if (names) for (const entry of names) {
      if (!local.has(entry.name)) fail(file, 'names', `export 목록의 ${entry.name}은(는) ${name}에서 정의되지 않았습니다.`, entry.span)
    }
    module.exports = names ? new Map(names.map(({ name }) => [name, local.get(name)])) : local
    visiting.pop()
  }
  for (const module of modules.values()) visit(module)
  const definitions = [...modules.values()].flatMap(module => module.definitions)
  if (!definitions.length || definitions.length > 100) fail(files[0], 'support', '분석 문서의 함수·값 정의는 1~100개여야 합니다.')
  return {
    definitions,
    files: [...modules.values()].map(({ name, file }) => ({ ...file, moduleName: name })),
  }
}
