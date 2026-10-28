import { syntaxLessons, exampleProblems, lessonGuide, lessonSource } from './learningContent.js'

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
      <p class="syntax-support"></p>
      <h3>기본 문법</h3><p class="syntax-form"></p>
      <h3>짧은 예제 · Haskell</h3><pre><code></code></pre>
      <p class="syntax-expected"></p>
      <h3>예제 해설</h3><p class="syntax-explanation"></p>
      <details class="syntax-guide"><summary>프로그램 공통 조작 · 작업 보관</summary><ol></ol></details>
      <h3>프로그램에서 따라하기</h3><ol class="syntax-steps"></ol>
      <h3>값을 바꿔보기</h3><p class="syntax-experiment"></p>
      <h3>주의할 점</h3><p class="syntax-caution"></p>
      <footer class="syntax-note"><p class="syntax-source"></p><p class="syntax-license"></p></footer>
    </div>`
  document.body.append(dialog)
  const closeButton = dialog.querySelector('.syntax-close')

  function fillList(list, items) {
    list.replaceChildren(...items.map((text) => {
      const item = document.createElement('li')
      item.textContent = text
      return item
    }))
  }
  function sourceLink(text, url) {
    const link = document.createElement('a')
    link.textContent = text
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    return link
  }
  fillList(dialog.querySelector('.syntax-guide ol'), lessonGuide)
  dialog.querySelector('.syntax-license').append(
    `${lessonSource.author}. ${lessonSource.adaptation} `,
    sourceLink(lessonSource.license, lessonSource.licenseUrl),
  )

  function openLesson(lesson, trigger) {
    returnFocus = trigger
    dialog.querySelector('h2').textContent = lesson.title
    dialog.querySelector('#syntax-dialog-description').textContent = lesson.description
    dialog.querySelector('.syntax-support').textContent = lesson.support === 'graph'
      ? '프로그램에서 그래프로 실습 가능 · 아래 코드는 대응하는 Haskell 표기입니다.'
      : '개념 설명 · 코드는 외부 Haskell 환경용입니다. 아래에서는 같은 동작의 그래프를 실습합니다.'
    dialog.querySelector('.syntax-form').textContent = lesson.syntax
    dialog.querySelector('code').textContent = lesson.code
    dialog.querySelector('.syntax-expected').textContent = `예상 결과 (설명용): ${lesson.expected}`
    dialog.querySelector('.syntax-explanation').textContent = lesson.explanation
    fillList(dialog.querySelector('.syntax-steps'), lesson.steps)
    dialog.querySelector('.syntax-experiment').textContent = lesson.experiment
    dialog.querySelector('.syntax-caution').textContent = lesson.caution
    dialog.querySelector('.syntax-source').replaceChildren(
      '참고: ', sourceLink(lessonSource.title, new URL(lesson.source, lessonSource.url).href),
    )
    dialog.querySelector('.syntax-guide').open = false
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
        const stops = [...dialog.querySelectorAll('button, summary, a[href]')]
          .filter((item) => item.getClientRects().length)
        const current = stops.indexOf(document.activeElement)
        const next = event.shiftKey
          ? (current <= 0 ? stops.length - 1 : current - 1)
          : (current + 1) % stops.length
        stops[next].focus()
      }
    }, { capture: true })
  }
}
