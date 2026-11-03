// Isolated browser integration of the source document. No user profile/storage.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const port = 5188, debug = 9488
const chromePath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p))
if (!chromePath) throw new Error('Chrome/Chromium required (set CHROME)')
const profile = mkdtempSync(join(tmpdir(), 'hs-debug-e2e-'))
const artifacts = process.env.HS_DEBUG_ARTIFACTS || profile
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


  await click('#code-tab')
  await js(`window.runs=0;window.Worker=class extends Worker {constructor(...args){super(...args);window.runs++}}`)
  const resultText=expr=>'result :: Int\nresult = '+expr
  const run=async(text,expected)=>{await source(text);await click('#run');await waitResult(expected);await waitPlayback()}
  const field=selector=>js(`document.querySelector(${JSON.stringify(selector)})?.textContent`)
  const callOptions=()=>js(`[...document.querySelectorAll('#code-trace-call option')].slice(1).map(o=>({id:o.value,label:o.textContent}))`)
  const call=async(id)=>js(`(()=>{const s=document.querySelector('#code-trace-call');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change'))})()`)
  const args=()=>js(`[...document.querySelectorAll('[data-trace-arg]')].map(e=>[e.dataset.traceArg,e.textContent])`)
  const returned=()=>field('.code-trace-return')
  const eq=(a,b,reason)=>expect(JSON.stringify(a)===JSON.stringify(b),reason+': '+JSON.stringify(a))
  const add='add :: Int -> Int -> Int\nadd x y = x + y\n'+resultText('add 3 5')
  await check('add history reveals only known arguments and return; seek, pause and resume never launch another Worker',async()=>{
    await run(add,'8')
    const workerCount=await js('window.runs')
    const addCall=(await callOptions()).find(o=>o.label.includes(' add '))
    await call(addCall.id);eq(await args(),[['x','3'],['y','5']],'argument mapping');eq(await returned(),'8','return')
    await shot('add-call.png')
    await click('#code-trace-site');eq(await field('#code-source-preview mark'),'add 3 5','call site')
    await click('#code-trace-definition');eq(await field('#code-source-preview mark'),'add x y = x + y','definition')
    await click('#code-history-first')
    eq((await callOptions()).length,0,'future call visible')
    for(let i=0;i<15;i++){await click('#code-history-next');if(await js(`document.querySelector('#code-trace-call').value`)===addCall.id)break}
    eq(await args(),[['x','미평가'],['y','미평가']],'arguments leaked from future')
    eq(await returned(),'미평가','return leaked from future')
    await shot('add-entry-unevaluated.png')
    await click('#code-history-prev');expect((await callOptions()).every(x=>x.id!==addCall.id),'previous retained future frame')
    await click('#code-history-next')
    const step=await field('#code-history-position')
    await js(`document.querySelector('#code-stop-playback').click();document.querySelector('#code-stop-playback').click()`)
    await sleep(240);eq(await field('#code-history-position'),step,'pause moved step')
    await click('#code-stop-playback');await waitPlayback();eq(await js('window.runs'),workerCount,'history reevaluated')
    await waitResult('8')
  })
  await check('factorial and mutual recursion have separate calls, arguments, returns and parents',async()=>{
    await run('fac :: Int -> Int\nfac n = if n <= 1 then 1 else n * fac (n - 1)\n'+resultText('fac 4'),'24')
    const frames=(await callOptions()).filter(o=>o.label.includes(' fac '))
    eq(frames.length,4,'factorial frames')
    for(const [i,entry] of frames.entries()){
      await call(entry.id)
      eq(await args(),[['n',String(4-i)]],'recursive argument')
      eq(await returned(),['24','6','2','1'][i],'recursive return')
      if(i)expect(entry.label.includes('부모 #'+frames[i-1].id),'recursive parent')
    }
    await shot('factorial-calls.png')
    await run('evenN :: Int -> Bool\nevenN n = if n == 0 then True else oddN (n - 1)\noddN :: Int -> Bool\noddN n = if n == 0 then False else evenN (n - 1)\nresult :: Bool\nresult = evenN 2','True')
    const calls=await callOptions(),even=calls.find(c=>c.label.includes(' evenN ')),odd=calls.find(c=>c.label.includes(' oddN '))
    expect(odd?.label.includes('부모 #'+even.id),'mutual recursion parent')
  })
  await check('map calls keep captured values, distinct arguments and their map sites',async()=>{
    await run('shift :: Int -> Int -> Int\nshift d x = d + x\nresult :: [Int]\nresult = map (shift 2) [1,3] ++ map (shift 10) [1,3]','[3,5,11,13]')
    const frames=(await callOptions()).filter(o=>o.label.includes(' shift '))
    eq(frames.length,4,'map frames')
    for(const [i,entry] of frames.entries()){
      await call(entry.id)
      eq(await args(),[['d',i<2?'2':'10'],['x',i%2?'3':'1']],'map capture')
      eq(await returned(),['3','5','11','13'][i],'map return')
      await click('#code-trace-site')
      eq(await field('#code-source-preview mark'),i<2?'map (shift 2) [1,3]':'map (shift 10) [1,3]','map site')
    }
    await shot('map-captures.png')
  })
  await check('unexecuted if, unused recursive argument and unused list element stay unevaluated',async()=>{
    const loop='loop :: Int -> Int\nloop x = loop x\n'
    await run(loop+resultText('if True then 8 else loop 0'),'8')
    expect((await callOptions()).every(c=>!c.label.includes(' loop ')),'dead conditional branch executed')
    await run(loop+'first :: [Int] -> Int -> Int\nfirst [] _ = loop 0\nfirst (x:xs) y = x\n'+resultText('first [8,loop 0] (loop 0)'),'8')
    const frames=await callOptions()
    expect(frames.every(c=>!c.label.includes(' loop ')&&!c.label.includes('방정식 1')),'dead recursion/branch recorded')
    await call(frames.find(c=>c.label.includes(' first ')&&!c.label.includes('방정식')).id)
    eq(await args(),[['arg1','[8, 미평가]'],['arg2','미평가']],'unexpected demand')
    expect((await field('.code-trace-inspector')).includes('2 · (x:xs) y'),'selected pattern missing')
    await shot('pattern-unevaluated.png')
    for (let i = 0; i < 40 && !(await field('#code-history-position')).includes('방정식 선택'); i++) await click('#code-history-prev')
    eq(await field('#code-source-preview mark'),'first (x:xs) y = x','selected equation source')
  })
  await check('runtime error source and rewind, then edit, recovery and calculation stop',async()=>{
    await source('bad :: Int -> Int\nbad x = div 1 x\n'+resultText('bad 0'))
    await click('#run');await waitResult('error')
    eq(await field('#code-source-preview mark'),'div 1 x','error origin')
    expect((await field('.code-graph-heading')).startsWith('bad ::'),'error graph does not show its origin')
    for(let i=0;i<8;i++){await click('#code-history-prev');if((await field('#code-history-position')).includes('노드 오류')&&(await field('#code-source-preview mark'))==='div 1 x')break}
    expect((await field('.code-inspector')).includes('이 단계의 오류'),'historical error missing')
    await shot('runtime-error-step.png')
    await click('#code-history-first');expect((await callOptions()).length===0,'error rewind retained calls')
    await run(add,'8')
    await js(`(()=>{const e=document.querySelector('#code-input');e.value+='\\n-- edit';e.dispatchEvent(new Event('input'))})()`)
    expect(await js(`document.querySelector('.code-history').hidden&&!document.querySelector('.code-result')`),'edit retained history')
    await source(resultText('6 * 7'))
    await js(`document.querySelector('#run').click();document.querySelector('#code-stop').click()`)
    await sleep(250);expect(await js(`document.querySelector('.code-history').hidden&&document.querySelector('.code-result').textContent.includes('중단')`),'cancel leaked old messages')
    await run(resultText('6 * 7'),'42')
  })
  await check('record limit, long graph location and narrow viewport controls',async()=>{
    const fib=readFileSync(new URL('../test/fixtures/source-complex/cases/05_fibonacci_window.hs',import.meta.url),'utf8')
    await run(fib,'104')
    expect((await field('#code-history-position')).includes('생략'),'record clipping indicator missing')
    await shot('record-limit.png')
    const items=Array.from({length:80},(_,i)=>i+1).join(',')
    await run('result :: [Int]\nresult = ['+items+']','['+items+']')
    for(let i=0;i<12;i++){await click('#code-history-prev');if(await js(`!document.querySelector('#code-history-find').disabled&&document.querySelector('.code-step-node text')?.textContent==='80'`))break}
    await click('#code-history-find')
    expect(await js(`document.activeElement.classList.contains('code-step-node')&&document.querySelector('.code-surface').scrollTop>0`),'long graph node was not found')
    const oldScroll=await js(`document.querySelector('.code-surface').scrollTop`)
    await click('#code-history-prev')
    eq(await js(`document.querySelector('.code-surface').scrollTop`),oldScroll,'step reset graph scroll')
    await send('Emulation.setDeviceMetricsOverride',{width:420,height:820,deviceScaleFactor:1,mobile:false})
    await sleep(150)
    expect(await js(`(()=>{const b=document.querySelector('#code-history-next').getBoundingClientRect();return b.width>0&&b.right<=innerWidth})()`),'mobile controls clipped')
    await click('#code-history-next');await shot('narrow-history.png')
  })
  console.log(errors.length ? errors.join('\n') : 'No page or console errors.')
  console.log(`${6-failures}/6 visual debugger UI checks passed`)
  process.exitCode=failures||errors.length?1:0
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  try { ws?.close() } catch {}
  chrome.kill(); vite.kill()
  await sleep(500)
  // Only this test's mkdtemp directory is removed, never a real browser profile.
  if (profile.startsWith(join(tmpdir(), 'hs-debug-e2e-'))) try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
