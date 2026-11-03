import { describeTraceValue } from './sourceHistory.js'

export function addTraceInspector(host, documentModel, history, selectedCallId, actions) {
  if (!history.length) return
  const section = document.createElement('section')
  section.className = 'code-trace-inspector'
  const name = id => documentModel.nodes[id]?.label || id
  const show = ref => describeTraceValue(ref, history.values, name)
  const call = history.calls.get(selectedCallId)
  const label = document.createElement('label')
  label.htmlFor = 'code-trace-call'
  label.textContent = '호출 관계 · 현재 단계까지'
  const select = document.createElement('select')
  select.id = label.htmlFor
  select.add(new Option('호출 선택', ''))
  for (const entry of history.calls.values()) {
    const parent = entry.parentCallId ? ` · 부모 #${entry.parentCallId}` : ''
    select.add(new Option(`#${entry.callId} ${name(entry.functionId)}${parent}`, entry.callId))
  }
  select.value = call ? String(call.callId) : ''
  select.disabled = history.calls.size === 0
  select.addEventListener('focus', actions.pause)
  select.addEventListener('change', () => actions.select(Number(select.value)))
  section.append(label, select)
  if (call) {
    const details = document.createElement('dl')
    const field = (key, value) => {
      const term = document.createElement('dt'), definition = document.createElement('dd')
      term.textContent = key
      definition.textContent = value
      details.append(term, definition)
      return definition
    }
    field('호출', `#${call.callId} ${name(call.functionId)}`)
    field('부모', call.parentCallId ? `#${call.parentCallId} ${name(history.calls.get(call.parentCallId)?.functionId || '')}` : '최상위')
    const def = documentModel.nodes[call.functionId]
    const owner = documentModel.functions.find(fn => fn.id === (def.sourceOwner || call.functionId))
    const eq = owner?.equations?.find(row => row.id === (call.equationId || (def.sourceOwner && call.functionId)))
    if (eq) field('선택 방정식', `${owner.equations.indexOf(eq) + 1} · ${eq.patterns.map(p => p.text).join(' ')}`)
    else if (owner?.equations?.length) field('선택 방정식', '아직 선택되지 않음')
    for (const [i, arg] of call.args.entries()) {
      const item = field(def.params[i] || `인자 ${i + 1}`, show(arg))
      item.dataset.traceArg = def.params[i] || String(i + 1)
    }
    field('상태', { running: '평가 중', done: '반환됨', error: '오류' }[call.status])
    const result = field('반환값', call.status === 'error' ? call.message : show(call.value))
    result.className = 'code-trace-return'
    section.append(details)
    const navigation = document.createElement('div')
    navigation.className = 'code-trace-nav'
    function button(id, text, handler) {
      const button = document.createElement('button')
      button.type = 'button'
      button.id = id
      button.className = 'tool-button'
      button.textContent = text
      button.onclick = () => handler(call)
      navigation.append(button)
    }
    button('code-trace-definition', '함수 정의', actions.definition)
    if (call.site?.functionId) button('code-trace-site', '호출 위치', actions.site)
    section.append(navigation)
  }
  host.append(section)
}
