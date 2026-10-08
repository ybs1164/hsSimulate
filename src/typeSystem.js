// Minimal Hindley-Milner (Algorithm W) engine.
//
// Ported from the standard references:
// - Martin Grabmüller, "Algorithm W Step by Step"
//   https://archive.alvb.in/msc/05_infomcco/assignments/04_type-reconstruction/algorithm-w-step-by-step.pdf
// - Stephen Diehl, "Write You a Haskell", ch. 6 (Hindley-Milner)
//   https://github.com/sdiehl/write-you-a-haskell/blob/master/006_hindley_milner.md
//
// Pure type theory only — this module has no knowledge of the canvas/node
// graph data model. `Type` is one of:
//   { kind: 'var', id }        -- a type variable, e.g. `a`
//   { kind: 'con', name }      -- a concrete type constructor, e.g. Int, Bool
//   { kind: 'fun', from, to }  -- a function arrow, e.g. Int -> Bool
//   { kind: 'app', fn, arg }   -- a type constructor applied to an argument,
//                                 curried like THIH's `TAp`: `Maybe Int` is
//                                 app(Maybe, Int). The head may itself be a
//                                 variable (`f a`), which is what lets a
//                                 constructor class like Functor quantify
//                                 over `f :: * -> *`.
// `Scheme` is `{ vars: string[], type: Type }`, i.e. `forall vars. type`.
// `Subst` is a `Map<varId, Type>`.
//
// Kinds are kept to what this app needs: every constructor has a fixed arity
// (`List`, `Maybe`, … :: * -> *, everything else :: *), checked by
// `wellKinded`; type variables are assumed to be used at a consistent kind
// rather than kind-inferred.

let nextVarId = 0

export function tvar(id) {
  return { kind: 'var', id }
}

export function tcon(name) {
  return { kind: 'con', name }
}

export function tfun(from, to) {
  return { kind: 'fun', from, to }
}

export function tapp(fn, arg) {
  return { kind: 'app', fn, arg }
}

/** Haskell's list type `[a]` — internally the constructor `List` applied to `a`. */
export function tlist(elem) {
  return tapp(tcon('List'), elem)
}

/** How many type arguments each constructor takes (its kind is `*` with that many `* ->` in front). */
export const constructorArity = { List: 1, Maybe: 1, Endo: 1, Sum: 1, Product: 1, Widget: 1, Program: 2, Sub: 1, '(,)': 2 }

/** The pair type `(a, b)` — the categorical product. */
export function ttuple(a, b) {
  return tapp(tapp(tcon('(,)'), a), b)
}

/**
 * How many more arguments `type` still needs before it is a proper type of
 * kind `*`, or null if that depends on a variable's kind. Throws if a
 * constructor is over-applied or a function/argument isn't of kind `*`.
 */
export function kindArity(type) {
  if (type.kind === 'var') return null
  if (type.kind === 'con') return constructorArity[type.name] || 0
  if (type.kind === 'fun') {
    if (![0, null].includes(kindArity(type.from)) || ![0, null].includes(kindArity(type.to))) throw new Error(`Ill-kinded: ${showType(type)}`)
    return 0
  }
  const head = kindArity(type.fn)
  if (head === 0 || ![0, null].includes(kindArity(type.arg))) throw new Error(`Ill-kinded: ${showType(type)}`)
  return head === null ? null : head - 1
}

/** Is `type` a proper type of kind `*` (or possibly so, when that hinges on a variable)? */
export function wellKinded(type) {
  try {
    return [0, null].includes(kindArity(type))
  } catch {
    return false
  }
}

/** A fresh, globally-unique type variable (never resolves to a fixed name like builtin schemes' `a`/`b`). */
export function freshVar() {
  return tvar(`t${nextVarId++}`)
}

export function scheme(vars, preds, type) {
  return { vars, preds, type }
}

/** A class constraint, e.g. pred('Ring', tvar('a')) means "Ring a". */
export function pred(cls, type) {
  return { cls, type }
}

export class UnifyError extends Error {
  constructor(t1, t2) {
    super(`Cannot unify ${showType(t1)} with ${showType(t2)}`)
    this.t1 = t1
    this.t2 = t2
  }
}

/** Recursively resolve every type variable in `type` through `subst`. */
export function applySubst(subst, type) {
  if (type.kind === 'var') {
    const bound = subst.get(type.id)
    return bound ? applySubst(subst, bound) : type
  }
  if (type.kind === 'fun') return tfun(applySubst(subst, type.from), applySubst(subst, type.to))
  if (type.kind === 'app') return tapp(applySubst(subst, type.fn), applySubst(subst, type.arg))
  return type
}

/** Free type variables of a type, as a Set of var ids. */
export function ftv(type) {
  if (type.kind === 'var') return new Set([type.id])
  if (type.kind === 'fun') return new Set([...ftv(type.from), ...ftv(type.to)])
  if (type.kind === 'app') return new Set([...ftv(type.fn), ...ftv(type.arg)])
  return new Set()
}

