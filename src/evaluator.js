// Graph evaluator. Knows the same node/functionBodies data model as
// inferGraph.js and gives it the matching runtime meaning:
//
// - A function node's value is its callee applied to its *applied* slots —
//   a mounted node, or an inline literal (see literals.js) — with the
//   remaining slots left open as a closure. This is exactly the type
//   inferGraph assigns it (valueTypeOfEntry folds only the open slots).
// - Evaluation is lazy (call-by-need): arguments are thunks, forced only
//   when a builtin actually needs them, so `select`/`ifThenElse` evaluate
//   only the branch they take and a recursive custom function with a base
//   case terminates.
// - Runtime values are numbers, booleans, closures and data values (a
//   constructor of a user-declared type applied to its fields — lazily, as
//   Haskell constructors are). Closures and data values are plain data once
//   forced (`run` returns them that way), so they can be stored on a node
//   and survive save/load.
import { parseLiteral } from './literals.js'
import { cons, just, nil, nothing, pair, stdGen } from './dataTypes.js'

export class EvalError extends Error {}

/**
 * Library definitions — the Prelude (`prelude:…`), the functions derived
 * from a type declaration (`type:…`) and class instances (`instance:…`) —
 * can be edited as graphs: an edited one has its own body in
 * `functionBodies` under the same id (an *override*), and every call runs
 * that body instead of the built-in implementation.
 */
export const isOverridableId = (id) => /^(prelude|type|instance):/.test(id)

const MAX_STEPS = 1_000_000

class Thunk {
  constructor(compute) {
    this.compute = compute
    this.done = false
    this.running = false
    this.value = undefined
  }
}
const delay = (compute) => new Thunk(compute)
const now = (value) => Object.assign(new Thunk(null), { done: true, value })

function forceOne(t) {
  if (t.done) return t.value
  if (t.running) throw new EvalError('A value depends on itself (infinite loop)')
  t.running = true
  try {
    t.value = t.compute()
    t.done = true
    t.compute = null
  } finally {
    t.running = false
  }
  return t.value
}

export function force(v) {
  while (v instanceof Thunk) v = forceOne(v)
  return v
}

export function isClosure(v) {
  return v !== null && typeof v === 'object' && v.kind === 'closure'
}

export function isData(v) {
  return v !== null && typeof v === 'object' && v.kind === 'data'
}

function show(v) {
  return isClosure(v) ? `ƒ ${v.callee}` : isData(v) ? v.ctor : isMempty(v) ? 'mempty' : String(v)
}

/**
 * Haskell `show`-style rendering of a forced value: `Model {clicks = 1, perClick = 2}`,
 * `Tick 0.5`, `Buy (Just 3)`. `types` (the project's declarations) supplies
 * record field names; without it records print positionally.
 */
export function showValue(v, types = {}, asArg = false) {
  if (isClosure(v)) return `ƒ ${v.callee}`
  if (isMempty(v)) return 'mempty'
  if (typeof v === 'string') return `'${v}'` // a Char
  if (isData(v) && v.type === '(,)') return `(${showValue(v.args[0], types)},${showValue(v.args[1], types)})`
  if (isData(v) && v.type === 'List') {
    const items = []
    for (let l = v; l.ctorIndex === 1; l = l.args[1]) items.push(l.args[0])
    if (items.length && items.every((c) => typeof c === 'string')) return JSON.stringify(items.join('')) // a String
    return `[${items.map((x) => showValue(x, types)).join(',')}]`
  }
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return asArg && (v < 0 || Object.is(v, -0)) ? `(${v})` : String(v) // Haskell: Tick (-0.5)
  if (!isData(v)) return String(v)
  if (!v.args.length) return v.ctor
  const ctor = types[v.type]?.constructors.find((c) => c.name === v.ctor)
  const rendered = ctor?.record
    ? `${v.ctor} {${ctor.fields.map((f, i) => `${f.name} = ${showValue(v.args[i], types)}`).join(', ')}}`
    : `${v.ctor} ${v.args.map((a) => showValue(a, types, true)).join(' ')}`
  return asArg ? `(${rendered})` : rendered
}

