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
//
// An instance of a builtin class written by hand has exactly the same
// shape, kept per class in the project's `instances` (`{ Show: [{ head:
// 'Wallet', context: [], methods: { show: fnId } }] }`), and is resolved and
// checked the same way (`resolveWritten`). Its methods' types are the
// builtins' (builtinSchemes.js); a method it leaves out comes from the
// class's defaults (classMethods.js' minimal complete definitions).
import { DeclError, builtinTypeNames, derivedInstances, parseSignature, schemeProblem } from './typeDecls.js'
import { classArity, classClosure, entails, findInstance, headName, isClass, isUserClass, withDynamicClasses, withDynamicInstances } from './prelude.js'
import { constructorArity, ftv, pred, scheme, showType, tapp, tcon, tfun, tvar } from './typeSystem.js'
import { BUILTIN_CLASSES, CLASS_METHODS, minimalProblem } from './classMethods.js'
import { builtinMethodType, methodTypeAtHead, runtimeInstances } from './instanceTable.js'
import { preludeTypes } from './library.js'

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
    c.instances = c.instances.map((inst) => resolveInstance(c.name, c.arity, inst, types, seen, (q) => isClass(q) || byName.has(q)))
  }
  return resolved
}

// One instance, checked and resolved: `{ key, cls, headName, vars, head,
// context, methods }` — its head the type constructor applied to as many
// variables (a, b, …) as the class leaves it (`Maybe a`, or `Maybe` for a
// constructor class).
function resolveInstance(cls, arity, inst, types, seen, knownClass) {
  const where = `instance ${cls} ${showHead(inst.head)}`
  if (!HEAD_NAMES.includes(inst.head) && !types[inst.head]) throw new DeclError(`${where}: no type named ${inst.head}`)
  if (seen.has(inst.head)) throw new DeclError(`${where} is written twice`)
  seen.add(inst.head)
  const n = arityOfType(inst.head, types) - arity
  if (n < 0) throw new DeclError(`${where}: ${cls} needs a type constructor taking ${arity} argument${arity > 1 ? 's' : ''}`)
  const vars = HEAD_VARS.slice(0, n)
  const context = (inst.context || []).map((q) => {
    if (!vars.includes(q.var)) throw new DeclError(`${where}: the context mentions "${q.var}", which isn't one of ${vars.join(', ') || '(no variables)'}`)
    if (!knownClass(q.cls)) throw new DeclError(`${where}: no class named ${q.cls}`)
    return pred(q.cls, tvar(q.var))
  })
  return { key: `${cls}@${inst.head}`, cls, headName: inst.head, vars, head: vars.reduce((acc, v) => tapp(acc, tvar(v)), tcon(inst.head)), context, methods: { ...(inst.methods || {}) }, contextSource: inst.context || [] }
}

/**
 * Check and resolve the hand-written instances of builtin classes,
 * `instances` = `{ [cls]: [{ head, context, methods }] }` (the project's).
 * `knownClass(name)` says whether a context may ask for a class.
 */
export function resolveWritten(instances, types, knownClass = isClass) {
  return Object.entries(instances).flatMap(([cls, list]) => {
    if (!BUILTIN_CLASSES[cls]) throw new DeclError(`${cls} isn't a builtin class — a class you declare keeps its instances itself`)
    const seen = new Set()
    return (list || []).map((inst) => {
      const r = resolveInstance(cls, classArity(cls), inst, types, seen, knownClass)
      for (const m of Object.keys(r.methods)) if (r.methods[m] && !CLASS_METHODS[cls].includes(m)) throw new DeclError(`instance ${cls} ${showHead(r.headName)}: ${cls} has no method ${m}`)
      return r
    })
  })
}

/** The class-environment entries of the hand-written builtin-class instances — what deriving may rely on (typeDecls.js' `assumed`). */
export function writtenEnvironment(instances, types) {
  try {
    return classEnvironment([], resolveWritten(instances, types)).instances
  } catch (e) {
    if (e instanceof DeclError) return []
    throw e
  }
}

/**
 * Check and resolve `classes` against `types` (see resolveClasses), and the
 * hand-written builtin-class `instances` (see resolveWritten), with every
 * instance judged in the full environment. Leaves the class environment as
 * it was. The result is the resolved classes, with the resolved written
 * instances as its `written` property (classEnvironment installs both).
 */
