// Isolated browser integration of the source document. No user profile/storage.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reloadApp } from './browser-reload.mjs'
const port = 5184, debug = 9484
const chromePath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p))
if (!chromePath) throw new Error('Chrome/Chromium required (set CHROME)')
const profile = mkdtempSync(join(tmpdir(), 'hs-source-e2e-'))
const artifacts = process.env.HS_SOURCE_ARTIFACTS || profile
mkdirSync(artifacts, { recursive: true })
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', `--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms)), expect = (value, why) => { if (!value) throw new Error(why) }
let ws, serial = 0, failures = 0
const pending = new Map(), errors = []
const send = (method, params = {}) => new Promise(r => { const id = ++serial; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
  return r.result?.result?.value
}
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
const source = async text => { await js(`(() => { const el = document.querySelector('#code-input'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`); await click('#code-convert'); await sleep(100) }
const select = name => js(`[...document.querySelectorAll('#code-functions button')].find(b => b.textContent.startsWith(${JSON.stringify(name + ' ::')})).click()`)
const snapshot = () => js(`localStorage.getItem('hs-simulate:project')`)
const savedCode = () => js(`localStorage.getItem('hs-simulate:code-document:v1')`)
async function waitResult(expected) {
  for(let i=0;i<120;i++){
    const result=await js(`document.querySelector('.code-result')?.dataset.result`)
    if(result===expected)return
    if(result==='error')throw new Error(await js(`document.querySelector('.code-result').textContent`))
    await sleep(50)
  }
  throw new Error('result was not ready: '+expected)
}
async function waitPlayback() {
  for(let i=0;i<160;i++){
    if(await js(`document.querySelector('#code-stop-playback').disabled&&document.querySelector('.code-surface').dataset.calculating!=='true'`))return
    await sleep(50)
  }
  throw new Error('execution playback did not finish')
}
const shot = async name => writeFileSync(join(artifacts, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
async function check(name, run) { try { await run(); console.log(`✓ ${name}`) } catch (e) { failures++; console.log(`✗ ${name}: ${e.message}`); await shot(`source-failure-${failures}.png`) } }
try {
  for (let i = 0; i < 80; i++) {
    try { const tabs = await (await fetch(`http://127.0.0.1:${debug}/json`)).json(); if (tabs.some(t => t.type === 'page')) { ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); break } } catch {}
    await sleep(100)
  }
  if (!ws) throw new Error('test Chrome failed to start')
  await new Promise(r => ws.addEventListener('open', r))
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.description || a.value).join(' '))
  })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}`); break } catch { await sleep(100) } }
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` })
  for (let i = 0; i < 150 && !(await js(`!!document.querySelector('#code-tab')`).catch(() => false)); i++) await sleep(100)
  await sleep(450)
  const manual = await snapshot(), example = 'add :: Int -> Int -> Int\nadd x y = x + y\n\nresult :: Int\nresult = add 3 5\n'
  await check('add/result → 8; calls and definitions have distinct exact source highlights; real execution playback', async () => {
    await click('#code-tab'); await source(example)
    expect(await js(`document.querySelectorAll('#code-functions button').length === 2`), 'function list missing')
    await click('#run')
    for(let i=0;i<40 && !(await js(`!!document.querySelector('.code-node[data-state="running"]')`));i++)await sleep(25)
    expect(await js(`!!document.querySelector('.code-node[data-state="running"]')`), 'running state not visible')
    await waitResult('8');await waitPlayback()
    expect(await js(`document.querySelector('.code-result')?.dataset.result === '8'`), 'expected 8')
    expect(await js(`document.querySelectorAll('.code-node[data-state="done"]').length === 3`), 'wrong visible completion nodes')
    await js(`[...document.querySelectorAll('.code-node')].find(n => n.querySelector('text').textContent === 'add').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    expect(await js(`document.querySelector('#code-source-preview mark')?.textContent === 'add 3 5'`), 'call span incorrect')
    expect(await js(`Number(document.querySelector('#code-source-preview mark').dataset.start)`) === example.lastIndexOf('add 3 5'), 'wrong call offset')
    // Real pointer resize in code mode; manual graph stays untouched.
    const r = await js(`(() => { const r = document.querySelector('.workspace-resizer').getBoundingClientRect(); return { x:r.x+4, y:r.y+100 } })()`)
    const oldWidth = await js(`document.querySelector('.sidebar').getBoundingClientRect().width`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 120, y: r.y + 50, button: 'left', buttons: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + 120, y: r.y + 50, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(150)
    expect(oldWidth >= 300 && await js(`document.querySelector('.sidebar').getBoundingClientRect().width`) === oldWidth + 120, 'code-mode Workspace default width or pointer resize failed')
    await shot('source-result-8.png')
    await click('.code-inspector button')
    expect(await js(`document.querySelector('#code-source-preview mark')?.textContent === 'add x y = x + y'`), 'definition span incorrect')
    expect(await js(`document.querySelectorAll('.code-edge').length === 5`), 'parameter/ref/operator/output connections missing')
    expect(await js(`document.querySelector('#run').disabled`), 'function with parameters should not run directly')
    await js(`[...document.querySelectorAll('.code-node')].find(n => n.querySelector('text').textContent === 'x' && n.querySelectorAll('text')[1].textContent.includes('ref')).dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    expect(await js(`document.querySelector('#code-source-preview mark')?.textContent === 'x'`), 'parameter occurrence span incorrect')
    await shot('source-add-definition.png')
    expect(await snapshot() === manual, 'conversion modified manual project')
  })
  await check('stale code cancels results/highlights; all failed conversions preserve last successful graph and storage', async () => {
    const saved = await savedCode(), functions = await js(`document.querySelector('#code-functions').textContent`)
    for (const [text, reason] of [
      ['result :: Int\nresult = missing', '정의되지 않은'],
      ['result :: Int\nresult = 1\nresult = 2', '중복'],
      ['f :: Int -> Int\nf x = x\nresult :: Int\nresult = f', 'Int'],
      ['result :: Int\nresult = (1 +', '표현식'],
      ['import Prelude\nresult :: Int\nresult = 1', '지원하지'],
      ['result :: Int\nresult = (1,2)', '지원하지'],
    ]) {
      await source(text)
      expect((await js(`document.querySelector('#code-status').textContent`)).includes(reason), 'wrong diagnostic: ' + reason)
      expect(await savedCode() === saved && await snapshot() === manual, 'failed conversion overwrote saved data')
      expect(await js(`document.querySelector('#code-functions').textContent`) === functions, 'last successful graph lost')
      expect(await js(`document.querySelector('#run').disabled && !document.querySelector('#code-source-preview mark') && !document.querySelector('.code-result') && !document.querySelector('.code-node[data-state="done"]')`), 'stale result or highlight remains')
    }
  })
  await check('forward calls, renamed function, precedence and changed numbers; rapid run/switch/reconvert clears playback', async () => {
    await source('result :: Int\nresult = combine (2 + 3) 4\ncombine :: Int -> Int -> Int\ncombine a b = a * b - 2')
    await click('#run'); await waitResult('18')
    await click('#run'); await click('#run'); await select('combine'); await sleep(1000)
    expect(await js(`!document.querySelector('.code-result') && !document.querySelector('.code-node[data-state="done"], .code-node[data-state="running"]')`), 'old run contaminated another function')
    await source('main :: Int\nmain = 6 * 7')
    await click('#run'); await waitResult('42')
    expect(await js(`document.querySelector('.code-result')?.dataset.result === '42'`), 'imported main not evaluated independently')
    expect(await snapshot() === manual, 'imported main replaced manual main')
  })
  await check('numeric bound errors identify a node; correction clears it; source restore never restores old results', async () => {
    await source('result :: Int\nresult = (9007199254740991 + 1) - 1')
    await click('#run'); await waitResult('error');await waitPlayback()
    expect(await js(`document.querySelector('.code-result')?.dataset.result === 'error' && !!document.querySelector('.code-node[data-state="error"]')`), 'missing overflow error')
    await source(example); await click('#run'); await waitResult('8');await waitPlayback()
    expect(await js(`document.querySelector('.code-result')?.dataset.result === '8' && !document.querySelector('.code-node[data-state="error"]')`), 'correction did not clear error')
    const saved = await savedCode()
    await reloadApp(js)
    expect(await snapshot() === manual && await savedCode() === saved, 'reload modified project/source storage')
    await click('#code-tab')
    expect(await js(`document.querySelectorAll('#code-functions button').length === 2 && !document.querySelector('.code-result, #code-source-preview mark, .code-node[data-state="done"]')`), 'restored transient result or lost source')
    await click('#manual-tab')
    expect(await js(`!document.querySelector('#manual-tools').hidden && document.querySelector('#run').textContent.includes('main') && !document.querySelector('#reset').disabled`), 'manual controls not restored')
    expect(await snapshot() === manual, 'manual state changed')
  })
  await check('raw recursion/list/HOF cases 03–09 execute through the Worker with expected results',async()=>{
    await click('#code-tab')
    const fixtures=new URL('../test/fixtures/source-complex/',import.meta.url)
    const cases=JSON.parse(readFileSync(new URL('manifest.json',fixtures),'utf8')).cases.slice(2)
    for(const c of cases){
      await source(readFileSync(new URL(c.file,fixtures),'utf8'));await click('#run')
      for(let i=0;i<80&&!(await js(`!!document.querySelector('.code-result')`));i++)await sleep(50)
      expect(await js(`document.querySelector('.code-result')?.dataset.result`)===c.checks[0].expected,'wrong recursive result '+c.id)
    }
  })
  await check('lazy conditions skip errors/recursion; Bool display and explicit limit recover',async()=>{
    await source('loop :: Int -> Int\nloop n = loop n\nresult :: Int\nresult = if False && (loop 0 == 0) || True then 8 else div 1 0')
    await click('#run');await waitResult('8');await waitPlayback()
    expect(await js(`document.querySelector('.code-result')?.dataset.result==='8'`),'lazy evaluation failed')
    expect(await js(`[...document.querySelectorAll('.code-node')].filter(n=>['loop','div'].includes(n.querySelector('text').textContent)).every(n=>n.dataset.state==='idle')`),'dead branch was animated')
    await source('loop :: Int -> Int\nloop n = loop (n + 1)\nresult :: Int\nresult = loop 0');await click('#run');await waitResult('error')
    expect(await js(`document.querySelector('.code-result')?.textContent.includes('재귀 호출 깊이 제한')`),'missing controlled recursion limit')
    expect(await js(`!!document.querySelector('#code-source-preview mark')`),'error has no source highlight')
    await source('result :: Bool\nresult = (-7) `mod` 3 == 2');await click('#run');await waitResult('True')
    expect(await js(`document.querySelector('.code-result')?.dataset.result==='True'`),'Bool correction failed')
  })
  await check('calculation stop terminates Worker; replay stop preserves result; stale replies never leak',async()=>{
    await source('result :: Int\nresult = 4 + 7')
    await js(`document.querySelector('#run').click();document.querySelector('#code-stop').click()`);await sleep(250)
    expect(await js(`document.querySelector('.code-result')?.textContent.includes('사용자가 계산을 중단')`),'Worker stop failed')
    await click('#run');await waitResult('11');await click('#code-stop-playback')
    expect(await js(`document.querySelector('.code-result')?.dataset.result==='11'&&document.querySelector('#code-stop-playback').getAttribute('aria-pressed')==='false'`),'replay stop changed calculation')
    await click('#run');await click('#manual-tab');await sleep(300);await click('#code-tab')
    expect(await js(`!document.querySelector('.code-result')&&!document.querySelector('.code-node[data-state="done"],.code-node[data-state="running"]')`),'Worker reply leaked after mode switch')
    await click('#manual-tab')
  })
  await check('manual node creation, wiring, execution animation and autosave still work after source analysis', async () => {
    const analysisBefore = await savedCode()
    await js(`(() => { const input = document.querySelector('.search input'); input.value = '(+)'; input.dispatchEvent(new Event('input'));
      const item = [...document.querySelectorAll('.function-library-item')].find(el => el.querySelector('b').textContent === '(+)'); item.parentElement.querySelector('.add-call').click() })()`)
    await sleep(200)
    const id = await js(`document.querySelector('.param-slot').dataset.functionId`)
    for (const [index, value] of [[0, '3'], [1, '5']]) {
      await click(`.param-slot[data-function-id="${id}"][data-index="${index}"]`)
      await js(`(() => { const input = document.querySelector('.literal-input'); input.value = '${value}'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })()`)
    }
    const center = selector => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    const from = await center(`.out-port[data-node-id="${id}"]`), to = await center('.in-port')
    await send('Input.dispatchMouseEvent', {type:'mousePressed',...from,button:'left',buttons:1,clickCount:1})
    for (let i=1;i<=10;i++) await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10,button:'left',buttons:1})
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1})
    await click('#run')
    expect(await js(`!!document.querySelector('.execution-mark[data-state="running"]')`), 'manual animation missing')
    await sleep(1400)
    const after = await snapshot(), p = JSON.parse(after)
    expect(Object.values(p.functionBodies.main).some(n => n.label === 'result' && n.value === '8'), 'manual result not 8')
    await reloadApp(js)
    expect(await snapshot() === after, 'manual autosave did not restore')
    expect(await js(`document.querySelectorAll('.execution-mark').length === 0`), 'manual transient animation restored')
    await click('#code-tab')
    expect(await savedCode() === analysisBefore && await js(`document.querySelectorAll('#code-functions button').length > 0`), 'manual edit replaced analysis source')
  })
  console.log(errors.length ? `Page errors:\n${errors.join('\n')}` : 'No page or console errors.')
  console.log(`${8 - failures}/8 source UI checks passed`)
  process.exitCode = failures || errors.length ? 1 : 0
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  try { ws?.close() } catch {}
  chrome.kill(); vite.kill()
  await sleep(500)
  // Only this test's mkdtemp directory is removed, never a real browser profile.
  if (profile.startsWith(join(tmpdir(), 'hs-source-e2e-'))) try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
