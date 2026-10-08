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
import { applySubst, freshVar, ftv, generalize, instantiate, pred, tcon, tfun, tlist, unify, scheme } from './typeSystem.js'
import { builtinSchemes, listOfScheme } from './builtinSchemes.js'
import { literalClass, reduce } from './prelude.js'
import { parseLiteral } from './literals.js'
import { checkSignature, readSignature } from './typeGraph.js'

const Int = tcon('Int')
const Bool = tcon('Bool')

/**
 * Turn an entry into the single Type of that node *as a value*. A function
 * node's value is its callee applied to its applied slots (a mounted node or
 * an inline literal — see `applied`), so only the still-open slots fold into
 * the arrow, e.g. `plus` with its `x` slot filled is `a -> a`, and with both
 * filled just `a`. This is exactly the runtime meaning src/evaluator.js gives
 * it. Detected by field presence, not `.kind`, so this works on both the
 * internal `{kind, paramTypes|valueType}` shape used during graph traversal
 * and the external `perNode` shape (which drops `kind`).
 */
export function valueTypeOfEntry(entry) {
  if (!entry) return freshVar()
  if (entry.paramTypes) return entry.paramTypes.reduceRight((acc, t, i) => (entry.applied?.[i] ? acc : tfun(t, acc)), entry.resultType)
  return entry.valueType
}

function satisfiable(preds, subst) {
  try {
    reduce(preds.map((p) => pred(p.cls, applySubst(subst, p.type))))
    return true
  } catch {
    return false
  }
}

/**
 * Type the inline literals collected since `start`, one at a time, the way
 * main.js's canConnect vets a dragged edge: unify the literal's type with its
 * slot and keep it only if no outstanding constraint becomes unsatisfiable —
 * whether its own (`-3` needs Ring, which a Natural slot lacks) or one
 * elsewhere (`true` into `apply`'s argument when the function needs Semiring).
 * A rejected literal is recorded in invalidSlots instead of poisoning the
 * pass. If the graph was already unsatisfiable without it, only the literal's
 * own fit is judged, so one broken edge doesn't flag every literal.
 */
function settleLiterals(ctx, start) {
  for (const { graph, id, index, paramType, lit } of ctx.pendingLiterals.splice(start)) {
    const litType = lit.kind === 'number' ? freshVar() : lit.kind === 'string' ? tlist(tcon('Char')) : lit.kind === 'char' ? tcon('Char') : Bool
    const litPreds = lit.kind === 'number' ? [pred(literalClass(lit.text), litType)] : []
    let next
    try {
      next = unify(paramType, litType, ctx.subst)
    } catch {
      markInvalid(ctx, graph, id, index)
      continue
    }
    const fits = satisfiable([...ctx.preds, ...litPreds], next) || (!satisfiable(ctx.preds, ctx.subst) && satisfiable(litPreds, next))
    if (!fits) {
      markInvalid(ctx, graph, id, index)
      continue
    }
    ctx.subst = next
    ctx.preds.push(...litPreds)
  }
}

/** Record that `graph[id]`'s slot `index` holds an inline literal that doesn't fit the slot. */
function markInvalid(ctx, graph, id, index) {
  if (!ctx.invalid.has(graph)) ctx.invalid.set(graph, new Map())
  const perGraph = ctx.invalid.get(graph)
  if (!perGraph.has(id)) perGraph.set(id, new Set())
  perGraph.get(id).add(index)
}

function schemeFor(node, ctx) {
  if (node.scheme) return node.scheme
  if ((node.builtin || ctx.nodesRegistry[node.sourceFunctionId]?.builtin) === 'listOf') return listOfScheme(node.params?.length || 0) // a definition that carries its own type (e.g. derived from a type declaration)
  if (node.builtin) return builtinSchemes[node.builtin]
  return customSchemeOf(node.sourceFunctionId || node.id, ctx)
}

