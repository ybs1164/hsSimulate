// Real browser file picker events and editable local sources in a disposable profile.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reloadApp } from './browser-reload.mjs'

const port = 5192, debug = 9492
const chromePath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => path && existsSync(path))
if (!chromePath) throw new Error('Chrome/Chromium required (set CHROME)')
const profile = mkdtempSync(join(tmpdir(), 'hs-modules-e2e-'))
const artifacts = process.env.HS_MODULE_ARTIFACTS || profile
mkdirSync(artifacts, { recursive: true })
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', `--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const expect = (condition, message) => { if (!condition) throw new Error(message) }
const fixture = name => fileURLToPath(new URL('../test/fixtures/source-modules/' + name, import.meta.url))
const pending = new Map(), errors = [], values = {}
let ws, serial = 0, chooser, dialogCount = 0, acceptDialog = false
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('No Chrome response: ' + method)) }, 8000)
    pending.set(id, ({ result, error }) => { clearTimeout(timer); error ? reject(new Error(error.message)) : resolve(result) })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function js(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue:true, userGesture:true, awaitPromise:true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result?.value
}
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
const setSelect = (selector, value) => js(`(() => {
  const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change'))
})()`)
const edit = source => js(`(() => {
  const el=document.querySelector('#code-input'); el.value=${JSON.stringify(source)}; el.dispatchEvent(new Event('input'))
})()`)
async function wait(expression, message) {
  for (let i = 0; i < 120; i++) {
    if (await js(expression)) return
    await sleep(50)
  }
  throw new Error(message)
}
async function pick(paths) {
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chooser = null; reject(new Error('File chooser did not open')) }, 6000)
    chooser = event => { clearTimeout(timer); resolve(event) }
  })
  await click('#code-open-files')
  const event = await opened
  expect(event.mode === 'selectMultiple' && event.backendNodeId, 'not the native multiple-file input')
  await send('DOM.setFileInputFiles', { files: paths, backendNodeId: event.backendNodeId })
}
const field = selector => js(`document.querySelector(${JSON.stringify(selector)})?.textContent`)
const getValue = selector => js(`document.querySelector(${JSON.stringify(selector)})?.value`)
const fileName = () => js(`document.querySelector('#code-source-preview').dataset.filename`)
const mark = () => field('#code-source-preview mark')
const store = suffix => js(`localStorage.getItem(${JSON.stringify('hs-simulate:' + suffix)})`)
const filesSaved = () => store('code-files:v1')
const readStatus = condition => wait(`document.querySelector('#code-file-status').textContent.includes(${JSON.stringify(condition)})`, 'file status missing: ' + condition)
const convert = () => click('#code-convert')
async function run(expected, key) {
  await click('#run')
  await wait(`document.querySelector('.code-result')?.dataset.result === ${JSON.stringify(expected)} || document.querySelector('.code-result')?.dataset.result === 'error'`, 'No evaluation result')
  expect(await js(`document.querySelector('.code-result').dataset.result`) === expected, await field('.code-result'))
  if (key) values[key] = expected
  await wait(`document.querySelector('#code-stop-playback').disabled`, 'Trace playback did not finish')
}
const shot = async name => writeFileSync(join(artifacts, name), Buffer.from((await send('Page.captureScreenshot', { format:'png' })).data, 'base64'))
const call = async name => {
  const id = await js(`[...document.querySelectorAll('#code-trace-call option')].find(o=>o.textContent.includes(${JSON.stringify(' ' + name + ' ')}))?.value`)
  expect(id, 'Trace call missing: ' + name)
  await setSelect('#code-trace-call', id)
}
try {
  for (let i = 0; i < 80; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${debug}/json`)).json()
      const page = tabs.find(tab => tab.type === 'page')
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break }
    } catch {}
    await sleep(100)
  }
  expect(ws, 'Chrome did not start')
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once:true }); ws.addEventListener('error', reject, { once:true }) })
  ws.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data)
    if (event.id && pending.has(event.id)) { pending.get(event.id)(event); pending.delete(event.id) }
    if (event.method === 'Page.fileChooserOpened') { const resolve = chooser; chooser = null; resolve?.(event.params) }
    if (event.method === 'Page.javascriptDialogOpening') { dialogCount++; void send('Page.handleJavaScriptDialog', { accept:acceptDialog }).catch(error => errors.push(error.message)) }
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text)
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(arg => arg.description || arg.value).join(' '))
  })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Page.setInterceptFileChooserDialog', { enabled:true })
  await send('Emulation.setDeviceMetricsOverride', { width:1500, height:1000, deviceScaleFactor:1, mobile:false })
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}`); break } catch { await sleep(100) } }
  await send('Page.navigate', { url:`http://127.0.0.1:${port}` })
  await wait(`document.querySelector('#code-tab')`, 'Editor missing')
  await js(`window.workerRuns=0;window.Worker=class extends Worker {constructor(...args){super(...args);window.workerRuns++}}`)
  const manual = await store('project')
  await click('#code-tab')
  const single = 'result :: Int\nresult = 6 * 7'
  await edit(single); await convert(); await run('42', 'paste')
  const old = await store('code-document:v1')
  const utf = join(artifacts, 'Utf.hs'), unreadable = join(artifacts, 'Unreadable.hs')
  writeFileSync(utf, '\uFEFF' + single.replaceAll('\n','\r\n'), 'utf8')
  writeFileSync(unreadable, Buffer.from([0xff, 0xfe]))
  await pick([utf]); await readStatus('1개')
  expect(await getValue('#code-input') === single, 'BOM/CRLF not normalized in textarea')
  await convert(); await run('42', 'single')
  await pick([unreadable]); await readStatus('UTF-8')
  expect(await getValue('#code-input') === single && await js(`document.querySelector('.code-result').dataset.result`) === '42', 'bad read changed active document')
  await pick([]); expect(await getValue('#code-input') === single, 'cancel discarded active source')
  console.log('PASS legacy paste and single UTF-8 BOM/CRLF file; rejected bytes and canceled selection preserve state')

  await pick([fixture('Example.hs'), fixture('MathOps.hs')]); await readStatus('2개')
  await convert()
  await setSelect('#code-module','Example')
  await run('42','default')
  await call('MathOps.add')
  expect(await fileName() === 'MathOps.hs' && await mark() === 'add x y = x + y', 'definition source is not in MathOps.hs')
  expect(await field('.code-trace-return') === '42', 'cross-file return is wrong')
  const args = await js(`[...document.querySelectorAll('[data-trace-arg]')].map(el=>[el.dataset.traceArg,el.textContent])`)
  expect(JSON.stringify(args) === JSON.stringify([['x','40'],['y','2']]), 'cross-file arguments are wrong')
  await shot('definition-mathops.png')
  await click('#code-trace-site')
  expect(await fileName() === 'Example.hs' && await mark() === 'M.add (M.twice 20) 2', 'call source is not in Example.hs')
  await shot('call-example.png')
  await click('#code-history-first')
  expect(await fileName() === 'Example.hs', 'rewind did not restore entry file')
  for (let i = 0; i < 55 && await fileName() !== 'MathOps.hs'; i++) await click('#code-history-next')
  expect(await fileName() === 'MathOps.hs' && Boolean(await mark()), 'step did not follow module')
  expect(await getValue('#code-module') === 'Example', 'stepping changed the target module')
  await shot('history-cross-file.png')
  const workerRuns = await js('window.workerRuns')
  await setSelect('#code-file-view','file:Example.hs')
  expect(await getValue('#code-module') === 'Example' && await js(`document.querySelector('.code-result').dataset.result`) === '42' &&
    await js('window.workerRuns') === workerRuns, 'view switched or restarted the evaluation')
  const original = await getValue('#code-input')
  for (const [input, expected, key] of [['0','2','zero'],['(-3)','-4','negative']]) {
    await edit(original.replace('twice 20','twice ' + input))
    expect(await js(`document.querySelector('#run').disabled && !document.querySelector('.code-result') && document.querySelector('.code-history').hidden`), 'edit kept obsolete evaluation')
    await convert(); await run(expected,key)
  }
  console.log('PASS default/zero/negative, file selection, call values, both source files and trace navigation')

  const committed = await filesSaved()
  await edit(original.replace('import qualified MathOps as M','import qualified Missing as M'))
  await convert()
  expect(await js(`document.querySelector('#code-status').dataset.stage === 'dependency' && document.querySelector('#run').disabled`), 'missing module not diagnosed')
  expect(await filesSaved() === committed && await store('project') === manual && await store('code-document:v1') === old, 'failed conversion changed storage')
  await edit(original + '\nbroken = (')
  await convert()
  expect(await js(`document.querySelector('#code-status').dataset.stage === 'syntax'`) && await filesSaved() === committed, 'parse failure changed storage')
  const editBeforeReplace = await getValue('#code-input')
  await pick([fixture('Example.hs')]); await sleep(250)
  expect(dialogCount === 1 && await getValue('#code-input') === editBeforeReplace, 'cancel replacement overwrote draft')
  acceptDialog = true
  await pick([fixture('Example.hs')]); await wait(`document.querySelector('#code-input').value.includes('M.twice 20') && !document.querySelector('#code-input').value.includes('broken =')`, 'approved replacement not applied')
  await convert(); await run('42')
  await setSelect('#code-file-view','file:MathOps.hs')
  await reloadApp(js); await click('#code-tab')
  expect(await getValue('#code-file-view') === 'file:MathOps.hs' && await getValue('#code-module') === 'Example', 'saved selections did not restore')
  expect(await js(`!document.querySelector('.code-result')`) && await store('code-document:v1') === old, 'restored stale results or lost legacy data')
  await click('#code-paste-mode'); await run('42')
  await click('#code-files-mode')
  await pick([fixture('SeriesExample.hs'),fixture('Series.hs')]); await readStatus('2개')
  await convert(); await setSelect('#code-module','SeriesExample'); await run('12','series')
  expect(await js(`![...document.querySelectorAll('#code-trace-call option')].some(o=>o.textContent.includes('SeriesExample.loop'))`), 'unused cross-module list element evaluated')
  await call('MathOps.add'); expect(await fileName() === 'MathOps.hs', 'higher-order call did not jump to definition')
  await click('#code-trace-site')
  expect(await fileName() === 'Series.hs' && await mark() === 'map (add delta) xs', 'higher-order caller file or span incorrect')
  await shot('higher-order-cross-file.png')
  console.log('PASS missing/syntax preservation, duplicate confirmation, storage restore, recursive three-module graph and unused tail')

  await setSelect('#code-module','Example')
  await edit(original.replace('twice 20','twice 0'))
  await setSelect('#code-file-view','file:MathOps.hs')
  const math = await getValue('#code-input')
  await edit(math.replace('x * 2','div 1 x'))
  await convert(); await run('error')
  expect(await fileName() === 'MathOps.hs' && await mark() === 'div 1 x', 'runtime error did not select its original file')
  await shot('cross-file-error.png')
  await js(`[...document.querySelectorAll('.code-inspector button')].find(b=>b.textContent==='오류가 전달된 호출 위치').click()`)
  expect(await fileName() === 'Example.hs' && await mark() === 'M.twice 0', 'error caller span does not match')
  await setSelect('#code-file-view','file:MathOps.hs')
  await edit(math)
  await convert()
  await js(`(() => {
    document.querySelector('#run').click()
    const input=document.querySelector('#code-input')
    input.value += '\\n-- edit during evaluation'
    input.dispatchEvent(new Event('input'))
  })()`)
  await sleep(400)
  expect(await js(`document.querySelector('#run').disabled && !document.querySelector('.code-result') && document.querySelector('.code-history').hidden`), 'canceled module result leaked after edit')
  await convert(); await run('2')
  await setSelect('#code-module','SeriesExample')
  console.log('PASS runtime error and caller highlight use separate files, edit cancels the pending worker and recovery works')

  await js(`window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='hs-simulate:code-files:v1')throw new DOMException('test quota','QuotaExceededError');return window.originalSetItem.call(this,key,value)}`)
  const beforeQuota = await filesSaved()
  await convert()
  expect((await field('#code-status')).includes('저장 실패') && await filesSaved() === beforeQuota, 'storage failure was silent or replaced the snapshot')
  await run('12')
  expect(errors.length === 0, errors.join('\n'))
  expect(await store('project') === manual, 'manual project changed')
  writeFileSync(join(artifacts, 'browser-results.json'), JSON.stringify({ values, errors }, null, 2))
  console.log('PASS storage failure retains saved file project and remains usable; no page/console errors')
} catch (error) {
  console.error(error)
  try { await shot('failure.png') } catch {}
  process.exitCode = 1
} finally {
  try { ws?.close() } catch {}
  chrome.kill(); vite.kill()
  await sleep(500)
  if (profile.startsWith(join(tmpdir(), 'hs-modules-e2e-'))) try { rmSync(profile, { recursive:true, force:true }) } catch {}
}
