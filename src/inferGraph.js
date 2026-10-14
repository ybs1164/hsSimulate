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
// - Elaboration (dictionary passing, as GHC compiles classes — every class,
//   builtin or declared): every function node records the constraints its
//   instance of the callee's scheme carries, and so does every numeric
//   literal (`3 :: Semiring a => a` is `fromInteger` at a's dictionary) and
//   every stored Play result. Once a custom function is generalized, the
//   constraints it keeps (`Ring a`, `Pretty a`) become its dictionary
//   parameters, and each call in its body gets *evidence* — built from
//   instances and those parameters. A constraint left on a variable the
//   function's type doesn't mention is defaulted first (`show 3` shows an
//   Integer). The top-level graph's calls are elaborated per expression:
//   a value is evaluated at a monotype, as GHCi does (its constrained
//   variables default), while a partial application keeps its constraints
//   as dictionary parameters of its own (`rootParams`), supplied when the
//   stored closure is used again.
// - Ambiguity (GHC's ambiguity check, Haskell Report §4.3.4): a constraint
//   `C t` whose `t` doesn't occur in the type of the binding it arises in —
//   a custom function's body, or a top-level expression on the canvas —
//   can never be decided by any use of that binding: no instance can be
//   chosen. It's fine if defaulting applies (`show 3`: `Semiring t, Show t`
//   defaults t to Integer); otherwise it's an error, blamed on the nodes the
//   constraint comes from, and the constraint is left out of the binding's
//   type. Nothing ambiguous ever runs.
// - Type annotations (see typeExpr.js): a body's parameter and Output nodes
//   may carry Haskell type text — a partial type signature, segment by
//   segment. After the body is inferred, each is unified with what the body
//   made of that node; a mismatch, a class the pinned type lacks, or a named
//   variable that the body specializes (signature variables are rigid) is
//   reported on that node, and that annotation is left out. The Output node
//   may also carry the signature's pinned class context (`context: [{ cls,
//   var }]`, `Ord a =>`): each becomes one of the body's own constraints on
//   that signature variable, so it stays in the function's type (callers
//   must satisfy it) even where the body doesn't need it. Constraints the
//   body needs beyond those are still inferred (an extra-constraints
//   wildcard, `(Ord a, _) =>`).
import { applySubst, createNamer, freshVar, ftv, generalize, instantiate, pred, showType, tcon, tfun, tlist, tvar, unify, scheme } from './typeSystem.js'
import { builtinSchemes, listOfScheme } from './builtinSchemes.js'
import { classArity, evidence, isClass, isUserClass, literalClass, pickDefault, reduce } from './prelude.js'
import { parseLiteral } from './literals.js'
import { annotationType, typeFromText, typeText } from './typeExpr.js'

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
  for (const { graph, id, index, paramType, lit, litId } of ctx.pendingLiterals.splice(start)) {
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
    if (litPreds.length) {
      ctx.origins.push({ id, preds: litPreds, label: lit.text })
      // The literal's dictionary: keyed by the literal node, or by its host's slot (`call-1:0`) when typed inline.
      ctx.calls.push({ id: litId || `${id}:${index}`, node: id, preds: litPreds })
    }
  }
}

/**
 * Unify each annotated parameter/Output node of `graph` (a function body)
 * with its annotation, all of them sharing one scope of named variables.
 * The preds from `predsStart` on are the body's own — a pinned type must
 * satisfy them. Returns `{ nodeId: problem }` for annotations that don't fit
 * (and so weren't applied), and for named variables the body specializes.
 */
