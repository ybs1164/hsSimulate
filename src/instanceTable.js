// The runtime side of every instance: what its dictionary holds. Every class
// is compiled by dictionary passing (classEnv.js' evidence): a dictionary is
// `{ kind: 'dict', key, sub }` — instance `key` and the dictionaries of its
// context — and this table says, per key, how its methods run (all plain
// JSON, so it travels with an exported game):
//
//   { cls, how, supers: { [superclass]: evidence } }   and, by `how`:
//   prim       a builtin instance: its methods are primitives (evaluator.js)
//   stock      structural, as GHC derives Eq/Ord/Show: `type`, and per
//              constructor `{ name, record, fieldNames, ev }` — `ev` the
//              evidence for the class at each field's type
//   pointwise  a product's structure field by field (anyclass deriving, via
//              Generically): same shape as stock
//   newtype    the wrapped type's instance (newtype deriving): `inner`
//              evidence, coerced through the constructor `ctor` of `type`
//              wherever `coerce[method]` (its type) mentions the class variable
//   written    methods given by custom functions: `methods` (method →
//              function id, or null for the class's default), `implDicts`
//              (method → the evidence each needs, or `{ error }`)
//
// Evidence inside an entry is relative to the instance: `{ ctx: k }` is the
// k-th dictionary of its context, `{ self: true }` the instance itself,
// `{ extra: j }` the j-th further dictionary a method call carries (foldMap's
// Monoid). Superclass evidence lets `{ super: cls, of: e }` reach, say, the
// AddSemigroup dictionary inside a Ring one.
import { builtinSchemes } from './builtinSchemes.js'
import { CLASS_METHODS } from './classMethods.js'
import { evidence, listInstances, superclassesOf } from './prelude.js'
import { applySubst, ftv, instantiate, pred, showType, tapp, tcon, tfun, tvar, unify } from './typeSystem.js'

const given = (context) => context.map((q, k) => ({ pred: q, expr: { ctx: k } }))
const shown = (key) => key.replace('@', ' ').replace(' List', ' []')

/**
 * The runtime table for every instance in the class environment. `written`
 * describes hand-written instances by key: `{ methods, methodTypes }` where
 * methodTypes gives, per method, `{ type, classVar, extras }` (see
 * methodTypes) — and `schemeOf(fnId)` a custom function's generalized type.
 */
export function runtimeInstances({ written = {}, schemeOf = () => null } = {}) {
  const table = {}
  for (const inst of listInstances()) {
    const ctx = given(inst.context)
    const supers = Object.fromEntries(superclassesOf(inst.cls).map((s) => [s, evidence(ctx, pred(s, inst.head)) || { error: `instance ${shown(inst.key)} has no ${s} instance` }]))
    const entry = { cls: inst.cls, how: inst.how || 'prim', supers }
    const w = written[inst.key]
    if (w) Object.assign(entry, writtenEntry(inst, w, schemeOf))
    else if (entry.how === 'stock' || entry.how === 'pointwise') {
      entry.type = inst.type
      entry.ctors = inst.shape.map((c) => ({ name: c.name, record: !!c.record, fieldNames: c.fieldNames || c.fields.map(() => null), ev: c.fields.map((t) => evidence(ctx, pred(inst.cls, t)) || { error: `${shown(inst.key)}: a field of type ${showType(t, (id) => id.replace('$', ''))} has no ${inst.cls} instance` }) }))
    } else if (entry.how === 'newtype') {
      const only = inst.shape[0]
      entry.type = inst.type
      entry.ctor = only.name
      entry.inner = evidence(ctx, pred(inst.cls, only.fields[0])) || { error: `${shown(inst.key)}: the wrapped type has no ${inst.cls} instance` }
      // Where each method's type mentions the class variable: there it's coerced through the constructor.
      entry.coerce = Object.fromEntries((CLASS_METHODS[inst.cls] || []).map((m) => [m, builtinMethodType(inst.cls, m)]))
    }
    table[inst.key] = entry
  }
  return table
}

/**
 * What builtin method `m` of class `cls` is: its type, the variable the
 * class constrains in it, and the further constraints it carries (in order).
 */
export function builtinMethodType(cls, m) {
  const sch = builtinSchemes[m]
  const classVar = sch.preds.find((p) => p.cls === cls).type.id
  return { type: sch.type, classVar, extras: sch.preds.filter((p) => p.cls !== cls) }
}

// Rigid (skolem) versions of type variables, for checking against a required type.
const rigid = (t) => (t.kind === 'var' ? tcon(`'${t.id.replace(/^[m$]:?/, '')}`) : t.kind === 'fun' ? tfun(rigid(t.from), rigid(t.to)) : t.kind === 'app' ? tapp(rigid(t.fn), rigid(t.arg)) : t)

/**
 * A method's type at an instance head: the class variable replaced by the
 * head, its other variables renamed apart (`m:x`), and its further
 * constraints likewise. `head` and `context` use the instance's variables.
 */
export function methodTypeAtHead(mt, head) {
  const rename = (t) => (t.kind === 'var' ? (t.id === mt.classVar ? head : tvar(`m:${t.id}`)) : t.kind === 'fun' ? tfun(rename(t.from), rename(t.to)) : t.kind === 'app' ? tapp(rename(t.fn), rename(t.arg)) : t)
  return { type: rename(mt.type), extras: mt.extras.map((p) => pred(p.cls, rename(p.type))) }
}

// The entry of a hand-written instance: per method, the function and the
// dictionaries it needs, as evidence relative to the instance.
function writtenEntry(inst, w, schemeOf) {
  const at = shown(inst.key)
  const entry = { how: 'written', methods: {}, implDicts: {} }
  const ctxGiven = inst.context.map((p, k) => ({ pred: pred(p.cls, rigid(p.type)), expr: { ctx: k } }))
  for (const [m, mt] of Object.entries(w.methodTypes)) {
    const fnId = w.methods[m] || mt.default || null
    entry.methods[m] = fnId
    if (!fnId) continue
    const have = schemeOf(fnId)
    if (!have) { entry.implDicts[m] = { error: `${m} for ${at}: its function is gone` }; continue }
    const want = methodTypeAtHead(mt, inst.head)
    const dictsGiven = [{ pred: pred(inst.cls, rigid(inst.head)), expr: { self: true } }, ...ctxGiven, ...want.extras.map((p, j) => ({ pred: pred(p.cls, rigid(p.type)), expr: { extra: j } }))]
    const fresh = instantiate(have)
    let s
    try {
      s = unify(fresh.type, rigid(want.type))
    } catch {
      entry.implDicts[m] = { error: `${m} for ${at}: its function has the wrong type` }
      continue
    }
    const dicts = []
    for (const p of fresh.preds) {
      const q = pred(p.cls, applySubst(s, p.type))
      const e = ftv(q.type).size ? null : evidence(dictsGiven, q)
      if (!e) { entry.implDicts[m] = { error: `${m} for ${at} needs ${q.cls} ${showType(q.type).replaceAll("'", '')}, which nothing provides` }; break }
      dicts.push(e)
    }
    if (!entry.implDicts[m]) entry.implDicts[m] = dicts
  }
  return entry
}
