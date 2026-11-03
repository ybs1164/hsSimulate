// Isolated browser integration of the source document. No user profile/storage.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const port = 5187, debug = 9487
const chromePath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p))
if (!chromePath) throw new Error('Chrome/Chromium required (set CHROME)')
const profile = mkdtempSync(join(tmpdir(), 'hs-list-e2e-'))
const artifacts = process.env.HS_LIST_ARTIFACTS || profile
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

  const fixtures=new URL('../test/fixtures/source-complex/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',fixtures),'utf8'))
  const report={kind:'CURRENT_WORKTREE_REAL_UI',originals:[],variants:[],extras:[],serviceProof:{},errors}
  const saveReport=()=>writeFileSync(join(artifacts,'browser-results.json'),JSON.stringify(report,null,2))
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
  const allStorage=()=>js(`Object.fromEntries(Object.keys(localStorage).sort().filter(k=>k!=='hs-simulate:code-document:v1').map(k=>[k,localStorage.getItem(k)]))`)
  const compile=async(raw,version)=>js(`import('/src/sourceGraph.js').then(m=>m.compileSource(${JSON.stringify(raw)},${version}))`)
  const shape=()=>js(`({nodes:[...document.querySelectorAll('.code-node')].map(n=>n.dataset.codeNode),edges:[...document.querySelectorAll('.code-edge')].map(p=>p.getAttribute('d'))})`)
  async function pointer(selector){
    const r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',buttons:0,clickCount:1})
  }
  async function paste(raw){
    await js(`(()=>{const e=document.querySelector('#code-input');e.focus();e.select()})()`);await send('Input.insertText',{text:raw})
    expect(await js(`document.querySelector('#code-input').value`)===raw,'incomplete or modified source insertion')
    await click('#code-convert');await sleep(30)
    return js(`({state:document.querySelector('#code-status').dataset.state,message:document.querySelector('#code-status').textContent})`)
  }
  async function evaluate(expected,name='result',settle=true){
    await select(name);await click('#run');await waitResult(expected)
    if(settle)for(let i=0;i<180&&!(await js(`document.querySelector('#code-stop-playback').disabled`));i++)await sleep(50)
    else await click('#code-stop-playback')
    expect(same(await allStorage(),manualBaseline),'manual/progress storage changed')
    return {value:await js(`document.querySelector('.code-result').dataset.result`),text:await js(`document.querySelector('.code-result').textContent`)}
  }
  async function checkRow(list,row,run){list.push(row);try{await run(row);row.pass=true;console.log('PASS',row.id||row.name,row.value||'')}catch(e){row.pass=false;row.failure=e.stack;failures++;await shot('lists-failure-'+failures+'.png');console.log('FAIL',row.id||row.name,e.message)}saveReport()}
  // A nonempty disposable project; the user's profile is never opened.
  await js(`(()=>{const t=document.querySelector('#template');t.value='blankGame';t.dispatchEvent(new Event('change'));localStorage.setItem('hs-simulate:exercises','{"preserve":true}')})()`);await sleep(300)
  await click('#code-tab');const manualBaseline=await allStorage()
  for(const file of ['sourceParser.js','sourceAnalysis.js','sourceBuiltins.js','sourceGraph.js','sourceValue.js','sourcePanel.js','sourceWorker.js','evaluator.js']){
    const served=await js(`import('/src/${file}?raw').then(m=>m.default)`),local=readFileSync(new URL('../src/'+file,import.meta.url),'utf8')
    expect(served===local,'not serving latest working tree '+file);report.serviceProof[file]=true
  }
  const trees={
    '07_list_pattern_recursion':{positive:{root:'equations(arg1)',rows:['nil()','select(gt(x,0),cons(x,positive(xs)),positive(xs))']},square:'times(x,x)',squareList:{root:'equations(arg1)',rows:['nil()','cons(square(x),squareList(xs))']},sumList:{root:'equations(arg1)',rows:['0','plus(x,sumList(xs))']},score:'sumList(squareList(positive(xs)))',result:'score(listOf(negate(3),0,2,5,negate(1),4))'},
    '08_higher_order_pipeline':{isOddValue:'neq(mod(n,2),0)',shiftBy:'plus(x,delta)',square:'times(x,x)',accumulate:'plus(total,x)',pipeline:'foldl(accumulate(),0,map(square(),map(shiftBy(delta),filter(isOddValue(),xs))))',result:'pipeline(2,listOf(1,2,3,4,5,6,7,8))'},
    '09_quicksort_dedup':{smaller:'filter(lt(_,pivot),xs)',notSmaller:'filter(geq(_,pivot),xs)',quickSort:{root:'equations(arg1)',rows:['nil()','append(quickSort(smaller(pivot,xs)),append(listOf(pivot),quickSort(notSmaller(pivot,xs))))']},dedup:{root:'equations(arg1)',rows:['nil()','listOf(x)','select(eq(x,y),dedup(cons(y,xs)),cons(x,dedup(cons(y,xs))))']},checksum:{root:'equations(arg1)',rows:['0','plus(x,times(10,checksum(xs)))']},result:'checksum(dedup(quickSort(listOf(5,1,3,5,2,1,4))))'},
  }
  async function audit(c,raw){
    const version=JSON.parse(await savedCode()).version,doc=await compile(raw,version),rows=[]
    expect(same(doc.functions.map(f=>f.name).sort(),[...c.user_functions,'result'].sort()),'missing/duplicate public definitions')
    for(const fn of doc.functions){
      await select(fn.name)
      const def=doc.locations[fn.id]
      expect(await js(`document.querySelector('#code-source-preview mark')?.textContent`)===raw.slice(def.start,def.end),'definition highlight differs')
      const bodies=[{id:fn.id},...fn.equations],allIds=[],allEdges=[]
      for(const [index,b] of bodies.entries()){
        const g=doc.functionBodies[b.id],tree=id=>{
          if(!id)return '_';const n=g[id];if(n.type==='number'||n.type==='boolean')return n.value
          if(n.type==='parameter')return n.label;if(n.type==='ref')return tree(n.target)
          const f=doc.nodes[n.sourceFunctionId];return `${f.sourceEquations?'equations':f.builtin||f.label}(${n.mounted.map(tree).join(',')})`
        }
        const actualTree=tree(g.output.source),wanted=trees[c.id]?.[fn.name]
        if(wanted)expect(actualTree===(typeof wanted==='string'?wanted:index?wanted.rows[index-1]:wanted.root),'independent ordered call tree differs '+fn.name+'/'+index+': '+actualTree)
        for(const n of Object.values(g)){
          const id=n.id==='output'&&index?`${b.id}:output`:n.id;allIds.push(id)
          const loc=doc.locations[n.id==='output'?`${b.id}:output`:n.id],fragment=raw.slice(loc.start,loc.end)
          expect(fragment.length>0&&loc.start>=0&&loc.end<=raw.length,'invalid node range')
          if(n.type==='ref'||n.type==='parameter'&&!fn.equations.length||n.type==='parameter'&&index)expect(fragment===n.label,'binder/ref source mismatch')
          if(n.type==='number')expect(fragment===n.value,'literal source mismatch')
          if(loc.calleeSpan)expect(raw.slice(loc.calleeSpan.start,loc.calleeSpan.end)===n.label,'call-name span mismatch')
          await pointer(`.code-node[data-code-node=${JSON.stringify(id)}] rect`)
          expect(await js(`(()=>{const n=document.querySelector(${JSON.stringify(`.code-node[data-code-node=${JSON.stringify(id)}] rect`)}).getBoundingClientRect(),s=document.querySelector('.code-surface').getBoundingClientRect();return n.bottom>s.top&&n.top<s.bottom})()`),'node selection lost its graph scroll position')
          const mark=await js(`(()=>{const m=document.querySelector('#code-source-preview mark');return {text:m?.textContent,start:Number(m?.dataset.start),end:Number(m?.dataset.end),version:Number(m?.dataset.version)}})()`)
          expect(mark.text===fragment&&mark.start===loc.start&&mark.end===loc.end&&mark.version===version,'node/source UI highlight differs '+id)
          ;(n.mounted||(n.target?[n.target]:n.source?[n.source]:[])).forEach((id,i)=>{if(id){const from=g[id];allEdges.push(`M${from.x+150},${from.y+26} C${from.x+180},${from.y+26} ${n.x-25},${n.y+20+i*12} ${n.x},${n.y+20+i*12}`)}})
        }
        rows.push({function:fn.name,equation:index,tree:actualTree,nodes:Object.keys(g).length})
      }
      const visible=await shape();expect(same(visible.nodes,allIds)&&same(visible.edges,allEdges),'DOM graph edges/nodes differ from model')
      const patterns=fn.equations.flatMap(eq=>eq.patterns)
      for(let i=0;i<patterns.length;i++){
        await js(`document.querySelectorAll('.code-pattern')[${i}].click()`)
        expect(await js(`document.querySelector('#code-source-preview mark')?.textContent`)===patterns[i].text,'pattern selection span differs')
        expect(await js(`!document.querySelector('.code-selected')`),'pattern selection retained an unrelated node highlight')
      }
    }
    return rows
  }
  const selectedCases=process.env.HS_LIST_CASES?.split(',')
  for(const c of manifest.cases.filter(c=>!selectedCases||selectedCases.includes(c.id.slice(0,2)))){
    const raw=readFileSync(new URL(c.file,fixtures),'utf8')
    await checkRow(report.originals,{id:c.id,expected:c.checks[0].expected},async row=>{
      expect((await paste(raw)).state==='ready','original conversion failed')
      row.value=(await evaluate(c.checks[0].expected)).value;row.screenshot=c.id+'-result.png';await shot(row.screenshot)
      row.audit=await audit(c,raw)
      if(c.id.startsWith('07')||c.id.startsWith('08')||c.id.startsWith('09')){await select(c.id.startsWith('07')?'positive':c.id.startsWith('08')?'pipeline':'dedup');row.graphScreenshot=c.id+'-graph.png';await shot(row.graphScreenshot)}
    })
    for(let i=1;i<c.checks.length;i++)await checkRow(report.variants,{id:c.id,expression:c.checks[i].expression,expected:c.checks[i].expected},async row=>{
      const source=raw+'\nprobeValue :: Int\nprobeValue = '+row.expression+'\n'
      expect(source.startsWith(raw),'original source altered')
      expect((await paste(source)).state==='ready','variant conversion failed')
      row.value=(await evaluate(row.expected,'probeValue')).value
      const v=JSON.parse(await savedCode()).version,d=await compile(source,v),fn=d.functions.find(f=>f.name==='probeValue'),body=d.functionBodies[fn.id],root=body[body.output.source]
      await pointer(`.code-node[data-code-node=${JSON.stringify(root.id)}] rect`)
      expect(await js(`document.querySelector('#code-source-preview mark')?.textContent`)===row.expression,'variant original range differs')
    })
  }
  const extras=[
    ['Int list','result :: [Int]\nresult = [-2,0,2,-2]','[-2,0,2,-2]'],
    ['Bool list','result :: [Bool]\nresult = map (< 2) [1,2,3]','[True,False,False]'],
    ['empty foldl','result :: Int\nresult = foldl (+) 7 []','7'],
    ['lazy foldl','step :: Int -> Int -> Int\nstep acc x = if x == 2 then 8 else div 1 0\nresult :: Int\nresult = foldl step 0 [1,2]','8'],
    ['overlapping equations','f :: [Int] -> Int\nf _ = 8\nf [] = 0\nf (x:xs) = div 1 0\nresult :: Int\nresult = f [1,2]','8'],
    ['unused list element','second :: [Int] -> Int\nsecond (_:y:xs) = y\nresult :: Int\nresult = second [div 1 0,9]','9'],
    ['capture isolation','sumL :: [Int] -> Int\nsumL [] = 0\nsumL (x:xs) = x + sumL xs\noffset :: Int -> Int -> Int\noffset a x = a + x\nresult :: Int\nresult = sumL (map (offset 2) [1,2]) + sumL (map (offset 9) [1,2])','28'],
  ]
  for(const [name,raw,expected] of extras)await checkRow(report.extras,{name},async row=>{
    expect((await paste(raw)).state==='ready','conversion failed');row.value=(await evaluate(expected)).value
    if(name==='Bool list'){row.screenshot='bool-list.png';await shot(row.screenshot)}
    if(name==='overlapping equations'){
      const trace=await js(`document.querySelector('.code-equation-trace')?.textContent||''`)
      expect(trace.includes('f · 방정식 1: 1개 호출')&&!trace.includes('방정식 2')&&!trace.includes('방정식 3'),'equation summary differs from actual trace')
    }
  })
  await checkRow(report.extras,{name:'preview bound avoids later error'},async row=>{
    await paste('result :: [Int]\nresult = ['+Array(100).fill('1').join(',')+',div 1 0]');await select('result');await click('#run')
    for(let i=0;i<120&&!(await js(`!!document.querySelector('.code-result')`));i++)await sleep(50)
    expect(await js(`document.querySelector('.code-result')?.dataset.truncated==='true'&&document.querySelector('.code-result').textContent.includes('표시 일부 생략')`),'bounded preview or omission notice missing')
    expect(await js(`!document.querySelector('.code-result').textContent.includes('zero')`),'omitted element evaluated')
    await click('#code-stop-playback');await shot('bounded-list-preview.png')
  })
  await checkRow(report.extras,{name:'total preview budget avoids recursive tail'},async()=>{
    const xs='['+Array(100).fill('1').join(',')+']'
    await paste('loop :: [[Int]]\nloop = loop\nresult :: [[Int]]\nresult = ['+xs+','+xs+','+xs+'] ++ loop')
    await select('result');await click('#run')
    for(let i=0;i<120&&!(await js(`!!document.querySelector('.code-result')`));i++)await sleep(50)
    expect(await js(`document.querySelector('.code-result')?.dataset.result!=='error'&&document.querySelector('.code-result')?.dataset.truncated==='true'`),'display demanded the unnecessary recursive tail')
    await click('#code-stop-playback')
  })
  await checkRow(report.extras,{name:'type failures and out-of-scope 10 preserve documents/storage and recover'},async row=>{
    await paste('result :: Int\nresult = 6 * 7');await evaluate('42')
    const before=await savedCode(),project=await allStorage(),graph=await shape(),bad=[
      'result :: [Int]\nresult = [1,True]',
      'result :: [Int]\nresult = filter abs [1,2]',
      'result :: [Int]\nresult = map True [1]',
      'result :: Bool\nresult = foldl (+) True [1]',
      readFileSync(new URL(manifest.unsupportedCases[0].file,fixtures),'utf8'),
    ];row.diagnostics=[]
    for(const raw of bad){const r=await paste(raw);expect(r.state==='error'&&/\d+행 \d+열/.test(r.message),'missing located diagnostic');row.diagnostics.push(r.message);expect(await savedCode()===before&&same(await allStorage(),project)&&same(await shape(),graph),'failed conversion changed successful document/store');expect(await js(`document.querySelector('#run').disabled&&!document.querySelector('.code-result')&&!document.querySelector('#code-source-preview mark')`),'old result/highlight remains')}
    await shot('unsupported-10.png');await paste('result :: Int\nresult = 6 * 7');await evaluate('42')
  })
  await checkRow(report.extras,{name:'pattern mismatch error and correction'},async row=>{
    await paste('headL :: [Int] -> Int\nheadL (x:xs) = x\nresult :: Int\nresult = headL []');await select('result');await click('#run');await waitResult('error')
    expect(await js(`document.querySelector('.code-result').textContent.includes('headL')&&document.querySelector('.code-result').textContent.includes('패턴')`),'pattern failure not identified')
    expect(await js(`!!document.querySelector('#code-source-preview mark')`),'pattern error source missing');await shot('pattern-mismatch.png')
    expect(await js(`document.querySelector('.code-result').textContent.includes('호출:')`),'pattern error has no call location')
    await js(`[...document.querySelectorAll('.code-inspector button')].find(b=>b.textContent==='오류가 전달된 호출 위치').click()`)
    expect(await js(`document.querySelector('#code-source-preview mark')?.textContent==='headL []'`),'error call-site navigation points to the wrong source')
    await paste('result :: Int\nresult = 42');await evaluate('42')
  })
  await checkRow(report.extras,{name:'rerun/edit/mode cancellation and restore clear transient state'},async row=>{
    await paste('result :: [Int]\nresult = map abs [-2,0,2]');await js(`document.querySelector('#run').click();document.querySelector('#code-stop').click()`);await sleep(200)
    expect(await js(`document.querySelector('.code-result')?.textContent.includes('사용자가 계산을 중단')`),'actual calculation stop failed')
    await click('#run');await select('result');await sleep(200);expect(await js(`!document.querySelector('.code-result')&&!document.querySelector('.code-node[data-state="done"]')`),'stale worker message after target selection')
    await click('#run');await click('#manual-tab');await sleep(300);await click('#code-tab');expect(await js(`!document.querySelector('.code-result')`),'stale worker message after mode change')
    await evaluate('[2,0,2]');const stored=await savedCode();await send('Page.reload');await sleep(800);await click('#code-tab')
    expect(await savedCode()===stored&&same(await allStorage(),manualBaseline),'reload changed stored project/source')
    expect(await js(`!document.querySelector('.code-result')&&!document.querySelector('#code-source-preview mark')&&!document.querySelector('.code-node[data-state="done"]')`),'transient result restored')
  })
  report.complete=true;saveReport();expect(!errors.length,errors.join('\n'));console.log('Totals',report.originals.filter(r=>r.pass).length,'originals',report.variants.filter(r=>r.pass).length,'variants',report.extras.filter(r=>r.pass).length,'extras');process.exitCode=failures?1:0
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  try { ws?.close() } catch {}
  chrome.kill(); vite.kill()
  await sleep(500)
  // Only this test's mkdtemp directory is removed, never a real browser profile.
  if (profile.startsWith(join(tmpdir(), 'hs-list-e2e-'))) try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