/** Classic substitution composition: composeSubst(a, b) behaves like "apply a after b". */
export function composeSubst(a, b) {
  const result = new Map()
  for (const [id, type] of b) result.set(id, applySubst(a, type))
  for (const [id, type] of a) result.set(id, type)
  return result
}

function extend(subst, id, type) {
  if (ftv(type).has(id)) throw new UnifyError(tvar(id), type) // occurs check
  const next = new Map(subst)
  next.set(id, type)
  return next
}

/**
 * Unify t1 and t2, threading (extending) an accumulated substitution.
 * Callers building up constraints across many edges pass the previous
 * result back in as `subst` so later unifications see earlier ones.
 * Throws UnifyError if the two types cannot be made equal.
 */
export function unify(t1, t2, subst = new Map()) {
  const a = applySubst(subst, t1)
  const b = applySubst(subst, t2)
  if (a.kind === 'var' && b.kind === 'var' && a.id === b.id) return subst
  if (a.kind === 'var') return extend(subst, a.id, b)
  if (b.kind === 'var') return extend(subst, b.id, a)
  if (a.kind === 'con' && b.kind === 'con' && a.name === b.name) return subst
  if (a.kind === 'fun' && b.kind === 'fun') {
    const s1 = unify(a.from, b.from, subst)
    return unify(a.to, b.to, s1)
  }
  if (a.kind === 'app' && b.kind === 'app') {
    const s1 = unify(a.fn, b.fn, subst)
    return unify(a.arg, b.arg, s1)
  }
  throw new UnifyError(a, b)
}

/**
 * Close over every free variable in `type` and in every pred's type — no env
 * parameter needed (see plan Context: no cross-function lexical capture in
 * this app). Matches THiH's `quantify`, which closes over the whole
 * qualified type (preds included), not just the bare type.
 */
export function generalize(preds, type) {
  const vars = new Set(ftv(type))
  preds.forEach((p) => ftv(p.type).forEach((v) => vars.add(v)))
  return scheme([...vars], preds, type)
}

/**
 * Replace every quantified variable in a scheme with a fresh one, in both
 * the body type and every pred — using the SAME substitution for both, so a
 * pred and the arrow type it constrains keep sharing the same variable
 * identity after freshening. Returns `{ type, preds }` (not just a bare
 * Type), since a scheme's preds travel with each fresh instantiation.
 */
export function instantiate(sch) {
  const mapping = new Map(sch.vars.map((id) => [id, freshVar()]))
  return {
    type: applySubst(mapping, sch.type),
    preds: sch.preds.map((p) => pred(p.cls, applySubst(mapping, p.type))),
  }
}

/**
 * A var-id -> display-letter (a, b, c, ...) assigner. Pass one `namer` to
 * several showType() calls to keep the same underlying variable printed as
 * the same letter across all of them (e.g. every node label drawn in one
 * draw() pass); omit it and each call gets its own fresh a, b, c... so two
 * unrelated types don't collide on display names either.
 */
export function createNamer() {
  const letters = new Map()
  let next = 0
  return (id) => {
    if (!letters.has(id)) letters.set(id, String.fromCharCode(97 + (next++ % 26)))
    return letters.get(id)
  }
}

/**
 * GHC-style pretty printer: `Maybe (List a)` prints as `Maybe [a]`, `[Char]`
 * as `String` (Haskell's `type String = [Char]`). See createNamer() for how
 * variable letters are assigned.
 */
export function showType(type, namer = createNamer()) {
  // `asDomain`: left of an arrow; `asArg`: argument of a type application.
  const go = (t, asDomain, asArg) => {
    if (t.kind === 'var') return namer(t.id)
    if (t.kind === 'con') return t.name === 'List' ? '[]' : t.name
    if (t.kind === 'app') {
      if (t.fn.kind === 'app' && t.fn.fn.kind === 'con' && t.fn.fn.name === '(,)') return `(${go(t.fn.arg, false, false)}, ${go(t.arg, false, false)})`
      if (t.fn.kind === 'con' && t.fn.name === 'List') return t.arg.kind === 'con' && t.arg.name === 'Char' ? 'String' : `[${go(t.arg, false, false)}]`
      const rendered = `${go(t.fn, false, false)} ${go(t.arg, false, true)}`
      return asArg ? `(${rendered})` : rendered
    }
    const rendered = `${go(t.from, true, false)} → ${go(t.to, false, false)}`
    return asDomain || asArg ? `(${rendered})` : rendered
  }
  return go(type, false, false)
}

/**
 * Prints a qualified type Haskell-style: `AddGroup a => a -> a -> a`,
 * `(EuclideanRing a, Ring b) => a -> b`. Pass the same `namer` used for the body
 * type so a constraint and the arrow it constrains agree on which letter is
 * which. Falls back to plain showType(type, namer) when there are no preds.
 */
export function showQual(preds, type, namer = createNamer()) {
  const body = showType(type, namer)
  if (!preds.length) return body
  const parts = preds.map((p) => `${p.cls} ${showType(p.type, namer)}`)
  const context = parts.length > 1 ? `(${parts.join(', ')})` : parts[0]
  return `${context} ⇒ ${body}`
}
