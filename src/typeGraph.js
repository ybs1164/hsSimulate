// A function's type signature, drawn and edited as a graph like everything
// else. A type is an inductive term (CLAUDE.md), built from nodes plugged
// into each other's slots:
//
//   - a type constructor applied to its arguments — one slot per argument:
//     `Int` (none), `[ ]` and `Maybe` (one: they are functors), `( , )` (two:
//     the product), user types (none);
//   - the arrow `→`, slots `from` and `to` — the exponential object;
//   - a type variable `a` — every node with the same name is the same variable;
//   - a type application `f a`, for a variable standing for a constructor;
//   - a class constraint `Ring •`, whose slot takes the constrained type.
//
// The signature node `f ::` takes the type in its first slot and any
// constraints in the rest. `readSignature` turns that graph into a type
// scheme, `checkSignature` decides whether the body really has that type
// (it must be an instance of the type inferred from the body), and
// `typeNodes` draws a type as such a graph (to pin an inferred type, or to
// show a builtin's type in its read-only view).
import { applySubst, constructorArity, createNamer, instantiate, pred, scheme, showQual, showType, tapp, tcon, tfun, tvar, unify, wellKinded } from './typeSystem.js'
import { entails, isClass } from './prelude.js'

/** How many slots a type node of this kind/name has. */
export function typeNodeArity(tkind, name) {
  if (tkind === 'arrow' || tkind === 'app') return 2
  if (tkind === 'class') return 1
  if (tkind === 'con') return constructorArity[name] || 0
  return 0
}

/** The text a type node shows. */
export function typeNodeLabel(n) {
  if (n.tkind === 'arrow') return '→'
  if (n.tkind === 'app') return 'f a'
  if (n.tkind === 'con' && n.name === 'List') return '[ ]'
  if (n.tkind === 'con' && n.name === '(,)') return '( , )'
  return n.name
}

/** What a type node's slot `i` is for. */
export function typeSlotName(n, i) {
  if (n.type === 'signature') return i === 0 ? 'type' : 'context'
  if (n.tkind === 'arrow') return ['from', 'to'][i]
  if (n.tkind === 'app') return ['f', 'a'][i]
  if (n.tkind === 'class') return 'type'
  if (n.name === '(,)') return ['fst', 'snd'][i]
  if (n.name === 'Program') return ['model', 'msg'][i]
  return 'a'
}

/** A fresh type node (not yet in any graph). */
export function makeTypeNode(id, tkind, name, extra = {}) {
  const slots = typeNodeArity(tkind, name)
  return { id, type: 'tnode', tkind, name, label: typeNodeLabel({ tkind, name }), params: Array(slots).fill(''), mounted: Array(slots).fill(null), paramScopes: Array(slots).fill('local'), color: '#5a6ea8', x: 0, y: 0, ...extra }
}

/** A fresh signature node with one slot for the type and `contexts` for constraints. */
export function makeSignatureNode(contexts = 0, extra = {}) {
  const slots = 1 + contexts
  return { id: 'signature', type: 'signature', label: '::', params: Array(slots).fill(''), mounted: Array(slots).fill(null), paramScopes: Array(slots).fill('local'), color: '#211d34', x: 0, y: 0, ...extra }
}

/** A variable's id inside a declared scheme. */
const varId = (name) => `'${name}`

/**
 * The signature declared in `graph` (a function body), or null if it has
 * none: `{ scheme, errors, varNames }`. `errors` lists what keeps the graph
 * from being a type (an empty slot, a misplaced constraint, a kind error);
 * the scheme is only meaningful when there are none.
 */
