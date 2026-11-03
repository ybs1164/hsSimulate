import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileSource, compileSourceFiles, evaluateSource } from '../src/sourceGraph.js'
import { readSelectedSourceFiles } from '../src/sourceFiles.js'
import { SourceDocument } from '../src/sourceDocument.js'

const file = (name, source) => ({ id: 'file:' + name, name, source })
const fixture = name => file(name, readFileSync(new URL('./fixtures/source-modules/' + name, import.meta.url), 'utf8'))
const math = fixture('MathOps.hs'), example = fixture('Example.hs')
const value = (doc, mod) => evaluateSource(doc, doc.functions.find(fn => fn.moduleName === mod && fn.name === 'result').id)
const sourceAt = (doc, span) => doc.files.find(file => file.id === span.fileId).source.slice(span.start, span.end)
const exampleOf = (imports, expr, sig = 'Int') => file('Example.hs', `module Example where\n${imports}\nresult :: ${sig}\nresult = ${expr}`)

test('qualified modules keep exact definition and call locations in the same version', () => {
  for (const [literal, expected] of [['20',42],['0',2],['(-3)',-4]]) {
    const doc = compileSourceFiles([file(example.name, example.source.replace('twice 20', 'twice ' + literal)), math], 4)
    const run = value(doc, 'Example')
    assert.equal(run.value, expected)
    const call = run.debug.steps.find(e => e.kind === 'enter' && doc.nodes[e.functionId].label === 'MathOps.twice')
    assert.equal(sourceAt(doc, call.span), 'twice x = x * 2')
    assert.equal(sourceAt(doc, call.site.span), 'M.twice ' + literal)
    assert.equal(call.span.fileId, math.id)
    assert.equal(call.site.span.fileId, example.id)
    assert.equal(call.span.version, 4)
    assert.equal(call.site.span.version, 4)
    assert.doesNotThrow(() => structuredClone(run.debug))
  }
})

test('three modules, file order, recursive private helper, higher-order partial application and an unused list tail', () => {
  const series = fixture('Series.hs'), app = fixture('SeriesExample.hs')
  for (const order of [[app, series, math], [math, app, series]]) {
    const doc = compileSourceFiles(order), run = value(doc, 'SeriesExample')
    assert.equal(run.value, 12)
    const calls = run.debug.steps.filter(e => e.kind === 'enter').map(e => doc.nodes[e.functionId].label)
    assert.equal(calls.filter(name => name === 'MathOps.add').length, 2)
    assert.equal(calls.filter(name => name === 'Series.total').length, 3)
    assert.ok(!calls.includes('SeriesExample.loop'))
  }
})

test('plain, selective, qualified and aliased imports have separate namespaces', () => {
  for (const [imports, expr] of [
    ['import MathOps', 'add (MathOps.twice 20) 2'],
    ['import MathOps (twice)\nimport qualified MathOps (add)', 'MathOps.add (twice 20) 2'],
    ['import qualified MathOps as M (twice, add)', 'M.add (M.twice 20) 2'],
    ['import qualified MathOps (add)\nimport MathOps (twice)', 'MathOps.add (twice 20) 2'],
  ]) assert.equal(value(compileSourceFiles([math, exampleOf(imports, expr)]), 'Example').value, 42)
  const a = file('A.hs', 'module A where\nf :: Int\nf = 1')
  const b = file('B.hs', 'module B where\nf :: Int\nf = 2')
  const doc = compileSourceFiles([a,b,exampleOf('import qualified A\nimport qualified B', 'A.f + B.f')])
  const run = value(doc, 'Example')
  assert.equal(run.value, 3)
  const sourceCalls = run.debug.steps.filter(e => e.kind === 'enter' && e.site?.functionId)
  assert.deepEqual(sourceCalls.map(e => doc.nodes[e.functionId].label), ['A.f','B.f'])
  assert.throws(() => compileSourceFiles([a,b,exampleOf('import A\nimport B', 'f')]), /모호.*A\.f, B\.f/)
  assert.equal(value(compileSourceFiles([a,b,exampleOf('import A\nimport B', '4')]), 'Example').value, 4)
})

