// The canvas a declaration graph (declGraph.js) is drawn on: its nodes are
// cards in the DOM — they hold the same type nodes, name tokens and drop
// targets the rest of the editor uses — and its edges are drawn under them
// in SVG, in the same world coordinates. The background pans, the wheel
// zooms, a card is moved by dragging it anywhere that isn't a control of
// its own, and every move redraws the edges at once.
//
// An edge may end at a part of a card rather than the card (`fromPort` /
// `toPort`, a selector inside it): a parameter wires into the very field
// that mentions it.

const views = new Map() // a declaration's pan and zoom, kept across re-renders: key → { x, y, zoom }
const INTERACTIVE = 'button, input, select, textarea, a, .te-ftype, .type-chip, .drop-zone, .te-ident, .cc, .tn, [data-nodrag]'

/**
 * Draw `graph` into `container` (emptied). `at`: `{ [node id]: { x, y } }`,
 * each node's centre; `card(node)`: its inner HTML; `className(node)`:
 * extra classes for its card. `onMoved(id, at)` is called when a drag ends,
 * with every node's position after it (`at` is updated in place).
 * `viewKey` keeps pan and zoom while the same declaration is re-rendered.
 * `fixed`: ids whose position was placed by hand — the others, laid out by
 * column, are spread apart once their cards can be measured.
 * Returns `{ world, cardOf(id), redraw() }`.
 */