function annotate(ctx, graph, memo, predsStart) {
  const problems = {}
  const names = new Map()
  const pinnedBy = new Map() // variable name -> the node whose annotation first mentions it
  const show = (t) => typeText(t, createNamer(), '▸')
  const what = (n) => (n.type === 'output' ? 'the result' : `‘${n.label}’`)
  for (const n of Object.values(graph)) {
    if ((n.type !== 'parameter' && n.type !== 'output') || !n.annotation) continue
    const scoped = new Map(names)
    let want
    try {
      want = annotationType(n.annotation, scoped)
    } catch (e) {
      problems[n.id] = e.message
      continue
    }
    const have = valueTypeOfEntry(memo.get(n.id) ?? resolveNodeType(n.id, graph, ctx, memo))
    let next
    try {
      next = unify(have, want, ctx.subst)
    } catch {
      problems[n.id] = `The body makes ${what(n)} ${show(applySubst(ctx.subst, have))}, not ${n.annotation}`
      continue
    }
    const own = ctx.preds.slice(predsStart)
    const missing = own.find((p) => satisfiable([p], ctx.subst) && !satisfiable([p], next))
    if (missing) {
      problems[n.id] = `${n.annotation} can't be ${what(n)}: the body needs ${missing.cls} of it, which ${show(applySubst(next, missing.type))} doesn't have`
      continue
    }
    ctx.subst = next
    for (const [name, v] of scoped) {
      if (names.has(name)) continue
      names.set(name, v)
      pinnedBy.set(name, n.id)
    }
  }
  // The pinned class context: constraints the function's type carries.
  const output = Object.values(graph).find((n) => n.type === 'output')
  for (const q of output?.context || []) {
    const v = names.get(q.var)
    if (!isClass(q.cls)) problems.context ??= `There is no class ${q.cls}`
    else if (!v) problems.context ??= `${q.cls} ${q.var}: ${q.var} isn't a variable of the signature`
    else if (!usedAtKind(graph, q.var, classArity(q.cls))) problems.context ??= `${q.cls} ${q.var}: ${q.cls} is a class of ${classArity(q.cls) ? 'type constructors (like Maybe)' : 'types'}, but the signature uses ${q.var} as ${classArity(q.cls) ? 'a type' : 'a type constructor'}`
    else if (satisfiable([...ctx.preds.slice(predsStart), pred(q.cls, v)], ctx.subst)) ctx.preds.push(pred(q.cls, v))
    else problems.context ??= `${q.cls} ${q.var} can't hold: the body makes ${q.var} ${show(applySubst(ctx.subst, v))}`
  }
  // Signature variables are rigid: each must still be a variable of its own.
  const seen = new Map()
  for (const [name, v] of names) {
    const t = applySubst(ctx.subst, v)
    const at = pinnedBy.get(name)
    if (t.kind !== 'var') problems[at] ??= `${name} must work for every type (it's a variable of the signature), but the body needs it to be ${show(t)}`
    else if (seen.has(t.id)) problems[at] ??= `${seen.get(t.id)} and ${name} may be different types, but the body needs them to be the same`
    else seen.set(t.id, name)
  }
  return problems
}

/** Whether the annotations of `graph` use variable `name` with `arity` type arguments (`f a` for 1, a bare `a` for 0) somewhere. */
function usedAtKind(graph, name, arity) {
  return Object.values(graph).some((n) => (n.type === 'parameter' || n.type === 'output') && n.annotation && annotationUses(n.annotation, name, arity))
}

