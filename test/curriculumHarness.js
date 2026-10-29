// Plays a template project headlessly, as the app would: the registry of
// builtins/derived definitions it uses, a typed evaluator and the game runtime.
import { createTypedEvaluator as createEvaluator } from '../src/typedEvaluator.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { reduce, setDynamicInstances } from '../src/prelude.js'
import { createGame } from '../src/runtime.js'
import { derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { showType } from '../src/typeSystem.js'
import { preludeTypeDefs } from '../src/library.js'

export function registryOf(project) {
  const used = new Set(Object.values(project.functionBodies).flatMap((b) => Object.values(b)).map((x) => x.sourceFunctionId).filter(Boolean))
  return {
    ...Object.fromEntries([...used].filter((id) => !project.nodes[id] && !id.startsWith('type:')).map((id) => [id, { id, type: 'function', builtin: id.replace('prelude:', ''), label: id }])),
    ...preludeTypeDefs,
    ...Object.fromEntries(derivedDefinitions(project.types).map((d) => [d.id, d])),
    ...project.nodes,
  }
}

export function play(build) {
  const project = build()
  const nodes = registryOf(project)
  const ev = createEvaluator({ nodes, functionBodies: project.functionBodies, types: project.types })
  const game = createGame(ev, ev.run(nodes, 'main'))
  const widgets = () => {
    const out = []
    const walk = (w) => { out.push(w); (w.children || []).forEach(walk); if (w.child) walk(w.child) }
    walk(game.view())
    return out
  }
  const texts = () => widgets().filter((w) => w.kind === 'text').map((w) => w.text)
  const press = (label) => {
    const b = widgets().find((w) => w.kind === 'button' && w.label === label)
    if (!b) throw new Error(`no button ${label}: ${widgets().filter((w) => w.kind === 'button').map((w) => w.label)}`)
    game.dispatch(b.msg)
  }
  return { project, nodes, ev, game, widgets, texts, press }
}

/** The entry's type, with the project's derived instances in scope; throws if a constraint is left unsolved. */
export function entryType(build, name = 'main') {
  const project = build()
  const nodes = registryOf(project)
  setDynamicInstances(derivedInstances(project.types))
  try {
    const pass = inferGraph(nodes, project.functionBodies, project.nodes)
    reduce(pass.preds)
    const errors = [...pass.perNode.entries()].filter(([, e]) => e.error || e.invalidSlots?.length).map(([id, e]) => `${id}: ${e.error || 'invalid slots ' + e.invalidSlots}`)
    return { type: showType(valueTypeOfEntry(pass.perNode.get(name))), errors, pass }
  } finally {
    setDynamicInstances([])
  }
}
