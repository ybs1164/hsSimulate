// User type declarations, written in Haskell syntax:
//
//   data Model = Model { clicks :: Double, perClick :: Double } deriving (Eq, Show)
//   data Event = Click | Tick Double | Buy Int deriving Show
//   newtype Score = Score Int
//   data Pair a = Pair { first :: a, second :: a }
//
// Category-theoretically a declaration is a coproduct of products: each
// constructor injects a product of its fields into the type. From each one
// this module derives, as ordinary read-only function definitions:
//
//   - every constructor (injection ιⱼ, with its fields' pairing):  C :: A₁ → … → T
//   - for a single-constructor record, each field's projection πᵢ:  f :: T → A
//     plus lens-style updates (as Haskell's lens `set`/`over`):  set f :: A → T → T,
//     over f :: (A → A) → T → T
//   - the copairing [f₁, …, fₙ], shaped like Haskell's eliminators `maybe`,
//     `either`, `bool` — one branch per constructor in order, the scrutinee
//     last — but named `caseT` rather than the lowercased type name, since
//     that name (`wallet`, `model`) is the natural name for a field holding
//     the type:  caseT :: (A₁ → … → r) → … → T → r
//   - for an inductive (recursive) type, its recursor foldT, whose branches
//     get recursive fields already folded (CLAUDE.md: the type system
//     follows inductive structure)
//
// and registers the instances its `deriving` clauses ask for, plus the ones
// written by hand (`instance Show Wallet where show = showWallet`), whose
// methods are custom functions (see classMethods.js).
//
// A declaration may take type parameters (`data Pair a = …`), each of kind
// `*`. Its derived functions are then polymorphic in them, and its instances
// carry a context, as GHC infers for stock deriving: `deriving Eq` on
// `Pair a` is `instance Eq a => Eq (Pair a)`.
import { CLASS_METHODS } from './classMethods.js'
import { classArity, classClosure, entails, isClass, productLiftable, withDynamicInstances } from './prelude.js'
import { applySubst, constructorArity, instantiate, pred, scheme, showQual, showType, tapp, tcon, tfun, tlist, ttuple, tvar, unify } from './typeSystem.js'

export class DeclError extends Error {}

// ---- Parsing ---------------------------------------------------------------