/** Whether type text `text` uses variable `name` with `arity` arguments. */
function annotationUses(text, name, arity) {
  const go = (t, args) => {
    if (t.kind === 'var') return t.id === name && args === arity
    if (t.kind === 'fun') return go(t.from, 0) || go(t.to, 0)
    if (t.kind === 'app') return go(t.fn, args + 1) || go(t.arg, 0)
    return false
  }
  try {
    return go(typeFromText(text), 0)
  } catch {
    return false
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
  if (def.scheme) {
    // A definition with a declared type (a definition view's graph): its
    // body is still elaborated, given the dictionaries of that type, in its
    // order — what every caller passes. A recursive call uses the type as is.
    const body = ctx.functionBodiesRegistry[id]
    if (body && !ctx.visiting.has(id)) {
      ctx.visiting.add(id)
      inferCustomFunctionScheme(body, ctx, id, def.scheme)
      ctx.visiting.delete(id)
      ctx.customCache.set(id, def.scheme)
    }
    return def.scheme
  }
  if (def.builtin) return builtinSchemes[def.builtin]
  if (ctx.visiting.has(id)) return scheme([], [], freshVar()) // recursive custom function: monomorphic fallback, not cached
  ctx.visiting.add(id)
  const body = ctx.functionBodiesRegistry[id]
  const sch = body ? inferCustomFunctionScheme(body, ctx, id) : scheme([], [], freshVar())
  ctx.visiting.delete(id)
  ctx.customCache.set(id, sch)
  return sch
}

/**
 * Infer a custom function's own principal type from its body wiring, then
 * generalize (and elaborate its calls). With a `declared` scheme, the body
 * is checked against it instead and elaborated with its constraints as the
 * dictionary parameters; the declared scheme is the result.
 */
function inferCustomFunctionScheme(body, ctx, fnId, declared = null) {
  const callsStart = ctx.calls.length
  const originsStart = ctx.origins.length
  const memo = new Map()
  const paramNodes = Object.values(body).filter((n) => n.type === 'parameter')
  const paramVars = paramNodes.map(() => freshVar())
  paramNodes.forEach((n, i) => memo.set(n.id, { kind: 'value', valueType: paramVars[i] }))
  const predsStart = ctx.preds.length
  const literalsStart = ctx.pendingLiterals.length
  const outputEntry = resolveNodeType('output', body, ctx, memo)
  settleLiterals(ctx, literalsStart)
  const problems = annotate(ctx, body, memo, predsStart)
  if (Object.keys(problems).length) ctx.annotationProblems[fnId] = problems
  const resultType = valueTypeOfEntry(outputEntry)
  // Resolve against everything unified so far *before* generalizing — a
  // param that got pinned to Int by usage (e.g. wired into isZero) must show
  // up concrete here, not still-free, or it would be wrongly quantified.
  let wanted = null
  if (declared) {
    wanted = instantiate(declared)
    try {
      ctx.subst = unify(paramVars.reduceRight((acc, t) => tfun(t, acc), resultType), wanted.type, ctx.subst)
    } catch {
      // A body that doesn't fit its declared type: typed as written, elaborated as best it can be.
    }
  }
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
  // A constraint on a variable the function's type doesn't mention is ambiguous (or defaulted): it leaves the type.
  const visible = ftv(curried)
  const origins = ctx.origins.splice(originsStart).map((o) => ({ ...o, preds: o.preds.map((p) => pred(p.cls, applySubst(ctx.subst, p.type))) }))
  const ambiguous = ambiguitiesIn(retained, visible, origins)
  if (ambiguous.length) ctx.ambiguities[fnId] = ambiguous
  // The variables only its body sees default (Integer, Double) — for its calls' dictionaries only.
  const defaulted = withDefaults(retained, visible, ctx.subst)
  retained = retained.filter((p) => [...ftv(p.type)].every((v) => visible.has(v)))
  // Its constraints are its dictionary parameters, in order (a declared type's, when it has one).
  const given = (wanted ? wanted.preds.map((p) => pred(p.cls, applySubst(ctx.subst, p.type))) : retained).map((p, i) => ({ pred: p, expr: { param: i } }))
  ctx.elab.set(fnId, { params: given.length, nodes: elaborateCalls(ctx.calls.splice(callsStart), given, ctx, fnId, defaulted) })
  return generalize(retained, curried)
}

/**
 * `subst` extended with the defaults (Haskell Report §4.3.4, pickDefault) of
 * the constrained variables of `preds` (resolved) not in `keep` — those that
 * occur only in simple constraints `C v`, one of them numeric. The rest are
 * left alone (an ambiguity, reported elsewhere).
 */
function withDefaults(preds, keep, subst) {
  let reduced
  try {
    reduced = reduce(preds.map((p) => pred(p.cls, applySubst(subst, p.type))))
  } catch {
    return subst
  }
  let s = subst
  for (const v of new Set(reduced.flatMap((p) => [...ftv(p.type)]))) {
    if (keep.has(v) || !reduced.every((p) => !ftv(p.type).has(v) || (p.type.kind === 'var' && p.type.id === v))) continue
    const t = pickDefault(reduced, v)
    if (t) s = unify(tvar(v), tcon(t), s)
  }
  return s
}

/**
 * The ambiguous constraints among `preds` (already resolved) for a binding
 * whose type mentions the variables `visible`: those on a variable it
 * doesn't mention, unless that variable defaults (pickDefault — it occurs
 * only in simple constraints `C t`, one of them numeric, all standard).
 * Returns `[{ nodeId, message }]`, one per node the constraint arises from.
 */
function ambiguitiesIn(preds, visible, origins) {
  let reduced
  try {
    reduced = reduce(preds)
  } catch {
    return [] // unsatisfiable: a type error, reported where the edge was made
  }
  const hidden = (p) => [...ftv(p.type)].filter((v) => !visible.has(v))
  const defaultable = (v) => reduced.every((p) => !ftv(p.type).has(v) || (p.type.kind === 'var' && p.type.id === v)) && pickDefault(reduced, v)
  const bad = reduced.filter((p) => hidden(p).some((v) => !defaultable(v)))
  const out = []
  const blamed = new Set()
  for (const v of new Set(bad.flatMap(hidden))) {
    const constraints = reduced.filter((p) => ftv(p.type).has(v))
    const namer = createNamer()
    const shown = constraints.map((p) => `${p.cls} ${showType(p.type, namer)}`).join(', ')
    const userClass = constraints.some((p) => isUserClass(p.cls))
    const culprits = origins.filter((o) => o.preds.some((p) => ftv(p.type).has(v)))
    const names = [...new Set(culprits.map((o) => o.label))].map((l) => `‘${l}’`).join(', ')
    const why = userClass ? '' : ' (and no default applies: defaulting needs a numeric class such as Semiring, with only builtin classes)'
    const message = `Ambiguous type variable ${namer(v)}: the constraint ${shown} arising from ${names || 'here'} can't be solved, because nothing fixes ${namer(v)}${why}. Connect the value to something of a known type.`
    for (const o of culprits) {
      const key = `${o.id}|${message}`
      if (blamed.has(key)) continue
      blamed.add(key)
      out.push({ nodeId: o.id, message })
    }
  }
  return out
}

/** The nodes of `graph` that are whole expressions (not plugged into a slot) — each a binding of its own. */
function rootsOf(graph) {
  const mounted = new Set(Object.values(graph).flatMap((n) => (n.type === 'function' ? n.mounted || [] : [])).filter((id) => id && graph[id]))
  return Object.values(graph).filter((n) => !mounted.has(n.id) && !['output', 'parameter', 'law'].includes(n.type)).map((n) => n.id)
}

/** The node ids an expression consists of: its plugged-in nodes, and what its references point at. */
export function subtreeOf(graph, rootId) {
  const seen = new Set()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()
    const n = graph[id]
    if (!n || seen.has(id)) continue
    seen.add(id)
    if (n.type === 'ref') stack.push(n.target)
    for (const m of n.mounted || []) if (m) stack.push(m)
  }
  return seen
}

