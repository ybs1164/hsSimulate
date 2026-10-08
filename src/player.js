// Rendering widgets, and a standalone player for an exported game.
//
// `renderWidget` turns a plain widget tree (runtime.js' toWidgetTree) into
// DOM; the editor's play panel uses it too. `startPlayer` is what an
// exported HTML file runs: the flattened project (every definition the
// game needs, its function bodies and type declarations) is evaluated
// directly — no editor, no type checker — and played like gloss's `play`,
// with the game state saved in localStorage and time away applied on
// return (in one step when the exporter found `step` to be a monoid action).
import { createEvaluator, EvalError } from './evaluator.js'
import { createGame, isProgram } from './runtime.js'

/**
 * DOM for a widget tree. Each button gets `data-msg`, the index of its
 * message in `msgs` (dispatch them from one delegated listener: the view is
 * rebuilt on every tick, so per-button handlers could lose clicks).
 */
export function renderWidget(w, msgs) {
  if (w.kind === 'text') return Object.assign(document.createElement('p'), { className: 'w-text', textContent: w.text })
  if (w.kind === 'button') {
    const b = Object.assign(document.createElement('button'), { className: 'w-button', textContent: w.label, type: 'button' })
    b.dataset.msg = msgs.push(w.msg) - 1
    return b
  }
  if (w.kind === 'progress') {
    const bar = Object.assign(document.createElement('div'), { className: 'w-progress' })
    bar.append(Object.assign(document.createElement('i'), { style: `width:${(w.value * 100).toFixed(1)}%` }))
    return bar
  }
  const box = Object.assign(document.createElement('div'), { className: `w-${w.kind}` })
  box.append(...w.children.map((c) => renderWidget(c, msgs)))
  return box
}

/** Styles for widgets in an exported page (the editor has its own in style.css). */
export const PLAYER_CSS = `
body{margin:0;font-family:ui-monospace,'DM Mono',monospace;background:#f8f7fc;color:#211d34}
.player-bar{display:flex;gap:10px;align-items:center;padding:12px 18px;border-bottom:1px solid #e6e3f0;background:#fff;font-size:12px}
.player-bar b{margin-right:auto;color:#4b3cc4}
.player-bar button{border:1.5px solid #e6e3f0;border-radius:999px;background:#fff;padding:6px 12px;font:inherit;cursor:pointer}
.player-view{display:flex;justify-content:center;padding:36px}
.player-note{font-size:11px;color:#8a85a0;text-align:center;margin:0 0 12px}
.w-column{display:flex;flex-direction:column;gap:12px;min-width:300px;max-width:520px;width:100%}
.w-row{display:flex;gap:12px;flex-wrap:wrap}
.w-text{margin:0;font-size:16px}
.w-button{border:0;border-radius:999px;background:#6c5ce7;color:#fff;padding:13px 18px;font:600 13px inherit;font-family:inherit;cursor:pointer;box-shadow:0 3px 0 #4b3cc4}
.w-button:active{transform:translateY(2px);box-shadow:0 1px 0 #4b3cc4}
.w-progress{height:12px;border-radius:999px;background:#efeaff;overflow:hidden}
.w-progress i{display:block;height:100%;background:#6c5ce7;transition:width .15s}
.w-error{color:#c0335e}
`


/**
 * Play `data` = { title, definitions, functionBodies, types, entry,
 * exactTime } inside `root`. Returns the game (handy for tests).
 */
export function startPlayer(data, root, { storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  const ev = createEvaluator({ nodes: data.definitions, functionBodies: data.functionBodies, types: data.types })
  const program = ev.run(data.definitions, data.entry)
  if (!isProgram(program)) throw new EvalError('The exported entry point is not a Program')
  const game = createGame(ev, program, { exactTime: data.exactTime })
  const key = `hs-simulate:player:${data.title}`
  let note = ''
  try {
    const saved = JSON.parse(storage?.getItem(key) || 'null')
    if (saved) {
      game.restore(saved)
      const away = Math.min(game.maxOffline, Math.max(0, (now() - saved.savedAt) / 1000))
      if (away > 1) {
        const r = game.advance(away)
        note = `Welcome back — ${Math.round(away)}s passed${r.exact ? ' (applied in one step)' : ''}`
      }
    }
  } catch (error) {
    if (!(error instanceof EvalError) && !(error instanceof SyntaxError)) throw error
    game.reset()
  }
  const save = () => { try { storage?.setItem(key, JSON.stringify({ ...game.snapshot(), savedAt: now() })) } catch {} }

  root.innerHTML = `<div class="player-bar"><b></b><button data-act="pause">⏸</button><button data-act="reset">Restart</button></div><p class="player-note"></p><div class="player-view"></div>`
  root.querySelector('.player-bar b').textContent = data.title
  root.querySelector('.player-note').textContent = note
  const view = root.querySelector('.player-view')
  let msgs = []
  let running = true
  const render = () => {
    msgs = []
    try {
      view.replaceChildren(renderWidget(game.view(), msgs))
    } catch (error) {
      if (!(error instanceof EvalError)) throw error
      view.replaceChildren(Object.assign(document.createElement('p'), { className: 'w-error', textContent: error.message }))
      running = false
    }
  }
  view.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('.w-button')
    if (!button) return
    event.preventDefault()
    try { game.dispatch(msgs[Number(button.dataset.msg)]) } catch (error) { if (!(error instanceof EvalError)) throw error; running = false }
    render()
    save()
  })
  globalThis.addEventListener?.('keydown', (event) => {
    try { if (game.keyPressed(event.key)) { event.preventDefault(); render(); save() } } catch (error) { if (!(error instanceof EvalError)) throw error; running = false }
  })
  root.querySelector('[data-act="pause"]').onclick = (event) => { running = !running; event.target.textContent = running ? '⏸' : '▶' }
  root.querySelector('[data-act="reset"]').onclick = () => { game.reset(); save(); render() }

  let last = null
  let acc = 0
  const frame = (t) => {
    if (running && last !== null) {
      acc += Math.min(1, (t - last) / 1000)
      let ticked = false
      try {
        const slice = 1 / game.stepsPerSecond
        while (acc >= slice) { game.tick(slice); acc -= slice; ticked = true }
      } catch (error) {
        if (!(error instanceof EvalError)) throw error
        running = false
      }
      if (ticked) render()
    }
    last = t
    globalThis.requestAnimationFrame?.(frame)
  }
  render()
  globalThis.requestAnimationFrame?.(frame)
  globalThis.setInterval?.(save, 2000)
  globalThis.addEventListener?.('beforeunload', save)
  return game
}
