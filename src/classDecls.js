// User class declarations, as in Haskell:
//
//   class Show a => Pretty a where
//     pretty :: a -> String
//     pretty = show                       -- a default (optional)
//     defaultValue :: a                   -- return-type polymorphism is fine
//   instance Pretty Double where pretty = prettyDouble
//   instance Pretty a => Pretty (Maybe a) where pretty = prettyMaybe
//
// A class's methods are function definitions (`class:Pretty:pretty`), each
// implemented per instance by a custom function. Unlike the builtin
// classes — whose methods the evaluator picks by looking at runtime values
// — a user class is compiled the way GHC does it, by dictionary passing:
// the type checker decides at each call which instance it means, from the
// types alone (inferGraph.js elaborates every call with *evidence*), and a
// function polymorphic in a user class (`Pretty a => …`) receives the
// dictionary as a hidden argument. That is what makes a method like
// `defaultValue :: a`, which has no argument to look at, work — and lets
// `Int` and `Double` have different instances although both are numbers
// at runtime.
//
// Stored form (project `classes`, edited by the class editor):
//   { name, param, supers: [cls], methods: [{ name, sig, default: fnId | null }],
//     instances: [{ head: typeName, context: [{ cls, var }], methods: { name: fnId } }] }
// Everything else — method types, instance heads, the class environment's
// entries — is resolved from that by `resolveClasses`.
import { DeclError, builtinTypeNames, derivedInstances, parseSignature, schemeProblem } from './typeDecls.js'
import { classClosure, entails, evidence, isClass, isUserClass, withDynamicClasses, withDynamicInstances } from './prelude.js'
import { applySubst, constructorArity, ftv, instantiate, pred, scheme, showType, tapp, tcon, tfun, tvar, unify } from './typeSystem.js'

