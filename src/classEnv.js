// The class environment and constraint solver: which classes exist (and
// their superclasses), which instances exist, and the machinery that
// type-checks code using them — predicate entailment, context reduction and
// defaulting. Declarations live elsewhere (numericClasses.js,
// categoryClasses.js, and instances derived from user type declarations);
// import src/prelude.js to get the solver with every declaration loaded.
//
// Ported from Mark P. Jones & Simon Peyton Jones, "Typing Haskell in
// Haskell" (https://web.cecs.pdx.edu/~mpj/thih/TypingHaskellInHaskell.html):
// bySuper/byInst/entail, inHnf/toHnf/simplify/reduce (context reduction),
// and candidates/withDefaults (defaulting). Instances carry a context, as in
// THIH: `instance Monoid a => Monoid (Maybe a)` is
// `{ cls: 'Monoid', head: Maybe $a, context: [Monoid $a] }`, and using it
// leaves the context's predicates as new obligations.
import { applySubst, pred, showType, tcon } from './typeSystem.js'

const classes = new Map() // name -> { supers: string[], numeric: boolean }
const staticInstances = []
let dynamicInstances = [] // replaced wholesale whenever user type declarations change

/** Declare a class with its direct superclasses. `numeric` classes take part in defaulting. */
export function declareClass(name, supers = [], { numeric = false } = {}) {
  classes.set(name, { supers, numeric })
}

/**
 * Declare an instance. `head` is a Type whose variables must have ids
 * starting with `$` (instance-local pattern variables, never confused with
 * a real program type's variables); `context` constrains them.
 */
export function declareInstance(cls, head, context = []) {
  staticInstances.push({ cls, head, context })
}

/** Replace every instance derived from user type declarations (see typeDecls.js). */
export function setDynamicInstances(list) {
  dynamicInstances = list
}

function allInstances() {
  return [...staticInstances, ...dynamicInstances]
}

export function isClass(name) {
  return classes.has(name)
}

export function superclassesOf(name) {
  return classes.get(name)?.supers || []
}

/** Every class `cls` implies, itself included. */
export function classClosure(cls) {
  return [...new Set([cls, ...superclassesOf(cls).flatMap(classClosure)])]
}

/** Every declared class name. */
export function classNames() {
  return [...classes.keys()]
}

/**
 * Classes the concrete, argument-less type `name` is an instance of without
 * any remaining obligations (e.g. `instancesOf('Int')`).
 */
export function instancesOf(name) {
  return classNames().filter((cls) => entails([], pred(cls, tcon(name))))
}

/** Every declared instance, for inspection and tests. */
export function listInstances() {
  return allInstances()
}

export class ContextError extends Error {
  constructor(p) {
    super(`No instance for ${p.cls} ${showType(p.type)}`)
    this.pred = p
  }
}

/** `p` plus every predicate its class's superclasses also give you for the same type. */
function bySuper(p) {
  return [p, ...superclassesOf(p.cls).flatMap((sup) => bySuper(pred(sup, p.type)))]
}

/**
 * One-way unification: a substitution for `pattern`'s (`$`-prefixed)
 * variables making it equal to `type`, or null. `type`'s own variables are
 * never bound — an instance for `Maybe $a` matches `Maybe t3`, but an
 * instance for `Maybe Int` does not match `Maybe t3` (that would be guessing).
 */
function match(pattern, type, subst = new Map()) {
  if (pattern.kind === 'var') {
    const bound = subst.get(pattern.id)
    if (bound) return sameType(bound, type) ? subst : null
    return new Map(subst).set(pattern.id, type)
  }
  if (pattern.kind !== type.kind) return null
  if (pattern.kind === 'con') return pattern.name === type.name ? subst : null
  if (pattern.kind === 'fun') {
    const s1 = match(pattern.from, type.from, subst)
    return s1 && match(pattern.to, type.to, s1)
  }
  const s1 = match(pattern.fn, type.fn, subst)
  return s1 && match(pattern.arg, type.arg, s1)
}

/**
 * The obligations left by using an instance for `p` — `[]` for a base
 * instance like `Ring Int`, the instantiated context for one like
 * `Monoid a => Monoid (Maybe a)` — or null if no instance applies. A
 * fun-headed pred (e.g. `Ring (a -> b)`, a function value in a numeric slot)
 * never has an instance, so it fails cleanly at toHnf.
 */
function byInst(p) {
  for (const inst of allInstances()) {
    if (inst.cls !== p.cls) continue
    const s = match(inst.head, p.type)
    if (s) return inst.context.map((q) => pred(q.cls, applySubst(s, q.type)))
  }
  return null
}

/** Does `preds` entail `p` (via superclasses of what's already assumed, or by instance + recursively entailing its obligations)? */
export function entails(preds, p) {
  if (preds.some((q) => bySuper(q).some((r) => r.cls === p.cls && sameType(r.type, p.type)))) return true
  const sub = byInst(p)
  return sub !== null && sub.every((q) => entails(preds, q))
}

function sameType(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'var') return a.id === b.id
  if (a.kind === 'con') return a.name === b.name
  if (a.kind === 'fun') return sameType(a.from, b.from) && sameType(a.to, b.to)
  return sameType(a.fn, b.fn) && sameType(a.arg, b.arg)
}

/**
 * Head-normal form: the type is a variable or a variable applied to
 * arguments (`a`, `f b`), so no instance can be chosen until it's known.
 */
function inHnf(p) {
  let t = p.type
  while (t.kind === 'app') t = t.fn
  return t.kind === 'var'
}

function toHnf(p) {
  if (inHnf(p)) return [p]
  const sub = byInst(p)
  if (sub === null) throw new ContextError(p)
  return toHnfs(sub)
}

function toHnfs(preds) {
  return preds.flatMap(toHnf)
}

/** Drop any predicate already implied by the rest (e.g. drop `Ring a` once `EuclideanRing a` is also present). */
export function simplify(preds) {
  const kept = []
  for (let i = 0; i < preds.length; i++) {
    const rest = [...kept, ...preds.slice(i + 1)]
    if (!entails(rest, preds[i])) kept.push(preds[i])
  }
  return kept
}

/** Full context reduction: discharge concrete-headed preds against the instance table (throws ContextError if unsatisfiable), then drop redundant ones. */
export function reduce(preds) {
  return simplify(toHnfs(preds))
}

/** The predicates (already reduced) whose type is exactly the variable `varId`. */
export function predsOnVar(preds, varId) {
  return preds.filter((p) => p.type.kind === 'var' && p.type.id === varId)
}

/** Same default list GHC uses when no `default` declaration is given: try Integer, then Double. */
export const defaultTypes = ['Integer', 'Double']

/**
 * GHC's defaulting (Haskell Report §4.3.4 / GHC docs
 * https://ghc.gitlab.haskell.org/ghc/doc/users_guide/exts/type_defaulting.html):
 * a var is defaultable only via its own class preds, at least one of which
 * must be numeric; the first type in `defaultTypes` that satisfies ALL of
 * them wins. Returns a type name (string) or null if none apply / none fit.
 */
export function pickDefault(preds, varId) {
  const qs = predsOnVar(preds, varId)
  if (!qs.length || !qs.some((p) => classes.get(p.cls)?.numeric)) return null
  return defaultTypes.find((t) => qs.every((p) => entails([], pred(p.cls, tcon(t))))) || null
}
