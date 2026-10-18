// End-to-end: build and play a whole game through the editor UI only — no
// templates, no JSON import. Declares types in the type editor, creates
// functions, adds nodes from the sidebar, types literals (literal nodes made from empty slots), wires
// nodes (from their out-ports) into slots and onto Output, sets the entry point and plays. Also
// exercises search, λ nodes, broken-call marking, multi-select copy/paste
// and keyboard subscriptions.
//
// Needs a local Chrome/Chromium (set CHROME=/path/to/chrome if it isn't
// found). Starts its own Vite dev server. Run with `npm run test:e2e`.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 5179
const DEBUG_PORT = 9479
const chromePath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p))
if (!chromePath) { console.error('No Chrome/Chromium found — set CHROME=/path/to/chrome'); process.exit(2) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const profile = mkdtempSync(join(tmpdir(), 'hs-e2e-'))
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })
let failures = 0
function cleanup(code) {
  try { chrome.kill() } catch {}
  try { vite.kill() } catch {}
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }, 300)
}

let ws
const pending = new Map()
const errors = []
let msgId = 0
const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function js(expr) {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'evaluation failed')
  return m.result?.result?.value
}
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
async function key(k, code, vk, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(type === 'keyDown' && k.length === 1 ? { text: k } : {}) })
  await sleep(80)
}
async function check(name, fn) {
  try {
    const note = await fn()
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    failures++
    const shot = join(tmpdir(), `hs-e2e-failure-${failures}.png`)
    try { writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')) } catch {}
    console.log(`  ✗ ${name}: ${e.message}
    screenshot: ${shot}`)
  }
}
const expect = (cond, message) => { if (!cond) throw new Error(message) }

// ---- reading state (observation only: the autosave and the DOM) ----
const project = async () => { await sleep(450); return JSON.parse(await js(`localStorage.getItem('hs-simulate:project')`)) }
async function activeGraph() {
  const p = await project()
  if (await js(`document.querySelector('#back-graph').hidden`)) return { p, graph: p.nodes }
  const name = (await js(`document.querySelector('#graph-name').textContent`)).split(' / ').pop().replace(/^ƒ /, '').replace(/ · .*$/, '')
  const fn = Object.values(p.nodes).find((n) => n.custom && n.label === name && !n.lambda) || Object.values(p.nodes).find((n) => n.lambda && name === 'λ')
  return { p, graph: p.functionBodies[fn.id] }
}
async function toScreen(graph) {
  const zoom = await js(`parseFloat(document.querySelector('#zoom-level').textContent) / 100`)
  for (const n of Object.values(graph)) {
    if (n.type !== 'function' || n.lambda || !n.params?.length) continue
    const r = JSON.parse(await js(`JSON.stringify(document.querySelector('.param-slot[data-function-id="${n.id}"][data-index="0"]')?.getBoundingClientRect() ?? null)`))
    if (!r) continue
    const ox = r.x + r.width / 2 - (n.x + 118) * zoom, oy = r.y + r.height / 2 - n.y * zoom
    return (w) => ({ x: ox + w.x * zoom, y: oy + w.y * zoom })
  }
  throw new Error('no slot on screen to calibrate against')
}
async function slotCenter(fnId, i) {
  const r = JSON.parse(await js(`JSON.stringify(document.querySelector('.param-slot[data-function-id="${fnId}"][data-index="${i}"]')?.getBoundingClientRect() ?? null)`))
  if (!r) throw new Error(`no slot ${fnId}#${i}`)
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}
async function portCenter(sel) {
  const r = JSON.parse(await js(`JSON.stringify(document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect() ?? null)`))
  if (!r) throw new Error(`no port ${sel}`)
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}
const outPort = (nodeId) => portCenter(`.out-port[data-node-id="${nodeId}"]`)
async function drag(from, to) {
  await mouse('mousePressed', from.x, from.y)
  for (let k = 1; k <= 14; k++) { await mouse('mouseMoved', from.x + ((to.x - from.x) * k) / 14, from.y + ((to.y - from.y) * k) / 14); await sleep(12) }
  await mouse('mouseReleased', to.x, to.y)
  await sleep(200)
}
async function clickNode(nodeId, extra = {}) {
  const { graph } = await activeGraph()
  const at = (await toScreen(graph))(graph[nodeId])
  await mouse('mousePressed', at.x, at.y, extra); await mouse('mouseReleased', at.x, at.y, extra); await sleep(200)
}

// ---- UI actions ----
const setField = (sel, value, event = 'change') => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(event)})) })()`)
// Drag a type node from the workspace's TYPES — or a class from its CLASSES — (the chip with attribute `chipAttr`) onto element `toExpr`, with the real mouse.
async function dragType(chipAttr, toExpr) {
  const from = `document.querySelector('#type-palette .type-chip[${chipAttr}], #class-palette .type-chip[${chipAttr}]')`
  await js(`[${from}, ${toExpr}].forEach((el) => el.scrollIntoView({ block: 'nearest', behavior: 'instant' }))`)
  const at = async (expr) => { const r = JSON.parse(await js(`JSON.stringify(${expr}.getBoundingClientRect())`)); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
  const p = await at(from), q = await at(toExpr)
  await mouse('mousePressed', p.x, p.y)
  for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', p.x + ((q.x - p.x) * k) / 6, p.y + ((q.y - p.y) * k) / 6); await sleep(20) }
  await mouse('mouseReleased', q.x, q.y); await sleep(350)
}
// Names in the type editor are tokens: double-click one, type, Enter.
const rename = (sel, value) => js(`(() => { document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); const input = document.querySelector('.te-rename'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change')) })()`)
const editorStatus = () => js(`document.querySelector('.te-status').textContent`)
async function declareRecordType(name, fields) {
  await js(`document.querySelector('.add-type').click()`); await sleep(250)
  await rename('.te-ident-type', name); await sleep(150)
  for (const [i, [fname, ftype]] of fields.entries()) {
    await dragType(`data-con="${ftype}"`, `document.querySelector('[data-te="add-field"]')`)
    await rename(`.te-ident-field[data-fi="${i}"]`, fname); await sleep(100)
  }
  const status = await editorStatus()
  await js(`document.querySelector('[data-te="close"]').click()`); await sleep(150)
  expect(status.includes('applied'), status)
}
async function createFunction(label, params) {
  await js(`document.querySelector('.add-node').click()`); await sleep(150)
  await js(`(() => { const f = document.querySelector('#function-dialog form'); f.label.value = ${JSON.stringify(label)}; f.params.value = ${JSON.stringify(params.join(', '))}; f.requestSubmit() })()`); await sleep(250)
}
async function openBody(label) {
  await js(`[...document.querySelectorAll('.function-library-item')].find((e) => e.querySelector('b').textContent === ${JSON.stringify(label)}).click()`); await sleep(600)
}
async function back() { await js(`document.querySelector('#back-graph').click()`); await sleep(400) }
async function add(kind, label) {
  const before = new Set(Object.keys((await activeGraph()).graph))
  const sel = kind === 'derived' ? '#type-library .derived-item' : kind === 'class' ? '#class-library .derived-item' : kind === 'prelude' ? '#prelude-library .derived-item' : '.function-library-item'
  await js(`[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.querySelector('b').textContent === ${JSON.stringify(label)}).click()`); await sleep(300)
  const { graph } = await activeGraph()
  const id = Object.keys(graph).find((k) => !before.has(k))
  expect(id, `adding ${label} added nothing`)
  return id
}
async function fill(fnId, i, text) {
  // clicking an empty slot makes a literal node plugged into it, open for typing
  await js(`document.querySelector('.param-slot[data-function-id="${fnId}"][data-index="${i}"]').click()`); await sleep(150)
  await js(`(() => { const el = document.querySelector('.literal-input'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input')) })()`)
  await js(`document.querySelector('.literal-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`); await sleep(150)
}
async function addSlot(fnId) {
  // the + of this node is the one on its row (or, with no slots yet, the most recently added button)
  await js(`(() => { const s = document.querySelector('.param-slot[data-function-id="${fnId}"]'); const y = s ? s.getBoundingClientRect().y + s.getBoundingClientRect().height / 2 : null; const b = [...document.querySelectorAll('.param-add')].sort((a, c) => Math.abs(a.getBoundingClientRect().y + a.getBoundingClientRect().height / 2 - (y ?? 0)) - Math.abs(c.getBoundingClientRect().y + c.getBoundingClientRect().height / 2 - (y ?? 0))); (y === null ? b.pop() : b[0]).click() })()`)
  await sleep(200)
}
async function plug(nodeId, fnId, i) {
  await fitConnectionIfClipped(`.out-port[data-node-id="${nodeId}"]`, `.param-slot[data-function-id="${fnId}"][data-index="${i}"]`)
  await drag(await outPort(nodeId), await slotCenter(fnId, i))
  expect(await js(`!!document.querySelector('.param-slot.filled[data-function-id="${fnId}"][data-index="${i}"]')`), `plugging ${nodeId} into ${fnId}#${i} did not connect`)
}
async function toOutput(nodeId) {
  await fitConnectionIfClipped(`.out-port[data-node-id="${nodeId}"]`, '.in-port')
  await drag(await outPort(nodeId), await portCenter('.in-port'))
  expect((await activeGraph()).graph.output.source === nodeId, `${nodeId} did not connect to Output`)
}
// Learning panels reduce the canvas width. A newly added call can also
// widen after it is connected, putting its out-port beyond the canvas.
// Use the editor's Fit control before dragging an offscreen port, as a user
// would; keep the same real-pointer interaction and connection assertions.
async function fitConnectionIfClipped(...selectors) {
  const clipped = await js(`(() => {
    const canvas = document.querySelector('#graph-canvas').getBoundingClientRect()
    return ${JSON.stringify(selectors)}.some((selector) => {
      const r = document.querySelector(selector).getBoundingClientRect()
      return r.left < canvas.left || r.right > canvas.right || r.top < canvas.top || r.bottom > canvas.bottom
    })
  })()`)
  if (clipped) { await js(`document.querySelector('#fit').click()`); await sleep(200) }
}
const paramId = async (name) => Object.values((await activeGraph()).graph).find((n) => n.type === 'parameter' && n.label === name).id

// ---- the run ----
for (let i = 0; i < 60; i++) { try { const t = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); if (t.some((x) => x.type === 'page')) { ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); break } } catch {} await sleep(250) }
if (!ws) { console.error('Chrome did not start'); cleanup(2) } else {
  await new Promise((r) => ws.addEventListener('open', r))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break } catch { await sleep(250) } }
  await send('Page.navigate', { url: `http://localhost:${PORT}/` })
  // A cold Vite start can take a while to serve the app: wait for it to render.
  for (let i = 0; i < 120 && !(await js(`!!document.querySelector('.add-type')`).catch(() => false)); i++) await sleep(250)
  await sleep(500)
  console.log('Learning panels:')
  await check('independent panels preserve the graph, search and example selection in all four layouts', async () => {
    await js(`document.querySelector('.example-list button').click()`)
    await setField('.search input', 'identity', 'input')
    const before = JSON.stringify(await project())
    const snapshot = () => js(`JSON.stringify({
      ports: document.querySelector('#port-editor').innerHTML,
      inspector: document.querySelector('#inspector-content').innerHTML,
      zoom: document.querySelector('#zoom-level').textContent,
      search: document.querySelector('.search input').value,
      example: document.querySelector('.example-list [aria-pressed="true"]').textContent
    })`)
    const initial = await snapshot()
    const widths = []
    for (const toggle of [null, '.examples-panel', '.syntax-panel', '.examples-panel', '.syntax-panel']) {
      if (toggle) { await js(`document.querySelector('${toggle} .learning-toggle').click()`); await sleep(150) }
      const layout = await js(`[...document.querySelector('.workspace').children].map((e) => ({
        name: e.className, x: e.getBoundingClientRect().x, right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width
      }))`)
      expect(['examples-panel', 'syntax-panel', 'sidebar', 'canvas-panel', 'inspector'].every((name, i) => layout[i].name.includes(name)), 'panel order changed')
      expect(layout.slice(1).every((r, i) => Math.abs(r.x - layout[i].right) < 1), 'panels overlap or leave gaps')
      expect(await snapshot() === initial && JSON.stringify(await project()) === before, 'panel toggle changed the graph or selection')
      widths.push(layout[3].width)
    }
    expect(widths[1] > widths[0] && widths[2] > widths[1] && widths[3] === widths[1] && widths[4] === widths[0], `canvas widths: ${widths}`)
    await setField('.search input', '', 'input')
    // Use the compact learning rails for the large game below. Both expanded
    // and collapsed layouts were checked above; no graph state is reset.
    await js(`document.querySelectorAll('.learning-toggle').forEach((button) => button.click())`)
    await sleep(200)
    return `canvas widths ${widths.join(' → ')}`
  })
  console.log('Building a game through the UI only (learning panels collapsed):')

  await check('declare Model and Msg in the type editor', async () => {
    await declareRecordType('Model', [['count', 'Double']])
    await js(`document.querySelector('.add-type').click()`); await sleep(250)
    await rename('.te-ident-type', 'Msg'); await sleep(150)
    await rename('.te-ident-ctor', 'Increment'); await sleep(150)
    const sig = await js(`document.querySelector('.te-sig .type-chain').title`)
    await js(`document.querySelector('[data-te="close"]').click()`); await sleep(150)
    const p = await project()
    expect(sig === 'Msg', sig)
    expect(p.types.Model.deriving.some((c) => c.classes.includes('Show') && c.classes.includes('Eq')), 'Model should derive Eq and Show by itself')
    return `Increment :: ${sig}`
  })
  await check('initial = Model 0', async () => {
    await createFunction('initial', []); await openBody('initial')
    const m = await add('derived', 'Model'); await fill(m, 0, '0'); await toOutput(m); await back()
  })
  await check('handle msg m = over count (1 +) m', async () => {
    await createFunction('handle', ['msg', 'm']); await openBody('handle')
    const ov = await add('derived', 'over count')
    const inc = await add('main', '(+)')
    await fill(inc, 0, '1'); await plug(inc, ov, 0); await plug(await paramId('m'), ov, 1); await toOutput(ov); await back()
  })
  await check('step dt m = m', async () => {
    await createFunction('step', ['dt', 'm']); await openBody('step')
    const tmp = await add('derived', 'Model') // something with a slot, to find positions by
    await toOutput(await paramId('m'))
    await clickNode(tmp); await key('Delete', 'Delete', 46)
    await back()
  })
  await check('view m = column [text ("Count: " ++ showFFloat 0 (count m)), button "+1" Increment]', async () => {
    await createFunction('view', ['m']); await openBody('view')
    const cnt = await add('derived', 'count'); await plug(await paramId('m'), cnt, 0)
    const sf = await add('prelude', 'showFFloat'); await fill(sf, 0, '0'); await plug(cnt, sf, 1)
    const ap = await add('prelude', '(++)'); await fill(ap, 0, '"Count: "'); await plug(sf, ap, 1)
    const tx = await add('prelude', 'text'); await plug(ap, tx, 0)
    const msg = await add('derived', 'Increment')
    const bt = await add('prelude', 'button'); await fill(bt, 0, '"+1"'); await plug(msg, bt, 1)
    const ls = await add('prelude', '[ , , ]')
    expect((await activeGraph()).graph[ls].params.length === 0, 'a new list should start empty')
    await addSlot(ls); await addSlot(ls)
    await plug(tx, ls, 0); await plug(bt, ls, 1)
    const col = await add('prelude', 'column'); await plug(ls, col, 0); await toOutput(col)
    await back()
  })
  await check('main = program initial view handle step', async () => {
    await createFunction('main', []); await openBody('main')
    expect((await js(`document.querySelector('#graph-name').textContent`)) === 'ƒ main', 'breadcrumb should read ƒ main')
    const pr = await add('prelude', 'program')
    for (const [i, f] of ['initial', 'view', 'handle', 'step'].entries()) await plug(await add('main', f), pr, i)
    await toOutput(pr); await back()
    const sig = await js(`[...document.querySelectorAll('.function-library-item')].find((e) => e.querySelector('b').textContent === 'main').querySelector('small .type-chain').title`)
    expect(sig === 'Program Model Msg', sig)
    return `main :: ${sig}`
  })
  await check('make main the entry, Run graph, press +1 three times', async () => {
    const { graph } = await activeGraph()
    await clickNode(Object.values(graph).find((n) => n.label === 'main' && n.custom).id)
    expect((await js(`document.querySelector('.selected-node b')?.textContent`)) === 'main', 'could not select main')
    await js(`document.querySelector('#entry-toggle').click()`); await sleep(150)
    await js(`document.querySelector('#run').click()`); await sleep(800)
    expect(!(await js(`document.querySelector('#play-panel').hidden`)), 'no game started')
    for (let i = 0; i < 3; i++) { const r = JSON.parse(await js(`JSON.stringify(document.querySelector('#play-panel .w-button').getBoundingClientRect())`)); await mouse('mousePressed', r.x + 10, r.y + 10); await mouse('mouseReleased', r.x + 10, r.y + 10); await sleep(60) }
    const text = await js(`document.querySelector('#play-panel .w-text').textContent`)
    await js(`document.querySelector('[data-play="close"]').click()`); await sleep(200)
    expect(text === 'Count: 3', text)
    return text
  })

  console.log('Editing features:')
  await check('search finds a Prelude function and Enter adds it', async () => {
    await openBody('view')
    const before = Object.keys((await activeGraph()).graph).length
    await js(`(() => { const s = document.querySelector('.search input'); s.value = 'showComp'; s.dispatchEvent(new Event('input')) })()`)
    const hits = await js(`[...document.querySelectorAll('.function-library-item, #type-library .derived-item, #prelude-library .derived-item')].filter((e) => !e.hidden).map((e) => e.querySelector('b').textContent).join(',')`)
    await js(`document.querySelector('.search input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`); await sleep(300)
    const after = Object.keys((await activeGraph()).graph).length
    expect(hits === 'showCompact' && after === before + 1, `hits ${hits}, nodes ${before}→${after}`)
  })
  await check('multi-select copy/paste duplicates the selection', async () => {
    const { graph } = await activeGraph()
    const free = Object.values(graph).filter((n) => n.type === 'function' && !n.mountedTo && n.sourceFunctionId === 'prelude:showCompact')
    await clickNode(free[0].id)
    const before = Object.keys((await activeGraph()).graph).length
    await key('c', 'KeyC', 67, 2); await key('v', 'KeyV', 86, 2); await sleep(300)
    const after = Object.keys((await activeGraph()).graph).length
    expect(after === before + 1, `${before}→${after}`)
    // shift-select both copies and delete them together
    const copies = Object.values((await activeGraph()).graph).filter((n) => n.sourceFunctionId === 'prelude:showCompact')
    await clickNode(copies[0].id); await clickNode(copies[1].id, { modifiers: 8 })
    await key('Delete', 'Delete', 46); await sleep(300)
    expect(!Object.values((await activeGraph()).graph).some((n) => n.sourceFunctionId === 'prelude:showCompact'), 'multi-delete left nodes behind')
    await back()
  })
  const openType = async (name) => { await js(`[...document.querySelectorAll('.type-item')].find((e) => e.dataset.typeName === ${JSON.stringify(name)}).click()`); await sleep(250) }
  const closeType = async () => { await js(`document.querySelector('[data-te="close"]').click()`); await sleep(150) }
  await check('renaming a field renames every call to what it derives', async () => {
    await openType('Model')
    await rename('.te-ident-field[data-fi="0"]', 'total'); await sleep(200)
    await closeType()
    await openBody('handle')
    const { graph } = await activeGraph()
    const ov = Object.values(graph).find((n) => n.sourceFunctionId === 'type:Model:over total')
    expect(ov && ov.label === 'over total', 'over count was not renamed to over total')
    await clickNode(ov.id)
    const broken = await js(`document.querySelector('.broken-call') ? 'broken' : ''`)
    await back()
    await openType('Model')
    await rename('.te-ident-field[data-fi="0"]', 'count'); await sleep(200)
    await closeType()
    const again = Object.values((await project()).functionBodies).flatMap((b) => Object.values(b)).some((n) => n.sourceFunctionId === 'type:Model:over count')
    expect(!broken && again, `${broken} / renamed back: ${again}`)
    return 'over count → over total → over count'
  })
  await check('a derived function can be customized (body starts as its primitive) and reset', async () => {
    await openType('Model')
    await js(`document.querySelector('[data-edit="type:Model:count"]').click()`); await sleep(600)
    const crumb = await js(`document.querySelector('#graph-name').textContent`)
    const { p, graph } = await activeGraph()
    const prim = Object.values(graph).find((n) => n.sourceFunctionId === 'prim:type:Model:count')
    expect(p.nodes['type:Model:count']?.override === 'Model' && prim?.label === 'count#', `${crumb}: ${JSON.stringify(prim)}`)
    await back()
    await openType('Model')
    await js(`document.querySelector('[data-reset="type:Model:count"]').click()`); await sleep(200)
    await closeType()
    expect(!(await project()).nodes['type:Model:count'], 'reset left the customization behind')
    return `${crumb} = count# model`
  })
  await check('renaming a function renames its calls', async () => {
    const stepId = Object.values((await project()).nodes).find((n) => n.custom && n.label === 'step').id
    await clickNode(stepId)
    await setField('#function-rename', 'tick'); await sleep(300)
    const p = await project()
    const callLabels = Object.values(p.functionBodies).flatMap((b) => Object.values(b)).filter((n) => n.sourceFunctionId === stepId).map((n) => n.label)
    await clickNode(stepId)
    await setField('#function-rename', 'step'); await sleep(300)
    expect(p.nodes[stepId].label === 'tick' && callLabels.length && callLabels.every((l) => l === 'tick'), `${p.nodes[stepId].label} / ${callLabels}`)
    return `step → tick (${callLabels.length} call)`
  })
  await check('the type editor reads as a data declaration with no text boxes; fields are dragged in', async () => {
    await js(`document.querySelector('.add-type').click()`); await sleep(250)
    const boxes = await js(`document.querySelectorAll('#type-panel input, #type-panel select, #type-panel textarea').length`)
    await rename('.te-ident-type', 'Shape'); await sleep(150)
    await dragType('data-con="Maybe"', `document.querySelector('[data-te="add-field"]')`)
    const waiting = await editorStatus()
    await dragType('data-con="Int"', `document.querySelector('.te-ftype[data-fi="0"] .tn-hole')`)
    await js(`document.querySelector('[data-te="toggle-record"]').click()`); await sleep(200)
    const source = await js(`[...document.querySelectorAll('.hs-decl .hs-line')].map((l) => [...l.querySelectorAll('.te-keyword, .te-ident, .hs-op, .hs-punct, .te-ftype')].map((e) => e.textContent).join(' ')).join(' / ')`)
    const p = await project()
    const status = await editorStatus()
    await js(`document.querySelector('[data-te="delete"]').click()`); await sleep(200)
    expect(boxes === 0, `${boxes} text boxes in the type editor`)
    expect(status.includes('applied'), status)
    expect(/Fill each _/.test(waiting), waiting)
    expect(/= Shape MaybeInt/.test(source) && /^data Shape/.test(source) && p.types.Shape?.constructors[0].fields.length === 1 && !p.types.Shape.constructors[0].fields[0].name, source)
    return source.split(' / ').slice(0, 2).join(' ')
  })
  await check('a type with a parameter', async () => {
    await js(`document.querySelector('.add-type').click()`); await sleep(250)
    await rename('.te-ident-type', 'Box'); await sleep(150)
    await dragType('data-var="a"', `document.querySelector('[data-te="add-param"]')`)
    await dragType('data-var="a"', `document.querySelector('[data-te="add-field"]')`)
    const sig = await js(`document.querySelector('.te-sig .type-chain').title`)
    // a type variable used in a field becomes a parameter by itself
    await dragType('data-var="b"', `document.querySelector('[data-te="add-ctor"]')`)
    const params = await js(`[...document.querySelectorAll('.te-param')].map((e) => e.textContent.replace('−', '')).join(' ')`)
    const status = await editorStatus()
    await js(`document.querySelector('[data-te="delete"]').click()`); await sleep(200)
    expect(sig === 'a → Box a' && params === 'a b' && status.includes('applied'), `${sig} / ${params} / ${status}`)
    return `data Box ${params} = Box a | Box2 b`
  })
  await check('a parameter may stand for a type constructor: its kind is inferred', async () => {
    await js(`document.querySelector('.add-type').click()`); await sleep(250)
    await rename('.te-ident-type', 'Wrap'); await sleep(150)
    // f _ onto + adds a field `f _`; a onto its hole makes it `f a` (both become parameters)
    await dragType('data-varapp="f"', `document.querySelector('[data-te="add-field"]')`)
    await dragType('data-var="a"', `document.querySelector('.te-ftype .tn-hole')`)
    const params = await js(`[...document.querySelectorAll('.te-param')].map((e) => e.textContent.replace('−', '')).join(' ')`)
    const sig = await js(`document.querySelector('.te-sig .type-chain').title`)
    const status = await editorStatus()
    const kind = await js(`document.querySelector('#type-palette .type-chip[data-con="Wrap"]')?.title ?? ''`)
    await js(`document.querySelector('[data-te="delete"]').click()`); await sleep(200)
    expect(params === 'f a' && /^(\w) (\w) → Wrap \1 \2$/.test(sig) && status.includes('applied'), `${params} / ${sig} / ${status}`) // (a signature names its variables a, b, …)
    expect(/Wrap :: \(\* ▸ \*\) ▸ \* ▸ \*/.test(kind), kind)
    return `data Wrap f a = Wrap (f a) — ${kind}`
  })
  await check('a user class: declare it, give Model an instance, and call its method — picked by type', async () => {
    await js(`document.querySelector('.add-class').click()`); await sleep(300)
    await setField('.ce-name', 'Pretty'); await sleep(200)
    await setField('.ce-mname', 'pretty'); await sleep(200)
    await setField('.ce-add-instance', 'Model'); await sleep(400)
    const status = await editorStatus()
    const implId = await js(`document.querySelector('.te-instance select[data-method]').value`)
    // prettyModel x = show x
    await js(`document.querySelector('.te-instance [data-open]').click()`); await sleep(600)
    const sh = await add('prelude', 'show'); await plug(await paramId('x'), sh, 0); await toOutput(sh); await back()
    // shown = pretty initial
    await createFunction('shown', []); await openBody('shown')
    const pr = await add('class', 'pretty'); const init = await add('function', 'initial'); await plug(init, pr, 0); await toOutput(pr); await back()
    const p = await project()
    const shownId = Object.values(p.nodes).find((n) => n.custom && n.label === 'shown').id
    await clickNode(shownId)
    await js(`document.querySelector('#evaluate').click()`); await sleep(600)
    const result = Object.values((await project()).nodes).filter((n) => n.type === 'value').pop()
    let text = ''
    for (let l = result?.data; l?.ctorIndex === 1; l = l.args[1]) text += l.args[0]
    expect(status.includes('applied') && p.nodes[implId]?.label === 'prettyModel' && text === 'Model {count = 0.0}' /* count :: Double — shown as Haskell shows a Double */, `${status} / ${p.nodes[implId]?.label} / ${JSON.stringify(text)}`)
    return `pretty initial = ${JSON.stringify(text)}`
  })
  await check("an instance's context is built by dragging classes onto the head's type variables", async () => {
    await js(`document.querySelector('.class-item[data-class-name="Pretty"]').click()`); await sleep(300)
    await setField('.ce-add-instance', 'Maybe'); await sleep(400)
    const row = `[...document.querySelectorAll('.te-instance')].find((r) => /Maybe/.test(r.querySelector('.ce-head')?.textContent))`
    const context = async () => ((await project()).classes.Pretty.instances.find((i) => i.head === 'Maybe')?.context || []).map((q) => `${q.cls} ${q.var}`).join(', ')
    const shown = () => js(`${row}.querySelector('.ce-instance-head').textContent.replace(/×/g, '').replace(/\\s+/g, ' ').trim()`)
    const fresh = await context()
    // Show onto the a of Pretty (Maybe a)
    await dragType('data-cls="Show"', `${row}.querySelector('.ce-hvar[data-var="a"]')`)
    const added = await context()
    const line = await shown()
    // Eq onto the Pretty a constraint changes it
    await dragType('data-cls="Eq"', `${row}.querySelector('.ce-ctx .cc[data-ci="0"]')`)
    const changed = await context()
    // a constructor class doesn't go on a
    await dragType('data-cls="Functor"', `${row}.querySelector('.ce-hvar[data-var="a"]')`)
    const refused = await js(`document.querySelector('#toast')?.textContent ?? ''`)
    // × removes one
    await js(`${row}.querySelector('.ce-ctx .cc[data-ci="0"] .cc-x').click()`); await sleep(300)
    const removed = await context()
    const boxes = await js(`document.querySelectorAll('.te-instance input').length`)
    await js(`${row}.querySelector('[data-ce="drop-instance"]').click()`); await sleep(300)
    await js(`document.querySelector('[data-ce="close"]').click()`); await sleep(200)
    expect(fresh === 'Pretty a' && added === 'Pretty a, Show a' && /^instance \(Pretty a, Show a\) ⇒ Pretty \(Maybe a\) where$/.test(line), `${fresh} / ${added} / ${line}`)
    expect(changed === 'Eq a, Show a' && /type constructors/.test(refused) && removed === 'Show a' && boxes === 0, `${changed} / ${refused} / ${removed} / ${boxes}`)
    return line
  })
  await check('a builtin class opens from CLASSES; an instance written for a type is kept with the class, and (<>) runs it', async () => {
    // a click (no drag) on Semigroup in the workspace's CLASSES
    const r = JSON.parse(await js(`(() => { const el = document.querySelector('#class-palette .type-chip[data-cls="Semigroup"]'); el.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return JSON.stringify(el.getBoundingClientRect()) })()`))
    await mouse('mousePressed', r.x + r.width / 2, r.y + r.height / 2)
    await mouse('mouseReleased', r.x + r.width / 2, r.y + r.height / 2); await sleep(400)
    const head = await js(`document.querySelector('.ce-builtin-head')?.textContent.replace(/\\s+/g, ' ').trim()`)
    await setField('.ce-add-instance', 'Model'); await sleep(400)
    const inst = (await project()).instances?.Semigroup?.find((i) => i.head === 'Model')
    // mappendModel x y = x  (the left one wins)
    await js(`document.querySelector('.te-instance [data-open]').click()`); await sleep(600)
    await toOutput(await paramId('x')); await back()
    // joined = initial <> initial
    await createFunction('joined', []); await openBody('joined')
    const ap = await add('prelude', '(<>)'); const i1 = await add('function', 'initial'); const i2 = await add('function', 'initial')
    await plug(i1, ap, 0); await plug(i2, ap, 1); await toOutput(ap); await back()
    const p = await project()
    await clickNode(Object.values(p.nodes).find((n) => n.custom && n.label === 'joined').id)
    await js(`document.querySelector('#evaluate').click()`); await sleep(600)
    const result = Object.values((await project()).nodes).filter((n) => n.type === 'value').pop()
    await js(`document.querySelector('.class-item[data-class-name="Semigroup"]').click()`); await sleep(300)
    const status = await js(`[...document.querySelectorAll('.te-instance .law')].map((e) => e.textContent).join(' ')`)
    await js(`document.querySelector('[data-ce="close"]').click()`); await sleep(200)
    expect(/^class Semigroup a where$/.test(head) && inst?.context.length === 0 && p.nodes[inst?.methods.mappend]?.label === 'mappendModel', `${head} / ${JSON.stringify(inst)}`)
    expect(result?.data?.type === 'Model' && status === '✓', `${JSON.stringify(result?.data)} / ${status}`)
    return `instance Semigroup Model where (<>) = mappendModel — ${status}`
  })
  await check('an ambiguous connection is refused, as GHC would reject it (show mempty)', async () => {
    await createFunction('vague', []); await openBody('vague')
    const sh = await add('prelude', 'show'); const me = await add('prelude', 'mempty')
    await drag(await outPort(me), await slotCenter(sh, 0))
    const toast = await js(`document.querySelector('#toast')?.textContent ?? ''`)
    const after = (await activeGraph()).graph[sh]
    // a defaultable one is fine: show 3
    await fill(sh, 0, '3'); await sleep(300)
    await clickNode(sh)
    const flagged = await js(`document.querySelector('.broken-call') ? 'flagged' : ''`)
    await back()
    expect(!after.mounted[0] && /Ambiguous type variable/.test(toast) && !flagged, `${JSON.stringify(after.mounted)} / ${toast} / ${flagged}`)
    return toast.slice(0, 90) + '…'
  })
  await check('a λ is created, opened in place and printed as a lambda', async () => {
    await createFunction('twice', ['x']); await openBody('twice')
    await js(`document.querySelector('.library-item[data-type=lambda]').click()`); await sleep(400)
    const lam = Object.values((await activeGraph()).graph).find((n) => n.sourceFunctionId?.startsWith('lambda-'))
    const at = (await toScreen((await activeGraph()).graph))(lam)
    await mouse('mousePressed', at.x, at.y); await mouse('mouseReleased', at.x, at.y)
    await mouse('mousePressed', at.x, at.y, { clickCount: 2 }); await mouse('mouseReleased', at.x, at.y, { clickCount: 2 }); await sleep(600)
    const crumb = await js(`document.querySelector('#graph-name').textContent`)
    await back()
    await toOutput(lam.id)
    await back()
    const { graph } = await activeGraph()
    await clickNode(Object.values(graph).find((n) => n.label === 'twice' && n.custom).id)
    const def = await js(`document.querySelector('.haskell')?.textContent ?? ''`)
    expect(crumb === 'ƒ twice / ƒ λ' && def.includes('\\x -> x'), `${crumb} / ${def}`)
    return def.split('\n')[1]
  })
  const definitionText = () => js(`[...document.querySelectorAll('.property.definition .haskell')].pop()?.textContent ?? ''`)
  const clickToken = (text) => js(`[...document.querySelectorAll('.property.definition .haskell .tok')].reverse().find((t) => t.textContent === ${JSON.stringify(text)}).click()`).then(() => sleep(300))
  const playText = async () => {
    await js(`document.querySelector('#run').click()`); await sleep(800)
    const text = await js(`document.querySelector('#play-panel .w-text').textContent`)
    await js(`document.querySelector('[data-play="close"]').click()`); await sleep(200)
    return text
  }
  await check('a DEFINITION token selects the node it was read from', async () => {
    await openBody('view')
    await clickToken('showFFloat')
    const selected = await js(`document.querySelector('.selected-node b').textContent`)
    const linked = await js(`[...document.querySelectorAll('.property.definition .tok.linked')].map((t) => t.textContent).join('')`)
    await back()
    expect(selected === 'showFFloat' && linked.startsWith('showFFloat'), `${selected} / ${linked}`)
    return selected
  })
  await check('a Prelude call opens its definition read-only; a primitive too', async () => {
    await openBody('view')
    await clickToken('++')
    await js(`document.querySelector('#open-definition').click()`); await sleep(700)
    const crumb = await js(`document.querySelector('#graph-name').textContent`)
    const text = await definitionText()
    const count = await js(`document.querySelector('#node-count').textContent`)
    const fold = await js(`[...document.querySelectorAll('#port-editor .param-slot')].find((s) => s.classList.contains('filled'))?.dataset.functionId`)
    await js(`document.querySelector('.library-item[data-type=number]').click()`); await sleep(300) // refused: read-only
    const after = await js(`document.querySelector('#node-count').textContent`)
    await js(`document.querySelector('#port-editor .param-slot:not(.filled)')?.click()`); await sleep(300) // no literal typed into a read-only view
    const inputsLocked = !(await js(`!!document.querySelector('.literal-input')`)) && (await js(`document.querySelector('#node-count').textContent`)) === after
    await back()
    await clickToken('showFFloat')
    await js(`document.querySelector('#open-definition').click()`); await sleep(700)
    const primitive = await js(`document.querySelector('#graph-name').textContent`)
    const note = await definitionText()
    await back(); await back()
    expect(crumb === 'ƒ view / ƒ (++) · read-only' && text.includes('foldr (:) ys xs') && fold && count === after && inputsLocked, `${crumb} / ${text} / ${count}→${after} / locked ${inputsLocked}`)
    expect(primitive === 'ƒ view / ƒ showFFloat · read-only' && /-- primitive/.test(note), `${primitive} / ${note}`)
    return text.split('\n')[1]
  })
  await check('a Prelude definition is taken over as a graph; every call runs it until ↺', async () => {
    await openBody('view')
    await clickToken('++')
    await js(`document.querySelector('#open-definition').click()`); await sleep(700)
    await js(`document.querySelector('#edit-definition').click()`); await sleep(500)
    const crumb = await js(`document.querySelector('#graph-name').textContent`)
    // (++) xs ys = xs: pull xs out of foldr's last slot, then wire it to Output
    const fold = Object.values((await activeGraph()).graph).find((n) => n.sourceFunctionId === 'prelude:foldr').id
    await toOutput((await activeGraph()).graph[fold].mounted[2]) // pulling its wire out of the slot and into Output
    const text = await definitionText()
    await back(); await back()
    const edited = await playText()
    const saved = (await project()).nodes['prelude:append']
    await openBody('view')
    await clickToken('++')
    await js(`document.querySelector('#restore-library').click()`); await sleep(400)
    await back()
    const restored = await playText()
    const gone = !(await project()).nodes['prelude:append']
    expect(crumb === 'ƒ view / ƒ (++) · taken over' && saved?.library && text.split('\n')[1] === '(++) xs ys = xs', `${crumb} / ${text}`)
    expect(edited === 'Count: ' && /^Count: [0-9]+$/.test(restored) && gone, `${edited} / ${restored} / ${gone}`)
    return `${edited} → ${restored}`
  })
  await check('a parameter is moved: the body, the definition and every call follow', async () => {
    await createFunction('pairUp', ['a', 'b'])
    const { graph } = await activeGraph()
    const fnId = Object.values(graph).find((n) => n.label === 'pairUp' && n.custom).id
    await clickNode(fnId)
    await js(`document.querySelector('.param-move[data-index="1"]').click()`); await sleep(300)
    const p = await project()
    const order = Object.values(p.functionBodies[fnId]).filter((n) => n.type === 'parameter').map((n) => n.label)
    expect(p.nodes[fnId].params.join() === 'b,a' && order.join() === 'b,a', `${p.nodes[fnId].params} / ${order}`)
    return 'pairUp a b → pairUp b a'
  })
  await check('a signature is pinned by dragging type nodes from the workspace onto its chevrons, checked by inference', async () => {
    await createFunction('pinMe', ['x'])
    const { graph } = await activeGraph()
    const fnId = Object.values(graph).find((n) => n.label === 'pinMe' && n.custom).id
    await clickNode(fnId)
    const chain = () => js(`document.querySelector('#inspector-content .type-chain').title`)
    const annotations = async () => Object.values((await project()).functionBodies[fnId]).filter((n) => n.annotation).map((n) => `${n.type}:${n.annotation}`).sort().join(' ')
    const inferred = await chain()
    const chip = (attr) => attr
    const segment = (i, part = '') => `document.querySelectorAll('#inspector-content .type-chain > .tc-seg.editable')[${i}]${part ? `.querySelector('${part}')` : ''}`
    const drag = dragType
    const toast = () => js(`document.querySelector('#toast')?.textContent ?? ''`)
    // x :: Double — one drop on the parameter's chevron
    await drag(chip('data-con="Double"'), segment(0))
    const pinned = await chain()
    const xPinned = await annotations()
    // the result :: Maybe _ — a constructor comes with a hole, left to inference; the body (x :: Double) refuses it
    await drag(chip('data-con="Maybe"'), segment(1))
    const refused = await toast()
    const afterRefusal = await annotations()
    // [_] on x, then a into its slot: x :: [a], and the result follows
    await drag(chip('data-hole'), segment(0))
    await drag(chip('data-con="List"'), segment(0))
    const listed = await annotations()
    await drag(chip('data-var="a"'), segment(0, '.tn-list > [data-path]'))
    const filled = await annotations()
    const listChain = await chain()
    // and back to inferred: _ on the whole [a] (its bracket)
    await drag(chip('data-hole'), segment(0, '.tn-list > i'))
    const cleared = await chain()
    const none = await annotations()
    expect(inferred === 'a → a' && pinned === 'Double → Double' && xPinned === 'parameter:Double', `${inferred} / ${pinned} / ${xPinned}`)
    expect(/Maybe/.test(refused) && afterRefusal === 'parameter:Double', `${refused} / ${afterRefusal}`)
    expect(listed === 'parameter:[_]' && filled === 'parameter:[a]' && listChain === '[a] → [a]', `${listed} / ${filled} / ${listChain}`)
    expect(cleared === 'a → a' && none === '', `${cleared} / ${none}`)
    return `pinMe :: ${pinned}; result :: Maybe _ refused; x :: [a]`
  })
  await check('a class constraint is pinned by dragging a class node from the workspace onto a type variable', async () => {
    await createFunction('constrainMe', ['x'])
    const { graph } = await activeGraph()
    const fnId = Object.values(graph).find((n) => n.label === 'constrainMe' && n.custom).id
    await clickNode(fnId)
    const chain = () => js(`document.querySelector('#inspector-content .type-chain').title`)
    const signature = async () => { const body = (await project()).functionBodies[fnId]; return [...Object.values(body).filter((n) => n.annotation).map((n) => `${n.type}:${n.annotation}`).sort(), ...Object.values(body).flatMap((n) => (n.context || []).map((q) => `${q.cls} ${q.var}`))].join(' ') }
    const segment = (i) => `document.querySelectorAll('#inspector-content .type-chain > .tc-seg.editable')[${i}]`
    const pinnedChip = `document.querySelector('#inspector-content .tc-ctx .cc.pinned')`
    const toast = () => js(`document.querySelector('#toast')?.textContent ?? ''`)
    // Ord onto the inferred a of x: a is named in the signature, then constrained
    await dragType('data-cls="Ord"', segment(0))
    const ord = await chain()
    const ordSig = await signature()
    // Show onto the pinned Ord a chip replaces it
    await dragType('data-cls="Show"', pinnedChip)
    const show = await chain()
    // Functor is a class of type constructors: refused on a
    await dragType('data-cls="Functor"', segment(1))
    const refused = await toast()
    const afterRefusal = await signature()
    // × un-pins the constraint; the named variable stays
    await js(`${pinnedChip}.querySelector('.cc-x').click()`); await sleep(200)
    const unpinned = await chain()
    const unpinnedSig = await signature()
    expect(ord === 'Ord a ⇒ a → a' && ordSig === 'parameter:a Ord a', `${ord} / ${ordSig}`)
    expect(show === 'Show a ⇒ a → a', show)
    expect(/type constructors/.test(refused) && afterRefusal === 'parameter:a Show a', `${refused} / ${afterRefusal}`)
    expect(unpinned === 'a → a' && unpinnedSig === 'parameter:a', `${unpinned} / ${unpinnedSig}`)
    return `constrainMe :: ${ord}, then ${show}; Functor a refused`
  })
  await check('a Prelude primitive is taken over as name#; a Prelude constructor is customized and reset', async () => {
    await openBody('view')
    await clickToken('showFFloat')
    await js(`document.querySelector('#open-definition').click()`); await sleep(700)
    await js(`document.querySelector('#edit-definition').click()`); await sleep(500)
    const crumb = await js(`document.querySelector('#graph-name').textContent`)
    const text = await definitionText()
    await back(); await back()
    const played = await playText()
    await openBody('view')
    await clickToken('showFFloat')
    await js(`document.querySelector('#restore-library').click()`); await sleep(400)
    await back()
    const restored = !(await project()).nodes['prelude:showFFloat']
    // Text, a constructor of the Prelude's Widget: ✎ in the Prelude list, reset from its Output
    await js(`document.querySelector('#prelude-library .derived-edit[data-edit-id="type:Widget:Text"]').click()`); await sleep(500)
    const ctor = (await project()).functionBodies['type:Widget:Text']
    const primCall = Object.values(ctor || {}).some((n) => n.sourceFunctionId === 'prim:type:Widget:Text')
    await js(`document.querySelector('#reset-derived').click()`); await sleep(400)
    const reset = !(await project()).nodes['type:Widget:Text']
    expect(crumb === 'ƒ view / ƒ showFFloat · taken over' && /showFFloat# digits x/.test(text) && /^Count: /.test(played) && restored, `${crumb} / ${text} / ${played} / ${restored}`)
    expect(primCall && reset, `${primCall} / ${reset}`)
    return text.split('\n')[1]
  })
  await check("a Prelude type is taken over (its constructors kept) and given back; a builtin instance of it is replaced by a written one", async () => {
    await js(`document.querySelector('.prelude-take-type[data-type-name="Color"]').click()`); await sleep(500)
    const taken = (await project()).types.Color?.library
    // naming the fields derives projections; a constructor more is refused: the runtime reads Color's values
    await js(`document.querySelector('[data-te="toggle-record"]').click()`); await sleep(400)
    const projections = Object.keys((await project()).types.Color.constructors[0].fields.filter((f) => f.name)).length
    await js(`document.querySelector('[data-te="add-ctor"]').click()`); await sleep(300)
    const refused = await editorStatus()
    await js(`document.querySelectorAll('[data-te="drop-ctor"]')[1].click()`); await sleep(300)
    await js(`document.querySelector('[data-te="delete"]').click()`); await sleep(500)
    const given = !(await project()).types.Color
    // instance Show Color, written in the builtin class Show's editor, replaces the Prelude's
    const r = JSON.parse(await js(`(() => { const el = document.querySelector('#class-palette .type-chip[data-cls="Show"]'); el.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return JSON.stringify(el.getBoundingClientRect()) })()`))
    await mouse('mousePressed', r.x + r.width / 2, r.y + r.height / 2)
    await mouse('mouseReleased', r.x + r.width / 2, r.y + r.height / 2); await sleep(400)
    await setField('.ce-add-instance', 'Color'); await sleep(400)
    const inst = (await project()).instances?.Show?.find((i) => i.head === 'Color')
    const status = await js(`document.querySelector('.ce-status, .te-status')?.textContent ?? ''`)
    await js(`document.querySelector('[data-ce="close"]').click()`); await sleep(200)
    expect(taken && projections === 3 && given, `${taken} / ${projections} / ${given}`)
    expect(/constructors stay RGB/.test(refused), refused)
    expect(inst && !/already has/.test(status), `${JSON.stringify(inst)} / ${status}`)
    return `Color taken over and given back; instance Show Color where show = ${(await project()).nodes[inst.methods.show]?.label}`
  })

  console.log(errors.length ? `Page errors:\n  ${errors.join('\n  ')}` : 'No page errors.')
  if (errors.length) failures++
  console.log(failures ? `${failures} check(s) failed` : 'All checks passed')
  cleanup(failures ? 1 : 0)
}
