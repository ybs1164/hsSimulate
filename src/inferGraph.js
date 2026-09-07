// Graph-shape-aware inference pass. Knows about this app's node/functionBodies
// data model (unlike typeSystem.js, which is pure type theory); walks a graph's
// `mounted[]`/`output.source` edges as unify constraints.
//
// Design (see plan at .claude/plans — HM 다형성 계획):
// - Nothing is cached on node objects. `inferGraph` is a full recompute, called
//   fresh every draw()/updateInspector(), matching main.js's existing
//   "mutate state, then fully re-derive the view" style. Disconnecting a param
//   simply stops producing that unify constraint next pass — "ungeneralizing"
//   is free, there is no persisted state to roll back.
// - Every function-node *instance* (a canonical builtin in `nodes`, a
//   `call-...` copy, or a custom function's own definition node) is
//   instantiate()'d fresh, once per node id per pass, so two independent
//   uses of e.g. `identity` never share type-variable identity.
// - A custom function's *scheme* is computed once per pass (memoized +
//   cycle-guarded) by walking its body exactly like evaluateFunction does
//   (output.source chains, nested call nodes), then generalize()'d — this is
//   the actual "let-polymorphism" step: infer the body once, close over
//   whatever's left free, then let each call site instantiate it fresh.
import { applySubst, freshVar, ftv, generalize, instantiate, pred, tcon, tfun, unify, scheme } from './typeSystem.js'
import { builtinSchemes } from './builtinSchemes.js'
import { reduce } from './numericClasses.js'

const Int = tcon('Int')
const Bool = tcon('Bool')

/**
 * Turn an entry into a single Type (folds a function entry's params+result
 * into a right-nested arrow). Detected by field presence, not `.kind`, so
 * this works on both the internal `{kind, paramTypes|valueType}` shape used
 * during graph traversal and the external `perNode` shape (which drops `kind`).
 */
export function valueTypeOfEntry(entry) {
  if (!entry) return freshVar()
  if (entry.paramTypes) return entry.paramTypes.reduceRight((acc, t) => tfun(t, acc), entry.resultType)
  return entry.valueType
}

function schemeFor(node, ctx) {
  if (node.builtin) return builtinSchemes[node.builtin]
  return customSchemeOf(node.sourceFunctionId || node.id, ctx)
}

/** The scheme of a custom (or builtin, or missing) top-level function, memoized per pass with a cycle guard. */
function customSchemeOf(id, ctx) {
  if (ctx.customCache.has(id)) return ctx.customCache.get(id)
  const def = ctx.nodesRegistry[id]
  if (!def) return scheme([], [], freshVar())
  if (def.builtin) return builtinSchemes[def.builtin]
  if (ctx.visiting.has(id)) return scheme([], [], freshVar()) // recursive custom function: monomorphic fallback, not cached
  ctx.visiting.add(id)
  const body = ctx.functionBodiesRegistry[id]
  const sch = body ? inferCustomFunctionScheme(body, ctx) : scheme([], [], freshVar())
  ctx.visiting.delete(id)
  ctx.customCache.set(id, sch)
  return sch
}

/** Infer a custom function's own principal type from its body wiring, then generalize. */
function inferCustomFunctionScheme(body, ctx) {
  const memo = new Map()
  const paramNodes = Object.values(body).filter((n) => n.type === 'parameter')
  const paramVars = paramNodes.map(() => freshVar())
  paramNodes.forEach((n, i) => memo.set(n.id, { kind: 'value', valueType: paramVars[i] }))
  const predsStart = ctx.preds.length
  const outputEntry = resolveNodeType('output', body, ctx, memo)
  const resultType = valueTypeOfEntry(outputEntry)
  // Resolve against everything unified so far *before* generalizing — a
  // param that got pinned to Int by usage (e.g. wired into isZero) must show
  // up concrete here, not still-free, or it would be wrongly quantified.
  const resolvedParams = paramVars.map((v) => applySubst(ctx.subst, v))
  const resolvedResult = applySubst(ctx.subst, resultType)
  const curried = resolvedParams.reduceRight((acc, t) => tfun(t, acc), resolvedResult)
  // Claim only the preds *this body's own wiring* contributed (LIFO-safe:
  // any nested customSchemeOf call for another function fully pushes and
  // splices its own slice before this one takes its end-snapshot), resolve
  // them against the current substitution, and reduce — a param wired into
  // `plus` keeps its `Num` obligation here; one wired into `isZero` doesn't
  // (Int already satisfies it, so reduce discharges it). Fall back to the
  // unreduced set defensively rather than let a broken body kill the pass.
  const own = ctx.preds.splice(predsStart).map((p) => pred(p.cls, applySubst(ctx.subst, p.type)))
  let retained
  try {
    retained = reduce(own)
  } catch {
    retained = own
  }
  return generalize(retained, curried)
}

