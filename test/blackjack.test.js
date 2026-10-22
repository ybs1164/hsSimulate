// The blackjack template: a game of lists. It must type-check as a
// Program, deal a shuffled 52-card deck, and play rounds to a result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBlackjack } from '../src/examples/blackjack.js'
import { showValue } from '../src/evaluator.js'
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { createGame } from '../src/runtime.js'
import { derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { showType } from '../src/typeSystem.js'

// The registry the app would build for the loaded template.
function registryOf(project) {
  const used = new Set(Object.values(project.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
  return {
    ...Object.fromEntries([...used].filter((id) => !project.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, type: 'function', builtin: id.replace('prelude:', ''), label: id }])),
    ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])),
    ...project.nodes,
  }
}

function start() {
  const project = buildBlackjack()
  const nodes = registryOf(project)
  const ev = createEvaluator({ nodes, functionBodies: project.functionBodies, types: project.types })
  const game = createGame(ev, ev.run(nodes, 'main'))
  const widgets = () => {
    const out = []
    const walk = (w) => { out.push(w); (w.children || []).forEach(walk) }
    walk(game.view())
    return out
  }
  const texts = () => widgets().filter((w) => w.kind === 'text').map((w) => w.text)
  const press = (label) => game.dispatch(widgets().find((w) => w.kind === 'button' && w.label === label).msg)
  return { project, nodes, ev, game, texts, press }
}
const handScore = (line) => Number(line.match(/\((\d+)\)$/)?.[1])

test('blackjack type-checks as Program Model Msg', () => {
  const { project, nodes } = start()
  setDynamicInstances(derivedInstances(project.types))
  try {
    const pass = inferGraph(nodes, project.functionBodies, project.nodes)
    assert.equal(showType(valueTypeOfEntry(pass.perNode.get('main'))), 'Program Model Msg')
    assert.equal(showType(valueTypeOfEntry(pass.perNode.get('shuffle'))), 'StdGen → [a] → [a]')
    assert.doesNotThrow(() => reduce(pass.preds))
  } finally {
    setDynamicInstances([])
  }
})

test('a round deals two cards each from a shuffled 52-card deck, the dealer showing one', () => {
  const { game, texts } = start()
  const m = game.model
  const [deck, player, dealer] = m.args.slice(0, 3).map((t) => JSON.parse(showValue(t.value ?? t)))
  assert.equal(deck.length, 48)
  assert.equal(player.length, 2)
  assert.equal(dealer.length, 2)
  const all = [...deck, ...player, ...dealer].sort((a, b) => a - b)
  assert.deepEqual(all, Array.from({ length: 13 }, (_, i) => i + 1).flatMap((r) => [r, r, r, r]))
  assert.notDeepEqual(all, [...deck, ...player, ...dealer], 'shuffled')
  const [dealerLine, playerLine, status] = texts()
  assert.match(dealerLine, /^Dealer: (A|[2-9]|10|J|Q|K) \?$/)
  assert.match(playerLine, /^You: \S+ \S+ \(\d+\)$/)
  assert.equal(status, 'Hit or stand?')
})

test('rounds play to a result and are tallied; Deal starts the next', () => {
  const { texts, press } = start()
  let tallied = 0
  for (let round = 0; round < 8; round++) {
    // Hit below 15, then stand.
    for (let i = 0; i < 10 && texts()[2] === 'Hit or stand?' && handScore(texts()[1]) < 15; i++) press('Hit')
    if (texts()[2] === 'Hit or stand?') press('Stand')
    const [dealerLine, playerLine, status, tally] = texts()
    assert.notEqual(status, 'Hit or stand?')
    const p = handScore(playerLine)
    const d = handScore(dealerLine)
    if (p > 21) assert.equal(status, 'You lose.')
    else {
      assert.ok(d >= 17, dealerLine)
      assert.equal(status, d > 21 || p > d ? 'You win!' : p === d ? 'Push — a tie.' : 'You lose.', `${playerLine} / ${dealerLine}`)
    }
    // Hit and Stand do nothing once the round is over.
    press('Hit')
    assert.equal(texts()[1], playerLine)
    const [w, l] = tally.match(/\d+/g).map(Number)
    tallied = w + l
    press('Deal')
    assert.equal(texts()[2], 'Hit or stand?')
  }
  assert.ok(tallied >= 1)
})

test('score counts an Ace as 11 when that fits', () => {
  const { ev, nodes } = start()
  const scoreOf = (cards) => ev.run({ ...nodes, h: { id: 'h', type: 'function', sourceFunctionId: 'prelude:listOf', params: cards.map(String), mounted: cards.map(() => null) }, s: { id: 's', type: 'function', sourceFunctionId: 'score', params: [''], mounted: ['h'] } }, 's')
  assert.equal(scoreOf([1, 13]), 21)
  assert.equal(scoreOf([1, 1, 9]), 21)
  assert.equal(scoreOf([1, 10, 5]), 16)
  assert.equal(scoreOf([12, 11, 2]), 22)
})
