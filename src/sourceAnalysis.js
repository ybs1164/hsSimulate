import { SourceError, parseSource } from './sourceParser.js'

const same = (a, b) => a.kind === b.kind && (a.kind !== 'fun' || (same(a.from, b.from) && same(a.to, b.to)))
export const showSourceType = t => t.kind === 'int' ? 'Int' : t.kind === 'bool' ? 'Bool' : `${t.from.kind === 'fun' ? `(${showSourceType(t.from)})` : showSourceType(t.from)} -> ${showSourceType(t.to)}`
// Resolve the whole document before checking bodies, so source order is irrelevant.
export function analyzeSource(parsed) {
  const { source, definitions, signatures } = parsed
  const fail = (stage, message, span) => { throw new SourceError(stage, message, source, span) }
  const names = new Map(), sigs = new Map()
  const base = kind => ({kind}), arrow=(from,to)=>({kind:'fun',from,to})
  const builtinTypes = {abs:arrow(base('int'),base('int')),div:arrow(base('int'),arrow(base('int'),base('int'))),mod:arrow(base('int'),arrow(base('int'),base('int')))}
  for (const sig of signatures) {
    if (sigs.has(sig.name)) fail('names', `${sig.name}의 타입 시그니처가 중복됩니다.`, sig.span)
    sigs.set(sig.name, sig)
  }
  for (const def of definitions) {
    if (names.has(def.name)) fail('names', `${def.name} 정의가 중복됩니다. 패턴별 여러 정의는 지원하지 않습니다.`, def.nameSpan)
    const sig = sigs.get(def.name)
    if (!sig) fail('types', `${def.name} :: Int/Bool 또는 Int/Bool -> … 시그니처가 필요합니다.`, def.nameSpan)
    let t = sig.type, arity = 0
    while (t.kind === 'fun') {
      if (!['int','bool'].includes(t.from.kind)) fail('types', '함수를 인자로 받는 고차 함수는 첫 버전에서 지원하지 않습니다.', sig.span)
      t = t.to; arity++
    }
    if (def.params.length !== arity) fail('types', `${def.name}: 시그니처의 인자 ${arity}개를 모두 변수 매개변수로 적어 주세요.`, def.nameSpan)
    const locals = new Set()
    for (const p of def.params) { if (locals.has(p.text)) fail('names', `매개변수 ${p.text}가 중복됩니다.`, p); locals.add(p.text) }
    names.set(def.name, { ...def, type: sig.type, signatureSpan: sig.span, paramTypes:(()=>{const out=[];let t=sig.type;while(t.kind==='fun'){out.push(t.from);t=t.to}return out})(),returnType:t, dependencies: [] })
  }
  for (const sig of signatures) if (!names.has(sig.name)) fail('names', `${sig.name}의 정의가 없습니다.`, sig.span)
  function check(expr, def, depth = 0) {
    if (depth > 100) fail('support', '표현식 중첩은 최대 100단계입니다.', expr.span)
    const child = part => check(part, def, depth + 1)
    if (expr.kind === 'group') return expr.type=child(expr.expr)
    if (expr.kind === 'boolean') return expr.type=base('bool')
    if (expr.kind === 'integer') {
      if (!Number.isSafeInteger(Number(expr.text))) fail('range', '정수는 ±9007199254740991 범위만 지원합니다.', expr.span)
      return expr.type=base('int')
    }
    if (expr.kind === 'name') {
      const local=def.params.findIndex(p=>p.text===expr.name)
      if (local>=0) {expr.binding='parameter';return expr.type=def.paramTypes[local]}
      const target = names.get(expr.name)
      if (!target && builtinTypes[expr.name]) {expr.binding='builtin';return expr.type=builtinTypes[expr.name]}
      if (!target) fail('names', `정의되지 않은 이름 ${expr.name}입니다. 외부 함수·import는 지원하지 않습니다.`, expr.span)
      expr.binding = 'definition'; def.dependencies.push({ name: expr.name, span: expr.span })
      return expr.type=target.type
    }
    if (expr.kind === 'application') {
      const fn = child(expr.fn), arg = child(expr.arg)
      if (fn.kind !== 'fun') fail('types', 'Int/Bool 값은 함수처럼 호출할 수 없습니다.', expr.fn.span)
      if (!same(fn.from, arg)) fail('types', `인자는 ${showSourceType(fn.from)}이어야 하지만 ${showSourceType(arg)}입니다.`, expr.arg.span)
      return expr.type=fn.to
    }
    if(expr.kind==='if') {
      if(child(expr.condition).kind!=='bool')fail('types','if 조건은 Bool이어야 합니다.',expr.condition.span)
      const yes=child(expr.yes),no=child(expr.no)
      if(!same(yes,no))fail('types','if의 두 분기 결과 타입이 같아야 합니다.',expr.no.span)
      if(yes.kind==='fun')fail('support','조건식 분기는 Int/Bool 값이어야 합니다. 함수 값 선택은 미지원입니다.',expr.span)
      return expr.type=yes
    }
    if(expr.callee) {
      const fn=child(expr.callee),left=child(expr.left),right=child(expr.right)
      if(fn.kind!=='fun'||fn.to.kind!=='fun'||!same(fn.from,left)||!same(fn.to.from,right))fail('types','백틱 함수의 두 인자 타입이 시그니처와 맞지 않습니다.',expr.span)
      return expr.type=fn.to.to
    }
    const parts=expr.kind==='negate'?[expr.arg]:[expr.left,expr.right]
    const boolean=['&&','||'].includes(expr.op),comparison=['==','/=','<','<=','>','>='].includes(expr.op)
    for(const part of parts)if(child(part).kind!==(boolean?'bool':'int'))fail('types',boolean?'논리 연산에는 Bool이 필요합니다.':'산술·비교 연산에는 Int 값이 필요합니다. 함수 인자와 타입을 확인하세요.',part.span)
    return expr.type=base(boolean||comparison?'bool':'int')
  }
  for(const def of names.values())if(!same(check(def.expr,def),def.returnType))fail('types',def.name+'의 본문 결과가 시그니처 '+showSourceType(def.returnType)+'와 맞지 않습니다.',def.expr.span)
  return { source, definitions: [...names.values()] }
}
export const parseAndAnalyze = source => analyzeSource(parseSource(source))
