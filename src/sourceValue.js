// A bounded display request, not serialization of every lazy field or closure.
export const SOURCE_PREVIEW_LIMIT=100
export function serializeSourceValue(value,{force}) {
  let remaining=300
  function visit(v,depth=0){
    if(remaining--<=0||depth>=8)return {kind:'source-omitted'}
    v=force(v)
    if(v?.kind==='closure')return {kind:'source-function',name:v.callee}
    if(v?.kind!=='data')return v
    const items=[];let rest=v
    for(let i=0;i<SOURCE_PREVIEW_LIMIT;i++){
      if(rest.ctorIndex===0)return {kind:'source-list',items,truncated:false}
      if(remaining<=0)return {kind:'source-list',items,truncated:true}
      items.push(visit(rest.args[0],depth+1))
      // Do not demand the next cell merely to decide if an ellipsis is needed.
      if(i===SOURCE_PREVIEW_LIMIT-1||remaining<=0)return {kind:'source-list',items,truncated:true}
      rest=force(rest.args[1])
    }
  }
  return visit(value)
}
export function formatSourceValue(value){
  if(value?.kind==='source-list')return `[${value.items.map(formatSourceValue).join(',')}${value.truncated?(value.items.length?',…':'…'):''}]`
  if(value?.kind==='source-function')return '함수 값 (캡처한 인자는 강제하지 않음)'
  if(value?.kind==='source-omitted')return '…'
  return typeof value==='boolean'?(value?'True':'False'):String(value)
}
export function sourceValueTruncated(value){
  return value?.kind==='source-omitted'||value?.kind==='source-list'&&(value.truncated||value.items.some(sourceValueTruncated))
}