/** The scheme of a custom (or builtin, or missing) top-level function, memoized per pass with a cycle guard. */
function customSchemeOf(id, ctx) {
  if (ctx.customCache.has(id)) return ctx.customCache.get(id)
  const def = ctx.nodesRegistry[id]
  if (!def) return scheme([], [], freshVar())
  if (def.scheme) return def.scheme
  if (def.builtin) return builtinSchemes[def.builtin]
  const body = ctx.functionBodiesRegistry[id]
  // A declared signature (a type drawn in the body, see typeGraph.js) that
  // the body really has is the function's type — narrower than the inferred
  // one if it says so, and known up front for a recursive call.
  const declared = body && readSignature(body)
  const usable = declared && !declared.errors.length ? declared.scheme : null
  if (ctx.visiting.has(id)) return usable || scheme([], [], freshVar()) // recursive custom function: its signature, else a monomorphic fallback, not cached
  ctx.visiting.add(id)
  const inferred = body ? inferCustomFunctionScheme(body, ctx) : scheme([], [], freshVar())
  const sch = usable && !checkSignature(usable, inferred) ? usable : inferred
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
  const literalsStart = ctx.pendingLiterals.length
  const outputEntry = resolveNodeType('output', body, ctx, memo)
  settleLiterals(ctx, literalsStart)
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
  // `plus` keeps its `AddSemigroup` obligation here; one wired into `isZero` doesn't
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

  if (node.type === 'ref') {
    // The diagonal Δ : A → A × A — a second use of the same value. It *is*
    // its target's entry (same memo object), so both uses share one type.
    const entry = graph[node.target] ? resolveNodeType(node.target, graph, ctx, memo) : { kind: 'value', valueType: freshVar() }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'parameter') {
    const entry = { kind: 'value', valueType: freshVar() }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'number') {
    // A genuine type annotation (like Haskell's `5 :: Double`) resolves
    // outright, no constraint needed. Otherwise this is a numeric literal
    // carrying only the structure its text needs: `Semiring a => a` for a
    // non-negative integer, `Ring a => a` for a negative one, `Field a => a`
    // for a decimal (see literalClass).
    if (node.annotation) {
      const entry = { kind: 'value', valueType: tcon(node.annotation) }
      memo.set(id, entry)
      return entry
    }
    const v = freshVar()
    ctx.preds.push(pred(literalClass(node.value ?? ''), v))
    const entry = { kind: 'value', valueType: v }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'text') {
    const entry = { kind: 'value', valueType: tlist(tcon('Char')) }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'boolean') {
    const entry = { kind: 'value', valueType: Bool }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'curried' || node.type === 'value') {
    // A Play result with open slots stores its residual as a generalized
    // scheme (constraints included), instantiated fresh here like any other
    // polymorphic value. `resolvedType` is the older bare-type form.
    let valueType = node.resolvedType || freshVar()
    if (node.resolvedScheme) {
      const inst = instantiate(node.resolvedScheme)
      ctx.preds.push(...inst.preds)
      valueType = inst.type
    }
    const entry = { kind: 'value', valueType }
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
    const applied = paramTypes.map(() => false)
    const entry = { kind: 'function', paramTypes, resultType: rest, applied }
    memo.set(id, entry) // set before recursing so a stray self-mount can't loop
    paramTypes.forEach((paramType, i) => {
      const mountedId = node.mounted?.[i]
      if (mountedId && graph[mountedId]) {
        applied[i] = true
        const argEntry = resolveNodeType(mountedId, graph, ctx, memo)
        try {
          ctx.subst = unify(paramType, valueTypeOfEntry(argEntry), ctx.subst)
        } catch {
          // Invalid edge — connect-time gating should prevent this; skip defensively rather than blank the canvas.
        }
        return
      }
      // An inline literal typed into the slot counts as applied (the
      // evaluator will use it) but, unlike a mounted edge, nothing gated it
      // — so its typing is deferred to settleLiterals, which accepts it only
      // if every constraint stays satisfiable.
      const lit = parseLiteral(node.params?.[i])
      if (!lit) return
      applied[i] = true
      ctx.pendingLiterals.push({ graph, id, index: i, paramType, lit })
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
  const ctx = { subst: new Map(), customCache: new Map(), visiting: new Set(), nodesRegistry, functionBodiesRegistry, preds: [], invalid: new Map(), pendingLiterals: [] }
  const memo = new Map()
  const perNode = new Map()
  const entries = Object.keys(activeGraph).map((id) => [id, resolveNodeType(id, activeGraph, ctx, memo)])
  const signature = checkActiveSignature(activeGraph, ctx, memo)
  settleLiterals(ctx, 0)
  // Read every type back only now, against the final substitution, so an
  // edge resolved late still refines a node resolved early.
  entries.forEach(([id, entry]) => {
    perNode.set(
      id,
      entry.kind === 'function'
        ? { paramTypes: entry.paramTypes.map((t) => applySubst(ctx.subst, t)), resultType: applySubst(ctx.subst, entry.resultType), applied: entry.applied }
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
  const invalidHere = ctx.invalid.get(activeGraph) || new Map()
  perNode.forEach((entry, id) => {
    if (entry.paramTypes) entry.invalidSlots = [...(invalidHere.get(id) || [])]
    const ownTypes = entry.paramTypes ? [...entry.paramTypes, entry.resultType] : [entry.valueType]
    const ownVars = new Set(ownTypes.flatMap((t) => [...ftv(t)]))
    // Reduced preds are in head-normal form (`Ring a`, or `Show (f a)` under a
    // constructor class), so "mentions one of this node's variables" is the test.
    entry.preds = reducedPreds.filter((p) => [...ftv(p.type)].some((v) => ownVars.has(v)))
  })
  return { perNode, subst: ctx.subst, preds: resolvedPreds, signature }
}

/**
 * The signature declared in the body on screen, checked against the body:
 * `{ errors, mismatch }` (null if there's none). One that holds pins the
 * body's own types — its parameters and its Output take the declared types.
 */
function checkActiveSignature(graph, ctx, memo) {
  const declared = readSignature(graph)
  if (!declared) return null
  const result = { errors: declared.errors, mismatch: null }
  if (declared.errors.length || !graph.output) return result
  // Infer the body on its own (a scratch context), as a callee would see it.
  const scratch = { ...ctx, subst: new Map(), preds: [], pendingLiterals: [], invalid: new Map(), visiting: new Set(), customCache: new Map() }
  result.mismatch = checkSignature(declared.scheme, inferCustomFunctionScheme(graph, scratch))
  if (result.mismatch) return result
  const inst = instantiate(declared.scheme)
  ctx.preds.push(...inst.preds)
  let rest = inst.type
  const pin = (entry, t) => { try { ctx.subst = unify(valueTypeOfEntry(entry), t, ctx.subst) } catch {} }
  for (const p of Object.values(graph).filter((n) => n.type === 'parameter')) {
    if (rest.kind !== 'fun') break
    pin(memo.get(p.id), rest.from)
    rest = rest.to
  }
  pin(memo.get('output'), rest)
  return result
}