/** Fully force a value into JSON-safe data (closure args included). */
function serializeValue(v) {
  v = force(v)
  if (isData(v)) return { kind: 'data', type: v.type, ctor: v.ctor, ctorIndex: v.ctorIndex, args: v.args.map(serializeValue) }
  if (!isClosure(v)) return v
  return { kind: 'closure', callee: v.callee, args: v.args.map((a) => (a === null ? null : serializeValue(a))) }
}

/** Turn stored closure data back into a runtime closure. */
function reviveValue(v) {
  if (isData(v)) return { ...v, args: v.args.map((a) => now(reviveValue(a))) }
  if (!isClosure(v)) return v
  return { kind: 'closure', callee: v.callee, args: v.args.map((a) => (a === null ? null : now(reviveValue(a)))) }
}

// ---- Runtime algebra ------------------------------------------------------
// The evaluator is untyped, so class methods dispatch on the shape of the
// values they meet:
//
// - Arithmetic, lattice and vector operations work on numbers and lift
//   pointwise over data values (a record that derives AddGroup adds field by
//   field — the product of the structures).
// - A bare number meeting a data value is broadcast along it: the diagonal
//   ℤ → R × S, which is the (unique) ring map, so `0`/`addZero` and
//   `1`/`mulOne` already are the zero and one of any product ring.
// - `mempty` can't be a number (lists, Maybe, Endo have no map from ℤ), so
//   it is a formal identity, MEMPTY, that `<>` absorbs and that becomes a
//   concrete value of the right shape whenever it's observed: `[]`,
//   `Nothing`, `Sum 0`, the identity function, or a record of MEMPTYs.
export const MEMPTY = Object.freeze({ kind: 'mempty' })
export const isMempty = (v) => v === MEMPTY || (v !== null && typeof v === 'object' && v.kind === 'mempty')

/** Spread a number along a data value's shape (the diagonal into a product). */
function broadcast(n, like) {
  if (!isData(like)) return n
  return { ...like, args: like.args.map((f) => delay(() => broadcast(n, force(f)))) }
}

/** MEMPTY made concrete in the shape of `like`. */
export function concreteMempty(like) {
  if (!isData(like)) throw new EvalError(`mempty has no ${show(like)}-shaped value`)
  if (like.type === 'List') return nil
  if (like.type === 'Maybe') return nothing
  if (like.type === 'Picture') return picture('Blank', 0, [])
  if (like.type === 'Sub') return { kind: 'data', type: 'Sub', ctor: 'None', ctorIndex: 0, args: [] }
  if (like.type === 'Sum') return { ...like, args: [now(0)] }
  if (like.type === 'Product') return { ...like, args: [now(1)] }
  if (like.type === 'Endo') return { ...like, args: [now({ kind: 'closure', callee: 'identity', args: [null] })] } // End(a)'s identity
  return { ...like, args: like.args.map(() => now(MEMPTY)) }
}

const num = (t) => {
  const v = force(t)
  if (typeof v !== 'number') throw new EvalError(`Expected a number, got ${show(v)}`)
  return v
}
const bool = (t) => {
  const v = force(t)
  if (typeof v !== 'boolean') throw new EvalError(`Expected a Bool, got ${show(v)}`)
  return v
}
/**
 * Structural comparison, as Haskell's derived Eq/Ord: numbers by value,
 * False < True, data values by constructor order and then field by field.
 * Returns -1, 0 or 1. (The type checker keeps functions out of here.)
 */
