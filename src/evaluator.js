// Graph evaluator. Knows the same node/functionBodies data model as
// inferGraph.js and gives it the matching runtime meaning:
//
// - A function node's value is its callee applied to its *applied* slots —
//   a mounted node, or an inline literal (see literals.js) — with the
//   remaining slots left open as a closure. This is exactly the type
//   inferGraph assigns it (valueTypeOfEntry folds only the open slots).
// - Evaluation is lazy (call-by-need): arguments are thunks, forced only
//   when a builtin actually needs them, so `select`/`ifThenElse` evaluate
//   only the branch they take and a recursive custom function with a base
//   case terminates.
// - Runtime values are numbers, booleans and closures. A closure is plain
//   data once forced (`run` returns it that way), so a partial application
//   can be stored on a curried node and survive save/load.
import { parseLiteral } from './literals.js'

export class EvalError extends Error {}

const MAX_STEPS = 1_000_000

class Thunk {
  constructor(compute) {
    this.compute = compute
    this.done = false
    this.running = false
    this.value = undefined
  }
}
const delay = (compute) => new Thunk(compute)
const now = (value) => Object.assign(new Thunk(null), { done: true, value })

function forceOne(t) {
  if (t.done) return t.value
  if (t.running) throw new EvalError('A value depends on itself (infinite loop)')
  t.running = true
  try {
    t.value = t.compute()
    t.done = true
    t.compute = null
  } finally {
    t.running = false
  }
  return t.value
}

export function force(v) {
  while (v instanceof Thunk) v = forceOne(v)
  return v
}

export function isClosure(v) {
  return v !== null && typeof v === 'object' && v.kind === 'closure'
}

function show(v) {
  return isClosure(v) ? `ƒ ${v.callee}` : String(v)
}

/** Fully force a value into JSON-safe data (closure args included). */
function serializeValue(v) {
  v = force(v)
  if (!isClosure(v)) return v
  return { kind: 'closure', callee: v.callee, args: v.args.map((a) => (a === null ? null : serializeValue(a))) }
}

/** Turn stored closure data back into a runtime closure. */
function reviveValue(v) {
  if (!isClosure(v)) return v
  return { kind: 'closure', callee: v.callee, args: v.args.map((a) => (a === null ? null : now(reviveValue(a)))) }
}

const num = (t) => {
  const v = force(t)
  if (typeof v !== 'number') throw new EvalError(`Expected a number, got ${show(v)}`)
  return v
}
const bool = (t) => {
  const v = force(t)
  if (typeof v !== 'boolean') throw new EvalError(`Expected a Bool, got ${show(v)}`)
  return v
}
const comparable = (t) => {
  const v = force(t)
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0 // Ord Bool: False < True
  throw new EvalError(`Cannot compare ${show(v)}`)
}

