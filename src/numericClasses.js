// The numeric type-class hierarchy: Num, Real, Integral, Fractional,
// Floating, RealFrac, RealFloat, plus the constraint-solving machinery
// (predicate entailment, context reduction, defaulting) needed to actually
// type-check code that uses them.
//
// Ported from Mark P. Jones & Simon Peyton Jones, "Typing Haskell in
// Haskell" (https://web.cecs.pdx.edu/~mpj/thih/TypingHaskellInHaskell.html):
// bySuper/byInst/entail, toHnf/toHnfs/simplify/reduce (context reduction),
// and candidates/withDefaults (defaulting). Class definitions and instances
// per the Haskell 2010 Report, ch. 6
// (https://www.haskell.org/onlinereport/haskell2010/haskellch6.html).
//
// Simplification versus the real Haskell Report (documented, not an
// oversight): the Report's actual superclasses also require Eq/Ord/Enum/Show
// (`Real` needs (Num, Ord)`, `Integral` needs `(Real, Enum)`), but this app
// doesn't model Eq/Ord/Enum/Show anywhere at all, so those edges are simply
// dropped — `Real`'s only modeled superclass is `Num`, `Integral`'s is only
// `Real`. The other four classes' superclasses (Fractional/Floating/
// RealFrac/RealFloat) already don't involve Eq/Ord/Enum/Show in the Report
// either, so they're modeled exactly as specified.
import { pred } from './typeSystem.js'

/** Direct superclass edges (this app's simplified subset — see file header). */
const superclasses = {
  Num: [],
  Real: ['Num'],
  Integral: ['Real'],
  Fractional: ['Num'],
  Floating: ['Fractional'],
  RealFrac: ['Real', 'Fractional'],
  RealFloat: ['RealFrac', 'Floating'],
}

/** Which classes each concrete numeric type instantiates. */
const instances = {
  Int: ['Num', 'Real', 'Integral'],
  Integer: ['Num', 'Real', 'Integral'],
  Word: ['Num', 'Real', 'Integral'],
  Float: ['Num', 'Real', 'Fractional', 'Floating', 'RealFrac', 'RealFloat'],
  Double: ['Num', 'Real', 'Fractional', 'Floating', 'RealFrac', 'RealFloat'],
  Rational: ['Num', 'Real', 'Fractional', 'RealFrac'],
}

/** GHC's actual default list when no `default` declaration is given: try Integer, then Double. */
export const defaultTypes = ['Integer', 'Double']

export class ContextError extends Error {
  constructor(p) {
    super(`No instance for ${p.cls} ${p.type.kind === 'con' ? p.type.name : '(...)'}`)
    this.pred = p
  }
}

/** `p` plus every predicate its class's superclasses also give you for the same type. */
function bySuper(p) {
  return [p, ...(superclasses[p.cls] || []).flatMap((sup) => bySuper(pred(sup, p.type)))]
}

/**
 * If `p`'s type is concrete, does it actually have this instance? Returns
 * `[]` (no sub-obligations — numeric instances here are all "base" instances)
 * if satisfied, or `null` if not. A var-headed pred can't be judged yet; a
 * fun-headed pred (e.g. `Num (a -> b)`, a function value in a numeric slot)
 * NEVER has an instance — deliberately treated the same as an unmatched
 * concrete type, not as "undecidable", so it fails cleanly at toHnf.
 */
function byInst(p) {
  if (p.type.kind !== 'con') return null
  const classes = instances[p.type.name]
  return classes && classes.includes(p.cls) ? [] : null
}

/** Does `preds` entail `p` (via superclasses of what's already assumed, or by instance + recursively entailing its sub-obligations)? */
export function entails(preds, p) {
  if (preds.some((q) => bySuper(q).some((r) => r.cls === p.cls && sameType(r.type, p.type)))) return true
  const sub = byInst(p)
  return sub !== null && sub.every((q) => entails(preds, q))
}

function sameType(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'var') return a.id === b.id
  if (a.kind === 'con') return a.name === b.name
  return sameType(a.from, b.from) && sameType(a.to, b.to)
}

/** Head-normal form: still headed by a variable, so it can't be reduced further without knowing the concrete type. */
function inHnf(p) {
  return p.type.kind === 'var'
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

/** Drop any predicate already implied by the rest (e.g. drop `Num a` once `Integral a` is also present). */
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

const numericClasses = Object.keys(superclasses)

/**
 * GHC's defaulting (Haskell Report §4.3.4 / GHC docs
 * https://ghc.gitlab.haskell.org/ghc/doc/users_guide/exts/type_defaulting.html):
 * a var is defaultable only via its own class preds, at least one of which
 * must be numeric; the first type in `defaultTypes` that satisfies ALL of
 * them wins. Returns a type name (string) or null if none apply / none fit.
 */
export function pickDefault(preds, varId) {
  const qs = predsOnVar(preds, varId)
  if (!qs.length || !qs.some((p) => numericClasses.includes(p.cls))) return null
  return defaultTypes.find((t) => qs.every((p) => entails([], pred(p.cls, { kind: 'con', name: t })))) || null
}
