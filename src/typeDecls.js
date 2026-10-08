// User type declarations, written in Haskell syntax:
//
//   data Model = Model { clicks :: Double, perClick :: Double } deriving (Eq, Show)
//   data Event = Click | Tick Double | Buy Int deriving Show
//   newtype Score = Score Int
//   data Tree a = Leaf | Node (Tree a) a (Tree a) deriving (Eq, Show)
//
// A declaration may take type parameters (`Tree a`): its functions are then
// polymorphic in them (`Node :: Tree a → a → Tree a → Tree a`), and a
// derived instance needs the class of each parameter, as Haskell infers
// (`instance Eq a => Eq (Tree a)`).
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
// and registers the instances its `deriving` clauses ask for.
import { classClosure, entails, isClass, productLiftable, withDynamicInstances } from './prelude.js'
import { constructorArity, pred, scheme, showType, tapp, tcon, tfun, tlist, ttuple, tvar, wellKinded } from './typeSystem.js'

export class DeclError extends Error {}

// ---- Parsing ---------------------------------------------------------------

function tokenize(text) {
  const tokens = []
  const re = /\s*(?:(--[^\n]*)|(::|->|[=|{},()[\]!])|([A-Za-z_][A-Za-z0-9_']*)|(\S))/gy
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
// A type variable — any lowercase name but the keywords that end a declaration or start the next.
const isTypeVar = (t) => isLower(t) && !['data', 'newtype', 'deriving'].includes(t)

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
    if (isTypeVar(t)) { next(); return { var: t } }
    throw new DeclError(`Expected a type but found ${t ? `"${t}"` : 'the end'}`)
  }
  const startsAtype = (t) => t === '(' || t === '[' || t === '!' || isUpper(t) || isTypeVar(t)
  function btype() {
    const head = atype()
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
  }
}

/** Parse one or more Haskell `data`/`newtype` declarations into syntax trees (field types unresolved). */
export function parseDecls(text) {
  return parser(tokenize(text)).decls()
}

// ---- Resolution and checking -------------------------------------------------

/** Built-in type names a field may mention (beyond the declared ones). */
export const builtinTypeNames = ['Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational', 'Bool', 'Char', 'String', 'StdGen', 'Picture', 'Color', ...Object.keys(constructorArity)]

// `known`: type name -> how many arguments it takes; `params`: the
// declaration's own type parameters (each of kind *).
function resolveType(t, known, params = []) {
  const go = (u) => resolveType(u, known, params)
  if (t.unit) return tcon('()')
  if (t.var) {
    if (!params.includes(t.var)) throw new DeclError(`Type variable "${t.var}" isn't a parameter of the type — declare it after the type's name`)
    return tvar(t.var)
  }
  if (t.tuple) return ttuple(go(t.tuple[0]), go(t.tuple[1]))
  if (t.list) return tlist(go(t.list))
  if (t.fun) return tfun(go(t.fun[0]), go(t.fun[1]))
  if (t.con === 'String' && !t.args.length) return tlist(tcon('Char'))
  if (!known.has(t.con)) throw new DeclError(`Unknown type "${t.con}"`)
  const resolved = t.args.reduce((acc, arg) => tapp(acc, go(arg)), tcon(t.con))
  if (known.get(t.con) !== t.args.length || !wellKinded(resolved, (n) => known.get(n) ?? 0)) throw new DeclError(`"${showType(resolved)}" has the wrong number of type arguments (${t.con} takes ${known.get(t.con)})`)
  return resolved
}

/** The type a declaration declares: its name applied to its parameters (`Tree a`). */
export function declaredType(d) {
  return (d.params || []).reduce((acc, p) => tapp(acc, tvar(p)), tcon(d.name))
}

/** How many type arguments each declared type takes. */
export function declaredArities(types) {
  return Object.fromEntries(Object.values(types).map((d) => [d.name, (d.params || []).length]))
}

const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1)

/**
 * Turn parsed declarations into stored declarations (field types resolved
 * to Type objects) and add them to `types` (a copy is returned; the input is
 * untouched). `source` is kept so the declaration can be edited as written.
 * Throws DeclError on any problem, checking the whole result: unknown
 * types, duplicate names, clashes with existing function names, and
 * underivable `deriving` clauses.
 */
export function declareTypes(types, text, { replacing = null, functionLabels = [], builtin = false } = {}) {
  const parsed = parseDecls(text)
  const next = { ...types }
  if (replacing) delete next[replacing]
  for (const d of parsed) {
    if (next[d.name]) throw new DeclError(`Type "${d.name}" is already declared`)
    if (!builtin && (builtinTypeNames.includes(d.name) || d.name === '()')) throw new DeclError(`"${d.name}" is a built-in type`)
    next[d.name] = { name: d.name, keyword: d.keyword, params: d.params, constructors: d.constructors, deriving: d.deriving, source: parsed.length === 1 ? text.trim() : null }
  }
  // Resolve field types against every declared name (so declarations may refer to each other).
  const known = new Map([...builtinTypeNames.map((n) => [n, constructorArity[n] || 0]), ...Object.entries(declaredArities(next))])
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

function printSyntax(t, asArg = false) {
  if (t.unit) return '()'
  if (t.var) return t.var
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

function checkStrategy(r, d) {
  const where = `deriving ${r.cls} for ${r.type}`
  const isProduct = d.constructors.length === 1
  if (r.strategy === 'stock') {
    if (!STOCK.includes(r.cls)) throw new DeclError(`${where}: stock deriving covers ${STOCK.join(', ')} — try \`deriving anyclass\`, \`deriving newtype\` or \`via Generically ${d.name}\``)
  } else if (r.strategy === 'via') {
    if (!(r.via?.con === 'Generically' && r.via.args.length === 1 && r.via.args[0].con === d.name)) throw new DeclError(`${where}: only \`via Generically ${d.name}\` is supported`)
    if (d.params?.length) throw new DeclError(`${where}: via Generically needs a type without parameters`)
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
  // Judge with all requested instances in scope (allows recursion). A type
  // with parameters is judged under its instance's context: its parameters
  // are assumed to have the class.
  const instances = derivedInstances(types)
  for (const r of requested) {
    const d = types[r.type]
    const given = (d.params || []).map((p) => pred(r.cls, tvar(p)))
    for (const sup of classClosure(r.cls).filter((c) => c !== r.cls)) {
      const supGiven = (d.params || []).map((p) => pred(sup, tvar(p)))
      if (!entailsWith(instances, pred(sup, declaredType(d)), [...given, ...supGiven])) throw new DeclError(`deriving ${r.cls} for ${r.type} needs an ${sup} instance — add ${sup} to its deriving clause`)
    }
    for (const c of d.constructors) {
      for (const f of c.fields) {
        if (!entailsWith(instances, pred(r.cls, f.type), given)) throw new DeclError(`deriving ${r.cls} for ${r.type}: field ${f.name ? `"${f.name}"` : `of ${c.name}`} has type ${showType(f.type)}, which has no ${r.cls} instance`)
      }
    }
  }
}

// Judge `p` (assuming `given`) as if `instances` were the only derived instances in scope.
function entailsWith(instances, p, given = []) {
  return withDynamicInstances(instances, () => entails(given, p))
}

/**
 * The instances a (checked) set of declarations contributes to the class
 * environment: `instance C (T a b)`, needing `C a` and `C b` when the type
 * has parameters (instance heads use `$`-variables, as dataTypes.js's do).
 */
export function derivedInstances(types) {
  return requestedInstances(types).map((r) => {
    const params = types[r.type].params || []
    return { cls: r.cls, head: params.reduce((acc, p) => tapp(acc, tvar(`$${p}`)), tcon(r.type)), context: params.map((p) => pred(r.cls, tvar(`$${p}`))) }
  })
}

/**
 * Read-only function definitions derived from `types`, keyed by id, in the
 * same shape as main.js's `nodes` entries — plus a `scheme` (their type) and
 * a `derived` descriptor the evaluator runs.
 */
export function derivedDefinitions(types) {
  const defs = []
  for (const d of Object.values(types)) {
    const T = declaredType(d)
    const params = d.params || []
    // The result type of an eliminator, named clear of the type's parameters.
    let rName = 'r'
    while (params.includes(rName)) rName = `${rName}'`
    const r = tvar(rName)
    const curried = (args, result) => args.reduceRight((acc, t) => tfun(t, acc), result)
    d.constructors.forEach((c, ctorIndex) => {
      defs.push({
        label: c.name,
        params: c.fields.map((f, i) => f.name || `x${i + 1}`),
        scheme: scheme([...params], [], curried(c.fields.map((f) => f.type), T)),
        derived: { op: 'construct', type: d.name, ctor: c.name, ctorIndex, arity: c.fields.length },
      })
    })
    const only = d.constructors.length === 1 ? d.constructors[0] : null
    // What the eliminators need to read a bare number or mempty standing for a value of the type.
    const shape = only ? { ctor: only.name, fieldCount: only.fields.length } : {}
    if (only?.record) {
      only.fields.forEach((f, fieldIndex) => {
        defs.push({ label: f.name, params: [lowerFirst(d.name)], scheme: scheme([...params], [], tfun(T, f.type)), derived: { op: 'get', type: d.name, ctor: only.name, fieldCount: only.fields.length, fieldIndex, arity: 1 } })
        defs.push({ label: `set ${f.name}`, params: [f.name, lowerFirst(d.name)], scheme: scheme([...params], [], tfun(f.type, tfun(T, T))), derived: { op: 'set', type: d.name, ctor: only.name, fieldCount: only.fields.length, fieldIndex, arity: 2 } })
        defs.push({ label: `over ${f.name}`, params: ['f', lowerFirst(d.name)], scheme: scheme([...params], [], tfun(tfun(f.type, f.type), tfun(T, T))), derived: { op: 'over', type: d.name, ctor: only.name, fieldCount: only.fields.length, fieldIndex, arity: 2 } })
      })
    }
    defs.push({
      label: `case${d.name}`,
      params: [...d.constructors.map((c) => lowerFirst(c.name)), lowerFirst(d.name)],
      scheme: scheme([...params, rName], [], curried(d.constructors.map((c) => curried(c.fields.map((f) => f.type), r)), tfun(T, r))),
      derived: { op: 'case', type: d.name, arities: d.constructors.map((c) => c.fields.length), arity: d.constructors.length + 1, ...shape },
    })
    // An inductive (recursive) type also gets its recursor — structural
    // recursion, like `foldr` for lists: each branch receives the recursive
    // fields already folded (their type T replaced by the result r), e.g.
    // `data Nat = Z | S Nat` gives foldNat :: r → (r → r) → Nat → r.
    // Only direct occurrences of T are folded; T inside another type
    // (`[T]`, `Maybe T`) is passed through as is.
    const isSelf = (t) => sameType(t, T)
    const recursive = d.constructors.map((c) => c.fields.map((f) => isSelf(f.type)))
    if (recursive.some((fs) => fs.some(Boolean))) {
      defs.push({
        label: `fold${d.name}`,
        params: [...d.constructors.map((c) => lowerFirst(c.name)), lowerFirst(d.name)],
        scheme: scheme([...params, rName], [], curried(d.constructors.map((c) => curried(c.fields.map((f) => (isSelf(f.type) ? r : f.type)), r)), tfun(T, r))),
        derived: { op: 'fold', type: d.name, arities: d.constructors.map((c) => c.fields.length), recursive, arity: d.constructors.length + 1, ...shape },
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

function sameType(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'var') return a.id === b.id
  if (a.kind === 'con') return a.name === b.name
  if (a.kind === 'fun') return sameType(a.from, b.from) && sameType(a.to, b.to)
  return sameType(a.fn, b.fn) && sameType(a.arg, b.arg)
}

/** An editable draft of declaration `d` (or of a new, empty type). */
export function declToDraft(d) {
  if (!d) return { name: 'NewType', keyword: 'data', params: [], constructors: [{ name: 'NewType', fields: [] }], deriving: { stock: [], anyclass: [], via: [], newtype: [] } }
  const deriving = { stock: [], anyclass: [], via: [], newtype: [] }
  for (const c of d.deriving) deriving[c.strategy]?.push(...c.classes)
  return {
    name: d.name,
    keyword: d.keyword,
    params: [...(d.params || [])],
    constructors: d.constructors.map((c) => ({ name: c.name, fields: c.fields.map((f) => ({ name: f.name || '', type: asHaskell(f.type) })) })),
    deriving,
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
  const d = draft.deriving
  const clauses = [
    d.stock.length && ` deriving stock (${d.stock.join(', ')})`,
    d.anyclass.length && ` deriving anyclass (${d.anyclass.join(', ')})`,
    d.via.length && ` deriving (${d.via.join(', ')}) via Generically ${draft.name}`,
    d.newtype.length && ` deriving newtype (${d.newtype.join(', ')})`,
  ].filter(Boolean)
  return `${draft.keyword} ${[draft.name, ...(draft.params || [])].join(' ')} = ${draft.constructors.map(ctor).join(' | ')}${clauses.join('')}`
}
