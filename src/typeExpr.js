// Types as nodes. A type is a term of its own small applicative language,
// one level up from the value graph: a type constructor is a type-level
// function (`Maybe :: * ▸ *`, `Pair :: * ▸ *`, and the arrow itself,
// `(▸) :: * ▸ * ▸ *`), and a type is constructors applied to types — the
// same shape as a call with its slots filled. So the editor shows a type the
// way the canvas shows a call: a head with a slot per argument, each slot
// holding another type node, or a hole (`_`) still to be filled.
//
// A function type is drawn as its curried chain `A ▸ B ▸ C`: one chevron
// per argument, pointing at the rest (`A → (B → C)`), the last one the
// result. That chain is what a function block's slots line up with.
//
// A *type annotation* is Haskell type text stored on a body's parameter or
// Output node (`Double`, `Maybe a`, `_`). It works like a GHC partial type
// signature with an extra-constraints wildcard (`f :: _ => a ▸ Int`): what's
// written is checked against the inferred type by unification (inferGraph.js),
// named variables are rigid (they must stay distinct, unconstrained types),
// `_` is left to inference, and class constraints are always inferred.
import { DeclError, builtinTypeNames, parseTypeText } from './typeDecls.js'
import { constructorArity, createNamer, freshVar, tapp, tcon, tfun, userTypeArities } from './typeSystem.js'

/** Whether a variable id is one inference made up (`t42`), rather than a name written in an annotation. */
export const isInferredVar = (id) => /^t\d+$/.test(id)

/** A hole: a type not chosen yet (written `_`). Only ever lives in the editor. */
export const hole = () => ({ kind: 'hole' })
export const isHole = (t) => t?.kind === 'hole'

/** Every type name in scope, with how many type arguments it takes. */
export function knownTypes() {
  return new Map([...builtinTypeNames.map((n) => [n, constructorArity[n] || 0]), ...Object.entries(userTypeArities())])
}

/**
 * Resolve annotation `text` to a Type. Named variables become fresh type
 * variables, shared through `names` (one map per signature, so `a` means the
 * same type in every segment of it); each `_` is a fresh variable of its own.
 * Throws DeclError if the text isn't a type.
 */
export function annotationType(text, names = new Map()) {
  let wild = 0
  const numbered = String(text).replace(/(^|[^A-Za-z0-9_'])_(?![A-Za-z0-9_'])/g, (_, before) => `${before}_${++wild}`)
  const named = parseTypeText(numbered, knownTypes())
  const go = (t) => {
    if (t.kind === 'var') {
      if (t.id.startsWith('_')) return freshVar()
      if (!names.has(t.id)) names.set(t.id, freshVar())
      return names.get(t.id)
    }
    if (t.kind === 'fun') return tfun(go(t.from), go(t.to))
    if (t.kind === 'app') return tapp(go(t.fn), go(t.arg))
    return t
  }
  return go(named)
}

/** Whether `text` is a usable annotation; '' if so, else why not. */
export function annotationProblem(text) {
  try {
    annotationType(text)
    return ''
  } catch (e) {
    if (e instanceof DeclError) return e.message
    throw e
  }
}

/** Parse annotation text keeping variables by name and `_` as holes — for editing it as nodes. */
export function typeFromText(text) {
  let wild = 0
  const numbered = String(text).replace(/(^|[^A-Za-z0-9_'])_(?![A-Za-z0-9_'])/g, (_, before) => `${before}_${++wild}`)
  const go = (t) => (t.kind === 'var' && t.id.startsWith('_') ? hole() : t.kind === 'fun' ? tfun(go(t.from), go(t.to)) : t.kind === 'app' ? tapp(go(t.fn), go(t.arg)) : t)
  return go(parseTypeText(numbered, knownTypes()))
}

/**
 * Haskell text for a type: `->` arrows, `[a]`, `(a, b)`, `String`, holes
 * as `_`. Variables print by name when they have one (an annotation's own
 * `a`), else through `namer` (inferred variables are numbered).
 */
export function typeText(type, namer = createNamer(), arrow = '->') {
  const name = (id) => (isInferredVar(id) ? namer(id) : id)
  const go = (t, asDomain, asArg) => {
    if (isHole(t)) return '_'
    if (t.kind === 'var') return name(t.id)
    if (t.kind === 'con') return t.name === 'List' ? '[]' : t.name
    if (t.kind === 'app') {
      if (t.fn.kind === 'app' && t.fn.fn.kind === 'con' && t.fn.fn.name === '(,)') return `(${go(t.fn.arg, false, false)}, ${go(t.arg, false, false)})`
      if (t.fn.kind === 'con' && t.fn.name === 'List') return t.arg.kind === 'con' && t.arg.name === 'Char' ? 'String' : `[${go(t.arg, false, false)}]`
      const rendered = `${go(t.fn, false, false)} ${go(t.arg, false, true)}`
      return asArg ? `(${rendered})` : rendered
    }
    const rendered = `${go(t.from, true, false)} ${arrow} ${go(t.to, false, false)}`
    return asDomain || asArg ? `(${rendered})` : rendered
  }
  return go(type, false, false)
}

