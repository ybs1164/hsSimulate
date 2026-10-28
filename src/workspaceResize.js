// Layout preference only: never reads or writes the graph or its history.
const STORAGE_KEY = 'hs-simulate:workspace-width'
const MIN_WIDTH = 160
const MAX_WIDTH = 520

export function workspaceWidthRange(available, reserved, defaultWidth = MIN_WIDTH) {
  // On an already overflowing narrow layout, keep the existing default valid.
  // The workspace's horizontal scrollbar still provides access to every panel.
  const base = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, defaultWidth))
  return { min: MIN_WIDTH, max: Math.max(base, Math.min(MAX_WIDTH, Math.floor(available - reserved))) }
}

export function storedWorkspaceWidth(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  const width = Number(text)
  return Number.isFinite(width) && width > 0 ? width : null
}

export function initWorkspaceResize({ workspace, sidebar, onResizeStart }) {
  const handle = document.createElement('div')
  handle.className = 'workspace-resizer'
  handle.tabIndex = 0
  sidebar.id ||= 'workspace-sidebar'
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.setAttribute('aria-controls', sidebar.id)
  handle.setAttribute('aria-label', 'Workspace 너비 조절')
  handle.title = 'Workspace 너비 조절 · 드래그 또는 ←/→ · Home/End'
  sidebar.append(handle)

  let preferredWidth = null
  try { preferredWidth = storedWorkspaceWidth(localStorage.getItem(STORAGE_KEY)) } catch { /* storage may be unavailable */ }
  let drag = null
  const clamp = (width, { min, max }) => Math.max(min, Math.min(max, width))
  const siblings = [...workspace.querySelectorAll('.learning-panel, .inspector')]

  function sizes() {
    const css = getComputedStyle(workspace)
    const defaultWidth = parseFloat(css.getPropertyValue('--sidebar-width'))
    const graphMin = parseFloat(css.getPropertyValue('--graph-min-width'))
    const reserved = graphMin + siblings.reduce((sum, panel) => sum + panel.getBoundingClientRect().width, 0)
    return { defaultWidth, range: workspaceWidthRange(workspace.clientWidth, reserved, defaultWidth) }
  }
  function refresh() {
    const { defaultWidth, range } = sizes()
    const width = clamp(preferredWidth ?? defaultWidth, range)
    if (preferredWidth === null) workspace.style.removeProperty('--workspace-width')
    else workspace.style.setProperty('--workspace-width', `${width}px`)
    handle.setAttribute('aria-valuemin', String(range.min))
    handle.setAttribute('aria-valuemax', String(range.max))
    handle.setAttribute('aria-valuenow', String(Math.round(width)))
    handle.setAttribute('aria-valuetext', `${Math.round(width)}px`)
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, String(preferredWidth)) } catch { /* resizing still works without storage */ }
  }
  function finish(commit) {
    if (!drag) return
    const ended = drag
    drag = null // releasing capture can synchronously dispatch lostpointercapture
    workspace.classList.remove('is-workspace-resizing')
    if (!commit) preferredWidth = ended.preference
    else save()
    if (handle.hasPointerCapture(ended.id)) handle.releasePointerCapture(ended.id)
    refresh()
  }
  function move(event) {
    const { range } = sizes()
    preferredWidth = clamp(drag.width + event.clientX - drag.x, range)
    refresh()
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || drag) return
    event.preventDefault()
    event.stopPropagation()
    onResizeStart()
    drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width, preference: preferredWidth }
    // Save the effective width even if the user only clicks the handle.
    preferredWidth = drag.width
    handle.setPointerCapture(event.pointerId)
    handle.focus({ preventScroll: true })
    workspace.classList.add('is-workspace-resizing')
  })
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    event.preventDefault()
    event.stopPropagation()
    if (event.buttons === 0) { finish(true); return }
    move(event)
  })
  handle.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    event.preventDefault()
    event.stopPropagation()
    move(event) // also handle a fast press/release with no intervening move
    finish(true)
  })
  handle.addEventListener('pointercancel', () => finish(false))
  handle.addEventListener('lostpointercapture', () => finish(false))
  window.addEventListener('blur', () => finish(false))
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(false) })
  handle.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Escape') { finish(false); return }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (drag) return
    const { range } = sizes()
    const step = event.shiftKey ? 32 : 16
    const width = sidebar.getBoundingClientRect().width
    preferredWidth = event.key === 'Home' ? range.min : event.key === 'End' ? range.max
      : clamp(width + (event.key === 'ArrowRight' ? step : -step), range)
    refresh()
    save()
  })
  // Re-clamp after window changes and independent panel collapse/Inspector close.
  // Keep the user's preference so a temporarily smaller window can grow back.
  window.addEventListener('resize', refresh)
  const observer = new ResizeObserver(refresh)
  ;[workspace, ...siblings].forEach((panel) => observer.observe(panel))
  refresh()
}
