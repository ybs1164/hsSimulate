import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBlankGame } from '../src/examples/blankGame.js'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { buildDice } from '../src/examples/dice.js'
import { createEvaluator } from '../src/evaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { createGame } from '../src/runtime.js'
import { derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { showType } from '../src/typeSystem.js'

// The registry the app would build for a loaded template.
function registryOf(project) {
  const used = new Set(Object.values(project.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
  return {
    ...Object.fromEntries([...used].filter((id) => !project.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, type: 'function', builtin: id.replace('prelude:', ''), label: id }])),
    compose: { id: 'compose', builtin: 'compose' },
    ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])),
    ...project.nodes,
  }
}

for (const [name, build, firstButton, after] of [['click counter', buildClickCounter, 'Click!', 'Clicks: 3'], ['blank game', buildBlankGame, '+1', 'Count: 3'], ['dice', buildDice, 'Roll', null]]) {
  test(`${name}: plays and type-checks as Program Model Msg`, () => {
    const project = build()
    const nodes = registryOf(project)
    const ev = createEvaluator({ nodes, functionBodies: project.functionBodies, types: project.types })
    const game = createGame(ev, ev.run(nodes, 'main'))
    const buttons = []
    const walk = (w) => { if (w.kind === 'button') buttons.push(w); (w.children || []).forEach(walk) }
    walk(game.view())
    const button = buttons.find((b) => b.label === firstButton)
    for (let i = 0; i < 3; i++) game.dispatch(button.msg)
    walk(game.view())
    const texts = []
    const collect = (w) => { if (w.kind === 'text') texts.push(w.text); (w.children || []).forEach(collect) }
    collect(game.view())
    if (after) assert.ok(texts.includes(after), texts.join(' | '))
    else assert.ok(texts.some((t) => /^You rolled [1-6]$/.test(t)), texts.join(' | '))
    game.tick(1)
    setDynamicInstances(derivedInstances(project.types))
    try {
      const pass = inferGraph(nodes, project.functionBodies, project.nodes)
      assert.equal(showType(valueTypeOfEntry(pass.perNode.get('main'))), 'Program Model Msg')
      assert.doesNotThrow(() => reduce(pass.preds))
    } finally {
      setDynamicInstances([])
    }
  })
}