function tokenize(text) {
  const tokens = []
  const re = /\s*(?:(--[^\n]*)|(::|->|=>|[=|{},()[\]!])|([A-Za-z_][A-Za-z0-9_']*)|(\S))/gy
  let m
  while ((m = re.exec(text)) && m[0] !== '') {
    if (m[1]) continue
    if (m[4]) throw new DeclError(`Unexpected character "${m[4]}"`)
    tokens.push(m[2] || m[3])
  }
  return tokens
}

const isUpper = (t) => /^[A-Z]/.test(t || '')
const isLower = (t) => /^[a-z_]/.test(t || '')
const KEYWORDS = ['data', 'newtype', 'deriving', 'instance', 'where']

function parser(tokens) {
  let i = 0
  const peek = () => tokens[i]
  const next = () => tokens[i++]
  const expect = (t) => {
    if (tokens[i] !== t) throw new DeclError(`Expected "${t}" but found ${tokens[i] ? `"${tokens[i]}"` : 'the end'}`)
    i++
  }
  const upper = (what) => {
    const t = next()
    if (!isUpper(t)) throw new DeclError(`Expected ${what} (a capitalized name) but found ${t ? `"${t}"` : 'the end'}`)
    return t
  }
  // Type syntax trees: { con: 'Maybe', args: [...] } | { var: 'a' } | { list: T } | { unit: true } | { fun: [A, B] }
  function atype() {
    if (peek() === '!') next() // strictness annotations are accepted and ignored
    const t = peek()
    if (t === '(') {
      next()
      if (peek() === ')') { next(); return { unit: true } }
      const inner = type()
      if (peek() === ',') { next(); const second = type(); expect(')'); return { tuple: [inner, second] } }
      expect(')')
      return inner
    }
    if (t === '[') {
      next()
      const inner = type()
      expect(']')
      return { list: inner }
    }
    if (isUpper(t)) { next(); return { con: t, args: [] } }
    if (isLower(t) && !KEYWORDS.includes(t)) { next(); return { var: t } }
    throw new DeclError(`Expected a type but found ${t ? `"${t}"` : 'the end'}`)
  }
  const startsAtype = (t) => t === '(' || t === '[' || t === '!' || isUpper(t) || (isLower(t) && !KEYWORDS.includes(t))
  function btype() {
    const head = atype()
    if (head.var && startsAtype(peek()) && peek() !== '!') {
      // `f a`: a variable standing for a type constructor (only a class method's signature may use one).
      const applied = { varApp: head.var, args: [] }
      while (startsAtype(peek())) applied.args.push(atype())
      return applied
    }
    if (!head.con) return head
    while (startsAtype(peek())) head.args.push(atype())
    return head
  }
  function type() {
    const left = btype()
    if (peek() !== '->') return left
    next()
    return { fun: [left, type()] }
  }
  function constructor() {
    const name = upper('a constructor name')
    if (peek() === '{') {
      next()
      const fields = []
      if (peek() !== '}') {
        do {
          const names = [next()]
          while (peek() === ',') { next(); names.push(next()) }
          names.forEach((n) => { if (!isLower(n)) throw new DeclError(`Field names must start lowercase: "${n}"`) })
          expect('::')
          const t = type()
          names.forEach((n) => fields.push({ name: n, type: t }))
        } while (peek() === ',' && next())
      }
      expect('}')
      return { name, fields, record: true }
    }
    const fields = []
    while (startsAtype(peek())) fields.push({ type: atype() })
    return { name, fields, record: false }
  }
  function deriving() {
    const clauses = []
    while (peek() === 'deriving') {
      next()
      let strategy = 'stock'
      if (['stock', 'anyclass', 'newtype'].includes(peek())) strategy = next()
      const classes = []
      if (peek() === '(') {
        next()
        if (peek() !== ')') {
          classes.push(upper('a class name'))
          while (peek() === ',') { next(); classes.push(upper('a class name')) }
        }
        expect(')')
      } else classes.push(upper('a class name'))
      let via = null
      if (peek() === 'via') {
        next()
        via = btype()
        strategy = 'via'
      }
      clauses.push({ strategy, classes, via })
    }
    return clauses
  }
  function decl() {
    const keyword = next()
    if (keyword !== 'data' && keyword !== 'newtype') throw new DeclError(`A declaration starts with "data" or "newtype", not ${keyword ? `"${keyword}"` : 'nothing'}`)
    const name = upper('a type name')
    const params = []
    while (isLower(peek())) {
      const p = next()
      if (params.includes(p)) throw new DeclError(`Type parameter "${p}" appears twice in ${name}`)
      params.push(p)
    }
    expect('=')
    const constructors = [constructor()]
    while (peek() === '|') { next(); constructors.push(constructor()) }
    const derivings = deriving()
    if (keyword === 'newtype' && (constructors.length !== 1 || constructors[0].fields.length !== 1)) throw new DeclError(`A newtype has exactly one constructor with exactly one field`)
    return { keyword, name, params, constructors, deriving: derivings }
  }
  return {
    decls() {
      const out = []
      while (i < tokens.length) out.push(decl())
      if (!out.length) throw new DeclError('Write a declaration, e.g. data Model = Model { clicks :: Double }')
      return out
    },
    /** A whole type (syntax tree), nothing after it. */
    wholeType() {
      if (!tokens.length) throw new DeclError('Write a type, e.g. a -> String')
      const t = type()
      if (i < tokens.length) throw new DeclError(`Unexpected "${tokens[i]}" after the type`)
      return t
    },
    /** A context `C a` or `(C a, D b)`: `[{ cls, var }]`. */
    context() {
      const one = () => {
        const cls = upper('a class name')
        const v = next()
        if (!isLower(v)) throw new DeclError(`Expected a type variable after ${cls}, found ${v ? `"${v}"` : 'the end'}`)
        return { cls, var: v }
      }
      const out = []
      if (peek() === '(') {
        next()
        if (peek() !== ')') { out.push(one()); while (peek() === ',') { next(); out.push(one()) } }
        expect(')')
      } else if (tokens.length) out.push(one())
      if (i < tokens.length) throw new DeclError(`Unexpected "${tokens[i]}" in the context`)
      return out
    },
  }
}

/**
 * Parse a type signature `[context =>] type` — a class method's, e.g.
 * `Show b => a -> b -> String` — resolving its type names against `types`.
 * Every lowercase name is a type variable. Returns `{ preds, type }`.
 */
export function parseSignature(text, types = {}) {
  const [ctxText, typeText] = text.includes('=>') ? [text.slice(0, text.indexOf('=>')), text.slice(text.indexOf('=>') + 2)] : ['', text]
  const syntax = parser(tokenize(typeText)).wholeType()
  const vars = new Set()
  const walk = (t) => { if (t.var) vars.add(t.var); (t.args || []).forEach(walk); if (t.list) walk(t.list); if (t.fun) t.fun.forEach(walk); if (t.tuple) t.tuple.forEach(walk) }
  walk(syntax)
  const known = new Map([...builtinTypeNames.map((n) => [n, constructorArity[n] || 0]), ...Object.values(types).map((d) => [d.name, (d.params || []).length])])
  const type = resolveType(syntax, known, [...vars], { applyVars: true })
  const preds = parseContext(ctxText).map((c) => {
    if (!vars.has(c.var)) throw new DeclError(`The constraint ${c.cls} ${c.var} is about a type variable the type doesn't mention`)
    if (!isClass(c.cls)) throw new DeclError(`No class named ${c.cls}`)
    return pred(c.cls, tvar(c.var))
  })
  return { preds, type }
}

/**
 * Parse a bare type (no context) against `known` (type name -> how many type
 * arguments it takes). Every lowercase name is a type variable, kept by name
 * (`tvar('a')`), and may stand for a constructor (`f a`).
 */
export function parseTypeText(text, known) {
  const syntax = parser(tokenize(text)).wholeType()
  const vars = new Set()
  const walk = (t) => { if (t.var) vars.add(t.var); if (t.varApp) vars.add(t.varApp); (t.args || []).forEach(walk); if (t.list) walk(t.list); if (t.fun) t.fun.forEach(walk); if (t.tuple) t.tuple.forEach(walk) }
  walk(syntax)
  return resolveType(syntax, known, [...vars], { applyVars: true })
}

/** Parse a context `C a, D b` (parentheses optional): `[{ cls, var }]`. */
export function parseContext(text) {
  const trimmed = text.trim()
  if (!trimmed) return []
  return parser(tokenize(/^\(.*\)$/.test(trimmed) ? trimmed : `(${trimmed})`)).context()
}

/** Parse one or more Haskell `data`/`newtype` declarations into syntax trees (field types unresolved). */
export function parseDecls(text) {
  return parser(tokenize(text)).decls()
}

// ---- Resolution and checking -------------------------------------------------

/** Built-in type names a field may mention (beyond the declared ones). */
export const builtinTypeNames = ['Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational', 'Bool', 'Char', 'String', 'StdGen', 'Picture', 'Color', ...Object.keys(constructorArity)]

// `known`: type name -> how many arguments it takes; `params`: the type
// parameters in scope (the declaration's own).
function resolveType(t, known, params = [], opts = {}) {
  const go = (u) => resolveType(u, known, params, opts)
  if (t.varApp) {
    if (!opts.applyVars) throw new DeclError(`A type parameter can't be applied to arguments ("${t.varApp} …") — parameters stand for plain types`)
    return t.args.reduce((acc, arg) => tapp(acc, go(arg)), tvar(t.varApp))
  }
  if (t.var) {
    if (!params.includes(t.var)) throw new DeclError(`Type variable "${t.var}" isn't a parameter of this type — declare it after the type name (data T ${t.var} = …)`)
    return tvar(t.var)
  }
  if (t.unit) return tcon('()')
  if (t.tuple) return ttuple(go(t.tuple[0]), go(t.tuple[1]))
  if (t.list) return tlist(go(t.list))
  if (t.fun) return tfun(go(t.fun[0]), go(t.fun[1]))
  if (t.con === 'String' && !t.args.length) return tlist(tcon('Char'))
  if (!known.has(t.con)) throw new DeclError(`Unknown type "${t.con}"`)
  const resolved = t.args.reduce((acc, arg) => tapp(acc, go(arg)), tcon(t.con))
  const arity = known.get(t.con)
  if (t.args.length !== arity) throw new DeclError(`"${showType(resolved, (id) => id)}" has the wrong number of type arguments (${t.con} takes ${arity})`)
  return resolved
}

/** How many type arguments each declared type takes. */
export function typeArities(types) {
  return Object.fromEntries(Object.values(types).map((d) => [d.name, (d.params || []).length]))
}

/** The type a declaration declares, applied to its own parameters: `Pair a`. */
export function declType(d, prefix = '') {
  return (d.params || []).reduce((acc, p) => tapp(acc, tvar(prefix + p)), tcon(d.name))
}

const sameType = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1)

/**
 * Turn parsed declarations into stored declarations (field types resolved
 * to Type objects) and add them to `types` (a copy is returned; the input is
 * untouched). `source` is kept so the declaration can be edited as written.
 * Throws DeclError on any problem, checking the whole result: unknown
 * types, duplicate names, clashes with existing function names, and
 * underivable `deriving` clauses.
 */
export function declareTypes(types, text, { replacing = null, functionLabels = [], instances = null } = {}) {
  const parsed = parseDecls(text)
  const next = { ...types }
  if (replacing) delete next[replacing]
  for (const d of parsed) {
    if (next[d.name]) throw new DeclError(`Type "${d.name}" is already declared`)
    if (builtinTypeNames.includes(d.name) || d.name === '()') throw new DeclError(`"${d.name}" is a built-in type`)
    if (d.params.includes('r')) throw new DeclError(`Type parameter "r" is kept for the result of case${d.name} — use another letter`)
    // Hand-written instances aren't part of the `data` syntax: they come
    // from the editor's draft, or stay with the declaration being replaced.
    const written = instances ?? (replacing && parsed.length === 1 ? types[replacing]?.instances : null) ?? []
    next[d.name] = { name: d.name, keyword: d.keyword, params: d.params, constructors: d.constructors, deriving: d.deriving, instances: structuredClone(written), source: parsed.length === 1 ? text.trim() : null }
  }
  // Resolve field types against every declared name (so declarations may refer to each other).
  const known = new Map([...builtinTypeNames.map((n) => [n, constructorArity[n] || 0]), ...Object.values(next).map((d) => [d.name, (d.params || []).length])])
  for (const d of parsed) {
    next[d.name] = {
      ...next[d.name],
      source: next[d.name].source ?? printDecl(next[d.name]),
      constructors: d.constructors.map((c) => ({ name: c.name, record: c.record, fields: c.fields.map((f) => ({ name: f.name ?? null, type: resolveType(f.type, known, d.params) })) })),
    }
  }
  checkTypes(next, functionLabels)
  return next
}

/** `types` with every mention of type `from` in a field renamed to `to` (for renaming a declaration others use). */
export function renameTypeReferences(types, from, to) {
  const rename = (t) => {
    if (t.kind === 'con') return t.name === from ? tcon(to) : t
    if (t.kind === 'fun') return tfun(rename(t.from), rename(t.to))
    if (t.kind === 'app') return tapp(rename(t.fn), rename(t.arg))
    return t
  }
  return Object.fromEntries(Object.entries(types).map(([name, d]) => [name, { ...d, source: null, constructors: d.constructors.map((c) => ({ ...c, fields: c.fields.map((fl) => ({ ...fl, type: rename(fl.type) })) })) }]))
}

function printSyntax(t, asArg = false) {
  if (t.var) return t.var
  if (t.unit) return '()'
  if (t.tuple) return `(${printSyntax(t.tuple[0])}, ${printSyntax(t.tuple[1])})`
  if (t.list) return `[${printSyntax(t.list)}]`
  if (t.fun) return `(${printSyntax(t.fun[0])} -> ${printSyntax(t.fun[1])})`
  const s = [t.con, ...t.args.map((a) => printSyntax(a, true))].join(' ')
  return asArg && t.args.length ? `(${s})` : s
}

function printDecl(d) {
  const ctors = d.constructors.map((c) => (c.record ? `${c.name} { ${c.fields.map((f) => `${f.name} :: ${printSyntax(f.type)}`).join(', ')} }` : [c.name, ...c.fields.map((f) => printSyntax(f.type, true))].join(' ')))
  const derivs = d.deriving.map((c) => ` deriving${['anyclass', 'newtype'].includes(c.strategy) ? ` ${c.strategy}` : ''} (${c.classes.join(', ')})${c.via ? ` via ${printSyntax(c.via)}` : ''}`)
  return `${d.keyword} ${[d.name, ...(d.params || [])].join(' ')} = ${ctors.join(' | ')}${derivs.join('')}`
}

// What each `deriving` strategy can produce, as in GHC:
// - stock: the standard derivable classes;
// - via Generically: Semigroup/Monoid fieldwise, for a product (as base's
//   `Generically` does);
// - anyclass: the pointwise algebraic structures a product admits — exactly
//   the classes defined by equations alone (Lawvere theories, whose models
//   are closed under products; see categoryClasses.js);
// - newtype: anything the wrapped type has (GeneralizedNewtypeDeriving).
const STOCK = ['Eq', 'Ord', 'Show']
const VIA_GENERICALLY = ['Semigroup', 'Monoid']
const NOT_LIFTABLE = {
  Field: "a product of fields isn't a field: only non-zero elements have inverses — not an equation, so it doesn't survive products ((1, 0) has no inverse)",
  Ord: 'a product of total orders is only a partial order — derive PartialOrd/Lattice and compare with leq',
}
function whyNotLiftable(cls) {
  for (const [root, why] of Object.entries(NOT_LIFTABLE)) if (classClosure(cls).includes(root)) return why
  return null
}

/** The `{ cls, type }` instances a set of declarations derives (unchecked). */
function requestedInstances(types) {
  return Object.values(types).flatMap((d) => d.deriving.flatMap((c) => c.classes.map((cls) => ({ cls, type: d.name, strategy: c.strategy, via: c.via }))))
}

/** The `{ cls, type, methods }` instances written by hand (unchecked). */
function writtenInstances(types) {
  return Object.values(types).flatMap((d) => (d.instances || []).map((i) => ({ cls: i.cls, type: d.name, methods: i.methods || {}, written: true })))
}

/** Parameters of `d` that some field mentions (a phantom parameter needs nothing). */
function usedParams(d) {
  const used = new Set()
  const walk = (t) => {
    if (t.kind === 'var') used.add(t.id)
    else if (t.kind === 'fun') { walk(t.from); walk(t.to) } else if (t.kind === 'app') { walk(t.fn); walk(t.arg) }
  }
  d.constructors.forEach((c) => c.fields.forEach((fl) => walk(fl.type)))
  return (d.params || []).filter((p) => used.has(p))
}

/**
 * An instance's head and context. For a class on types: `C (T a b)` under
 * `C a, C b` for the parameters the fields use (GHC's inferred context for
 * stock deriving). For a constructor class (Functor): `C T` — `C (T a)` for
 * a two-parameter type — with no context. `prefix` names the head's
 * variables (`$` for the instance table's pattern variables).
 */
function instanceShape(d, cls, prefix = '') {
  const params = d.params || []
  const k = classArity(cls)
  if (k) return { head: params.slice(0, params.length - k).reduce((acc, p) => tapp(acc, tvar(prefix + p)), tcon(d.name)), context: [] }
  return { head: declType(d, prefix), context: usedParams(d).map((p) => pred(cls, tvar(prefix + p))) }
}

function checkStrategy(r, d) {
  const where = `deriving ${r.cls} for ${r.type}`
  const isProduct = d.constructors.length === 1
  if (r.strategy === 'stock') {
    if (!STOCK.includes(r.cls)) throw new DeclError(`${where}: stock deriving covers ${STOCK.join(', ')} — try \`deriving anyclass\`, \`deriving newtype\` or \`via Generically ${d.name}\``)
  } else if (r.strategy === 'via') {
    if (!(r.via?.con === 'Generically' && r.via.args.length === 1 && r.via.args[0].con === d.name)) throw new DeclError(`${where}: only \`via Generically ${d.name}\` is supported`)
    if (!VIA_GENERICALLY.includes(r.cls)) throw new DeclError(`${where}: Generically gives ${VIA_GENERICALLY.join(' and ')}`)
    if (!isProduct) throw new DeclError(`${where}: Generically needs a product (one constructor), not a sum`)
  } else if (r.strategy === 'anyclass') {
    const why = whyNotLiftable(r.cls)
    if (why) throw new DeclError(`${where}: ${why}`)
    if (!productLiftable.includes(r.cls) || VIA_GENERICALLY.includes(r.cls)) throw new DeclError(`${where}: anyclass deriving covers the pointwise structures ${productLiftable.filter((c) => !VIA_GENERICALLY.includes(c)).join(', ')}${VIA_GENERICALLY.includes(r.cls) ? ` (use via Generically ${d.name})` : ''}`)
    if (!isProduct) throw new DeclError(`${where}: a pointwise structure needs a product (one constructor), not a sum`)
  } else if (r.strategy === 'newtype') {
    if (d.keyword !== 'newtype') throw new DeclError(`${where}: newtype deriving needs a newtype declaration`)
  }
}

/**
 * Check a whole set of declarations. Instances are judged together (a
 * recursive type's `Eq` may rely on its own `Eq`), Haskell-style: an
 * instance needs every superclass instance, and every field must have the
 * class too.
 */
export function checkTypes(types, functionLabels = []) {
  for (const d of Object.values(types)) {
    for (const p of d.params || []) if (d.constructors.some((c) => c.name === p)) throw new DeclError(`${d.name}: "${p}" is both a parameter and a constructor`)
  }
  const names = new Map() // generated function label -> what generated it
  for (const label of functionLabels) names.set(label, 'an existing function')
  for (const d of Object.values(types)) {
    const ctorNames = new Set()
    for (const c of d.constructors) {
      if (ctorNames.has(c.name)) throw new DeclError(`Constructor "${c.name}" appears twice in ${d.name}`)
      ctorNames.add(c.name)
      const fieldNames = c.fields.filter((f) => f.name).map((f) => f.name)
      const dup = fieldNames.find((n, i) => fieldNames.indexOf(n) !== i)
      if (dup) throw new DeclError(`Field "${dup}" appears twice in ${c.name}`)
    }
    for (const def of derivedDefinitions({ [d.name]: d })) {
      if (names.has(def.label)) throw new DeclError(`"${def.label}" (from ${d.name}) clashes with ${names.get(def.label)}`)
      names.set(def.label, `${d.name}'s ${def.derived.op}`)
    }
  }
  const requested = requestedInstances(types)
  for (const r of requested) {
    if (!isClass(r.cls)) throw new DeclError(`deriving ${r.cls} for ${r.type}: no such class`)
    checkStrategy(r, types[r.type])
  }
  const written = writtenInstances(types)
  const seen = new Set(requested.map((r) => `${r.cls} ${r.type}`))
  for (const w of written) {
    const where = `instance ${w.cls} ${w.type}`
    if (!isClass(w.cls)) throw new DeclError(`${where}: no such class`)
    if (!CLASS_METHODS[w.cls]) throw new DeclError(`${where}: ${w.cls}'s methods work on the host's numbers, so it can't be written by hand`)
    if ((types[w.type].params || []).length < classArity(w.cls)) throw new DeclError(`${where}: ${w.cls} is for type constructors — give ${w.type} a type parameter (data ${w.type} a = …)`)
    if (seen.has(`${w.cls} ${w.type}`)) throw new DeclError(`${where}: ${w.type} already has ${w.cls} (derived, or written twice)`)
    seen.add(`${w.cls} ${w.type}`)
  }
  // Judge with every instance in scope (allows recursion), assuming the
  // instance's own context (`Eq a` while judging `Eq (Pair a)`).
  const instances = derivedInstances(types)
  for (const r of [...requested, ...written]) {
    const d = types[r.type]
    const { head, context } = instanceShape(d, r.cls)
    const what = r.written ? `instance ${r.cls} ${r.type}` : `deriving ${r.cls} for ${r.type}`
    for (const sup of classClosure(r.cls).filter((c) => c !== r.cls)) {
      if (!entailsWith(instances, context, pred(sup, head))) throw new DeclError(`${what} needs an ${sup} instance — ${r.written ? `derive or write ${sup} too` : `add ${sup} to its deriving clause`}`)
    }
    if (r.written) continue // a hand-written instance answers for itself (its methods are checked against their types)
    for (const c of d.constructors) {
      for (const fl of c.fields) {
        if (!entailsWith(instances, context, pred(r.cls, fl.type))) throw new DeclError(`deriving ${r.cls} for ${r.type}: field ${fl.name ? `"${fl.name}"` : `of ${c.name}`} has type ${showType(fl.type, (id) => id)}, which has no ${r.cls} instance`)
      }
    }
  }
}

// Judge `p` from `given` as if `instances` were the only derived instances in scope.
function entailsWith(instances, given, p) {
  return withDynamicInstances(instances, () => entails(given, p))
}

/** The instances a (checked) set of declarations contributes to the class environment, derived and written. */
export function derivedInstances(types) {
  return [...requestedInstances(types), ...writtenInstances(types)].map((r) => ({ cls: r.cls, ...instanceShape(types[r.type], r.cls, '$') }))
}

/**
 * What a hand-written method must be: the method's type at this instance —
 * `show :: Show a ⇒ a → String` at `Pair b` is `Pair b → String`, given
 * `Show b`. Returns `{ type, given }`; the type's variables (the
 * declaration's parameters and the method's own others) are to be held
 * rigid when an implementation is checked against it.
 */
export function methodTypeAt(d, cls, methodScheme) {
  const { head, context } = instanceShape(d, cls, '')
  const classVar = methodScheme.preds.find((p) => p.cls === cls)?.type.id
  const rename = (t) => {
    if (t.kind === 'var') return t.id === classVar ? head : tvar(`m:${t.id}`)
    if (t.kind === 'fun') return tfun(rename(t.from), rename(t.to))
    if (t.kind === 'app') return tapp(rename(t.fn), rename(t.arg))
    return t
  }
  const others = methodScheme.preds.filter((p) => p.cls !== cls).map((p) => pred(p.cls, rename(p.type)))
  return { type: rename(methodScheme.type), given: [...context, ...others] }
}

/**
 * Why a function of type `have` (a scheme) can't implement a method (of
 * scheme `methodScheme`) of `instance cls d`, or '' if it can: it must be at
 * least as general as the method's type at the instance (`showMoney ::
 * Money → String`; `a → String` would do too), whose variables are held
 * rigid, and any constraint it leaves must follow from the instance's
 * context. Call with the instance in scope (it may be used recursively).
 */
export function methodTypeProblem(have, d, cls, methodScheme) {
  const { type: want, given } = methodTypeAt(d, cls, methodScheme)
  return schemeProblem(have, want, given)
}

/**
 * Why a function of scheme `have` can't be used where type `want` is
 * required (its variables held rigid, constraints `given` in hand), or ''
 * if it can: `have` must be at least as general, and every constraint it
 * leaves must follow from `given`. (Variable ids `m:x` print as `x`.)
 */
export function schemeProblem(have, want, given) {
  const bare = (id) => id.replace('m:', '')
  const rigid = (t) => (t.kind === 'var' ? tcon(`'${bare(t.id)}`) : t.kind === 'fun' ? tfun(rigid(t.from), rigid(t.to)) : t.kind === 'app' ? tapp(rigid(t.fn), rigid(t.arg)) : t)
  const shown = showQual(given, want, bare)
  const inst = instantiate(have)
  let s
  try {
    s = unify(inst.type, rigid(want))
  } catch {
    return `has type ${showQual(have.preds, have.type)}, needs ${shown}`
  }
  const assumed = given.map((p) => pred(p.cls, rigid(p.type)))
  const missing = inst.preds.map((p) => pred(p.cls, applySubst(s, p.type))).find((p) => !entails(assumed, p))
  return missing ? `needs ${missing.cls} ${showType(missing.type).replaceAll("'", '')}, which ${shown} doesn't give` : ''
}

/**
 * Read-only function definitions derived from `types`, keyed by id, in the
 * same shape as main.js's `nodes` entries — plus a `scheme` (their type) and
 * a `derived` descriptor the evaluator runs.
 */
export function derivedDefinitions(types) {
  const defs = []
  for (const d of Object.values(types)) {
    const T = declType(d)
    const vs = [...(d.params || [])]
    const r = tvar('r')
    const curried = (args, result) => args.reduceRight((acc, t) => tfun(t, acc), result)
    d.constructors.forEach((c, ctorIndex) => {
      defs.push({
        label: c.name,
        params: c.fields.map((f, i) => f.name || `x${i + 1}`),
        scheme: scheme(vs, [], curried(c.fields.map((f) => f.type), T)),
        derived: { op: 'construct', type: d.name, ctor: c.name, ctorIndex, arity: c.fields.length },
      })
    })
    const only = d.constructors.length === 1 ? d.constructors[0] : null
    if (only?.record) {
      only.fields.forEach((f, fieldIndex) => {
        defs.push({ label: f.name, params: [lowerFirst(d.name)], scheme: scheme(vs, [], tfun(T, f.type)), derived: { op: 'get', type: d.name, ctor: only.name, fieldCount: only.fields.length, fieldIndex, arity: 1 } })
        defs.push({ label: `set ${f.name}`, params: [f.name, lowerFirst(d.name)], scheme: scheme(vs, [], tfun(f.type, tfun(T, T))), derived: { op: 'set', type: d.name, ctor: only.name, fieldCount: only.fields.length, fieldIndex, arity: 2 } })
        defs.push({ label: `over ${f.name}`, params: ['f', lowerFirst(d.name)], scheme: scheme(vs, [], tfun(tfun(f.type, f.type), tfun(T, T))), derived: { op: 'over', type: d.name, ctor: only.name, fieldCount: only.fields.length, fieldIndex, arity: 2 } })
      })
    }
    defs.push({
      label: `case${d.name}`,
      params: [...d.constructors.map((c) => lowerFirst(c.name)), lowerFirst(d.name)],
      scheme: scheme([...vs, 'r'], [], curried(d.constructors.map((c) => curried(c.fields.map((f) => f.type), r)), tfun(T, r))),
      derived: { op: 'case', type: d.name, arities: d.constructors.map((c) => c.fields.length), arity: d.constructors.length + 1 },
    })
    // An inductive (recursive) type also gets its recursor — structural
    // recursion, like `foldr` for lists: each branch receives the recursive
    // fields already folded (their type T replaced by the result r), e.g.
    // `data Nat = Z | S Nat` gives foldNat :: r → (r → r) → Nat → r.
    // Only direct occurrences of T are folded; T inside another type
    // (`[T]`, `Maybe T`) is passed through as is.
    // (For a parameterized type, the recursive occurrence is T at its own parameters.)
    const isSelf = (t) => sameType(t, T)
    const recursive = d.constructors.map((c) => c.fields.map((f) => isSelf(f.type)))
    if (recursive.some((fs) => fs.some(Boolean))) {
      defs.push({
        label: `fold${d.name}`,
        params: [...d.constructors.map((c) => lowerFirst(c.name)), lowerFirst(d.name)],
        scheme: scheme([...vs, 'r'], [], curried(d.constructors.map((c) => curried(c.fields.map((f) => (isSelf(f.type) ? r : f.type)), r)), tfun(T, r))),
        derived: { op: 'fold', type: d.name, arities: d.constructors.map((c) => c.fields.length), recursive, arity: d.constructors.length + 1 },
      })
    }
  }
  return defs.map((def) => {
    const id = `type:${def.derived.type}:${def.label}`
    return { id, type: 'function', readonly: true, color: '#3cbe9e', mounted: def.params.map(() => null), paramScopes: def.params.map(() => 'local'), scope: 'main', ...def, params: [...def.params] }
  })
}

// ---- Editing a declaration as its constructor functions -------------------
// The type editor shows a declaration as what it is made of: constructor
// functions, each with its fields written inside it (`clicks :: Double`).
// A draft is that editable shape; it turns back into Haskell source and goes
// through declareTypes, so every check above still applies.

const asHaskell = (type) => showType(type, (id) => id).replaceAll('→', '->')

/** An editable draft of declaration `d` (or of a new, empty type). */
export function declToDraft(d) {
  if (!d) return { name: 'NewType', keyword: 'data', params: [], constructors: [{ name: 'NewType', fields: [] }], deriving: { stock: [], anyclass: [], via: [], newtype: [] }, instances: [] }
  const deriving = { stock: [], anyclass: [], via: [], newtype: [] }
  for (const c of d.deriving) deriving[c.strategy]?.push(...c.classes)
  return {
    name: d.name,
    keyword: d.keyword,
    params: [...(d.params || [])],
    constructors: d.constructors.map((c) => ({ name: c.name, fields: c.fields.map((f) => ({ name: f.name || '', type: asHaskell(f.type) })) })),
    deriving,
    instances: structuredClone(d.instances || []),
  }
}

/** Haskell source for a draft. A constructor is a record when its fields are named. */
export function draftToSource(draft) {
  const ctor = (c) => {
    const named = c.fields.filter((f) => f.name.trim())
    if (named.length && named.length !== c.fields.length) throw new DeclError(`${c.name}: name every field or none`)
    if (named.length) return `${c.name} { ${c.fields.map((f) => `${f.name.trim()} :: ${f.type.trim() || '?'}`).join(', ')} }`
    return [c.name, ...c.fields.map((f) => { const t = f.type.trim() || '?'; return /[\s>]/.test(t) && !/^[[(].*[\])]$/.test(t) ? `(${t})` : t })].join(' ')
  }
  const head = [draft.name, ...(draft.params || [])].join(' ')
  const d = draft.deriving
  const clauses = [
    d.stock.length && ` deriving stock (${d.stock.join(', ')})`,
    d.anyclass.length && ` deriving anyclass (${d.anyclass.join(', ')})`,
    d.via.length && ` deriving (${d.via.join(', ')}) via Generically ${(draft.params || []).length ? `(${head})` : draft.name}`,
    d.newtype.length && ` deriving newtype (${d.newtype.join(', ')})`,
  ].filter(Boolean)
  return `${draft.keyword} ${head} = ${draft.constructors.map(ctor).join(' | ')}${clauses.join('')}`
}
