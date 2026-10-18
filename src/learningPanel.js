import { syntaxLessons, exampleProblems } from './learningContent.js'

// This module owns only learning UI state; it never receives or mutates a graph.
export function initLearningPanel({ workspace, onModalOpen }) {
  let selectedExample = null
  let returnFocus = null
  const panel = document.createElement('aside')
  panel.className = 'learning-panel syntax-panel'
  panel.setAttribute('aria-label', '문법 패널')
  panel.innerHTML = `
    <header class="learning-header">
      <div class="learning-heading"><span class="learning-eyebrow">HASKELL</span><h2 id="syntax-heading">문법</h2></div>
      <button type="button" class="learning-toggle" aria-expanded="true" aria-controls="syntax-section" aria-label="문법 패널 접기" title="문법 패널 접기">‹</button>
    </header>
      <section id="syntax-section" class="learning-section" aria-labelledby="syntax-heading">
        <div class="learning-section-heading"><p>짧은 설명과 코드로 익혀 보세요.</p></div>
        <ul class="learning-list syntax-list" aria-label="문법 목록"></ul>
      </section>`
  workspace.insertBefore(panel, workspace.querySelector('.sidebar'))

  const examplesPanel = document.createElement('aside')
  examplesPanel.className = 'learning-panel examples-panel'
  examplesPanel.setAttribute('aria-label', '예제 문제 패널')
  examplesPanel.innerHTML = `
    <header class="learning-header">
      <div class="learning-heading"><span class="learning-eyebrow">PRACTICE</span><h2 id="examples-heading">예제 문제</h2></div>
      <button type="button" class="learning-toggle" aria-expanded="true" aria-controls="examples-section" aria-label="예제 문제 패널 접기" title="예제 문제 패널 접기">‹</button>
    </header>
      <section id="examples-section" class="learning-section" aria-labelledby="examples-heading">
        <div class="learning-section-heading"><p>관심 있는 문제를 선택해 보세요.</p></div>
        <ul class="learning-list example-list" aria-label="예제 문제 목록"></ul>
        <p class="learning-footnote">지금은 문제 선택만 할 수 있어요.</p>
      </section>`
  workspace.prepend(examplesPanel)

  const dialog = document.createElement('dialog')
  dialog.className = 'syntax-dialog'
  dialog.setAttribute('aria-labelledby', 'syntax-dialog-title')
  dialog.setAttribute('aria-describedby', 'syntax-dialog-description')
  dialog.setAttribute('aria-modal', 'true')
  dialog.innerHTML = `
    <header class="syntax-dialog-header">
      <div><span class="learning-eyebrow">HASKELL · 문법</span><h2 id="syntax-dialog-title" tabindex="-1"></h2></div>
      <button type="button" class="syntax-close" aria-label="문법 설명 닫기" title="닫기 (Esc)">×</button>
    </header>
    <div class="syntax-dialog-content">
      <p id="syntax-dialog-description"></p>
      <h3>코드 예제</h3><pre><code></code></pre>
      <h3>예제 해설</h3><p class="syntax-explanation"></p>
      <p class="syntax-note">Haskell 문법 학습용 예제입니다. 현재 그래프 실행기의 지원 범위와는 다를 수 있습니다.</p>
    </div>`
  document.body.append(dialog)
  const closeButton = dialog.querySelector('.syntax-close')

  function openLesson(lesson, trigger) {
    returnFocus = trigger
    dialog.querySelector('h2').textContent = lesson.title
    dialog.querySelector('#syntax-dialog-description').textContent = lesson.description
    dialog.querySelector('code').textContent = lesson.code
    dialog.querySelector('.syntax-explanation').textContent = lesson.explanation
    onModalOpen()
    // A native modal dialog makes the rest of the document inert, including
    // the canvas and its DOM port overlay, and contains keyboard focus.
    dialog.showModal()
    dialog.scrollTop = 0
    dialog.querySelector('h2').focus({ preventScroll: true })
  }

  function appendItem(list, title, index, onClick) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'learning-item'
    const number = document.createElement('span')
    number.className = 'learning-item-number'
    number.setAttribute('aria-hidden', 'true')
    number.textContent = String(index + 1).padStart(2, '0')
    const label = document.createElement('span')
    label.textContent = title
    button.append(number, label)
    button.addEventListener('click', () => onClick(button))
    item.append(button)
    list.append(item)
    return button
  }

  syntaxLessons.forEach((lesson, index) => {
    const button = appendItem(panel.querySelector('.syntax-list'), lesson.title, index, (trigger) => openLesson(lesson, trigger))
    button.setAttribute('aria-haspopup', 'dialog')
  })
  const exampleButtons = new Map()
  exampleProblems.forEach((problem, index) => {
    const button = appendItem(examplesPanel.querySelector('.example-list'), problem.title, index, () => {
      selectedExample = problem.id
      exampleButtons.forEach((item, id) => item.setAttribute('aria-pressed', String(id === selectedExample)))
    })
    button.setAttribute('aria-pressed', 'false')
    exampleButtons.set(problem.id, button)
  })

  function bindToggle(targetPanel, name, className, closeIcon, openIcon) {
    let collapsed = false
    const toggle = targetPanel.querySelector('.learning-toggle')
    toggle.addEventListener('click', () => {
      collapsed = !collapsed
      workspace.classList.toggle(className, collapsed)
      targetPanel.classList.toggle('is-collapsed', collapsed)
      targetPanel.querySelector('.learning-section').hidden = collapsed
      toggle.setAttribute('aria-expanded', String(!collapsed))
      const label = `${name} 패널 ${collapsed ? '펼치기' : '접기'}`
      toggle.setAttribute('aria-label', label)
      toggle.title = label
      toggle.textContent = collapsed ? openIcon : closeIcon
      // Keep the control reachable when the narrow workspace scrolls sideways.
      toggle.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }
  bindToggle(panel, '문법', 'syntax-collapsed', '‹', '›')
  bindToggle(examplesPanel, '예제 문제', 'examples-collapsed', '‹', '›')

  closeButton.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); dialog.close() })
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  })
  // Require both ends of a click to be on the backdrop, so selecting code
  // and releasing outside the dialog doesn't accidentally dismiss it.
  const isBackdrop = (event) => {
    const rect = dialog.getBoundingClientRect()
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
  }
  let backdropStart = false
  dialog.addEventListener('pointerdown', (event) => { backdropStart = isBackdrop(event) })
  dialog.addEventListener('click', (event) => {
    if (backdropStart && isBackdrop(event)) dialog.close()
    backdropStart = false
  })

  // Keep window/document-level graph shortcuts from seeing modal keystrokes.
  // Native inertness alone doesn't suppress global keyboard listeners.
  for (const eventName of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(eventName, (event) => {
      if (!dialog.open) return
      event.stopImmediatePropagation()
      if (eventName === 'keydown' && event.key === 'Escape') {
        event.preventDefault()
        dialog.close()
      } else if (eventName === 'keydown' && event.key === 'Tab') {
        event.preventDefault()
        closeButton.focus() // The close button is the dialog's only tab stop.
      }
    }, { capture: true })
  }
}