/**
 * Evidence for each call's constraints (`{ nodeId: [evidence…] }`), from the
 * dictionaries in hand (`given`), against `subst` (the pass's, plus any
 * defaults). A direct recursive call passes the function's own dictionaries
 * on (it is typed monomorphically). Missing evidence becomes `{ error }`,
 * reported only if that dictionary is used.
 */
function elaborateCalls(calls, given, ctx, selfId = null, subst = ctx.subst) {
  const out = {}
  for (const call of calls) {
    if (call.recursive) {
      if (call.recursive === selfId) out[call.id] = given.map((g) => g.expr)
      continue
    }
    if (!call.preds.length) continue
    out[call.id] = call.preds.map((q) => {
      const p = pred(q.cls, applySubst(subst, q.type))
      return evidence(given, p) || { error: `No instance for ${p.cls} ${showType(p.type)}${p.type.kind === 'var' ? ' — the type is ambiguous here (fix it by connecting the value to something of a known type)' : ''}` }
    })
  }
  return out
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
      ctx.calls.push({ id, preds: [pred(literalClass(node.value ?? ''), entry.valueType)] })
      memo.set(id, entry)
      return entry
    }
    const v = freshVar()
    ctx.preds.push(pred(literalClass(node.value ?? ''), v))
    ctx.origins.push({ id, preds: [pred(literalClass(node.value ?? ''), v)], label: String(node.value ?? '') })
    ctx.calls.push({ id, preds: [pred(literalClass(node.value ?? ''), v)] })
    const entry = { kind: 'value', valueType: v }
    memo.set(id, entry)
    return entry
  }
  if (node.type === 'literal') {
    // Plugged in, its host types it (with the slot): resolve the host first.
    const at = String(node.mountedTo || '').lastIndexOf(':')
    const hostId = at < 0 ? null : node.mountedTo.slice(0, at)
    if (hostId && graph[hostId]?.mounted?.includes(id)) {
      resolveNodeType(hostId, graph, ctx, memo)
      if (memo.has(id)) return memo.get(id)
    }
    // Free-standing: the type its text alone gives (`3 :: Semiring a => a`).
    const lit = parseLiteral(node.value)
    const valueType = !lit || lit.kind === 'number' ? freshVar() : lit.kind === 'string' ? tlist(tcon('Char')) : lit.kind === 'char' ? tcon('Char') : Bool
    if (lit?.kind === 'number') {
      ctx.preds.push(pred(literalClass(lit.text), valueType))
      ctx.origins.push({ id, preds: [pred(literalClass(lit.text), valueType)], label: lit.text })
      ctx.calls.push({ id, preds: [pred(literalClass(lit.text), valueType)] })
    }
    const entry = { kind: 'value', valueType }
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
      // Its closure's dictionary parameters, in the scheme's order (see rootParams).
      ctx.calls.push({ id, preds: inst.preds })
      if (inst.preds.length) ctx.origins.push({ id, preds: inst.preds, label: node.label || 'result' })
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
    const calleeId = node.sourceFunctionId || node.id
    const recursive = !node.builtin && !ctx.nodesRegistry[calleeId]?.scheme && !ctx.nodesRegistry[calleeId]?.builtin && ctx.visiting.has(calleeId) && !ctx.customCache.has(calleeId) ? calleeId : null
    const sch = schemeFor(node, ctx)
    const { type: instType, preds: instPreds } = instantiate(sch)
    ctx.preds.push(...instPreds)
    const call = { id, preds: instPreds, recursive }
    ctx.calls.push(call)
    if (instPreds.length) ctx.origins.push({ id, preds: instPreds, label: node.label })
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
      if (mountedId && graph[mountedId]?.type === 'literal') {
        // A literal node plugged in is typed exactly like the same text typed
        // inline (below): settled against the slot, flagged there if it
        // doesn't fit. It reads as the slot's own type.
        applied[i] = true
        memo.set(mountedId, { kind: 'value', valueType: paramType })
        const lit = parseLiteral(graph[mountedId].value)
        if (lit) ctx.pendingLiterals.push({ graph, id, index: i, paramType, lit, litId: mountedId })
        else markInvalid(ctx, graph, id, i)
        return
      }
      if (mountedId && graph[mountedId]) {
        applied[i] = true
        const argEntry = resolveNodeType(mountedId, graph, ctx, memo)
        try {
          ctx.subst = unify(paramType, valueTypeOfEntry(argEntry), ctx.subst)
        } catch {
          // Invalid edge — connect-time gating should prevent this; skip defensively rather than blank the canvas.
          ctx.broken.push({ graph, nodeId: id, index: i })
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
  const ctx = { subst: new Map(), customCache: new Map(), visiting: new Set(), nodesRegistry, functionBodiesRegistry, preds: [], invalid: new Map(), pendingLiterals: [], calls: [], elab: new Map(), origins: [], ambiguities: {}, annotationProblems: {}, broken: [] }
  const memo = new Map()
  const perNode = new Map()
  const entries = Object.keys(activeGraph).map((id) => [id, resolveNodeType(id, activeGraph, ctx, memo)])
  settleLiterals(ctx, 0)
  // A function body being looked at directly: its own signature annotations.
  const annotationsHere = annotate(ctx, activeGraph, memo, 0)
  // Ambiguity of each top-level expression. In a function body the
  // parameters' types count as known (they're the function's own type).
  const resolveP = (p) => pred(p.cls, applySubst(ctx.subst, p.type))
  const topOrigins = ctx.origins.splice(0).map((o) => ({ ...o, preds: o.preds.map(resolveP) }))
  const paramVars = new Set(Object.values(activeGraph).filter((n) => n.type === 'parameter').flatMap((n) => [...ftv(applySubst(ctx.subst, valueTypeOfEntry(memo.get(n.id))))]))
  const topAmbiguities = []
  // Each expression's elaboration: a value defaults its constrained
  // variables (it's evaluated at a monotype, as GHCi does); a function value
  // keeps those of its own type as dictionary parameters (rootParams).
  const rootParams = {}
  const rootOf = new Map()
  const perRoot = new Map()
  for (const rootId of rootsOf(activeGraph)) {
    const inside = subtreeOf(activeGraph, rootId)
    inside.forEach((id) => { if (!rootOf.has(id)) rootOf.set(id, rootId) })
    const origins = topOrigins.filter((o) => inside.has(o.id))
    if (!origins.length) continue
    const rootType = applySubst(ctx.subst, valueTypeOfEntry(memo.get(rootId)))
    const visible = new Set([...ftv(rootType), ...paramVars])
    const preds = origins.flatMap((o) => o.preds)
    topAmbiguities.push(...ambiguitiesIn(preds, visible, origins))
    let own = []
    try {
      own = rootType.kind === 'fun' ? reduce(preds).filter((p) => [...ftv(p.type)].every((v) => ftv(rootType).has(v))) : []
    } catch {}
    if (own.length) rootParams[rootId] = own
    perRoot.set(rootId, { given: own.map((p, i) => ({ pred: p, expr: { param: i } })), subst: withDefaults(preds, rootType.kind === 'fun' ? visible : new Set(paramVars), ctx.subst) })
  }
  // What's left in ctx.calls is the active graph's own calls.
  const main = {}
  const byRoot = Object.groupBy(ctx.calls.splice(0), (call) => rootOf.get(call.node ?? call.id) ?? '')
  for (const [rootId, calls] of Object.entries(byRoot)) {
    const r = perRoot.get(rootId)
    Object.assign(main, elaborateCalls(calls, r?.given || [], ctx, null, r?.subst))
  }
  const elaboration = { main, functions: Object.fromEntries(ctx.elab) }
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
  return { perNode, subst: ctx.subst, preds: resolvedPreds, elaboration, rootParams, schemes: ctx.customCache, ambiguities: { main: topAmbiguities, functions: ctx.ambiguities }, annotations: { here: annotationsHere, functions: ctx.annotationProblems }, brokenEdges: ctx.broken.filter((b) => b.graph === activeGraph).map(({ nodeId, index }) => ({ nodeId, index })) }
}
