import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { BundleError, bundleModules, buildPlayerHtml, PLAYER_MODULES } from '../src/exportHtml.js'
import { derivedDefinitions } from '../src/typeDecls.js'

const sources = Object.fromEntries(PLAYER_MODULES.map((name) => [name, readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')]))
const loadBundle = (code) => new Function(`${code}\nreturn __m`)()

// The flattened project an export carries: every definition the game needs.
const example = buildClickCounter()
const usedIds = new Set(Object.values(example.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
const definitions = {
  ...Object.fromEntries([...usedIds].filter((id) => !example.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, type: 'function', builtin: id.replace('prelude:', ''), label: id }])),
  compose: { id: 'compose', builtin: 'compose' },
  ...Object.fromEntries(derivedDefinitions(example.types).map((d) => [d.id, d])),
  ...example.nodes,
}
const data = { title: 'Click Counter', definitions, functionBodies: example.functionBodies, types: example.types, entry: 'main', exactTime: true }

test('the bundled player modules run the exported game exactly like the editor does', () => {
  const m = loadBundle(bundleModules(sources))
  assert.deepEqual(Object.keys(m), PLAYER_MODULES)
  const ev = m.evaluator.createEvaluator({ nodes: definitions, functionBodies: example.functionBodies, types: example.types })
  const game = m.runtime.createGame(ev, ev.run(definitions, 'main'), { exactTime: true })
  const click = game.view().children[3].msg
  for (let i = 0; i < 5; i++) game.dispatch(click)
  assert.equal(game.view().children[0].text, 'Clicks: 5')
  assert.equal(typeof m.player.startPlayer, 'function')
})

test('the page embeds the project as JSON that survives a closing script tag in strings', () => {
  const tricky = { ...data, title: 'a </script> b' }
  const html = buildPlayerHtml(tricky, sources)
  const json = html.match(/<script id="game-data" type="application\/json">([^<]*)<\/script>/)[1]
  assert.deepEqual(JSON.parse(json), tricky)
  assert.ok(!html.includes('a </script> b'), 'the title is escaped in <title> and the JSON')
})

test('unsupported module syntax is reported, not silently mis-bundled', () => {
  assert.throws(() => bundleModules({ ...sources, literals: "export default function f() {}\n" }), BundleError)
  assert.throws(() => bundleModules({ ...sources, runtime: undefined }), BundleError)
})
