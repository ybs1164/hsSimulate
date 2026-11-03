// Isolated browser integration of the source document. No user profile/storage.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const port = 5186, debug = 9486
const chromePath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p))
if (!chromePath) throw new Error('Chrome/Chromium required (set CHROME)')
const profile = mkdtempSync(join(tmpdir(), 'hs-timeout-e2e-'))
const artifacts = process.env.HS_TIMEOUT_ARTIFACTS || profile
mkdirSync(artifacts, { recursive: true })
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', `--user-data-dir=${profile}`, `--remote-debugging-port=${debug}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms)), expect = (value, why) => { if (!value) throw new Error(why) }
let ws, serial = 0
const pending = new Map(), errors = []
const send = (method, params = {}) => new Promise(r => { const id = ++serial; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
  return r.result?.result?.value
}
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
const source = async text => { await js(`(() => { const el = document.querySelector('#code-input'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })) })()`); await click('#code-convert'); await sleep(100) }
const shot = async name => writeFileSync(join(artifacts, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
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

  await click('#code-tab'); await source('result :: Int\nresult = 6 * 7')
  // Replace only the calculation Worker, never timers or the runner/UI. A real
  // worker reports liveness through a separate MessagePort, and finishes too late.
  await js(`(() => {
    const NativeWorker=window.Worker;window.timeoutAudit={workers:[],uiTicks:0};window.nativeSourceWorker=NativeWorker;
    const blob=new Blob([\`self.onmessage=({data})=>{const p=data.port;setInterval(()=>p.postMessage('alive'),50);setTimeout(()=>postMessage({value:999,events:[],allEvents:[]}),4800)}\`],{type:'text/javascript'});
    window.controlledWorkerURL=URL.createObjectURL(blob);
    window.Worker=class extends NativeWorker {
      constructor(url,opts){super(window.controlledWorkerURL,opts);const row={started:performance.now(),ticks:0,messages:0,terminated:0};window.timeoutAudit.workers.push(row);this.row=row;window.lastControlledWorker=this;const channel=new MessageChannel();this.port=channel.port2;row.receiver=channel.port1;channel.port1.onmessage=()=>{row.ticks++;row.lastTick=performance.now()};this.addEventListener('message',()=>row.messages++);}
      postMessage(data){super.postMessage({port:this.port},[this.port])}
      terminate(){this.row.terminated++;this.row.elapsed=performance.now()-this.row.started;super.terminate()}
    };
    window.uiHeartbeat=setInterval(()=>window.timeoutAudit.uiTicks++,40);
  })()`)
  await click('#run');await sleep(150)
  expect(await js(`document.querySelector('.code-surface').dataset.calculating==='true'`),'not calculating')
  await click('#code-support summary') // real UI interaction while the worker is alive
  expect(await js(`document.querySelector('#code-support').open`),'UI unresponsive')
  for(let i=0;i<110&&!(await js(`!!document.querySelector('.code-result')`));i++)await sleep(50)
  expect(await js(`document.querySelector('.code-result')?.textContent.includes('시간 제한(4초)')`),'not the 4-second timeout cause')
  await shot('timeout-4s.png')
  const timing=await js(`(()=>{const r=window.timeoutAudit.workers[0];return {elapsed:r.elapsed,ticks:r.ticks,terminated:r.terminated,messages:r.messages,uiTicks:window.timeoutAudit.uiTicks}})()`)
  expect(timing.elapsed>=3900&&timing.elapsed<6000,'wrong real timeout duration '+timing.elapsed)
  expect(timing.terminated===1&&timing.ticks>30&&timing.uiTicks>50&&timing.messages===0,'no real worker/termination evidence')
  const ticks=timing.ticks;await sleep(250)
  expect(await js(`window.timeoutAudit.workers[0].ticks`)===ticks,'worker still alive after terminate')
  await js(`window.Worker=window.nativeSourceWorker`)
  await source('result :: Int\nresult = 6 * 7');await click('#run')
  for(let i=0;i<60&&!(await js(`!!document.querySelector('.code-result')`));i++)await sleep(50)
  expect(await js(`document.querySelector('.code-result')?.dataset.result==='42'`),'normal calculation did not recover')
  await click('#code-stop-playback')
  expect(await js(`document.querySelector('.code-result')?.dataset.result==='42'&&document.querySelector('#code-stop-playback').getAttribute('aria-pressed')==='false'`),'replay stop changed actual result')
  await sleep(1000) // beyond the dead worker's scheduled result
  await js(`window.lastControlledWorker.dispatchEvent(new MessageEvent('message',{data:{value:999,events:[],allEvents:[]}}))`)
  expect(await js(`document.querySelector('.code-result')?.dataset.result==='42'`),'stale completion overwrote the new result')
  await shot('timeout-recovery-42.png')
  const audit=await js(`(()=>{clearInterval(window.uiHeartbeat);return {timing:${JSON.stringify(timing)},lateWorkerMessages:window.timeoutAudit.workers[0].messages,finalResult:document.querySelector('.code-result').dataset.result,consoleErrors:0}})()`)
  // messages includes the synthetic stale-delivery probe, explicitly separate
  // from real worker messages (zero before dispatch).
  writeFileSync(join(artifacts,'timeout-browser.json'),JSON.stringify({...audit,method:'CONTROLLED_REAL_WORKER_REAL_TIMER_NOT_EVALUATOR_LOAD',timeoutMs:4000,syntheticStaleProbe:true},null,2))
  expect(errors.length===0,errors.join('\n'))
  console.log('PASS real 4s runner timeout, actual Worker termination, responsive UI, stale-message rejection, result 42 recovery and separate replay stop',JSON.stringify(timing))
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  try { ws?.close() } catch {}
  chrome.kill(); vite.kill()
  await sleep(500)
  // Only this test's mkdtemp directory is removed, never a real browser profile.
  if (profile.startsWith(join(tmpdir(), 'hs-timeout-e2e-'))) try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