const isUpperName = (s) => /^[A-Z][A-Za-z0-9_']*$/.test(s || '')
const isLowerName = (s) => /^[a-z_][A-Za-z0-9_']*$/.test(s || '')
// Type constructors an instance may be for: the declared types and the builtin ones (String is [Char], not a constructor).
const HEAD_NAMES = builtinTypeNames.filter((n) => n !== 'String')
const HEAD_VARS = ['a', 'b', 'c', 'd']

/** The number of arguments the class variable takes in a method type (0: a plain type), or throws if uses disagree. */
function classVarArity(type, v, cls) {
  const uses = new Set()
  const walk = (t, applied = 0) => {
    if (t.kind === 'var') { if (t.id === v) uses.add(applied); return }
    if (t.kind === 'fun') { walk(t.from); walk(t.to); return }
    if (t.kind === 'app') { walk(t.fn, applied + 1); walk(t.arg); }
  }
  walk(type)
  if (uses.size > 1) throw new DeclError(`${cls}: "${v}" is used with different numbers of arguments in its methods`)
  return uses.size ? [...uses][0] : null
}

const arityOfType = (name, types) => (types[name] ? (types[name].params || []).length : constructorArity[name] || 0)
const arrows = (t) => (t.kind === 'fun' ? 1 + arrows(t.to) : 0)
const showHead = (name) => (name === 'List' ? '[]' : name)

/** The resolved form of `classes` (see the header), checked. Throws DeclError. `functionLabels`: names already taken. */
export function resolveClasses(classes, types, functionLabels = []) {
  const list = Object.values(classes)
  const taken = new Map(functionLabels.map((l) => [l, 'an existing function']))
  const resolved = []
  for (const c of list) {
    if (!isUpperName(c.name)) throw new DeclError(`A class name is capitalized: "${c.name}"`)
    if (isClass(c.name) && !isUserClass(c.name)) throw new DeclError(`${c.name} is a builtin class`)
    if (!isLowerName(c.param)) throw new DeclError(`${c.name}: its type variable is a lowercase name, not "${c.param}"`)
    for (const s of c.supers || []) if (!isClass(s) && !classes[s]) throw new DeclError(`${c.name}: no superclass named ${s}`)
    const methods = c.methods.map((m) => {
      if (!isLowerName(m.name)) throw new DeclError(`${c.name}: a method name is a lowercase name, not "${m.name}"`)
      if (taken.has(m.name)) throw new DeclError(`${c.name}: method "${m.name}" clashes with ${taken.get(m.name)}`)
      taken.set(m.name, `${c.name}'s method`)
      let sig
      try {
        sig = parseSignature(m.sig, types)
      } catch (e) {
        throw new DeclError(`${c.name}.${m.name}: ${e.message}`)
      }
      if (!ftv(sig.type).has(c.param)) throw new DeclError(`${c.name}.${m.name} :: ${m.sig} doesn't mention ${c.param} — a method's type must involve the class variable`)
      if (sig.preds.some((p) => p.type.id === c.param)) throw new DeclError(`${c.name}.${m.name}: constrain ${c.param} in the class head (as a superclass), not in a method`)
      return { name: m.name, sig: m.sig, default: m.default || null, type: sig.type, extras: sig.preds }
    })
    const arities = methods.map((m) => classVarArity(m.type, c.param, c.name)).filter((a) => a !== null)
    if (new Set(arities).size > 1) throw new DeclError(`${c.name}: "${c.param}" is used with different numbers of arguments in its methods`)
    resolved.push({ name: c.name, param: c.param, supers: [...(c.supers || [])], arity: arities[0] || 0, methods, instances: c.instances || [] })
  }
  // Superclasses may not loop.
  const byName = new Map(resolved.map((c) => [c.name, c]))
  const visit = (name, path) => {
    if (path.includes(name)) throw new DeclError(`Superclasses go round in a circle: ${[...path, name].join(' ⇒ ')}`)
    for (const s of byName.get(name)?.supers || []) visit(s, [...path, name])
  }
  resolved.forEach((c) => visit(c.name, []))
  // Instances.
  for (const c of resolved) {
    const seen = new Set()
    c.instances = c.instances.map((inst) => {
      const where = `instance ${c.name} ${showHead(inst.head)}`
      if (!HEAD_NAMES.includes(inst.head) && !types[inst.head]) throw new DeclError(`${where}: no type named ${inst.head}`)
      if (seen.has(inst.head)) throw new DeclError(`${where} is written twice`)
      seen.add(inst.head)
      const n = arityOfType(inst.head, types) - c.arity
      if (n < 0) throw new DeclError(`${where}: ${c.name} needs a type constructor taking ${c.arity} argument${c.arity > 1 ? 's' : ''}`)
      const vars = HEAD_VARS.slice(0, n)
      const context = (inst.context || []).map((q) => {
        if (!vars.includes(q.var)) throw new DeclError(`${where}: the context mentions "${q.var}", which isn't one of ${vars.join(', ') || '(no variables)'}`)
        if (!isClass(q.cls) && !byName.has(q.cls)) throw new DeclError(`${where}: no class named ${q.cls}`)
        return pred(q.cls, tvar(q.var))
      })
      return { key: `${c.name}@${inst.head}`, cls: c.name, headName: inst.head, vars, head: vars.reduce((acc, v) => tapp(acc, tvar(v)), tcon(inst.head)), context, methods: { ...(inst.methods || {}) }, contextSource: inst.context || [] }
    })
  }
  return resolved
}

/**
 * Check and resolve `classes` against `types` (see resolveClasses), with
 * every instance judged in the full environment. Leaves the class
 * environment as it was; install the result with `installClasses`.
 */
export function declareClasses(classes, types, functionLabels = []) {
  // While resolving, every declared class exists (methods may mention each other's classes).
  const provisional = Object.values(classes).map((c) => ({ name: c.name, supers: c.supers || [], arity: 0 }))
  return withDynamicClasses(provisional, () => {
    const resolved = resolveClasses(classes, types, functionLabels)
    const env = classEnvironment(resolved)
    withDynamicClasses(env.classes, () => withDynamicInstances([...derivedInstances(types), ...env.instances], () => checkInstances(resolved)))
    return resolved
  })
}

/** The class-environment entries for resolved classes: `{ classes, instances }` (instance heads use `$` pattern variables). */
export function classEnvironment(resolved) {
  const pattern = (t) => (t.kind === 'var' ? tvar(`$${t.id}`) : t.kind === 'app' ? tapp(pattern(t.fn), pattern(t.arg)) : t)
  return {
    classes: resolved.map((c) => ({ name: c.name, supers: c.supers, arity: c.arity })),
    instances: resolved.flatMap((c) => c.instances.map((i) => ({ cls: c.name, head: pattern(i.head), context: i.context.map((q) => pred(q.cls, pattern(q.type))), key: i.key }))),
  }
}

/**
 * Check what needs the whole class environment in scope (call with it set):
 * each instance has its superclasses' instances. Throws DeclError.
 */
export function checkInstances(resolved) {
  for (const c of resolved) {
    for (const i of c.instances) {
      for (const sup of classClosure(c.name).filter((s) => s !== c.name)) {
        if (!entails(i.context, pred(sup, i.head))) throw new DeclError(`instance ${c.name} ${showType(i.head, (id) => id)} needs an ${sup} instance for ${showType(i.head, (id) => id)}${i.vars.length ? ' (or a context giving it)' : ''}`)
      }
    }
  }
}

/** A class method's scheme: `∀ a … . (C a, extras) ⇒ type`. */
export function methodScheme(c, m) {
  const vars = [...new Set([c.param, ...ftv(m.type)])]
  return scheme(vars, [pred(c.name, tvar(c.param)), ...m.extras], m.type)
}

/** Function definitions for every method of the resolved classes (read-only, like derived ones). */
export function classMethodDefinitions(resolved) {
  return resolved.flatMap((c) => c.methods.map((m) => {
    const params = Array.from({ length: arrows(m.type) }, (_, i) => ['x', 'y', 'z', 'w'][i] || `x${i + 1}`)
    return { id: `class:${c.name}:${m.name}`, type: 'function', label: m.name, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', readonly: true, color: '#d68a3c', scheme: methodScheme(c, m), method: { cls: c.name, name: m.name } }
  }))
}

// Rigid (skolem) versions of type variables, for checking against a required type.
const rigid = (t) => (t.kind === 'var' ? tcon(`'${t.id.replace('m:', '')}`) : t.kind === 'fun' ? tfun(rigid(t.from), rigid(t.to)) : t.kind === 'app' ? tapp(rigid(t.fn), rigid(t.arg)) : t)

/**
 * What an implementation of method `m` must be at instance `i`: the
 * method's type with the class variable replaced by the head (`pretty ::
 * Maybe a → String`), and what it may assume (the instance's context, the
 * method's own constraints, and the instance itself, for recursion).
 */
export function instanceMethodType(c, m, i) {
  const rename = (t) => (t.kind === 'var' ? (t.id === c.param ? i.head : tvar(`m:${t.id}`)) : t.kind === 'fun' ? tfun(rename(t.from), rename(t.to)) : t.kind === 'app' ? tapp(rename(t.fn), rename(t.arg)) : t)
  const extras = m.extras.map((p) => pred(p.cls, rename(p.type)))
  return { type: rename(m.type), context: i.context, extras, self: pred(c.name, i.head) }
}

/** Why function scheme `have` can't implement method `m` at instance `i` ('' if it can). */
export function instanceMethodProblem(have, c, m, i) {
  const want = instanceMethodType(c, m, i)
  return schemeProblem(have, want.type, [want.self, ...want.context, ...want.extras])
}

/**
 * The runtime side of every instance, for the evaluator: per instance key,
 * the function implementing each method (the instance's own, else the
 * class default), the dictionaries that function needs — as evidence
 * relative to the instance (`{ self }`, `{ ctx: k }` its context's k-th
 * dictionary, `{ extra: j }` the call's j-th extra dictionary) — and how to
 * get each user superclass's dictionary. `schemeOf(fnId)` gives a custom
 * function's generalized scheme. Problems become `{ error }` entries,
 * reported when (and if) that method runs.
 */
export function instanceEvidence(resolved, schemeOf) {
  const out = {}
  for (const c of resolved) {
    for (const i of c.instances) {
      const userCtx = i.context.filter((p) => isUserClass(p.cls))
      const ctxGiven = userCtx.map((p, k) => ({ pred: pred(p.cls, rigid(p.type)), expr: { ctx: k } }))
      const entry = { cls: c.name, methods: {}, implDicts: {}, supers: {} }
      for (const m of c.methods) {
        const fnId = i.methods[m.name] || m.default
        entry.methods[m.name] = fnId || null
        if (!fnId) continue
        const have = schemeOf(fnId)
        if (!have) { entry.implDicts[m.name] = { error: `${m.name} for ${c.name} ${showHead(i.headName)}: its function is gone` }; continue }
        const want = instanceMethodType(c, m, i)
        const extrasUser = want.extras.filter((p) => isUserClass(p.cls))
        const given = [{ pred: pred(c.name, rigid(i.head)), expr: { self: true } }, ...ctxGiven, ...extrasUser.map((p, j) => ({ pred: pred(p.cls, rigid(p.type)), expr: { extra: j } }))]
        const inst = instantiate(have)
        let s
        try {
          s = unify(inst.type, rigid(want.type))
        } catch {
          entry.implDicts[m.name] = { error: `${m.name} for ${c.name} ${showHead(i.headName)}: its function has the wrong type` }
          continue
        }
        const dicts = []
        for (const p of inst.preds.filter((q) => isUserClass(q.cls))) {
          const e = evidence(given, pred(p.cls, applySubst(s, p.type)))
          if (!e) { dicts.length = 0; entry.implDicts[m.name] = { error: `${m.name} for ${c.name} ${showHead(i.headName)} needs ${p.cls} ${showType(applySubst(s, p.type)).replaceAll("'", '')}, which nothing provides` }; break }
          dicts.push(e)
        }
        if (!entry.implDicts[m.name]) entry.implDicts[m.name] = dicts
      }
      for (const sup of classClosure(c.name).filter((s) => s !== c.name && isUserClass(s))) {
        entry.supers[sup] = evidence(ctxGiven, pred(sup, rigid(i.head))) || { error: `instance ${c.name} ${showHead(i.headName)} has no ${sup}` }
      }
      out[i.key] = entry
    }
  }
  return out
}

/** `classes` with every mention of type `from` (method signatures, instance heads) renamed to `to`. */
export function renameTypeInClasses(classes, from, to) {
  const word = new RegExp(`\\b${from}\\b`, 'g')
  return Object.fromEntries(Object.entries(classes).map(([name, c]) => [name, {
    ...c,
    methods: c.methods.map((m) => ({ ...m, sig: m.sig.replace(word, to) })),
    instances: (c.instances || []).map((i) => (i.head === from ? { ...i, head: to } : i)),
  }]))
}

/** Which classes mention type `name` (in a signature or as an instance head). */
export function classesUsingType(classes, name) {
  const word = new RegExp(`\\b${name}\\b`)
  return Object.values(classes).filter((c) => c.methods.some((m) => word.test(m.sig)) || (c.instances || []).some((i) => i.head === name)).map((c) => c.name)
}

/** Every place a custom function is used by a class (as a default or an instance method), for messages. */
export function classUsesOf(classes, fnId) {
  return Object.values(classes).flatMap((c) => [
    ...c.methods.filter((m) => m.default === fnId).map((m) => `the default ${m.name} of ${c.name}`),
    ...(c.instances || []).flatMap((i) => Object.entries(i.methods || {}).filter(([, f]) => f === fnId).map(([m]) => `${m} in instance ${c.name} ${showHead(i.head)}`)),
  ])
}

export { HEAD_NAMES, showHead }