/** Haskell's `round`: halves go to the even neighbour. */
function roundHalfEven(x) {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/**
 * `registry` is `{ nodes, functionBodies }` (main.js's live objects): `nodes`
 * holds every function definition, `functionBodies` every custom body.
 */
export function createEvaluator(registry) {
  let steps = 0

  // [arity, implementation]. Implementations receive argument thunks and
  // force only what they need. The first seven are the protected builtins
  // (CLAUDE.md) — same results as their original implementations.
  const builtins = {
    succ: [1, (n) => num(n) + 1],
    zero: [0, () => 0],
    identity: [1, (x) => force(x)],
    apply: [2, (f, x) => applyValue(f, [x])],
    compose: [3, (f, g, x) => applyValue(f, [delay(() => applyValue(g, [x]))])],
    isZero: [1, (n) => num(n) === 0],
    ifThenElse: [3, (c, a, b) => (bool(c) ? force(a) : force(b))],

    plus: [2, (x, y) => num(x) + num(y)],
    negate: [1, (x) => -num(x)],
    minus: [2, (x, y) => num(x) - num(y)],
    times: [2, (x, y) => num(x) * num(y)],
    addZero: [0, () => 0],
    mulOne: [0, () => 1],
    divide: [2, (x, y) => num(x) / num(y)],
    sqrt: [1, (x) => Math.sqrt(num(x))],
    toRational: [1, (x) => num(x)], // no distinct runtime numeric representations — type-level only
    fromIntegral: [1, (x) => num(x)],
    round: [1, (x) => roundHalfEven(num(x))],
    isNaN: [1, (x) => Number.isNaN(num(x))],
    geq: [2, (x, y) => comparable(x) >= comparable(y)],
    eq: [2, (x, y) => comparable(x) === comparable(y)],
    select: [3, (c, a, b) => (bool(c) ? force(a) : force(b))],
  }

  function definition(callee) {
    const def = registry.nodes[callee]
    if (!def) throw new EvalError(`Unknown function: ${callee}`)
    return def
  }

  function arityOf(callee) {
    const def = definition(callee)
    if (def.builtin) {
      const impl = builtins[def.builtin]
      if (!impl) throw new EvalError(`${def.label}: no runtime implementation`)
      return impl[0]
    }
    const body = registry.functionBodies[callee]
    return body ? Object.values(body).filter((n) => n.type === 'parameter').length : 0
  }

  function call(callee, args) {
    if (++steps > MAX_STEPS) throw new EvalError('Evaluation took too many steps (infinite recursion?)')
    const def = definition(callee)
    if (def.builtin) return builtins[def.builtin][1](...args)
    const body = registry.functionBodies[callee]
    const output = body?.output
    if (!output?.source || !body[output.source]) throw new EvalError(`${def.label}: Output is not connected`)
    return force(nodeValue(body, output.source, { args, memo: new Map() }))
  }

  /** Apply a function value to argument thunks, filling its open slots left to right. */
  function applyValue(fn, argThunks) {
    let v = fn
    for (const arg of argThunks) {
      v = force(v)
      if (!isClosure(v)) throw new EvalError(`Cannot apply ${show(v)} — it is not a function`)
      const args = v.args.slice()
      args[args.indexOf(null)] = arg
      v = args.includes(null) ? { kind: 'closure', callee: v.callee, args } : call(v.callee, args)
    }
    return force(v)
  }

  /** A node's value as a memoized thunk, within one call frame (`env`). */
  function nodeValue(graph, id, env) {
    if (env.memo.has(id)) return env.memo.get(id)
    const t = delay(() => computeNode(graph, id, env))
    env.memo.set(id, t)
    return t
  }

  function computeNode(graph, id, env) {
    const node = graph[id]
    if (!node) throw new EvalError(`Missing node: ${id}`)
    if (node.type === 'number') {
      const text = String(node.value ?? '').trim()
      const value = Number(text)
      if (text === '' || (Number.isNaN(value) && text !== 'NaN')) throw new EvalError(`${node.label}: "${node.value}" is not a number`)
      return value
    }
    if (node.type === 'boolean') return node.value === 'true'
    if (node.type === 'ref') {
      if (!graph[node.target]) throw new EvalError(`${node.label}: the original node is gone`)
      return force(nodeValue(graph, node.target, env)) // shares the target's thunk: evaluated once
    }
    if (node.type === 'parameter') {
      if (!env.args) throw new EvalError(`Parameter ${node.label} only has a value inside a call`)
      const index = Object.values(graph).filter((n) => n.type === 'parameter').findIndex((n) => n.id === id)
      const arg = env.args[index]
      if (!arg) throw new EvalError(`Parameter ${node.label} has no argument`)
      return force(arg)
    }
    if (node.type === 'output') {
      if (!node.source || !graph[node.source]) throw new EvalError('Output is not connected')
      return force(nodeValue(graph, node.source, env))
    }
    if (node.type === 'curried') {
      if (!isClosure(node.closure)) throw new EvalError(`${node.label}: no stored partial application — Play the function again`)
      return reviveValue(node.closure)
    }
    if (node.type === 'function') return functionNodeValue(graph, node, env)
    throw new EvalError(`${node.label || id}: cannot evaluate a ${node.type} node`)
  }

  function functionNodeValue(graph, node, env) {
    const callee = node.sourceFunctionId || node.id
    const arity = arityOf(callee)
    const args = Array(arity).fill(null)
    ;(node.params || []).forEach((text, i) => {
      const mountedId = node.mounted?.[i]
      let arg = null
      if (mountedId && graph[mountedId]) arg = nodeValue(graph, mountedId, env)
      else {
        const lit = parseLiteral(text)
        if (lit) arg = now(lit.value)
      }
      if (!arg) return
      if (i >= arity) throw new EvalError(`${node.label}: slot ${i + 1} has no matching parameter`)
      args[i] = arg
    })
    return args.includes(null) ? { kind: 'closure', callee, args } : call(callee, args)
  }

  return {
    /** Evaluate node `nodeId` of `graph` to JSON-safe data: a number, a boolean, or a closure. */
    run(graph, nodeId) {
      steps = 0
      try {
        return serializeValue(nodeValue(graph, nodeId, { args: null, memo: new Map() }))
      } catch (e) {
        if (e instanceof RangeError) throw new EvalError('Recursion too deep')
        throw e
      }
    },
  }
}
