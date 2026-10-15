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
import { pred, showType, tcon } from './typeSystem.js'

const staticClasses = new Map() // name -> { supers: string[], numeric: boolean, arity }
let dynamicClasses = new Map() // user-declared classes (classDecls.js), replaced wholesale
const staticInstances = []
let shadowFor = null // the dynamic instances `unshadowed` was computed for (see allInstances)
let unshadowed = staticInstances
let dynamicInstances = [] // replaced wholesale whenever user type declarations change
const classes = {
  get: (name) => staticClasses.get(name) ?? dynamicClasses.get(name),
  has: (name) => staticClasses.has(name) || dynamicClasses.has(name),
  keys: () => [...staticClasses.keys(), ...dynamicClasses.keys()],
}

/**
 * Declare a class with its direct superclasses. `numeric` classes take part
 * in defaulting; `arity` is how many arguments the class's type takes (0 for
 * a class of types, 1 for a constructor class like Functor).
 */
export function declareClass(name, supers = [], { numeric = false, arity = 0 } = {}) {
  staticClasses.set(name, { supers, numeric, arity })
}

/** Replace the user-declared classes: `[{ name, supers, arity }]`. They carry dictionaries at runtime (see evidence). */
export function setDynamicClasses(list) {
  dynamicClasses = new Map(list.map((c) => [c.name, { supers: c.supers, numeric: false, arity: c.arity || 0, user: true }]))
}

/** Run `fn` with `list` as the user-declared classes, then restore the previous ones. */
export function withDynamicClasses(list, fn) {
  const before = dynamicClasses
  setDynamicClasses(list)
  try {
    return fn()
  } finally {
    dynamicClasses = before
  }
}

/** Is `name` a user-declared class (passed as a dictionary) rather than a builtin one (dispatched on values)? */
export function isUserClass(name) {
  return !staticClasses.has(name) && !!dynamicClasses.get(name)?.user
}

/** How many arguments class `name`'s type takes (0 for a class of types). */
export function classArity(name) {
  return classes.get(name)?.arity || 0
}

/**
 * Declare an instance. `head` is a Type whose variables must have ids
 * starting with `$` (instance-local pattern variables, never confused with
 * a real program type's variables); `context` constrains them.
 */
export function declareInstance(cls, head, context = [], impl = { how: 'prim' }) {
  staticInstances.push({ ...impl, cls, head, context, key: instanceKey(cls, head) })
  shadowFor = null
}

/** The constructor at the head of a type (`Maybe` for `Maybe a`, `List` for `[a]`), or null for a variable or function type. */
export function headName(t) {
  while (t.kind === 'app') t = t.fn
  return t.kind === 'con' ? t.name : null
}

/**
 * An instance's key: its class and its head's constructor, `Show@Maybe` —
 * unique, since instances never overlap. It names the instance's
 * dictionary at runtime (see instanceTable.js and evaluator.js).
 */
export function instanceKey(cls, head) {
  return `${cls}@${headName(head)}`
}

const keyed = (list) => list.map((i) => (i.key ? i : { ...i, key: instanceKey(i.cls, i.head) }))

/** Replace every instance derived from user type declarations (see typeDecls.js). */
export function setDynamicInstances(list) {
  dynamicInstances = keyed(list)
}

/** The instances currently set by setDynamicInstances. */
export function listDynamicInstances() {
  return dynamicInstances
}

/** Run `fn` with `list` as the derived instances in scope, then restore the previous ones. */
export function withDynamicInstances(list, fn) {
  const before = dynamicInstances
  dynamicInstances = keyed(list)
  try {
    return fn()
  } finally {
    dynamicInstances = before
  }
}

// A project's own instance of a class for a type (derived by a declaration,
// or written by hand) replaces a builtin one with the same key: a Prelude
// type the project has taken over, or written an instance for, is the
// project's for that class (typeEdits.js, classDecls.js).
function allInstances() {
  if (shadowFor !== dynamicInstances) {
    shadowFor = dynamicInstances
    const own = new Set(dynamicInstances.map((i) => i.key))
    unshadowed = own.size ? staticInstances.filter((i) => !own.has(i.key)) : staticInstances
  }
  return [...unshadowed, ...dynamicInstances]
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
  return classes.keys()
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

/** Replace an instance's pattern variables in one step (unlike applySubst, never re-resolving what was substituted in). */
function substitutePattern(s, t) {
  if (t.kind === 'var') return s.get(t.id) ?? t
  if (t.kind === 'fun') return { kind: 'fun', from: substitutePattern(s, t.from), to: substitutePattern(s, t.to) }
  if (t.kind === 'app') return { kind: 'app', fn: substitutePattern(s, t.fn), arg: substitutePattern(s, t.arg) }
  return t
}

/**
 * The obligations left by using an instance for `p` — `[]` for a base
 * instance like `Ring Int`, the instantiated context for one like
 * `Monoid a => Monoid (Maybe a)` — or null if no instance applies. A
 * fun-headed pred (e.g. `Ring (a -> b)`, a function value in a numeric slot)
 * never has an instance, so it fails cleanly at toHnf.
 */
function byInst(p) {
  return findInstance(p)?.obligations ?? null
}

/** The instance that applies to `p` and the obligations using it leaves, or null. */
export function findInstance(p) {
  for (const inst of allInstances()) {
    if (inst.cls !== p.cls) continue
    const s = match(inst.head, p.type)
    if (s) return { inst, obligations: inst.context.map((q) => pred(q.cls, substitutePattern(s, q.type))) }
  }
  return null
}

/**
 * Evidence for `p` — how to build its dictionary — or null if there is
 * none. Every class is passed as a dictionary, as GHC compiles them: the
 * builtin ones too (their dictionaries' methods are primitives, or derived
 * structurally — see instanceTable.js). `given` are the dictionaries in
 * hand: `[{ pred, expr }]`. Evidence is JSON data the evaluator interprets:
 *
 *   given.expr                 a dictionary in hand (a function's dictionary parameter, …)
 *   { super: cls, of: e }      the superclass `cls` dictionary inside dictionary e
 *   { inst: key, sub: [e…] }   instance `key`'s dictionary, from its context's dictionaries
 */
export function evidence(given, p) {
  for (const g of given) {
    const path = superPath(g.pred, p)
    if (path) return path.reduce((e, cls) => ({ super: cls, of: e }), g.expr)
  }
  const found = findInstance(p)
  if (!found) return null
  const sub = []
  for (const q of found.obligations) {
    const e = evidence(given, q)
    if (!e) return null
    sub.push(e)
  }
  return { inst: found.inst.key, sub }
}

// The superclasses to step through to get from `have` to `want` (same type), or null.
function superPath(have, want) {
  if (have.cls === want.cls && sameType(have.type, want.type)) return []
  for (const sup of superclassesOf(have.cls)) {
    const rest = superPath(pred(sup, have.type), want)
    if (rest) return [sup, ...rest]
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
  // Only standard classes default (Haskell Report §4.3.4): never a user class.
  if (qs.some((p) => isUserClass(p.cls))) return null
  return defaultTypes.find((t) => qs.every((p) => entails([], pred(p.cls, tcon(t))))) || null
}