test('unavailable modules and names, duplicate modules, cycles, unsupported imports and imported type errors have file locations', () => {
  const series = fixture('Series.hs')
  const errors = [
    [[example], 'dependency', 'Example.hs', /MathOps/],
    [[math, file('Copy.hs', math.source)], 'names', 'Copy.hs', /중복/],
    [[file('A.hs','module A where\nimport B\na :: Int\na = 1'),file('B.hs','module B where\nimport A\nb :: Int\nb = 2')], 'dependency', 'B.hs', /A → B → A/],
    [[math,series,exampleOf('import qualified Series', 'Series.total []')], 'names', 'Example.hs', /정의되지.*Series.total/],
    [[math,series,exampleOf('import Series (total)', '1')], 'names', 'Example.hs', /공개하지/],
    [[math,exampleOf('import MathOps (twice)', 'add 1 2')], 'names', 'Example.hs', /정의되지.*add/],
    [[math,exampleOf('import qualified MathOps as M', 'M.twice True')], 'types', 'Example.hs', /Int.*Bool/],
    [[exampleOf('import Prelude', '1')], 'support', 'Example.hs', /Prelude.*지원하지/],
    [[exampleOf('import Other hiding (x)', '1')], 'syntax', 'Example.hs', /hiding/],
    [[file('Bad.hs','module Bad (missing) where\nf :: Int\nf = 1')], 'names', 'Bad.hs', /export 목록/],
  ]
  for (const [files, stage, filename, pattern] of errors) assert.throws(() => compileSourceFiles(files), error =>
    error.stage === stage && pattern.test(error.message) && error.message.startsWith(filename) &&
    error.fileId === 'file:' + filename && error.line > 0 && error.column > 0)
})

test('runtime errors point to the failing file and the call site in the importing file', () => {
  const library = file('Bad.hs', 'module Bad where\nbad :: Int -> Int\nbad x = div 1 x')
  const doc = compileSourceFiles([exampleOf('import qualified Bad', 'Bad.bad 0'), library], 3)
  const { error } = value(doc, 'Example')
  assert.equal(error.fileId, library.id)
  assert.equal(sourceAt(doc, error.span), 'div 1 x')
  assert.equal(sourceAt(doc, error.callSpan), 'Bad.bad 0')
  assert.match(error.message, /Bad\.hs.*Example\.hs/)
})

test('UTF-8 file selection handles BOM/CRLF and refuses invalid bytes and duplicate file identities', async () => {
  const data = 'result :: Int\nresult = 42'
  const [loaded] = await readSelectedSourceFiles([new File(['\uFEFF' + data.replaceAll('\n','\r\n')], 'Single.hs')])
  assert.equal(loaded.source, data)
  assert.equal(loaded.moduleName, 'Main')
  assert.equal(value(compileSourceFiles([loaded]), 'Main').value, value(compileSource(data), 'Main').value)
  await assert.rejects(readSelectedSourceFiles([new File([Uint8Array.of(255)], 'Invalid.hs')]), /UTF-8/)
  await assert.rejects(readSelectedSourceFiles([new File([data], 'a.hs'),new File([data], 'a.hs')]), /식별자/)
})

test('file view preserves target and result, saved document restores selections, and failed conversion preserves storage', async () => {
  let saved
  const model = new SourceDocument({ fileMode:true, save: data => { saved = structuredClone(data) } })
  model.replaceFiles([example,math])
  assert.ok(model.convert())
  assert.equal(model.evaluate().value, 42)
  assert.ok(model.viewFile(math.id, true))
  assert.equal(model.evaluate().value, 42)
  assert.equal(model.moduleName, 'Example')
  const restored = new SourceDocument({ fileMode:true })
  assert.ok(restored.restore(saved))
  assert.equal(restored.fileId, math.id)
  assert.equal(restored.selected, model.selected)
  assert.equal(restored.result, null)
  const doc = model.document, before = saved
  let resolveRun
  const pending = model.evaluateWith(() => new Promise(resolve => { resolveRun = resolve }))
  model.removeFile(math.id)
  resolveRun({ value: 42 })
  assert.equal(await pending, null)
  assert.equal(model.convert(), false)
  assert.equal(model.document, doc)
  assert.equal(saved, before)
  assert.equal(model.result, null)
  assert.equal(model.error.stage, 'dependency')
  const unavailable = new SourceDocument({ fileMode:true, save() { throw new Error('quota') } })
  unavailable.replaceFiles([example,math])
  assert.ok(unavailable.convert())
  assert.equal(unavailable.storageError, true)
  assert.equal(unavailable.evaluate().value, 42)
})