export function drawDeclGraph(container, { graph, at, fixed = new Set(), card, className = () => '', onMoved = () => {}, onOpen = null, viewKey = '' }) {
  container.innerHTML = '<div class="decl-surface"><div class="decl-world"><svg class="decl-edges" aria-hidden="true"></svg></div></div>'
  const surface = container.firstElementChild
  const world = surface.firstElementChild
  const svg = world.firstElementChild
  const cards = new Map()
  for (const n of graph.nodes) {
    const el = document.createElement('div')
    el.className = `decl-node decl-${n.kind} ${className(n)}`.trim()
    el.dataset.node = n.id
    el.innerHTML = card(n)
    world.append(el)
    cards.set(n.id, el)
  }
  const place = (id) => {
    const el = cards.get(id), p = at[id]
    if (el && p) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
  }
  graph.nodes.forEach((n) => place(n.id))

  // Where an edge meets a card: its right side going out, its left side coming in (or a port's row on that side).
  const anchor = (id, port, side) => {
    const el = cards.get(id), p = at[id]
    if (!el || !p) return null
    const w = el.offsetWidth, h = el.offsetHeight
    let y = p.y
    const part = port && el.querySelector(port)
    if (part) {
      let top = part.offsetTop + part.offsetHeight / 2
      for (let o = part.offsetParent; o && o !== el; o = o.offsetParent) top += o.offsetTop
      y = p.y - h / 2 + top
    }
    return { x: p.x + (side === 'out' ? w / 2 : -w / 2), y, top: p.y - h / 2, bottom: p.y + h / 2 }
  }
  const redraw = () => {
    const parts = []
    for (const e of graph.edges) {
      const a = anchor(e.from, e.fromPort, 'out'), b = anchor(e.to, e.toPort, 'in')
      if (!a || !b) continue
      let d
      if (a.x <= b.x - 20) {
        const dx = Math.max(40, (b.x - a.x) / 2)
        d = `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
      } else {
        // Backwards (a recursive field, a card dragged past its target): around, below both.
        const low = Math.max(a.bottom, b.bottom) + 60
        d = `M${a.x},${a.y} C${a.x + 90},${a.y} ${a.x + 90},${low} ${(a.x + b.x) / 2},${low} S${b.x - 90},${b.y} ${b.x},${b.y}`
      }
      parts.push(`<path class="decl-edge decl-edge-${e.kind}" d="${d}" marker-end="url(#decl-arrow)"/>`)
      if (e.label) parts.push(`<text class="decl-edge-label" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}">${e.label}</text>`)
    }
    svg.innerHTML = `<defs><marker id="decl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="decl-arrowhead"/></marker></defs>${parts.join('')}`
  }

  // Pan and zoom, kept per declaration; the first time, fit the graph in view.
  let view = views.get(viewKey)
  const apply = () => { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }
  const fit = () => {
    const ids = graph.nodes.map((n) => n.id).filter((id) => at[id])
    if (!ids.length) return { x: surface.clientWidth / 2, y: surface.clientHeight / 2, zoom: 1 }
    const box = ids.reduce((b, id) => {
      const el = cards.get(id), p = at[id]
      return { l: Math.min(b.l, p.x - el.offsetWidth / 2), r: Math.max(b.r, p.x + el.offsetWidth / 2), t: Math.min(b.t, p.y - el.offsetHeight / 2), b: Math.max(b.b, p.y + el.offsetHeight / 2) }
    }, { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity })
    const pad = 48
    const zoom = Math.min(1, (surface.clientWidth - pad * 2) / Math.max(1, box.r - box.l), (surface.clientHeight - pad * 2) / Math.max(1, box.b - box.t))
    const z = Math.max(0.35, zoom)
    return { x: surface.clientWidth / 2 - ((box.l + box.r) / 2) * z, y: surface.clientHeight / 2 - ((box.t + box.b) / 2) * z, zoom: z }
  }
  // Cards in one column, of whatever height, mustn't overlap: push them apart, keeping the column centred where it was.
  const settle = () => {
    const columns = new Map()
    for (const n of graph.nodes) {
      if (fixed.has(n.id) || !at[n.id]) continue
      const x = at[n.id].x
      if (!columns.has(x)) columns.set(x, [])
      columns.get(x).push(n.id)
    }
    for (const ids of columns.values()) {
      ids.sort((a, b) => at[a].y - at[b].y)
      const before = ids.reduce((sum, id) => sum + at[id].y, 0) / ids.length
      for (let i = 1; i < ids.length; i++) {
        const prev = at[ids[i - 1]], h0 = cards.get(ids[i - 1]).offsetHeight, h1 = cards.get(ids[i]).offsetHeight
        at[ids[i]] = { x: at[ids[i]].x, y: Math.max(at[ids[i]].y, prev.y + h0 / 2 + 28 + h1 / 2) }
      }
      const shift = before - ids.reduce((sum, id) => sum + at[id].y, 0) / ids.length
      for (const id of ids) at[id] = { x: at[id].x, y: Math.round(at[id].y + shift) }
    }
    graph.nodes.forEach((n) => place(n.id))
  }
  settle()
  // Fitted once the surface has a size (it may not yet, in a pane that isn't shown): until then, a provisional view.
  if (!view) {
    view = surface.clientWidth ? fit() : { x: 0, y: 0, zoom: 1, provisional: true }
    views.set(viewKey, view)
  }
  apply()
  redraw()
  if (view.provisional && typeof ResizeObserver === 'function') {
    const watch = new ResizeObserver(() => {
      if (!surface.clientWidth || !surface.isConnected) return
      watch.disconnect()
      if (!view.provisional) return
      settle()
      Object.assign(view, fit(), { provisional: false })
      apply()
      redraw()
    })
    watch.observe(surface)
  }

  surface.addEventListener('wheel', (event) => {
    event.preventDefault()
    const r = surface.getBoundingClientRect()
    const mx = event.clientX - r.left, my = event.clientY - r.top
    const zoom = Math.min(2, Math.max(0.25, view.zoom * Math.exp(-event.deltaY * 0.0015)))
    view.x = mx - ((mx - view.x) * zoom) / view.zoom
    view.y = my - ((my - view.y) * zoom) / view.zoom
    view.zoom = zoom
    apply()
  }, { passive: false })

  let drag = null
  surface.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest(INTERACTIVE)) return
    const el = event.target.closest('.decl-node')
    drag = el
      ? { id: el.dataset.node, el, from: { x: event.clientX, y: event.clientY }, start: { ...at[el.dataset.node] }, moved: false }
      : { pan: true, from: { x: event.clientX, y: event.clientY }, start: { x: view.x, y: view.y } }
    try { surface.setPointerCapture(event.pointerId) } catch {} // (a synthetic event has no pointer to capture)
    if (el) el.classList.add('dragging')
  })
  surface.addEventListener('pointermove', (event) => {
    if (!drag) return
    const dx = event.clientX - drag.from.x, dy = event.clientY - drag.from.y
    if (Math.hypot(dx, dy) > 3) drag.moved = true
    if (drag.pan) { view.x = drag.start.x + dx; view.y = drag.start.y + dy; apply(); return }
    at[drag.id] = { x: Math.round(drag.start.x + dx / view.zoom), y: Math.round(drag.start.y + dy / view.zoom) }
    place(drag.id)
    redraw()
  })
  const end = () => {
    if (!drag) return
    const { id, el, moved, pan } = drag
    drag = null
    el?.classList.remove('dragging')
    if (pan) return
    if (moved) onMoved(id, at)
    else if (onOpen) onOpen(id)
  }
  surface.addEventListener('pointerup', end)
  surface.addEventListener('pointercancel', end)
  surface.addEventListener('dblclick', (event) => {
    if (event.target.closest('.decl-node')) return
    view = fit(); views.set(viewKey, view); apply()
  })
  return { world, cardOf: (id) => cards.get(id), redraw }
}

/** Forget a declaration's pan and zoom (it fits the view again next time). */
export function forgetView(viewKey) { views.delete(viewKey) }
