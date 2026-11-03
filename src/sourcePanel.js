import { formatSourceValue, sourceValueTruncated } from './sourceValue.js'
import { SourceDocument, SOURCE_STORAGE_KEY, SOURCE_FILES_STORAGE_KEY } from './sourceDocument.js'
import { readSelectedSourceFiles } from './sourceFiles.js'
import { createSourceRunner } from './sourceRunner.js'
import { sourceLocation } from './sourceParser.js'
import { createSourceHistory, describeTraceValue } from './sourceHistory.js'
import { addTraceInspector } from './sourceDebuggerPanel.js'

// Read-only analysis uses the existing Graph area, never loadProject/autosave.
export function initSourcePanel({ onEnter, onLeave }) {
  const workspace = document.querySelector('.workspace'), sidebar = workspace.querySelector('.sidebar')
  const pasted = new SourceDocument({ save: data => localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(data)) })
  const imported = new SourceDocument({ fileMode: true, save: data => localStorage.setItem(SOURCE_FILES_STORAGE_KEY, JSON.stringify(data)) })
  const modeKey = 'hs-simulate:code-source-mode'
  let model = pasted, fileRequest = 0
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
  pane.innerHTML = `<div class="code-file-controls">
      <button type="button" class="tool-button" id="code-paste-mode">붙여넣기</button>
      <button type="button" class="tool-button" id="code-files-mode">파일 작업</button>
      <button type="button" class="tool-button" id="code-open-files">.hs 파일 열기</button>
      <input type="file" id="code-file-input" aria-label=".hs 파일 선택" accept=".hs" multiple hidden>
    </div>
    <div id="code-file-controls" hidden>
      <label for="code-file-view">원문 파일</label>
      <select id="code-file-view"></select>
      <button type="button" class="tool-button" id="code-remove-file">현재 파일 제거</button>
    </div>
    <p id="code-file-status" role="status" hidden></p>
    <label id="code-input-label" for="code-input">Haskell 코드</label><textarea id="code-input" spellcheck="false" aria-describedby="code-support"></textarea>
    <button type="button" id="code-convert" class="tool-button primary">그래프로 변환</button>
    <div class="code-run-controls"><button type="button" class="tool-button" id="code-stop" disabled>계산 중단</button></div>
    <p id="code-status" role="status" aria-live="polite"></p>
    <details id="code-support"><summary>지원 범위와 제한</summary><p>정의는 한 줄씩, 모든 정의에 구체적인 Int/Bool·리스트·함수 시그니처가 필요합니다. 정수·True/False·+ − *·비교·&amp;&amp;·||·if then else·abs/div/mod·백틱 호출·괄호·변수·자기/상호 재귀·빈 줄·-- 주석을 지원합니다. 리스트([Int]·[Bool], 중첩 가능), :·++, 순서 있는 []·[x]·(x:xs)·변수·_ 패턴, 함수 값·부분 적용, map/filter/지연 foldl, 오른쪽 연산자 섹션(< pivot)을 지원합니다. 정의의 인자는 전부 명시합니다. 음수 인자는 (-2)처럼 괄호로 감싸세요.</p><p>사용자가 선택한 UTF-8 .hs 파일만 불러옵니다. 파일당 40,000자, 전체 120,000자, 파일 12개까지 지원합니다. 로컬 module·export·import·qualified·as와 함수/값 목록을 지원합니다. 명시적 Prelude import·hiding·재내보내기·순환 모듈·외부 라이브러리·IO·튜플·가드·let/where·사용자 data·사용자 다형 시그니처는 미지원입니다. 모든 중간 계산은 ±9007199254740991 이내여야 합니다. Graph JS 실행이며 GHC 실행이 아닙니다. 호출 깊이 48·평가 깊이 128, 함수/노드/리스트 검사 각 6,000회, 계산 1.5초(Worker 강제 종료 4초), 노드 기록 20,000개가 상한입니다. 탐색 기록은 최대 4,000단계와 값 참조 10,000개까지 보관하며 초과분은 생략합니다. 리스트 표시는 앞 100개·총 300개·중첩 8단계까지만 요구하며, 나머지는 강제로 계산하지 않고 …로 표시합니다. 계산 한도를 넘으면 오류로 중단합니다. 계산 중단과 기록 재생 중단은 별개입니다.</p><p>분석 문서는 수동 프로젝트와 별도 저장됩니다. 생성 그래프는 읽기 전용이며 원문으로의 역변환은 없습니다.</p></details>
    <div id="code-module-controls" hidden><label for="code-module">분석 대상 모듈</label><select id="code-module"></select></div>
    <h2>분석 함수 / 값</h2><ul id="code-functions"></ul>
    <label for="code-source-preview">변환된 원문 · 노드를 눌러 위치 확인</label><pre id="code-source-preview" tabindex="0"></pre>`
  sidebar.querySelector('.side-heading').after(tabs, manual, pane)
  const input = pane.querySelector('textarea'), status = pane.querySelector('#code-status'), preview = pane.querySelector('pre')
  const fileInput = pane.querySelector('#code-file-input'), fileView = pane.querySelector('#code-file-view')
  const moduleSelect = pane.querySelector('#code-module'), fileStatus = pane.querySelector('#code-file-status')
  const fileButton = pane.querySelector('#code-open-files'), removeButton = pane.querySelector('#code-remove-file')
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
  const controls = document.createElement('div')
  controls.className = 'code-history'
  controls.hidden = true
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', '실행 기록 탐색')
  controls.innerHTML = `<div class="code-history-buttons">
    <button type="button" class="tool-button" id="code-history-first">처음</button>
    <button type="button" class="tool-button" id="code-history-prev">이전</button>
    <button type="button" class="tool-button" id="code-history-next">다음</button>
    <button type="button" class="tool-button" id="code-stop-playback">자동 재생</button>
    <button type="button" class="tool-button" id="code-history-find">현재 노드 찾기</button>
    </div><output id="code-history-position"></output>`
  document.querySelector('.canvas-wrap').before(controls)
  const history = createSourceHistory(showStep)
  const savedDisabled = new Map(), viewPositions = new Map()
  const commands = [...document.querySelectorAll('#undo, #redo, #back-graph, .project-menu button, .project-menu select')]
  let frameId = null, selectedCallId = null, graphOwner = null, renderedOwner = null, stepNode = null
  const current = () => model.document?.functions.find(f => f.id === model.selected)
  const viewFunction = () => model.document?.functions.find(f => f.id === (graphOwner || model.selected))
  const clear = () => {
    generation++
    runner.cancel()
    calculating = false
    history.load([])
    selectedNode = frameId = selectedCallId = graphOwner = stepNode = null
    viewPositions.clear()
  }
  pane.querySelector('#code-stop').onclick = () => {
    clear()
    model.result = { error: { message: '사용자가 계산을 중단했습니다.' }, events: [] }
    render()
  }
  const control = id => controls.querySelector('#' + id)
  control('code-history-first').onclick = () => history.seek(0)
  control('code-history-prev').onclick = () => history.seek(history.position - 1)
  control('code-history-next').onclick = () => history.seek(history.position + 1)
  control('code-stop-playback').onclick = () => history.playing ? history.pause() : history.play()
  control('code-history-find').onclick = findNode

  function findNode() {
    if (!stepNode) return
    const node = surface.querySelector('[data-code-node="' + CSS.escape(stepNode) + '"]')
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    node?.focus({ preventScroll: true })
  }
  function showPosition(owner, callId, nodeId, range) {
    const previousOwner = viewFunction()?.id
    graphOwner = model.document.nodes[owner]?.sourceOwner || owner || null
    frameId = callId
    selectedNode = null
    stepNode = nodeId || null
    highlight(range)
    if (viewFunction()?.id !== previousOwner) renderGraph()
    renderSource(); renderInspector(); renderPlayback()
  }
  function showStep() {
    if (!active || !model.document) return
    const step = history.event
    const root = [...history.calls.values()].find(call => call.parentCallId === 0)
    selectedCallId = step?.callId || (step?.kind === 'finish' ? root?.callId : null)
    const owner = step?.functionId || model.selected
    const locationId = step?.equationId || step?.nodeId || (step?.kind === 'finish' ? owner : '')
    const range = step?.span || model.document.locations[locationId]
    if (!step && model.viewFile(current()?.fileId)) syncFileView()
    showPosition(owner, step?.callId || (step?.kind === 'finish' ? root?.callId : null), step?.nodeId, range)
  }
  function showCall(call, atSite = false) {
    if (!call) return
    history.pause(false)
    selectedCallId = call.callId
    const site = atSite ? call.site : null
    showPosition(site?.functionId || call.functionId, site?.callId || call.callId, site?.nodeId || call.nodeId,
      site?.span || call.span || model.document.locations[site?.nodeId || call.functionId])
  }

  function syncFileView() {
    input.value = model.draft
    fileView.value = model.fileId || ''
    const filename = model.files?.find(file => file.id === model.fileId)?.name
    pane.querySelector('#code-input-label').textContent = filename || 'Haskell 코드'
  }
  function highlight(range) {
    model.highlight = range && !model.stale ? { ...range, version: model.document.version } : null
    if (model.highlight && model.viewFile(range.fileId)) syncFileView()
  }
  function reportFiles(message, error = false) {
    fileStatus.textContent = message
    fileStatus.hidden = !message
    fileStatus.dataset.state = error ? 'read-error' : 'ready'
  }
  function chooseSource(next) {
    if (model !== next) {
      clear()
      model.result = model.highlight = null
      model = next
      model.result = model.highlight = null
      syncFileView()
      try {
        if (next === pasted || next.document) localStorage.setItem(modeKey, next === pasted ? 'paste' : 'files')
      } catch { /* mode preference is optional */ }
    }
    render()
  }
  pane.querySelector('#code-paste-mode').onclick = () => { reportFiles(''); chooseSource(pasted) }
  pane.querySelector('#code-files-mode').onclick = () => { reportFiles(''); chooseSource(imported) }
  fileButton.onclick = () => fileInput.click()
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files)
    fileInput.value = ''
    if (!files.length) return
    const request = ++fileRequest, revision = imported.revision
    try {
      const loaded = await readSelectedSourceFiles(files)
      if (request !== fileRequest) return
      if (revision !== imported.revision) throw new Error('읽는 동안 파일이 편집됐습니다. 현재 편집을 보존했습니다. 다시 선택하세요.')
      const duplicates = loaded.filter(file => imported.files.some(previous => previous.id === file.id))
      if (duplicates.length && !window.confirm(`${duplicates.map(file => file.name).join(', ')}의 현재 편집 내용을 선택한 파일로 교체할까요?`)) return
      imported.replaceFiles(loaded)
      if (active) {
        clear()
        chooseSource(imported)
        syncFileView()
      }
      reportFiles(`${loaded.length}개 파일을 읽었습니다. 그래프로 변환하세요.`)
    } catch (error) {
      if (request === fileRequest) reportFiles(error.message, true)
    }
  })
  fileView.onchange = () => {
    if (!model.viewFile(fileView.value, true)) return
    history.pause(false)
    syncFileView()
    renderSource(); renderPlayback()
    renderStatus()
  }
  removeButton.onclick = () => {
    clear()
    model.removeFile(model.fileId)
    syncFileView()
    reportFiles('파일을 제거했습니다. 저장된 변환을 갱신하려면 다시 변환하세요.')
    render()
  }
  moduleSelect.onchange = () => {
    clear()
    model.selectModule(moduleSelect.value)
    const file = model.document.files.find(file => file.moduleName === model.moduleName)
    if (model.viewFile(file?.id, true)) syncFileView()
    render()
  }

  function mode(value) {
    if (active === value) return
    clear(); model.result = model.highlight = null
    controls.hidden = true
    active = value
    if (active) onEnter()
    workspace.classList.toggle('code-mode', active)
    manual.hidden = active; pane.hidden = !active; surface.hidden = !active; inspector.hidden = !active; summary.hidden = !active; crumb.hidden = !active
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String((b.id === 'code-tab') === active)))
    for (const button of commands) {
      if (active) { savedDisabled.set(button, button.disabled); button.disabled = true }
      else button.disabled = savedDisabled.get(button)
    }
    if (active) { syncFileView(); render() }
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
  pane.querySelector('#code-convert').onclick = () => {
    clear()
    if (model.convert() && model.files && !model.storageError) {
      try { localStorage.setItem(modeKey, 'files') } catch { /* file data is already saved */ }
    }
    reportFiles('')
    render()
  }
  for (const [target, key] of [[pasted, SOURCE_STORAGE_KEY], [imported, SOURCE_FILES_STORAGE_KEY]]) {
    try { target.restore(JSON.parse(localStorage.getItem(key) || 'null')) }
    catch { /* unreadable analysis storage cannot affect the manual project */ }
  }
  try { if (imported.files.length && localStorage.getItem(modeKey) !== 'paste') model = imported }
  catch { /* paste remains available even if storage is disabled */ }
  syncFileView()

  function refreshRunLabel() {
    if (!active) return
    const button = document.querySelector('#run'), fn = current()
    button.querySelector('span').textContent = fn ? `평가 ${functionName(fn)}` : '분석 값 선택'
    button.disabled = calculating || model.stale || !fn || fn.arity > 0
    button.title = model.stale ? '코드를 그래프로 변환하세요' : fn?.arity ? '인자가 없는 최상위 값만 평가합니다' : 'Graph JS로 선택한 코드 값을 한 번 평가합니다 (Ctrl/⌘+Enter)'
    document.querySelector('#run-shortcut-label').textContent = '선택 값 평가'
  }
  const functionName = fn => model.files ? `${fn.moduleName}.${fn.name}` : fn.name
  function renderStatus() {
    status.textContent = model.error ? (model.document ? `재변환 필요 · ${model.error.message}` : model.error.message)
      : model.stale ? (model.document ? `재변환 필요 · 아래 그래프는 이전 v${model.document.version}입니다` : model.files ? '.hs 파일을 선택하고 변환하세요.' : '코드를 붙여 넣고 변환하세요')
        : `v${model.document.version} 변환 완료 · 그래프는 읽기 전용`
    if (model.storageError) status.append(' · 브라우저 저장 실패. 현재 편집은 이 탭에 남아 있습니다.')
    status.dataset.state = model.error ? 'error' : model.stale ? 'stale' : 'ready'
    status.dataset.stage = model.error?.stage || ''
  }
  function render() {
    refreshRunLabel()
    renderStatus()
    const fileMode = Boolean(model.files)
    pane.querySelector('#code-paste-mode').setAttribute('aria-pressed', String(!fileMode))
    pane.querySelector('#code-files-mode').setAttribute('aria-pressed', String(fileMode))
    pane.querySelector('#code-file-controls').hidden = !fileMode
    pane.querySelector('#code-module-controls').hidden = !fileMode || !model.document
    fileView.replaceChildren(...(model.files || []).map(file => {
      const name = model.sourceFile(file.id)?.moduleName || file.moduleName || '모듈 미확인'
      return new Option(`${file.name} · ${name}`, file.id)
    }))
    fileView.value = model.fileId || ''
    moduleSelect.replaceChildren(...(model.document?.files || []).map(file => new Option(`${file.moduleName} · ${file.name}`, file.moduleName)))
    moduleSelect.value = model.moduleName || ''
    input.disabled = fileMode && !model.fileId
    removeButton.disabled = input.disabled
    pane.querySelector('#code-convert').disabled = input.disabled
    const list = pane.querySelector('ul'); list.replaceChildren()
    for (const fn of model.document?.functions || []) {
      if (fileMode && fn.moduleName !== model.moduleName) continue
      const li = document.createElement('li'), button = document.createElement('button')
      button.type = 'button'; button.dataset.codeFunction = fn.id; button.textContent = `${fn.name} :: ${fn.signature}`
      button.setAttribute('aria-pressed', String(model.selected === fn.id))
      button.onclick = () => { clear(); model.selectFunction(fn.id); highlight(model.highlight); render() }
      li.append(button); list.append(li)
    }
    crumb.textContent = `코드 / ${current() ? functionName(current()) : '미변환'}`
    renderSource(); renderGraph(); renderInspector(); renderPlayback()
  }
  function renderSource() {
    preview.replaceChildren()
    const file = model.sourceFile(), source = file?.source || '', range = model.highlight
    preview.dataset.fileId = file?.id || ''
    preview.dataset.filename = file?.name || ''
    if (!range || model.stale || range.fileId !== file?.id) { preview.textContent = source; return }
    const mark = document.createElement('mark'); mark.textContent = source.slice(range.start, range.end)
    mark.dataset.start = range.start; mark.dataset.end = range.end; mark.dataset.version = range.version
    mark.dataset.fileId = file.id
    preview.append(source.slice(0, range.start), mark, source.slice(range.end))
    input.setSelectionRange(range.start, range.end)
    mark.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  function renderInspector() {
    inspector.replaceChildren()
    const heading = document.createElement('h2')
    // All user source is inserted as text, never HTML.
    heading.textContent = selectedNode ? `노드 · ${selectedNode.label}` : viewFunction() ? functionName(viewFunction()) : '코드 분석'; inspector.append(heading)
    const text = value => { const p = document.createElement('p'); p.textContent = value; inspector.append(p); return p }
    text(model.stale ? '이전 변환 그래프입니다. 최신 코드는 재변환해야 평가할 수 있습니다.' : current()?.arity ? '매개변수가 있는 함수입니다. 인자가 없는 값에서 호출해 평가하세요.' : '상단 평가 버튼으로 선택한 값을 실행합니다.')
    if (model.highlight && !model.stale) {
      const range = model.highlight, file = model.sourceFile(range.fileId), source = file?.source || ''
      const start = sourceLocation(source, range.start), end = sourceLocation(source, range.end)
      text(`${file?.name ? file.name + ' · ' : ''}원문 v${range.version} · ${start.line}:${start.column}–${end.line}:${end.column} · ${range.kind}`)
      const pre = document.createElement('pre'); pre.textContent = source.slice(range.start, range.end); inspector.append(pre)
      if (range.targetDefinition) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-button'; button.textContent = '호출한 함수 정의로 이동'
        button.onclick = () => {
          if (!model.files) {
            clear()
            model.selectFunction(range.targetDefinition)
            render()
            return
          }
          history.pause(false)
          showPosition(range.targetDefinition, null, null, model.document.locations[range.targetDefinition])
        }
        inspector.append(button)
      }
    }
    if (model.result) {
      const node = history.nodes.get(frameId + ':' + (selectedNode?.id || stepNode))
      if (node?.phase === 'done') {
        text('이 단계의 노드 값 · ' + describeTraceValue(node.value, history.values, id => model.document.nodes[id]?.label || id))
      } else if (node?.phase === 'error') {
        text('이 단계의 오류 · ' + node.message)
      }
      const result = text(model.result.error ? '최종 오류 · ' + model.result.error.message : `최종 Graph JS 결과: ${show(model.result.value)}`)
      if(sourceValueTruncated(model.result.value))result.append(' · 표시 일부 생략 (전체 값의 계산 완료를 뜻하지 않음)')
      result.dataset.truncated=String(sourceValueTruncated(model.result.value))
      result.className = 'code-result'; result.dataset.result = model.result.error ? 'error' : show(model.result.value)
      result.setAttribute('role', 'status')
      addTraceInspector(inspector, model.document, history, selectedCallId, {
        pause() { history.pause(false); renderPlayback() },
        select(id) { showCall(history.calls.get(id)); inspector.querySelector('#code-trace-call')?.focus() },
        definition: call => showCall(call), site: call => showCall(call, true),
      })
      const equations=new Map((model.document?.functions||[]).flatMap(fn=>(fn.equations||[]).map((eq,i)=>[eq.id,{name:fn.name,index:i+1,calls:new Set()}])))
      for(const call of history.calls.values())equations.get(call.functionId)?.calls.add(call.callId)
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
        button.onclick=()=>{const range=model.result.error.callSpan;history.pause(false);showPosition(range.owner,null,null,range)};inspector.append(button)
      }
    }
  }
  function renderGraph() {
    const sheet = surface.querySelector('.code-graph-sheet'), heading = surface.querySelector('.code-graph-heading')
    if (renderedOwner) viewPositions.set(renderedOwner, [surface.scrollLeft, surface.scrollTop])
    const viewed = viewFunction()
    renderedOwner = viewed?.id
    const graph = model.document?.functionBodies[viewed?.id]
    sheet.replaceChildren()
    heading.textContent = graph ? `${functionName(viewed)} :: ${viewed.signature} · v${model.document.version}${model.stale ? ' · 재변환 필요' : ''}` : '코드를 변환하면 이곳에 읽기 전용 그래프가 표시됩니다.'
    surface.classList.toggle('code-stale', model.stale)
    if (!graph) return
    surface.style.scrollPaddingTop=`${heading.offsetHeight+12}px`
    surface.style.scrollPaddingBottom='16px'
    const bodies=[{id:viewed.id,graph},...(viewed.equations||[]).map(eq=>({...eq,graph:model.document.functionBodies[eq.id]}))]
    for(const [ordinal,body] of bodies.entries()) {
    const graph=body.graph
    if(ordinal){
      const title=document.createElement('h3');title.className='code-equation-title';title.textContent=`방정식 ${ordinal} · 위에서부터 검사`;sheet.append(title)
      const patterns=document.createElement('div');patterns.className='code-patterns'
      for(const p of body.patterns){
        const button=document.createElement('button');button.type='button';button.className='tool-button code-pattern';button.textContent=p.text
        button.onclick=()=>{selectedNode=null;surface.querySelectorAll('.code-selected').forEach(n=>n.classList.remove('code-selected'));highlight({...p.span,kind:'pattern',owner:body.id});renderSource();renderInspector()};patterns.append(button)
      }
      sheet.append(patterns)
    }
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    const width = Math.max(...Object.values(graph).map(n => n.x)) + 185, height = Math.max(...Object.values(graph).map(n => n.y)) + 100
    if(viewed.equations?.length)svg.style.maxWidth=`${width}px`
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('aria-label', `${viewed.name} 함수 그래프`)
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
        history.pause(false)
        selectedNode = node
        highlight(model.document.locations[node.id === 'output' ? viewed.id + ':output' : node.id])
        renderSource()
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
    const [left, top] = viewPositions.get(viewed.id) || [0, 0]
    surface.scrollTo(left, top)
  }
  function renderPlayback() {
    for (const node of surface.querySelectorAll('[data-code-node]')) {
      const phase = history.nodes.get(frameId + ':' + node.dataset.codeNode)?.phase
      node.dataset.state = phase === 'start' ? 'running' : phase || 'idle'
      node.classList.toggle('code-step-node', node.dataset.codeNode === stepNode)
      node.querySelector('.code-node-state').textContent = ({ running: '계산 중', done: '완료', error: '오류' })[node.dataset.state] || ''
    }
    if (!active) return
    pane.querySelector('#code-stop').disabled=!calculating
    controls.hidden = !history.length
    const { position, length, playing } = history
    control('code-history-first').disabled = position === 0
    control('code-history-prev').disabled = position === 0
    control('code-history-next').disabled = position === length
    control('code-history-find').disabled = !stepNode || !surface.querySelector(`[data-code-node="${CSS.escape(stepNode || '')}"]`)
    control('code-stop-playback').disabled = position === length
    control('code-stop-playback').textContent = playing ? '일시정지' : '자동 재생'
    control('code-stop-playback').setAttribute('aria-pressed', String(playing))
    const omitted = model.result?.debug?.omitted || 0
    const clipped = omitted ? ` · 기록 ${omitted}단계 생략` : ''
    const valuesClipped = model.result?.debug?.valuesOmitted ? ' · 일부 값 생략' : ''
    const phase = { start: '노드 진입', done: '노드 평가됨', error: '노드 오류' }[history.event?.phase]
      || { enter: '호출 진입', return: '호출 반환', equation: '방정식 선택', 'call-error': '호출 오류', finish: '실행 종료' }[history.event?.kind]
      || '실행 전'
    control('code-history-position').textContent = `기록 ${position}/${length}${omitted ? ` (전체 ${length + omitted})` : ''} · ${phase}${clipped}${valuesClipped}`
    surface.dataset.calculating=String(calculating)
    summary.textContent = calculating ? 'Graph JS 계산 중 · 계산 중단 가능' : model.stale ? '재변환 필요 · 이전 결과 표시 안 함' : history.playing ? '실행 기록 재생 중 · 계산은 한 번만 실행' : model.result?.error ? `Graph JS 오류: ${model.result.error.message}` : model.result ? `Graph JS 결과: ${show(model.result.value)}${sourceValueTruncated(model.result.value)?' · 표시 일부 생략':''}` : '읽기 전용 코드 그래프 · Graph JS'
  }
  async function evaluate() {
    if (!active || model.stale || !current() || current().arity) return
    clear()
    const token=generation
    calculating=true; model.result=model.highlight=null; render()
    const result=await model.evaluateWith((doc,id)=>runner.run(doc,id))
    if(token!==generation)return
    calculating=false
    if (model.highlight) highlight(model.highlight)
    history.load(result?.debug?.steps || [])
    render()
    if (result?.error) {
      if (history.length && !result.debug.omitted) history.seek(history.length)
    } else history.play()
  }
  return { get active() { return active }, refreshRunLabel, evaluate }
}