export function readSignature(graph) {
  const sig = Object.values(graph).find((n) => n.type === 'signature')
  if (!sig) return null
  const errors = []
  const vars = new Set()
  const read = (id, where) => {
    const n = graph[id]
    if (!n) { errors.push(`${where} is empty`); return tvar(varId('?')) }
    if (n.type !== 'tnode') { errors.push(`${where} holds a value, not a type`); return tvar(varId('?')) }
    if (n.tkind === 'class') { errors.push(`the constraint ${n.name} can only go in the signature's context`); return tvar(varId('?')) }
    if (n.tkind === 'var') {
      if (!/^[a-z][A-Za-z0-9_']*$/.test(n.name || '')) errors.push(`"${n.name}" is not a type variable name`)
      vars.add(varId(n.name))
      return tvar(varId(n.name))
    }
    const kids = n.mounted || []
    if (n.tkind === 'arrow') return tfun(read(kids[0], 'the argument of →'), read(kids[1], 'the result of →'))
    if (n.tkind === 'app') return tapp(read(kids[0], 'the constructor of f a'), read(kids[1], 'the argument of f a'))
    // A constructor with every slot empty stands for itself, unapplied
    // (`Maybe` in `f a`'s first slot); partly filled, it's missing arguments.
    if (kids.every((k) => !k)) return tcon(n.name)
    return kids.reduce((t, k, i) => tapp(t, read(k, `argument ${i + 1} of ${typeNodeLabel(n)}`)), tcon(n.name))
  }
  const type = read(sig.mounted?.[0], 'the signature\'s type')
  const preds = []
  ;(sig.mounted || []).slice(1).forEach((id) => {
    if (!id) return
    const n = graph[id]
    if (n?.type !== 'tnode' || n.tkind !== 'class') { errors.push('a context slot takes a class constraint'); return }
    if (!isClass(n.name)) { errors.push(`${n.name} is not a class`); return }
    preds.push(pred(n.name, read(n.mounted?.[0], `the type in ${n.name}`)))
  })
  if (!errors.length && !wellKinded(type)) errors.push(`${showType(type, (id) => id.slice(1))} is not a type (a constructor is missing an argument, or has one too many)`)
  preds.forEach((p) => {
    if (p.type.kind === 'var' && !typeVars(type).has(p.type.id)) errors.push(`the constraint ${p.cls} ${p.type.id.slice(1)} is on a variable the type doesn't mention`)
  })
  return { scheme: scheme([...vars], preds, type), errors, varNames: (id) => (id.startsWith("'") ? id.slice(1) : id) }
}

function typeVars(t, acc = new Set()) {
  if (t.kind === 'var') acc.add(t.id)
  if (t.kind === 'fun') { typeVars(t.from, acc); typeVars(t.to, acc) }
  if (t.kind === 'app') { typeVars(t.fn, acc); typeVars(t.arg, acc) }
  return acc
}

/**
 * Does a body whose principal (inferred) type is `inferred` have the
 * `declared` type? Only if `declared` is an instance of it: its variables
 * are rigid (each one some fixed, unknown type), the inferred type must
 * unify with it, and every constraint the body needs must follow from the
 * declared context. Returns null when it does, else why not.
 */
export function checkSignature(declared, inferred) {
  // Rigid variables: a lowercase constructor can't clash with a real one.
  const rigid = new Map(declared.vars.map((v) => [v, tcon(v.slice(1))]))
  const type = applySubst(rigid, declared.type)
  const given = declared.preds.map((p) => pred(p.cls, applySubst(rigid, p.type)))
  const inst = instantiate(inferred)
  let s
  try {
    s = unify(inst.type, type)
  } catch {
    return `the body has the type ${showQual(inferred.preds, inferred.type)}`
  }
  for (const p of inst.preds) {
    const needed = pred(p.cls, applySubst(s, p.type))
    if (!entails(given, needed)) return `the body needs ${needed.cls} ${showType(needed.type)}, which the context doesn't give`
  }
  return null
}

/**
 * Draw the qualified type `preds ⇒ type` as type nodes: `{ nodes, root,
 * context }`, ids from `newId()`, every argument plugged into (and unfolded
 * from) its slot, positions left to the caller.
 */
export function typeNodes(preds, type, newId, namer = createNamer()) {
  const nodes = {}
  const make = (tkind, name, kids = []) => {
    const n = makeTypeNode(newId(), tkind, name)
    nodes[n.id] = n
    kids.forEach((kid, i) => {
      if (!kid) return
      n.mounted[i] = kid
      n.params[i] = nodes[kid].label
      Object.assign(nodes[kid], { mountedTo: `${n.id}:${i}`, connected: true, unfolded: true })
    })
    return n.id
  }
  const go = (t) => {
    if (t.kind === 'var') return make('var', namer(t.id))
    if (t.kind === 'fun') return make('arrow', '->', [go(t.from), go(t.to)])
    if (t.kind === 'con') return make('con', t.name)
    // An application: a constructor applied to as many arguments as it takes
    // is one node; anything else (a variable head, `f a`) is spelled out.
    const args = []
    let head = t
    while (head.kind === 'app') { args.unshift(head.arg); head = head.fn }
    if (head.kind === 'con' && (constructorArity[head.name] || 0) === args.length) return make('con', head.name, args.map(go))
    return make('app', 'app', [go(t.fn), go(t.arg)])
  }
  const root = go(type)
  const context = preds.map((p) => make('class', p.cls, [go(p.type)]))
  return { nodes, root, context }
}

/** Draw `preds => type` into `body` as its signature: the type nodes and the `::` block holding them. */
export function drawSignature(body, preds, type, newId) {
  const drawn = typeNodes(preds, type, newId)
  Object.assign(body, drawn.nodes)
  body.signature = makeSignatureNode(drawn.context.length)
  ;[drawn.root, ...drawn.context].forEach((kid, i) => {
    body.signature.mounted[i] = kid
    body.signature.params[i] = drawn.nodes[kid].label
    Object.assign(drawn.nodes[kid], { mountedTo: `signature:${i}`, connected: true, unfolded: true })
  })
}