export function declareClasses(classes, types, functionLabels = [], instances = {}) {
  // While resolving, every declared class exists (methods may mention each other's classes).
  const provisional = Object.values(classes).map((c) => ({ name: c.name, supers: c.supers || [], arity: 0 }))
  return withDynamicClasses(provisional, () => {
    const resolved = resolveClasses(classes, types, functionLabels)
    const written = resolveWritten(instances, types, (q) => isClass(q) || resolved.some((c) => c.name === q))
    // A written instance may not overlap one that's derived or builtin — but
    // it may replace a builtin instance of a type the Prelude declares
    // (library.js): `instance Show Color` is the project's Show for Color.
    const derived = derivedInstances(types)
    const ownKeys = new Set(derived.map((i) => `${i.cls}@${headName(i.head)}`))
    withDynamicInstances(derived, () => {
      for (const w of written) {
        const other = findInstance(pred(w.cls, w.head))
        const own = other && ownKeys.has(other.inst.key)
        if (other && !(!own && preludeTypes[w.headName])) throw new DeclError(`instance ${w.cls} ${showHead(w.headName)}: ${showHead(w.headName)} already has ${w.cls}${own ? ' (derived — drop it from the deriving clause first)' : ' (builtin)'}`)
      }
    })
    resolved.written = written
    const env = classEnvironment(resolved)
    const byClass = Object.entries(Object.groupBy(written, (w) => w.cls)).map(([name, list]) => ({ name, instances: list }))
    withDynamicClasses(env.classes, () => withDynamicInstances([...derivedInstances(types), ...env.instances], () => checkInstances([...resolved, ...byClass])))
    return resolved
  })
}

/**
 * The class-environment entries for resolved classes and the written
 * instances (`written`, by default the resolved classes' own): `{ classes,
 * instances }` (instance heads use `$` pattern variables).
 */
export function classEnvironment(resolved, written = resolved.written || []) {
  const pattern = (t) => (t.kind === 'var' ? tvar(`$${t.id}`) : t.kind === 'app' ? tapp(pattern(t.fn), pattern(t.arg)) : t)
  const entry = (i) => ({ cls: i.cls, head: pattern(i.head), context: i.context.map((q) => pred(q.cls, pattern(q.type))), key: i.key, how: 'written', methods: i.methods })
  return {
    classes: resolved.map((c) => ({ name: c.name, supers: c.supers, arity: c.arity })),
    instances: [...resolved.flatMap((c) => c.instances.map(entry)), ...written.map(entry)],
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
 * What runtimeInstances (instanceTable.js) needs to know of hand-written
 * instances — the resolved classes' and the builtin-class instances written
 * for declared types (`types`): per instance key, its method functions and
 * each method's type (`{ type, classVar, extras, default }`).
 */
export function writtenInstanceInfo(resolved) {
  const out = {}
  for (const c of resolved) {
    for (const i of c.instances) {
      out[i.key] = { methods: i.methods, methodTypes: Object.fromEntries(c.methods.map((m) => [m.name, { type: m.type, classVar: c.param, extras: m.extras, default: m.default }])) }
    }
  }
  for (const w of resolved.written || []) {
    out[w.key] = { methods: w.methods, methodTypes: Object.fromEntries(CLASS_METHODS[w.cls].map((m) => [m, builtinMethodType(w.cls, m)])) }
  }
  return out
}

/** Why function scheme `have` can't implement builtin method `m` of written instance `w` ('' if it can). */
export function writtenMethodProblem(have, w, m) {
  const want = methodTypeAtHead(builtinMethodType(w.cls, m), w.head)
  return schemeProblem(have, want.type, [...w.context, ...want.extras], [pred(w.cls, w.head)]) // (the instance itself, for recursion)
}

/** Why written instance `w`'s methods aren't a complete definition of its class (classMethods.js' MINIMAL), or ''. */
export function writtenMinimalProblem(w) {
  return minimalProblem(w.cls, Object.keys(w.methods).filter((m) => w.methods[m]))
}

/**
 * The runtime side of every instance in the class environment (call with
 * it set), for the evaluator — see instanceTable.js. `schemeOf(fnId)` gives
 * a custom function's generalized scheme. Problems become `{ error }`
 * entries, reported when (and if) that method runs.
 */
export function instanceEvidence(resolved, schemeOf) {
  return runtimeInstances({ written: writtenInstanceInfo(resolved), schemeOf })
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

/** The written builtin-class `instances` with every instance head `from` renamed to `to`. */
export function renameTypeInInstances(instances, from, to) {
  return Object.fromEntries(Object.entries(instances).map(([cls, list]) => [cls, list.map((i) => (i.head === from ? { ...i, head: to } : i))]))
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