/** A type's curried chain: `A ▸ B ▸ C` is `[A, B, C]` (arguments, then the result). */
export function chainOf(type) {
  const out = []
  let t = type
  while (t?.kind === 'fun') {
    out.push(t.from)
    t = t.to
  }
  out.push(t)
  return out
}

/**
 * A type node: its head and the types in its slots.
 *   - a constructor applied to arguments: `Maybe Int` → head Maybe, slots [Int]
 *     (lists `[a]` and pairs `(a, b)` are the constructors List and (,))
 *   - an arrow `a ▸ b` → head ▸, slots [a, b]
 *   - a variable applied to arguments (`f a`) → head f, slots [a]
 *   - anything else (a plain constructor, a variable, a hole) has no slots
 */
export function typeNode(type) {
  if (type?.kind === 'fun') return { head: { kind: 'arrow' }, slots: [type.from, type.to] }
  const slots = []
  let t = type
  while (t?.kind === 'app') {
    slots.unshift(t.arg)
    t = t.fn
  }
  return { head: t, slots }
}

/** Rebuild a type node from its head and slots (inverse of typeNode). */
export function fromTypeNode(head, slots) {
  if (head.kind === 'arrow') return tfun(slots[0], slots[1])
  return slots.reduce((acc, s) => tapp(acc, s), head)
}

/** The type at `path` (slot indices, outermost first) inside `type`. */
export function typeAt(type, path) {
  return path.reduce((t, i) => typeNode(t).slots[i], type)
}

/** `type` with the part at `path` replaced by `sub`. */
export function replaceAt(type, path, sub) {
  if (!path.length) return sub
  const { head, slots } = typeNode(type)
  const [i, ...rest] = path
  return fromTypeNode(head, slots.map((s, j) => (j === i ? replaceAt(s, rest, sub) : s)))
}

/** The path of the first hole in `type` (depth-first, left to right), or null. */
export function firstHole(type, path = []) {
  if (isHole(type)) return path
  const { slots } = typeNode(type)
  for (let i = 0; i < slots.length; i++) {
    const found = firstHole(slots[i], [...path, i])
    if (found) return found
  }
  return null
}

/** A constructor (or the arrow, `'->'`) applied to holes, ready to be filled: `Maybe _`, `_ ▸ _`. */
export function constructorWithHoles(name) {
  if (name === '->') return tfun(hole(), hole())
  const arity = knownTypes().get(name) ?? 0
  return Array.from({ length: arity }, hole).reduce((acc, h) => tapp(acc, h), name === 'String' ? tapp(tcon('List'), tcon('Char')) : tcon(name))
}

/** How a type constructor's head reads on its node: `[ ]` for lists, `( , )` for pairs. */
export function headLabel(head) {
  if (head.kind === 'arrow') return '▸'
  if (isHole(head)) return '_'
  if (head.kind === 'var') return typeof head.id === 'string' ? head.id : '?'
  return head.name === 'List' ? '[ ]' : head.name === '(,)' ? '( , )' : head.name
}

/**
 * The type constructors a type can be built from, grouped for a palette —
 * each with its kind written as a chain of `*`s (`Maybe :: * ▸ *`).
 */
export function typePalette() {
  const kind = (n) => ['*', ...Array(n).fill('*')].join(' ▸ ')
  const entry = (name, arity, label = name) => ({ name, arity, label, kind: kind(arity) })
  const user = Object.entries(userTypeArities()).map(([n, a]) => entry(n, a))
  return [
    { group: 'Numbers', items: ['Int', 'Integer', 'Double', 'Float', 'Rational', 'Natural', 'Word'].map((n) => entry(n, 0)) },
    { group: 'Basics', items: [entry('Bool', 0), entry('Char', 0), entry('String', 0), entry('()', 0)] },
    { group: 'Structure', items: [entry('->', 2, '_ ▸ _'), entry('List', 1, '[ _ ]'), entry('(,)', 2, '( _ , _ )'), entry('Maybe', 1, 'Maybe _')] },
    { group: 'Game', items: [entry('Picture', 0), entry('Color', 0), entry('StdGen', 0), entry('Widget', 1, 'Widget _'), entry('Sub', 1, 'Sub _'), entry('Program', 2, 'Program _ _')] },
    ...(user.length ? [{ group: 'Yours', items: user.map((e) => ({ ...e, label: [e.name, ...Array(e.arity).fill('_')].join(' ') })) }] : []),
  ]
}