function compareValues(x, y) {
  let a = force(x)
  let b = force(y)
  if (isMempty(a) && isMempty(b)) return 0
  if (isMempty(a)) a = concreteMempty(b)
  if (isMempty(b)) b = concreteMempty(a)
  if (typeof a === 'number' && isData(b)) a = broadcast(a, b)
  if (typeof b === 'number' && isData(a)) b = broadcast(b, a)
  if ((typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string')) return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  if (isData(a) && isData(b)) {
    if (a.ctorIndex !== b.ctorIndex) return a.ctorIndex < b.ctorIndex ? -1 : 1
    for (let i = 0; i < a.args.length; i++) {
      const c = compareValues(a.args[i], b.args[i])
      if (c !== 0) return c
    }
    return 0
  }
  throw new EvalError(`Cannot compare ${show(a)} with ${show(b)}`)
}

/** A JS string as a Haskell String: a lazy list of Chars. */
function fromJsString(str) {
  return [...str].reduceRight((tail, ch) => cons(now(ch), now(tail)), nil)
}

const COMPACT_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
/** 999 → "999", 1234 → "1.2K", 3.4e6 → "3.4M" — truncated, never rounded up past what you have. */
export function showCompact(x) {
  if (!Number.isFinite(x)) return String(x)
  const a = Math.abs(x)
  if (a < 1000) return String(Math.trunc(x))
  const e = Math.min(COMPACT_SUFFIXES.length - 1, Math.floor(Math.log10(a) / 3))
  const v = Math.trunc((a / 1000 ** e) * 10) / 10
  return `${x < 0 ? '-' : ''}${v >= 100 ? Math.trunc(v) : String(v)}${COMPACT_SUFFIXES[e]}`
}

const picture = (ctor, ctorIndex, args) => ({ kind: 'data', type: 'Picture', ctor, ctorIndex, args })
const colour = (r, g, b) => ({ kind: 'data', type: 'Color', ctor: 'RGB', ctorIndex: 0, args: [r, g, b] })

/** One step of mulberry32: a 32-bit state in, [a uniform number in [0, 1), the next state] out. */
function mulberry32(state) {
  const next = (state + 0x6d2b79f5) | 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

/** Haskell's `round`: halves go to the even neighbour. */
function roundHalfEven(x) {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/**
 * `registry` is `{ nodes, functionBodies }` (main.js's live objects): `nodes`
 * holds every function definition, `functionBodies` every custom body.
 */
export function createEvaluator(registry) {
  let steps = 0

  // [arity, implementation]. Implementations receive argument thunks and
  // force only what they need. The first seven are the protected builtins
  // (CLAUDE.md) — same results as their original implementations.
  const builtins = {
    succ: [1, (n) => num(n) + 1],
    zero: [0, () => 0],
    identity: [1, (x) => force(x)],
    apply: [2, (f, x) => applyValue(f, [x])],
    compose: [3, (f, g, x) => applyValue(f, [delay(() => applyValue(g, [x]))])],
    isZero: [1, (n) => num(n) === 0],
    ifThenElse: [3, (c, a, b) => (bool(c) ? force(a) : force(b))],

    plus: [2, (x, y) => lift2((a, b) => a + b, x, y)],
    negate: [1, (x) => lift1((a) => -a, x)],
    minus: [2, (x, y) => lift2((a, b) => a - b, x, y)],
    times: [2, (x, y) => lift2((a, b) => a * b, x, y)],
    addZero: [0, () => 0],
    mulOne: [0, () => 1],
    divide: [2, (x, y) => num(x) / num(y)],
    sqrt: [1, (x) => Math.sqrt(num(x))],
    toRational: [1, (x) => num(x)], // no distinct runtime numeric representations — type-level only
    fromIntegral: [1, (x) => num(x)],
    round: [1, (x) => roundHalfEven(num(x))],
    isNaN: [1, (x) => Number.isNaN(num(x))],
    geq: [2, (x, y) => compareValues(x, y) >= 0],
    eq: [2, (x, y) => compareValues(x, y) === 0],
    select: [3, (c, a, b) => (bool(c) ? force(a) : force(b))],

    // Prelude functions on lists and Maybe (dataTypes.js). Lazy throughout,
    // so they work on infinite lists as far as they're consumed.
    nil: [0, () => nil],
    cons: [2, (x, xs) => cons(x, xs)],
    foldr: [3, (f, z, xs) => {
      const go = (t) => {
        const l = list(t)
        return l.ctorIndex === 0 ? force(z) : applyValue(f, [l.args[0], delay(() => go(l.args[1]))])
      }
      return go(xs)
    }],
    map: [2, (f, xs) => {
      const go = (t) => {
        const l = list(t)
        return l.ctorIndex === 0 ? nil : cons(delay(() => applyValue(f, [l.args[0]])), delay(() => go(l.args[1])))
      }
      return go(xs)
    }],
    length: [1, (xs) => {
      let n = 0
      for (let l = list(xs); l.ctorIndex === 1; l = list(l.args[1])) n++
      return n
    }],
    append: [2, (xs, ys) => {
      const go = (t) => {
        const l = list(t)
        return l.ctorIndex === 0 ? force(ys) : cons(l.args[0], delay(() => go(l.args[1])))
      }
      return go(xs)
    }],
    index: [2, (xs, i) => {
      let n = num(i)
      if (n < 0) return nothing
      for (let l = list(xs); l.ctorIndex === 1; l = list(l.args[1]), n--) if (n === 0) return just(l.args[0])
      return nothing
    }],
    pair: [2, (a, b) => pair(a, b)],
    fst: [1, (p) => force(force(p).args[0])],
    snd: [1, (p) => force(force(p).args[1])],
    mkStdGen: [1, (n) => stdGen(num(n) | 0)],
    randomR: [2, (range, g) => {
      const [lo, hi] = force(range).args.map(num)
      const [u, next] = mulberry32(num(force(g).args[0]))
      return pair(lo + u * (hi - lo), stdGen(next))
    }],
    randomRInt: [2, (range, g) => {
      const [lo, hi] = force(range).args.map(num)
      const [u, next] = mulberry32(num(force(g).args[0]))
      return pair(lo + Math.floor(u * (hi - lo + 1)), stdGen(next))
    }],
    nothing: [0, () => nothing],
    just: [1, (x) => just(x)],
    maybe: [3, (b, f, m) => {
      const v = force(m)
      if (!isData(v) || v.type !== 'Maybe') throw new EvalError(`Expected a Maybe, got ${show(v)}`)
      return v.ctorIndex === 0 ? force(b) : applyValue(f, [v.args[0]])
    }],
    show: [1, (x) => fromJsString(showValue(serializeValue(x), registry.types || {}))],
    showFFloat: [2, (d, x) => fromJsString(num(x).toFixed(Math.max(0, Math.min(20, num(d)))))],
    showCompact: [1, (x) => fromJsString(showCompact(num(x)))],
    listOf: [null, (...xs) => xs.reduceRight((tail, x) => cons(x, now(tail)), nil)], // arity = the node's slot count

    // Category classes (categoryClasses.js).
    mappend: [2, (x, y) => mappend(x, y)],
    mempty: [0, () => MEMPTY],
    mconcat: [1, (xs) => {
      const go = (t) => {
        const l = list(t)
        return l.ctorIndex === 0 ? MEMPTY : mappend(l.args[0], delay(() => go(l.args[1])))
      }
      return go(xs)
    }],
    fmap: [2, (f, t) => {
      const v = force(t)
      if (isData(v) && v.type === 'Maybe') return v.ctorIndex === 0 ? nothing : just(delay(() => applyValue(f, [v.args[0]])))
      if (isMempty(v) || (isData(v) && v.type === 'Sub')) return { kind: 'data', type: 'Sub', ctor: 'Map', ctorIndex: 4, args: [f, now(v)] }
      return builtins.map[1](f, now(v))
    }],
    foldMap: [2, (f, t) => {
      const v = force(t)
      if (isData(v) && v.type === 'Maybe') return v.ctorIndex === 0 ? MEMPTY : applyValue(f, [v.args[0]])
      const go = (u) => {
        const l = list(u)
        return l.ctorIndex === 0 ? MEMPTY : mappend(delay(() => applyValue(f, [l.args[0]])), delay(() => go(l.args[1])))
      }
      return go(now(v))
    }],
    leq: [2, (x, y) => leq(x, y)],
    join: [2, (x, y) => lift2((a, b) => (typeof a === 'boolean' ? a || b : Math.max(a, b)), x, y)],
    meet: [2, (x, y) => lift2((a, b) => (typeof a === 'boolean' ? a && b : Math.min(a, b)), x, y)],
    scale: [2, (k, v) => lift1((a) => num(k) * a, v)],
    mkSum: [1, (x) => ({ kind: 'data', type: 'Sum', ctor: 'Sum', ctorIndex: 0, args: [x] })],
    getSum: [1, (s) => newtypeField(s, 'Sum', 0)],
    mkProduct: [1, (x) => ({ kind: 'data', type: 'Product', ctor: 'Product', ctorIndex: 0, args: [x] })],
    getProduct: [1, (s) => newtypeField(s, 'Product', 1)],
    mkEndo: [1, (f) => ({ kind: 'data', type: 'Endo', ctor: 'Endo', ctorIndex: 0, args: [f] })],
    // Games (runtime.js): a Program and its widgets are plain lazy data.
    // A Program carries its settings after the four functions: steps per
    // second, the longest time away that counts (seconds), subscriptions.
    program: [4, (model, view, handle, step) => ({ kind: 'data', type: 'Program', ctor: 'Program', ctorIndex: 0, args: [model, view, handle, step, now(10), now(7 * 24 * 3600), now(MEMPTY)] })],
    setStepsPerSecond: [2, (n, p) => setProgramField(p, 4, n)],
    setMaxOffline: [2, (s, p) => setProgramField(p, 5, s)],
    setSubscriptions: [2, (f, p) => setProgramField(p, 6, f)],
    every: [2, (seconds, msg) => ({ kind: 'data', type: 'Sub', ctor: 'Every', ctorIndex: 1, args: [seconds, msg] })],
    onKey: [1, (f) => ({ kind: 'data', type: 'Sub', ctor: 'OnKey', ctorIndex: 2, args: [f] })],
    wText: [1, (s) => ({ kind: 'data', type: 'Widget', ctor: 'Text', ctorIndex: 0, args: [s] })],
    wButton: [2, (label, msg) => ({ kind: 'data', type: 'Widget', ctor: 'Button', ctorIndex: 1, args: [label, msg] })],
    wColumn: [1, (ws) => ({ kind: 'data', type: 'Widget', ctor: 'Column', ctorIndex: 2, args: [ws] })],
    wRow: [1, (ws) => ({ kind: 'data', type: 'Widget', ctor: 'Row', ctorIndex: 3, args: [ws] })],
    wProgress: [1, (x) => ({ kind: 'data', type: 'Widget', ctor: 'Progress', ctorIndex: 4, args: [x] })],
    wHeading: [1, (s) => ({ kind: 'data', type: 'Widget', ctor: 'Heading', ctorIndex: 5, args: [s] })],
    wSpacer: [1, (px) => ({ kind: 'data', type: 'Widget', ctor: 'Spacer', ctorIndex: 6, args: [px] })],
    wColor: [2, (c, w) => ({ kind: 'data', type: 'Widget', ctor: 'Tinted', ctorIndex: 7, args: [c, w] })],
    wDrawing: [3, (w, h, p) => ({ kind: 'data', type: 'Widget', ctor: 'Drawing', ctorIndex: 8, args: [w, h, p] })],
    pCircle: [1, (r) => picture('Circle', 1, [r])],
    pCircleSolid: [1, (r) => picture('CircleSolid', 2, [r])],
    pRectangleSolid: [2, (w, h) => picture('RectangleSolid', 3, [w, h])],
    pTranslate: [3, (x, y, p) => picture('Translate', 4, [x, y, p])],
    pColor: [2, (c, p) => picture('Color', 5, [c, p])],
    rgb: [3, (r, g, b) => colour(num(r), num(g), num(b))],
    red: [0, () => colour(1, 0, 0)],
    green: [0, () => colour(0, 0.7, 0)],
    blue: [0, () => colour(0, 0, 1)],
    yellow: [0, () => colour(1, 0.85, 0)],
    black: [0, () => colour(0, 0, 0)],
    white: [0, () => colour(1, 1, 1)],
    appEndo: [2, (e, x) => {
      const v = force(e)
      if (isMempty(v)) return force(x) // mempty :: Endo a is the identity
      if (!isData(v) || v.type !== 'Endo') throw new EvalError(`Expected an Endo, got ${show(v)}`)
      return applyValue(v.args[0], [x])
    }],
  }

  /** A Program with setting `index` replaced (record update). Programs from older saves get the defaults first. */
  function setProgramField(p, index, value) {
    const v = force(p)
    if (!isData(v) || v.type !== 'Program') throw new EvalError(`Expected a Program, got ${show(v)}`)
    const args = [...v.args, now(10), now(7 * 24 * 3600), now(MEMPTY)].slice(0, 7)
    args[index] = value
    return { ...v, args }
  }

  /** The field of a newtype value; MEMPTY of Sum/Product unwraps to its carrier's identity. */
  function newtypeField(t, type, identity) {
    const v = force(t)
    if (isMempty(v)) return identity
    if (!isData(v) || v.type !== type) throw new EvalError(`Expected a ${type}, got ${show(v)}`)
    return force(v.args[0])
  }

  /** A unary numeric/boolean operation, lifted pointwise over data values. */
  function lift1(op, x) {
    const a = force(x)
    if (isData(a)) return { ...a, args: a.args.map((f) => delay(() => lift1(op, f))) }
    if (typeof a !== 'number' && typeof a !== 'boolean') throw new EvalError(`Expected a number, got ${show(a)}`)
    return op(a)
  }

  /** A binary operation, lifted pointwise over data values; a bare number is broadcast along the other side. */
  function lift2(op, x, y) {
    let a = force(x)
    let b = force(y)
    if (typeof a === 'number' && isData(b)) a = broadcast(a, b)
    if (typeof b === 'number' && isData(a)) b = broadcast(b, a)
    if (isData(a) && isData(b)) {
      if (a.ctorIndex !== b.ctorIndex) throw new EvalError(`Cannot combine ${a.ctor} with ${b.ctor}`)
      return { ...a, args: a.args.map((f, i) => delay(() => lift2(op, f, b.args[i]))) }
    }
    const ok = (v) => typeof v === 'number' || typeof v === 'boolean'
    if (!ok(a) || !ok(b)) throw new EvalError(`Expected numbers, got ${show(a)} and ${show(b)}`)
    return op(a, b)
  }

  /** The partial order: pointwise on data values (a product of posets). */
  function leq(x, y) {
    let a = force(x)
    let b = force(y)
    if (typeof a === 'number' && isData(b)) a = broadcast(a, b)
    if (typeof b === 'number' && isData(a)) b = broadcast(b, a)
    if (isData(a) && isData(b)) return a.ctorIndex === b.ctorIndex && a.args.every((f, i) => leq(f, b.args[i]))
    if (typeof a === 'boolean') return !a || b
    return num(now(a)) <= num(now(b))
  }

  /** The monoid operation, by the shape of its arguments. MEMPTY is absorbed. */
  function mappend(x, y) {
    const a = force(x)
    if (isMempty(a)) return force(y)
    if (isData(a) && a.type === 'List') return builtins.append[1](now(a), y) // the free monoid: (++), lazy in y
    const b = force(y)
    if (isMempty(b)) return a
    if (!isData(a) || !isData(b)) throw new EvalError(`No (<>) for ${show(a)}`)
    if (a.type === 'Maybe') return a.ctorIndex === 0 ? b : b.ctorIndex === 0 ? a : just(delay(() => mappend(a.args[0], b.args[0])))
    if (a.type === 'Sum') return { ...a, args: [delay(() => lift2((p, q) => p + q, a.args[0], b.args[0]))] }
    if (a.type === 'Product') return { ...a, args: [delay(() => lift2((p, q) => p * q, a.args[0], b.args[0]))] }
    if (a.type === 'Picture') return picture('Pictures', 6, [now(a), now(b)])
    if (a.type === 'Sub') return { kind: 'data', type: 'Sub', ctor: 'Batch', ctorIndex: 3, args: [now(a), now(b)] }
    if (a.type === 'Endo') {
      // End(a): (<>) is composition — the protected builtin `compose`.
      if (registry.nodes.compose?.builtin !== 'compose') throw new EvalError('Endo needs the compose builtin')
      return { ...a, args: [now({ kind: 'closure', callee: 'compose', args: [a.args[0], b.args[0], null] })] }
    }
    // A record deriving Semigroup via Generically: fieldwise.
    if (a.ctorIndex !== b.ctorIndex) throw new EvalError(`Cannot combine ${a.ctor} with ${b.ctor}`)
    return { ...a, args: a.args.map((f, i) => delay(() => mappend(f, b.args[i]))) }
  }

  function list(t) {
    const v = force(t)
    if (isMempty(v)) return nil
    if (!isData(v) || v.type !== 'List') throw new EvalError(`Expected a list, got ${show(v)}`)
    return v
  }

  function definition(callee) {
    const def = registry.nodes[callee]
    if (!def) throw new EvalError(`Unknown function: ${callee}`)
    return def
  }

  /** The edited body of library definition `callee`, if it has one. */
  function overrideOf(callee) {
    return isOverridableId(callee) ? registry.functionBodies[callee] : undefined
  }

  function arityOf(callee) {
    const def = definition(callee)
    const edited = overrideOf(callee)
    if (edited) return Object.values(edited).filter((n) => n.type === 'parameter').length
    if (def.derived) return def.derived.arity
    if (def.builtin) {
      const impl = builtins[def.builtin]
      if (!impl) throw new EvalError(`${def.label}: no runtime implementation`)
      return impl[0]
    }
    const body = registry.functionBodies[callee]
    return body ? Object.values(body).filter((n) => n.type === 'parameter').length : 0
  }

  function call(callee, args) {
    if (++steps > MAX_STEPS) throw new EvalError('Evaluation took too many steps (infinite recursion?)')
    const def = definition(callee)
    const edited = overrideOf(callee)
    if (!edited && def.derived) return runDerived(def.derived, args)
    if (!edited && def.builtin) return builtins[def.builtin][1](...args)
    const body = edited || registry.functionBodies[callee]
    const output = body?.output
    if (!output?.source || !body[output.source]) throw new EvalError(`${def.label}: Output is not connected`)
    return force(nodeValue(body, output.source, { args, memo: new Map() }))
  }

  /** The morphisms derived from a type declaration (see typeDecls.js). */
  function runDerived(d, args) {
    const record = (t) => {
      const v = force(t)
      // MEMPTY standing for a value of the type: its identity (`Sum 0`, `Nothing`, a record of MEMPTYs, …).
      if (isMempty(v)) return concreteMempty({ kind: 'data', type: d.type, ctor: d.ctor, ctorIndex: 0, args: Array.from({ length: d.fieldCount ?? 0 }, () => now(MEMPTY)) })
      // A broadcast number standing for a whole record: every field is that same value.
      if (typeof v === 'number' && d.fieldCount !== undefined) return { kind: 'data', type: d.type, ctor: d.ctor, ctorIndex: 0, args: Array.from({ length: d.fieldCount }, () => now(v)) }
      if (!isData(v) || v.type !== d.type) throw new EvalError(`Expected a ${d.type}, got ${show(v)}`)
      return v
    }
    if (d.op === 'construct') return { kind: 'data', type: d.type, ctor: d.ctor, ctorIndex: d.ctorIndex, args } // lazy fields
    if (d.op === 'get') return force(record(args[0]).args[d.fieldIndex])
    if (d.op === 'set' || d.op === 'over') {
      const r = record(args[1])
      const fields = r.args.slice()
      const old = fields[d.fieldIndex]
      fields[d.fieldIndex] = d.op === 'set' ? args[0] : delay(() => applyValue(args[0], [old]))
      return { ...r, args: fields }
    }
    if (d.op === 'case') {
      const v = record(args[args.length - 1])
      const branch = args[v.ctorIndex]
      return d.arities[v.ctorIndex] ? applyValue(branch, v.args) : force(branch)
    }
    if (d.op === 'fold') {
      const branches = args.slice(0, -1)
      const fold = (t) => {
        const v = record(t)
        const fields = v.args.map((field, i) => (d.recursive[v.ctorIndex][i] ? delay(() => fold(field)) : field))
        return d.arities[v.ctorIndex] ? applyValue(branches[v.ctorIndex], fields) : force(branches[v.ctorIndex])
      }
      return fold(args[args.length - 1])
    }
    throw new EvalError(`Unknown derived operation: ${d.op}`)
  }

  /** Apply a function value to argument thunks, filling its open slots left to right. */
  function applyValue(fn, argThunks) {
    let v = fn
    for (const arg of argThunks) {
      v = force(v)
      if (!isClosure(v)) throw new EvalError(`Cannot apply ${show(v)} — it is not a function`)
      const args = v.args.slice()
      args[args.indexOf(null)] = arg
      v = args.includes(null) ? { kind: 'closure', callee: v.callee, args } : call(v.callee, args)
    }
    return force(v)
  }

  /** A node's value as a memoized thunk, within one call frame (`env`). */
  function nodeValue(graph, id, env) {
    if (env.memo.has(id)) return env.memo.get(id)
    const t = delay(() => computeNode(graph, id, env))
    env.memo.set(id, t)
    return t
  }

  function computeNode(graph, id, env) {
    const node = graph[id]
    if (!node) throw new EvalError(`Missing node: ${id}`)
    if (node.type === 'number') {
      const text = String(node.value ?? '').trim()
      const value = Number(text)
      if (text === '' || (Number.isNaN(value) && text !== 'NaN')) throw new EvalError(`${node.label}: "${node.value}" is not a number`)
      return value
    }
    if (node.type === 'boolean') return node.value === 'true'
    if (node.type === 'text') return fromJsString(String(node.value ?? ''))
    if (node.type === 'ref') {
      if (!graph[node.target]) throw new EvalError(`${node.label}: the original node is gone`)
      return force(nodeValue(graph, node.target, env)) // shares the target's thunk: evaluated once
    }
    if (node.type === 'parameter') {
      if (!env.args) throw new EvalError(`Parameter ${node.label} only has a value inside a call`)
      const index = Object.values(graph).filter((n) => n.type === 'parameter').findIndex((n) => n.id === id)
      const arg = env.args[index]
      if (!arg) throw new EvalError(`Parameter ${node.label} has no argument`)
      return force(arg)
    }
    if (node.type === 'output') {
      if (!node.source || !graph[node.source]) throw new EvalError('Output is not connected')
      return force(nodeValue(graph, node.source, env))
    }
    if (node.type === 'value') return reviveValue(node.data) // a stored Play result: data value
    if (node.type === 'curried') {
      if (!isClosure(node.closure)) throw new EvalError(`${node.label}: no stored partial application — Play the function again`)
      return reviveValue(node.closure)
    }
    if (node.type === 'function') return functionNodeValue(graph, node, env)
    throw new EvalError(`${node.label || id}: cannot evaluate a ${node.type} node`)
  }

  function functionNodeValue(graph, node, env) {
    const callee = node.sourceFunctionId || node.id
    const arity = definition(callee).builtin === 'listOf' ? (node.params || []).length : arityOf(callee)
    const args = Array(arity).fill(null)
    ;(node.params || []).forEach((text, i) => {
      const mountedId = node.mounted?.[i]
      let arg = null
      if (mountedId && graph[mountedId]) arg = nodeValue(graph, mountedId, env)
      else {
        const lit = parseLiteral(text)
        if (lit) arg = now(lit.kind === 'string' ? fromJsString(lit.value) : lit.value)
      }
      if (!arg) return
      if (i >= arity) throw new EvalError(`${node.label}: slot ${i + 1} has no matching parameter`)
      args[i] = arg
    })
    return args.includes(null) ? { kind: 'closure', callee, args } : call(callee, args)
  }

  return {
    /** Evaluate node `nodeId` of `graph` to JSON-safe data: a number, a boolean, a data value, or a closure. */
    run(graph, nodeId) {
      return guarded(() => serializeValue(nodeValue(graph, nodeId, { args: null, memo: new Map() })))
    },
    /** Apply builtin `name` (e.g. 'mappend', 'plus') to already-built values — used by the law checker. */
    invokeBuiltin(name, values) {
      if (!builtins[name]) throw new EvalError(`Unknown builtin: ${name}`)
      return guarded(() => serializeValue(builtins[name][1](...values.map((v) => now(reviveValue(v))))))
    },
    /** Apply any function value (e.g. a closure over a custom function) to values. */
    apply(fn, values) {
      return guarded(() => serializeValue(applyValue(now(reviveValue(fn)), values.map((v) => now(reviveValue(v))))))
    },
  }

  function guarded(fn) {
    steps = 0
    try {
      return fn()
    } catch (e) {
      if (e instanceof RangeError) throw new EvalError('Recursion too deep')
      throw e
    }
  }
}
