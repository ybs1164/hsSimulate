// An evaluator that types what it runs itself. The evaluator (evaluator.js)
// passes dictionaries the type pass chose — main.js hands it the editor's
// cached elaboration, an exported game carries one. Anything else (tests, a
// script) gets it from here: each run is typed first (inferGraph.js), with
// the declared types', classes' and hand-written instances in scope, and the
// instance table built (instanceTable.js).
import { createEvaluator, elaborationIndex, EvalError } from './evaluator.js'
import { inferGraph } from './inferGraph.js'
import { derivedInstances } from './typeDecls.js'
import { classEnvironment, declareClasses, instanceEvidence } from './classDecls.js'
import { listDynamicInstances, withDynamicClasses, withDynamicInstances } from './prelude.js'

/**
 * The elaboration of running `graph` (or, for null, of applying any
 * function) in `registry` = `{ nodes, functionBodies, types, classes,
 * instances }` (the project's; `resolvedClasses` instead of classes and
 * instances if they're resolved already). Every custom function is typed,
 * through a probe call to each.
 */
export function elaborate(registry, graph = null) {
  const { nodes, functionBodies = {}, types = {} } = registry
  const resolved = registry.resolvedClasses ?? declareClasses(registry.classes || {}, types, [], registry.instances || {})
  const env = classEnvironment(resolved)
  const ours = [...derivedInstances(types), ...env.instances]
  const keys = new Set(ours.map((i) => i.key))
  const inScope = [...listDynamicInstances().filter((i) => !keys.has(i.key)), ...ours]
  const run = () => withDynamicInstances(inScope, () => {
    const probes = Object.fromEntries(Object.keys(functionBodies).filter((id) => nodes[id]).map((id) => [`probe:${id}`, { id: `probe:${id}`, type: 'function', sourceFunctionId: id, params: [], mounted: [] }]))
    const main = graph || {}
    const pass = inferGraph(nodes, functionBodies, { ...main, ...probes })
    if (graph && Object.values(graph).some((n) => n.match) && pass.brokenEdges.length) throw new EvalError('패턴 매칭 분기의 타입이나 연결을 확인하세요')
    if (graph) {
      const reachable = new Set(), visit = (body) => {
        for (const n of Object.values(body)) {
          const id = n.sourceFunctionId || n.id
          if (n.type !== 'function' || reachable.has(id) || !functionBodies[id]) continue
          reachable.add(id); visit(functionBodies[id])
        }
      }
      visit(graph)
      for (const id of reachable) if (nodes[id]?.matchBranch || Object.values(functionBodies[id]).some((n) => n.match)) {
        const broken = pass.brokenFunctions[id]?.[0]
        if (broken) throw new EvalError(broken.message || `${nodes[id]?.label || id}: 패턴 매칭 분기의 타입이 맞지 않습니다`)
      }
    }
    const instances = instanceEvidence(resolved, (fnId) => pass.schemes.get(fnId))
    return elaborationIndex({ ...pass.elaboration, instances }, main, functionBodies)
  })
  return resolved.length ? withDynamicClasses(env.classes, run) : run()
}

/** createEvaluator, typing each run itself (see elaborate). */
export function createTypedEvaluator(registry) {
  let whole = null // applying values: every function typed once
  return createEvaluator({
    ...registry,
    get types() { return registry.types },
    elaboration: (graph) => (graph ? elaborate(registry, graph) : (whole ??= elaborate(registry))),
  })
}
