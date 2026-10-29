import { COURSES, EXERCISE_UNITS, ALL_EXERCISES, courseOf } from './exerciseContent.js'
import { findExerciseFunction, gradeBuild, gradeChoice, gradeDeclare, gradeTypeAnswer, testExpression } from './grader.js'

const PROGRESS_KEY = 'hs-simulate:exercises'
const KIND_LABEL = { type: '타입', choice: '선택', build: '만들기', declare: '선언' }

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {} } catch { return {} }
}
function saveProgress(progress) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)) } catch { /* progress is a convenience */ }
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * The practice panel: the course of exercises (exerciseContent.js), each
 * graded by grader.js. A build exercise is solved on the canvas, so the
 * panel stays open beside it (no modal). `project()` gives what the grader
 * reads; `openFunction(exercise)` creates (or opens) the exercise's function;
 * `onChange()` runs whenever the exercise on screen changes; `reveal(name)`
 * shows a block the exercise uses in the sidebar.
 */
export function initExercisePanel({ workspace, project, schemeOf, openFunction, openType = () => {}, onChange = () => {}, reveal = () => {} }) {
  const progress = loadProgress()
  let current = null // the exercise on screen, or null for the list
  const drafts = new Map() // exercise id -> typed answer / picked option, kept while the page is open

  const panel = document.createElement('aside')
  panel.className = 'learning-panel examples-panel exercise-panel'
  panel.setAttribute('aria-label', '연습 문제 패널')
  panel.innerHTML = `
    <header class="learning-header">
      <div class="learning-heading"><span class="learning-eyebrow">LEARN · HASKELL</span>
        <h2 id="examples-heading">연습 문제</h2></div>
      <button type="button" class="learning-toggle" aria-expanded="true" aria-controls="examples-section" aria-label="연습 문제 패널 접기" title="연습 문제 패널 접기">‹</button>
    </header>
    <section id="examples-section" class="learning-section" aria-labelledby="examples-heading">
      <div class="exercise-body"></div>
    </section>`
  workspace.prepend(panel)
  const bodyEl = panel.querySelector('.exercise-body')

  const solvedCount = (list) => list.filter((e) => progress[e.id]).length
  // Whether units[u] opens a part (a course whose units are one function each is grouped in parts).
  const partStarts = (units, u) => !!units[u].part && units[u].part.id !== units[u - 1]?.part?.id

  function renderList() {
    current = null
    workspace.classList.remove('exercise-open')
    onChange()
    bodyEl.innerHTML = `
      <div class="learning-section-heading"><p>순서대로 풀어 보세요. 모든 문제는 타입을 먼저 확인하고, 만들기 문제는 시그니처 → 타입 검사 → 테스트 순으로 채점해요.</p>
        <div class="exercise-progress" aria-label="진행도"><span style="width:${(solvedCount(ALL_EXERCISES) / ALL_EXERCISES.length) * 100}%"></span></div>
        <small class="exercise-progress-text">${solvedCount(ALL_EXERCISES)} / ${ALL_EXERCISES.length} 해결</small></div>
      <div class="learning-list exercise-units">${COURSES.map((course) => [course, EXERCISE_UNITS.filter((u) => courseOf(u) === course.id)]).map(([course, units]) => `
        <div class="exercise-course"><h2>${escapeHtml(course.title)}</h2><small>${solvedCount(units.flatMap((u) => u.exercises))}/${units.reduce((k, u) => k + u.exercises.length, 0)}</small><p>${escapeHtml(course.intro)}</p></div>${units.map((unit, u) => `${partStarts(units, u) ? `
        <h4 class="exercise-part">${escapeHtml(unit.part.title)}</h4>` : ''}
        <section class="exercise-unit${unit.part ? ' per-function' : ''}">
          <h3><span>${u + 1}. ${unit.part ? `<code>${escapeHtml(unit.title)}</code>` : escapeHtml(unit.title)}</span><small>${solvedCount(unit.exercises)}/${unit.exercises.length}</small></h3>
          <ul>${unit.exercises.map((e, i) => `<li><button type="button" class="learning-item exercise-item${progress[e.id] ? ' solved' : ''}" data-id="${e.id}">
            <span class="learning-item-number" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
            <span class="exercise-item-title">${escapeHtml(e.title)}</span>
            <span class="exercise-kind kind-${e.kind}">${KIND_LABEL[e.kind]}</span>
            <span class="exercise-check" aria-label="${progress[e.id] ? '해결함' : '미해결'}">${progress[e.id] ? '✓' : ''}</span>
          </button></li>`).join('')}</ul>
        </section>`).join('')}`).join('')}</div>`
    bodyEl.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => open(b.dataset.id)))
  }

  function feedbackHtml(result) {
    if (!result) return ''
    return `<div class="exercise-feedback ${result.ok ? 'ok' : 'bad'}" role="status">${result.ok ? '✓ ' : '✗ '}${escapeHtml(result.message)}</div>`
  }
  function checksHtml(result) {
    if (!result) return ''
    return `<div class="exercise-feedback ${result.ok ? 'ok' : 'bad'}" role="status">${result.ok ? '✓ 모든 검사를 통과했어요!' : '✗ 아직 통과하지 못한 검사가 있어요.'}</div>
      <ol class="exercise-checks">${result.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><b>${c.ok ? '✓' : '✗'}</b><span><code>${escapeHtml(c.label)}</code>${c.detail ? `<small>${escapeHtml(c.detail)}</small>` : ''}</span></li>`).join('')}${result.skipped ? `
        <li class="skipped"><b>·</b><span><code>테스트 ${result.skipped}개</code><small>위 검사를 통과하면 실행해요.</small></span></li>` : ''}</ol>`
  }

  function open(id, result = null) {
    const e = ALL_EXERCISES.find((x) => x.id === id)
    if (!e) return renderList()
    current = e
    workspace.classList.add('exercise-open')
    onChange()
    const index = ALL_EXERCISES.indexOf(e)
    const next = ALL_EXERCISES[index + 1]
    const unit = EXERCISE_UNITS.find((u) => u.id === e.unit)
    const first = unit.exercises[0].id === e.id // (ALL_EXERCISES holds copies)
    const courseUnits = EXERCISE_UNITS.filter((u) => courseOf(u) === courseOf(unit))
    const opensPart = first && partStarts(courseUnits, courseUnits.indexOf(unit))
    let work = ''
    if (e.kind === 'type') {
      work = `<label class="exercise-type-row"><code>${escapeHtml(e.expr)} ::</code><input class="exercise-answer" spellcheck="false" autocomplete="off" placeholder="예: Int -> Bool" value="${escapeHtml(drafts.get(e.id) ?? '')}" /></label>
        <small class="exercise-note">제약은 <code>Num a =&gt;</code>처럼, 함수는 <code>-&gt;</code>로 써요.</small>`
    } else if (e.kind === 'choice') {
      work = `<div class="exercise-options" role="radiogroup">${e.options.map((o, i) => `<label class="exercise-option"><input type="radio" name="opt-${e.id}" value="${i}" ${drafts.get(e.id) === i ? 'checked' : ''} /><code>${escapeHtml(o.text)}</code></label>`).join('')}</div>`
    } else if (e.kind === 'declare') {
      const declared = !!project().types?.[e.name]
      work = `<div class="exercise-target"><small>선언할 타입</small><code>${escapeHtml(e.declaration)}</code></div>
        <ol class="exercise-steps">
          <li><b>${declared ? `${escapeHtml(e.name)} 열기` : '타입 선언'}</b>을 눌러 타입 그래프를 열어요.</li>
          <li>타입 카드의 이름을 <code>${escapeHtml(e.name)}</code>로 하고, <b>+ constructor</b>로 생성자 카드를 만들어 필드에 타입을 끌어다 놓아요. 생성자 카드는 위에서 아래로 선언의 순서예요(끌어서 바꿀 수 있어요).</li>
          <li><b>채점</b>을 눌러요.</li>
        </ol>
        <button type="button" class="tool-button exercise-open-type">${declared ? `${escapeHtml(e.name)} 열기` : '타입 선언'}</button>`
    } else {
      const fn = findExerciseFunction(project().userNodes, e.name)
      work = `<div class="exercise-target"><small>만들 함수</small><code>${escapeHtml(e.name)} :: ${escapeHtml(e.signature)}</code></div>
        <ol class="exercise-steps">
          <li><b>${fn ? '함수 열기' : '함수 만들기'}</b>를 눌러 ${escapeHtml(e.name)} ${e.params.map(escapeHtml).join(' ')}의 본체로 들어가요.</li>
          <li>위쪽 <b>시그니처 줄</b>의 각 자리에 타입 목록에서 타입을 끌어다 놓아 <code>${escapeHtml(e.signature)}</code>를 적어요.</li>
          <li>블록을 연결해 본체를 만들어요${e.uses?.length ? `: ${e.uses.map((u) => (!/[가-힣]/.test(u) ? `<button type="button" class="exercise-use" data-use="${escapeHtml(u)}" title="블록 목록에서 ${escapeHtml(u)} 찾기"><code>${escapeHtml(u)}</code></button>` : `<code>${escapeHtml(u)}</code>`)).join(' ')}` : ''}.</li>
          <li><b>채점</b>을 눌러요.</li>
        </ol>
        <button type="button" class="tool-button exercise-open-fn">${fn ? `ƒ ${escapeHtml(e.name)} 열기` : `ƒ ${escapeHtml(e.name)} 만들기`}</button>
        ${e.tests?.length ? `<details class="exercise-tests"><summary>테스트 ${e.tests.length}개</summary><ul>${e.tests.map((t) => `<li><code>${escapeHtml(testExpression(e.name, t))} == ${escapeHtml(t.expect)}</code></li>`).join('')}</ul></details>`
          : '<small class="exercise-note">테스트 없이 시그니처와 타입만 채점해요. 실행해서 직접 확인하세요.</small>'}`
    }
    bodyEl.innerHTML = `
      <div class="exercise-detail">
        <button type="button" class="exercise-back">‹ 목록</button>
        <div class="exercise-meta"><span>${unit.part ? `${escapeHtml(unit.part.title)} · ` : ''}${escapeHtml(unit.title)} · ${index - ALL_EXERCISES.findIndex((x) => x.unit === e.unit) + 1}/${unit.exercises.length}</span><span class="exercise-kind kind-${e.kind}">${KIND_LABEL[e.kind]}</span>${progress[e.id] ? '<span class="exercise-solved">✓ 해결함</span>' : ''}</div>
        <h3>${escapeHtml(e.title)}</h3>
        ${opensPart ? `<p class="exercise-intro exercise-part-intro"><b>${escapeHtml(unit.part.title)}</b> ${escapeHtml(unit.part.intro)}</p>` : ''}
        ${first ? `<p class="exercise-intro">${escapeHtml(unit.intro)}</p>` : ''}
        <p class="exercise-prompt">${escapeHtml(e.prompt)}</p>
        ${work}
        <div class="exercise-actions">
          <button type="button" class="tool-button primary exercise-grade">채점</button>
          ${e.hint ? '<button type="button" class="tool-button exercise-hint-toggle" aria-expanded="false">힌트</button>' : ''}
        </div>
        ${e.hint ? `<p class="exercise-hint" hidden>💡 ${escapeHtml(e.hint)}</p>` : ''}
        <div class="exercise-result">${e.kind === 'build' || e.kind === 'declare' ? checksHtml(result) : feedbackHtml(result)}</div>
        ${result?.ok && e.explain ? `<p class="exercise-explain">${escapeHtml(e.explain)}</p>` : ''}
        ${result?.ok && next ? `<button type="button" class="tool-button exercise-next">다음 문제: ${escapeHtml(next.title)} ›</button>` : ''}
      </div>`
    bodyEl.querySelector('.exercise-back').addEventListener('click', renderList)
    bodyEl.querySelector('.exercise-grade').addEventListener('click', grade)
    bodyEl.querySelector('.exercise-next')?.addEventListener('click', () => open(next.id))
    bodyEl.querySelectorAll('.exercise-use').forEach((b) => b.addEventListener('click', () => reveal(b.dataset.use)))
    bodyEl.querySelector('.exercise-open-fn')?.addEventListener('click', () => { openFunction(e); open(e.id) })
    bodyEl.querySelector('.exercise-open-type')?.addEventListener('click', () => openType(e.name))
    const hintToggle = bodyEl.querySelector('.exercise-hint-toggle')
    hintToggle?.addEventListener('click', () => {
      const hint = bodyEl.querySelector('.exercise-hint')
      hint.hidden = !hint.hidden
      hintToggle.setAttribute('aria-expanded', String(!hint.hidden))
    })
    const input = bodyEl.querySelector('.exercise-answer')
    if (input) {
      input.addEventListener('input', () => drafts.set(e.id, input.value))
      // Keep typing out of the canvas' keyboard shortcuts; Enter grades.
      input.addEventListener('keydown', (event) => { event.stopPropagation(); if (event.key === 'Enter') grade() })
    }
    bodyEl.querySelectorAll('.exercise-options input').forEach((r) => r.addEventListener('change', () => drafts.set(e.id, Number(r.value))))
    bodyEl.scrollTop = 0
  }

  function grade() {
    const e = current
    if (!e) return
    let result
    if (e.kind === 'type') result = gradeTypeAnswer(e, drafts.get(e.id) ?? '', schemeOf)
    else if (e.kind === 'choice') result = gradeChoice(e, drafts.get(e.id) ?? null)
    else if (e.kind === 'declare') result = gradeDeclare(e, project().types)
    else result = gradeBuild(e, project())
    if (result.ok && !progress[e.id]) { progress[e.id] = true; saveProgress(progress) }
    open(e.id, result)
    bodyEl.querySelector('.exercise-result')?.scrollIntoView({ block: 'nearest' })
    if (!result.ok) bodyEl.querySelector('.exercise-answer')?.focus({ preventScroll: true })
  }

  let collapsed = false
  const toggle = panel.querySelector('.learning-toggle')
  toggle.addEventListener('click', () => {
    collapsed = !collapsed
    workspace.classList.toggle('examples-collapsed', collapsed)
    panel.classList.toggle('is-collapsed', collapsed)
    panel.querySelector('.learning-section').hidden = collapsed
    toggle.setAttribute('aria-expanded', String(!collapsed))
    const label = `연습 문제 패널 ${collapsed ? '펼치기' : '접기'}`
    toggle.setAttribute('aria-label', label)
    toggle.title = label
    toggle.textContent = collapsed ? '›' : '‹'
    toggle.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })

  renderList()
  return {
    /** Re-render the open build exercise (its function may have been created or renamed). */
    refresh() { if (current?.kind === 'build') open(current.id) },
    /** The build exercise on screen, or null. */
    currentBuild: () => (current?.kind === 'build' ? current : null),
    grade() { panel.querySelector('.exercise-grade')?.click() },
  }
}
