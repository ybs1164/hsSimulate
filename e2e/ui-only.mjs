// End-to-end: build and play a whole game through the editor UI only — no
// templates, no JSON import. Declares types in the type editor, creates
// functions, adds nodes from the sidebar, types literals into slots, wires
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
const editorStatus = () => js(`document.querySelector('.te-status').textContent`)
async function declareRecordType(name, fields) {
  await js(`document.querySelector('.add-type').click()`); await sleep(250)
  await setField('.te-name', name); await sleep(150)
  for (const [i, [fname, ftype]] of fields.entries()) {
    await js(`document.querySelector('[data-te="add-field"]').click()`); await sleep(120)
    await setField(`.te-fname[data-fi="${i}"]`, fname); await sleep(100)
    await setField(`.te-ftype[data-fi="${i}"]`, ftype); await sleep(100)
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
  await js(`(() => { const el = document.querySelector('.param-slot[data-function-id="${fnId}"][data-index="${i}"] .param-value'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input')) })()`)
  await js(`document.activeElement?.blur?.()`)
}
async function addSlot(fnId) {
  // the + of this node is the one on its row (or, with no slots yet, the most recently added button)
  await js(`(() => { const s = document.querySelector('.param-slot[data-function-id="${fnId}"]'); const y = s ? s.getBoundingClientRect().y + s.getBoundingClientRect().height / 2 : null; const b = [...document.querySelectorAll('.param-add')].sort((a, c) => Math.abs(a.getBoundingClientRect().y + a.getBoundingClientRect().height / 2 - (y ?? 0)) - Math.abs(c.getBoundingClientRect().y + c.getBoundingClientRect().height / 2 - (y ?? 0))); (y === null ? b.pop() : b[0]).click() })()`)
  await sleep(200)
}
async function plug(nodeId, fnId, i) {
  await drag(await outPort(nodeId), await slotCenter(fnId, i))
  expect(await js(`!!document.querySelector('.param-slot[data-function-id="${fnId}"][data-index="${i}"] .param-chip')`), `plugging ${nodeId} into ${fnId}#${i} did not connect`)
}
async function toOutput(nodeId) {
  await drag(await outPort(nodeId), await portCenter('.in-port'))
  expect((await activeGraph()).graph.output.source === nodeId, `${nodeId} did not connect to Output`)
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
  console.log('Building a game through the UI only:')

  await check('declare Model and Msg in the type editor', async () => {
    await declareRecordType('Model', [['count', 'Double']])
    await js(`document.querySelector('.add-type').click()`); await sleep(250)
    await setField('.te-name', 'Msg'); await sleep(150)
    await setField('.te-cname', 'Increment'); await sleep(150)
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
    await setField('.te-fname[data-fi="0"]', 'total'); await sleep(200)
    await closeType()
    await openBody('handle')
    const { graph } = await activeGraph()
    const ov = Object.values(graph).find((n) => n.sourceFunctionId === 'type:Model:over total')
    expect(ov && ov.label === 'over total', 'over count was not renamed to over total')
    await clickNode(ov.id)
    const broken = await js(`document.querySelector('.broken-call') ? 'broken' : ''`)
    await back()
    await openType('Model')
    await setField('.te-fname[data-fi="0"]', 'count'); await sleep(200)
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
  await check('a type with a parameter', async () => {
    await js(`document.querySelector('.add-type').click()`); await sleep(250)
    await setField('.te-name', 'Box'); await sleep(150)
    await setField('.te-params', 'a'); await sleep(150)
    await js(`document.querySelector('[data-te="add-field"]').click()`); await sleep(150)
    const sig = await js(`document.querySelector('.te-sig .type-chain').title`)
    const status = await editorStatus()
    await js(`document.querySelector('[data-te="delete"]').click()`); await sleep(200)
    expect(sig === 'a → Box a' && status.includes('applied'), `${sig} / ${status}`)
    return sig
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
    expect(status.includes('applied') && p.nodes[implId]?.label === 'prettyModel' && text === 'Model {count = 0}', `${status} / ${p.nodes[implId]?.label} / ${JSON.stringify(text)}`)
    return `pretty initial = ${JSON.stringify(text)}`
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
    const fold = await js(`[...document.querySelectorAll('#port-editor .param-slot')].find((s) => s.querySelector('.param-chip'))?.dataset.functionId`)
    await js(`document.querySelector('.library-item[data-type=number]').click()`); await sleep(300) // refused: read-only
    const after = await js(`document.querySelector('#node-count').textContent`)
    const inputsLocked = await js(`[...document.querySelectorAll('#port-editor .param-value')].every((e) => e.readOnly)`)
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
    const chip = JSON.parse(await js(`JSON.stringify(document.querySelector('.param-slot[data-function-id="${fold}"][data-index="2"] .param-chip').getBoundingClientRect())`))
    await drag({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, { x: chip.x + chip.width / 2, y: chip.y + 200 })
    await toOutput(await paramId('xs'))
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
  await check('a signature is pinned chevron by chevron with type nodes, checked by inference', async () => {
    await createFunction('pinMe', ['x'])
    const { graph } = await activeGraph()
    const fnId = Object.values(graph).find((n) => n.label === 'pinMe' && n.custom).id
    await clickNode(fnId)
    const chain = () => js(`document.querySelector('#inspector-content .type-chain').title`)
    const inferred = await chain()
    const segment = (i) => js(`document.querySelectorAll('#inspector-content .tc-seg.editable')[${i}].click()`)
    const pick = (con) => js(`[...document.querySelectorAll('#type-picker [data-con]')].find((b) => b.dataset.con === ${JSON.stringify(con)}).click()`)
    // x :: Double — a whole type in one pick
    await segment(0); await sleep(200); await pick('Double'); await sleep(300)
    const pinned = await chain()
    const xAnnotation = Object.values((await project()).functionBodies[fnId]).find((n) => n.type === 'parameter').annotation
    // the result :: Maybe _ then Int — a constructor brings a hole to fill; the body says otherwise
    await segment(1); await sleep(200); await pick('Maybe'); await sleep(150)
    const hole = await js(`document.querySelector('#type-picker .tp-tree').textContent`)
    await pick('Int'); await sleep(300)
    const refused = await js(`document.querySelector('#type-picker .tp-error')?.textContent ?? ''`)
    await js(`document.querySelector('#type-picker [data-tp="close"]').click()`); await sleep(150)
    // and back to inferred
    await segment(0); await sleep(200); await js(`document.querySelector('#type-picker [data-tp="infer"]').click()`); await sleep(300)
    const cleared = await chain()
    expect(inferred === 'a → a' && pinned === 'Double → Double' && xAnnotation === 'Double', `${inferred} / ${pinned} / ${xAnnotation}`)
    expect(hole === 'Maybe_' && /makes the result Double, not Maybe Int/.test(refused), `${hole} / ${refused}`)
    expect(cleared === 'a → a', cleared)
    return `pinMe :: ${pinned}; result :: Maybe Int refused`
  })

  console.log(errors.length ? `Page errors:\n  ${errors.join('\n  ')}` : 'No page errors.')
  if (errors.length) failures++
  console.log(failures ? `${failures} check(s) failed` : 'All checks passed')
  cleanup(failures ? 1 : 0)
}