/** Resolve one node's type within `graph`, memoized for this one traversal, recursing through its edges. */
function resolveNodeType(id, graph, ctx, memo) {
  if (memo.has(id)) return memo.get(id)
  const node = graph[id]
  if (!node) return { kind: 'value', valueType: freshVar() }

  if (node.type === 'parameter') {
    const entry = { kind: 'value', valueType: freshVar() }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'number') {
    // A genuine type annotation (like Haskell's `5 :: Double`) resolves
    // outright, no constraint needed. Otherwise this is a numeric literal:
    // `Num a => a` for a plain literal, or `Fractional a => a` if it has a
    // decimal point (matches how a literal with a `.` desugars via
    // fromRational instead of fromInteger).
    if (node.annotation) {
      const entry = { kind: 'value', valueType: tcon(node.annotation) }
      memo.set(id, entry)
      return entry
    }
    const v = freshVar()
    ctx.preds.push(pred(/\./.test(node.value ?? '') ? 'Fractional' : 'Num', v))
    const entry = { kind: 'value', valueType: v }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'boolean') {
    const entry = { kind: 'value', valueType: Bool }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'curried') {
    // Real residual type wired in Phase 4; a fresh var unifies with anything for now.
    const entry = node.resolvedType ? { kind: 'value', valueType: node.resolvedType } : { kind: 'value', valueType: freshVar() }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'output') {
    if (node.source && graph[node.source]) {
      const entry = resolveNodeType(node.source, graph, ctx, memo)
      memo.set(id, entry)
      return entry
    }
    const entry = { kind: 'value', valueType: freshVar() }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'function') {
    const sch = schemeFor(node, ctx)
    const { type: instType, preds: instPreds } = instantiate(sch)
    ctx.preds.push(...instPreds)
    let rest = instType
    const arity = node.params ? node.params.length : 0
    const paramTypes = []
    for (let i = 0; i < arity; i++) {
      if (rest.kind === 'fun') {
        paramTypes.push(rest.from)
        rest = rest.to
      } else {
        paramTypes.push(freshVar()) // defensive: node has more ports than its scheme declares
      }
    }
    const entry = { kind: 'function', paramTypes, resultType: rest }
    memo.set(id, entry) // set before recursing so a stray self-mount can't loop
    ;(node.mounted || []).forEach((mountedId, i) => {
      if (!mountedId || !graph[mountedId]) return
      const argEntry = resolveNodeType(mountedId, graph, ctx, memo)
      try {
        ctx.subst = unify(paramTypes[i], valueTypeOfEntry(argEntry), ctx.subst)
      } catch {
        // Invalid edge — connect-time gating should prevent this; skip defensively rather than blank the canvas.
      }
    })
    return entry
  }
  // Unknown node shape — treat as an opaque value.
  const entry = { kind: 'value', valueType: freshVar() }
  memo.set(id, entry)
  return entry
}

/**
 * Infer types for every node in `activeGraph` (typically the result of
 * main.js's `activeNodes()`), resolving against `nodesRegistry` (main.js's
 * `nodes`, the canonical home of every function *definition*) and
 * `functionBodiesRegistry` (main.js's `functionBodies`) for custom-function
 * schemes reachable from it.
 */
export function inferGraph(nodesRegistry, functionBodiesRegistry, activeGraph) {
  const ctx = { subst: new Map(), customCache: new Map(), visiting: new Set(), nodesRegistry, functionBodiesRegistry, preds: [] }
  const memo = new Map()
  const perNode = new Map()
  Object.keys(activeGraph).forEach((id) => {
    const entry = resolveNodeType(id, activeGraph, ctx, memo)
    perNode.set(
      id,
      entry.kind === 'function'
        ? { paramTypes: entry.paramTypes.map((t) => applySubst(ctx.subst, t)), resultType: applySubst(ctx.subst, entry.resultType) }
        : { valueType: applySubst(ctx.subst, entry.valueType) },
    )
  })
  // Resolve every pending predicate against the final substitution. This is
  // returned raw (pre-reduce) too — main.js's canConnect needs to see every
  // outstanding obligation, not just what survives simplification, to
  // correctly re-check a *candidate* edge that hasn't been unified in yet.
  const resolvedPreds = ctx.preds.map((p) => pred(p.cls, applySubst(ctx.subst, p.type)))
  let reducedPreds
  try {
    reducedPreds = reduce(resolvedPreds)
  } catch {
    // A genuinely-bad predicate slipped through (shouldn't happen if connect-time
    // gating did its job). Don't let one bad node poison every other node's
    // display — fall back to reducing each predicate on its own, so only the
    // actually-broken one(s) get dropped (losing cross-pred simplification
    // for this pass, but not the whole canvas's type display).
    reducedPreds = resolvedPreds.flatMap((p) => {
      try {
        return reduce([p])
      } catch {
        return []
      }
    })
  }
  perNode.forEach((entry) => {
    const ownTypes = entry.paramTypes ? [...entry.paramTypes, entry.resultType] : [entry.valueType]
    const ownVars = new Set(ownTypes.flatMap((t) => [...ftv(t)]))
    entry.preds = reducedPreds.filter((p) => p.type.kind === 'var' && ownVars.has(p.type.id))
  })
  return { perNode, subst: ctx.subst, preds: resolvedPreds }
}
