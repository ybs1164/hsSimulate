import { formatSourceValue, sourceValueTruncated } from './sourceValue.js'
import { SourceDocument, SOURCE_STORAGE_KEY } from './sourceDocument.js'
import { createSourceRunner } from './sourceRunner.js'
import { sourceLocation } from './sourceParser.js'
import { createExecutionPlayback } from './executionTrace.js'

// Read-only analysis uses the existing Graph area, never loadProject/autosave.
export function initSourcePanel({ onEnter, onLeave }) {
  const workspace = document.querySelector('.workspace'), sidebar = workspace.querySelector('.sidebar')
  const model = new SourceDocument({ save: data => localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(data)) })
  let active = false, selectedNode = null, calculating = false, generation = 0
  const runner=createSourceRunner()
  const show=formatSourceValue
  const manual = document.createElement('div')
  manual.className = 'code-manual-tools'
  ;[...sidebar.children].filter(el => !el.matches('.side-heading, .workspace-resizer')).forEach(el => manual.append(el))
  const tabs = document.createElement('div')
  tabs.className = 'code-mode-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Workspace 모드')
  tabs.innerHTML = '<button id="code-tab" type="button" role="tab" aria-controls="code-pane" aria-selected="false">코드</button><button id="manual-tab" type="button" role="tab" aria-controls="manual-tools" aria-selected="true">함수</button>'
  manual.id = 'manual-tools'; manual.setAttribute('role', 'tabpanel'); manual.setAttribute('aria-labelledby', 'manual-tab')
  const pane = document.createElement('section')
  pane.className = 'code-pane'; pane.id = 'code-pane'; pane.hidden = true; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', 'code-tab')
  pane.innerHTML = `<label for="code-input">Haskell 코드 · 첫 버전</label><textarea id="code-input" spellcheck="false" aria-describedby="code-support"></textarea>
    <button type="button" id="code-convert" class="tool-button primary">그래프로 변환</button>
    <div class="code-run-controls"><button type="button" class="tool-button" id="code-stop" disabled>계산 중단</button><button type="button" class="tool-button" id="code-stop-playback" disabled>재생 중단</button></div>
    <p id="code-status" role="status" aria-live="polite"></p>
    <details id="code-support"><summary>지원 범위와 제한</summary><p>정의는 한 줄씩, 모든 정의에 구체적인 Int/Bool·리스트·함수 시그니처가 필요합니다. 정수·True/False·+ − *·비교·&amp;&amp;·||·if then else·abs/div/mod·백틱 호출·괄호·변수·자기/상호 재귀·빈 줄·-- 주석을 지원합니다. 리스트([Int]·[Bool], 중첩 가능), :·++, 순서 있는 []·[x]·(x:xs)·변수·_ 패턴, 함수 값·부분 적용, map/filter/지연 foldl, 오른쪽 연산자 섹션(< pivot)을 지원합니다. 정의의 인자는 전부 명시합니다. 음수 인자는 (-2)처럼 괄호로 감싸세요.</p><p>import·IO·튜플·가드·let/where·사용자 data·사용자 다형 시그니처는 미지원입니다. 모든 중간 계산은 ±9007199254740991 이내여야 합니다. Graph JS 실행이며 GHC 실행이 아닙니다. 호출 깊이 48·평가 깊이 128, 함수/노드/리스트 검사 각 6,000회, 계산 1.5초(Worker 강제 종료 4초), 기록 20,000개가 상한입니다. 리스트 표시는 앞 100개·총 300개·중첩 8단계까지만 요구하며, 나머지는 강제로 계산하지 않고 …로 표시합니다. 제한 초과는 오류로 중단합니다. 계산 중단과 기록 재생 중단은 별개입니다.</p><p>분석 문서는 수동 프로젝트와 별도 저장됩니다. 생성 그래프는 읽기 전용이며 원문으로의 역변환은 없습니다.</p></details>
    <h2>분석 함수 / 값</h2><ul id="code-functions"></ul>
    <label for="code-source-preview">변환된 원문 · 노드를 눌러 위치 확인</label><pre id="code-source-preview" tabindex="0"></pre>`
  sidebar.querySelector('.side-heading').after(tabs, manual, pane)
  const input = pane.querySelector('textarea'), status = pane.querySelector('#code-status'), preview = pane.querySelector('pre')
  input.value = model.draft
  const surface = document.createElement('div')
  surface.className = 'code-surface'; surface.hidden = true
  surface.innerHTML = '<div class="code-graph-heading"></div><div class="code-graph-sheet"></div>'
  document.querySelector('.canvas-wrap').append(surface)
  const inspector = document.createElement('div'); inspector.className = 'code-inspector'; inspector.hidden = true
  document.querySelector('.inspector').append(inspector)
  const summary = document.createElement('span'); summary.className = 'code-runtime-status'; summary.hidden = true; summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite')
  document.querySelector('.canvas-footer').append(summary)
  const crumb = document.createElement('b'); crumb.className = 'code-crumb'; crumb.hidden = true
  document.querySelector('.breadcrumbs').append(crumb)
  const playback = createExecutionPlayback({ onChange: renderPlayback })
  const savedDisabled = new Map()
  const commands = [...document.querySelectorAll('#undo, #redo, #back-graph, .project-menu button, .project-menu select')]
  const current = () => model.document?.functions.find(f => f.id === model.selected)
  const clear = () => { generation++; runner.cancel(); calculating=false; playback.cancel(); selectedNode = null }
  pane.querySelector('#code-stop').onclick=()=>{clear();model.result={error:{message:'사용자가 계산을 중단했습니다.'},events:[]};render()}
  pane.querySelector('#code-stop-playback').onclick=()=>playback.cancel()

  function mode(value) {
    if (active === value) return
    clear(); model.result = model.highlight = null
    active = value
    if (active) onEnter()
    workspace.classList.toggle('code-mode', active)
    manual.hidden = active; pane.hidden = !active; surface.hidden = !active; inspector.hidden = !active; summary.hidden = !active; crumb.hidden = !active
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String((b.id === 'code-tab') === active)))
    for (const button of commands) {
      if (active) { savedDisabled.set(button, button.disabled); button.disabled = true }
      else button.disabled = savedDisabled.get(button)
    }
    if (active) render()
    else onLeave()
  }
  tabs.querySelector('#code-tab').onclick = () => mode(true)
  tabs.querySelector('#manual-tab').onclick = () => mode(false)
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); mode(!active); tabs.querySelector(active ? '#code-tab' : '#manual-tab').focus()
  })
  // Existing global edit shortcuts must never mutate the hidden manual graph.
  window.addEventListener('keydown', event => {
    if (!active) return
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); evaluate() }
  })
  input.addEventListener('input', () => { clear(); model.edit(input.value); render() })
  pane.querySelector('#code-convert').onclick = () => { clear(); model.convert(); render() }
  try {
    const saved = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || 'null')
    if (saved && typeof saved.source === 'string' && Number.isSafeInteger(saved.version) && saved.version > 0) { model.edit(saved.source); model.convert(saved.version, false); input.value = model.draft }
  } catch { /* corrupt analysis storage cannot affect the manual project */ }

  function refreshRunLabel() {
    if (!active) return
    const button = document.querySelector('#run'), fn = current()
    button.querySelector('span').textContent = fn ? `평가 ${fn.name}` : '분석 값 선택'
    button.disabled = calculating || model.stale || !fn || fn.arity > 0
    button.title = model.stale ? '코드를 그래프로 변환하세요' : fn?.arity ? '인자가 없는 최상위 값만 평가합니다' : 'Graph JS로 선택한 코드 값을 한 번 평가합니다 (Ctrl/⌘+Enter)'
    document.querySelector('#run-shortcut-label').textContent = '선택 값 평가'
  }
  function render() {
    refreshRunLabel()
    status.textContent = model.error ? model.error.message : model.stale ? (model.document ? `재변환 필요 · 아래 그래프는 이전 v${model.document.version}입니다` : '코드를 붙여 넣고 변환하세요') : `v${model.document.version} 변환 완료 · 그래프는 읽기 전용`
    status.dataset.state = model.error ? 'error' : model.stale ? 'stale' : 'ready'
    const list = pane.querySelector('ul'); list.replaceChildren()
    for (const fn of model.document?.functions || []) {
      const li = document.createElement('li'), button = document.createElement('button')
      button.type = 'button'; button.dataset.codeFunction = fn.id; button.textContent = `${fn.name} :: ${fn.signature}`
      button.setAttribute('aria-pressed', String(model.selected === fn.id))
      button.onclick = () => { clear(); model.selectFunction(fn.id); render() }
      li.append(button); list.append(li)
    }
    crumb.textContent = `코드 / ${current()?.name || '미변환'}`
    renderSource(); renderGraph(); renderInspector(); renderPlayback()
  }
  function renderSource() {
    preview.replaceChildren()
    const source = model.document?.source || '', range = model.highlight
    if (!range || model.stale) { preview.textContent = source; return }
    const mark = document.createElement('mark'); mark.textContent = source.slice(range.start, range.end)
    mark.dataset.start = range.start; mark.dataset.end = range.end; mark.dataset.version = range.version
    preview.append(source.slice(0, range.start), mark, source.slice(range.end))
    input.setSelectionRange(range.start, range.end)
    mark.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  function renderInspector() {
    inspector.replaceChildren()
    const heading = document.createElement('h2')
    // All user source is inserted as text, never HTML.
    heading.textContent = selectedNode ? `노드 · ${selectedNode.label}` : current()?.name || '코드 분석'; inspector.append(heading)
    const text = value => { const p = document.createElement('p'); p.textContent = value; inspector.append(p); return p }
    text(model.stale ? '이전 변환 그래프입니다. 최신 코드는 재변환해야 평가할 수 있습니다.' : current()?.arity ? '매개변수가 있는 함수입니다. 인자가 없는 값에서 호출해 평가하세요.' : '상단 평가 버튼으로 선택한 값을 실행합니다.')
    if (model.highlight && !model.stale) {
      const range = model.highlight, start = sourceLocation(model.document.source, range.start), end = sourceLocation(model.document.source, range.end)
      text(`원문 v${range.version} · ${start.line}:${start.column}–${end.line}:${end.column} · ${range.kind}`)
      const pre = document.createElement('pre'); pre.textContent = model.document.source.slice(range.start, range.end); inspector.append(pre)
      if (range.targetDefinition) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-button'; button.textContent = '호출한 함수 정의로 이동'
        button.onclick = () => { clear(); model.selectFunction(range.targetDefinition); render() }; inspector.append(button)
      }
    }
    if (model.result) {
      const result = text(model.result.error ? model.result.error.message : `Graph JS 결과: ${show(model.result.value)}`)
      if(sourceValueTruncated(model.result.value))result.append(' · 표시 일부 생략 (전체 값의 계산 완료를 뜻하지 않음)')
      result.dataset.truncated=String(sourceValueTruncated(model.result.value))
      result.className = 'code-result'; result.dataset.result = model.result.error ? 'error' : show(model.result.value)
      result.setAttribute('role', 'status')
      const equations=new Map((model.document?.functions||[]).flatMap(fn=>(fn.equations||[]).map((eq,i)=>[eq.id,{name:fn.name,index:i+1,calls:new Set()}])))
      for(const event of model.result.allEvents||[])if(event.phase==='start')equations.get(event.functionId)?.calls.add(event.callId)
      const entered=[...equations.values()].filter(eq=>eq.calls.size)
      if(entered.length){
        const details=document.createElement('details');details.className='code-equation-trace'
        const summary=document.createElement('summary');summary.textContent='실제 진입한 방정식 · 호출별 기록';details.append(summary)
        for(const eq of entered.slice(0,40)){const p=document.createElement('p');p.textContent=`${eq.name} · 방정식 ${eq.index}: ${eq.calls.size}개 호출`;details.append(p)}
        if(entered.length>40)details.append('나머지 방정식 표시는 생략했습니다.')
        inspector.append(details)
      }
      if(model.result.error?.callSpan){
        const button=document.createElement('button');button.type='button';button.className='tool-button';button.textContent='오류가 전달된 호출 위치'
        button.onclick=()=>{selectedNode=null;surface.querySelectorAll('.code-selected').forEach(n=>n.classList.remove('code-selected'));model.highlight={...model.result.error.callSpan,version:model.document.version};renderSource();renderInspector()};inspector.append(button)
      }
    }
  }
  function renderGraph() {
    const sheet = surface.querySelector('.code-graph-sheet'), heading = surface.querySelector('.code-graph-heading')
    sheet.replaceChildren()
    const graph = model.document?.functionBodies[model.selected]
    heading.textContent = graph ? `${current().name} :: ${current().signature} · v${model.document.version}${model.stale ? ' · 재변환 필요' : ''}` : '코드를 변환하면 이곳에 읽기 전용 그래프가 표시됩니다.'
    surface.classList.toggle('code-stale', model.stale)
    if (!graph) return
    surface.style.scrollPaddingTop=`${heading.offsetHeight+12}px`
    surface.style.scrollPaddingBottom='16px'
    const bodies=[{id:model.selected,graph},...(current().equations||[]).map(eq=>({...eq,graph:model.document.functionBodies[eq.id]}))]
    for(const [ordinal,body] of bodies.entries()) {
    const graph=body.graph
    if(ordinal){
      const title=document.createElement('h3');title.className='code-equation-title';title.textContent=`방정식 ${ordinal} · 위에서부터 검사`;sheet.append(title)
      const patterns=document.createElement('div');patterns.className='code-patterns'
      for(const p of body.patterns){
        const button=document.createElement('button');button.type='button';button.className='tool-button code-pattern';button.textContent=p.text
        button.onclick=()=>{selectedNode=null;surface.querySelectorAll('.code-selected').forEach(n=>n.classList.remove('code-selected'));model.highlight={...p.span,version:model.document.version,kind:'pattern',owner:body.id};renderSource();renderInspector()};patterns.append(button)
      }
      sheet.append(patterns)
    }
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    const width = Math.max(...Object.values(graph).map(n => n.x)) + 185, height = Math.max(...Object.values(graph).map(n => n.y)) + 100
    if(current().equations?.length)svg.style.maxWidth=`${width}px`
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('aria-label', `${current().name} 함수 그래프`)
    const el = (name, attrs) => { const element = document.createElementNS(ns, name); Object.entries(attrs).forEach(([k, v]) => element.setAttribute(k, v)); return element }
    for (const n of Object.values(graph)) {
      const sources = n.mounted || (n.target ? [n.target] : n.source ? [n.source] : [])
      sources.forEach((id, index) => {
        if(!id)return
        const from = graph[id], y = n.y + 20 + index * 12
        svg.append(el('path', { d: `M${from.x + 150},${from.y + 26} C${from.x + 180},${from.y + 26} ${n.x - 25},${y} ${n.x},${y}`, class: 'code-edge' }))
      })
    }
    for (const actual of Object.values(graph)) {
      const node=actual.id==='output'&&ordinal?{...actual,id:`${body.id}:output`}:actual
      const group = el('g', { transform: `translate(${node.x},${node.y})`, class: `code-node${selectedNode?.id === node.id ? ' code-selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${node.label} 노드 원문 위치`, 'data-code-node': node.id })
      group.append(el('rect', { width: 150, height: 56, rx: 14 }))
      const label = el('text', { x: 12, y: 25 }); label.textContent = node.label.length>18?node.label.slice(0,16)+'…':node.label
      const type = el('text', { x: 12, y: 44, class: 'code-node-type' }); type.textContent = `${node.type === 'function' ? (node.resultType?.includes('->')?'함수 값 / 부분 적용':'호출') : node.type} · ${node.resultType || node.annotation || '?'}`
      const tooltip=el('title',{});tooltip.textContent=`${node.label} · ${node.resultType || node.annotation || '?'}`
      if(type.textContent.length>23)type.textContent=type.textContent.slice(0,21)+'…'
      group.append(label, type, tooltip, el('text', { x: 0, y: -7, class: 'code-node-state' }))
      const select = () => {
        selectedNode = node; model.selectNode(node.id); renderSource()
        // Keep the actual SVG/focus/scroll position when choosing a node.
        surface.querySelectorAll('.code-node').forEach(n=>n.classList.toggle('code-selected',n.dataset.codeNode===node.id))
        renderInspector(); renderPlayback()
      }
      group.addEventListener('click', select)
      group.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); select() } })
      svg.append(group)
    }
    sheet.append(svg)
    }
  }
  function renderPlayback() {
    for (const node of surface.querySelectorAll('[data-code-node]')) {
      node.dataset.state = playback.states.get(node.dataset.codeNode)?.state || 'idle'
      node.querySelector('.code-node-state').textContent = ({ running: '계산 중', done: '완료', error: '오류' })[node.dataset.state] || ''
    }
    if (!active) return
    pane.querySelector('#code-stop').disabled=!calculating
    pane.querySelector('#code-stop-playback').disabled=!playback.playing
    surface.dataset.calculating=String(calculating)
    summary.textContent = calculating ? 'Graph JS 계산 중 · 계산 중단 가능' : model.stale ? '재변환 필요 · 이전 결과 표시 안 함' : playback.playing ? '실행 기록 재생 중 · 계산은 한 번만 실행' : model.result?.error ? `Graph JS 오류: ${model.result.error.message}` : model.result ? `Graph JS 결과: ${show(model.result.value)}${sourceValueTruncated(model.result.value)?' · 표시 일부 생략':''}` : '읽기 전용 코드 그래프 · Graph JS'
  }
  async function evaluate() {
    if (!active || model.stale || current()?.arity) return
    clear()
    const token=generation
    calculating=true; model.result=model.highlight=null; render()
    const result=await model.evaluateWith((doc,id)=>runner.run(doc,id))
    if(token!==generation)return
    calculating=false
    if (result) playback.play(result.events, { rootId: model.selected })
    render()
  }
  return { get active() { return active }, refreshRunLabel, evaluate }
}
