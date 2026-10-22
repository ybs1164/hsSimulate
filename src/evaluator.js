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
// - Classes are passed as dictionaries, the way GHC compiles them — every
//   class, builtin or declared (classDecls.js). The type pass elaborates
//   each call with evidence (inferGraph.js); a custom function polymorphic
//   in a class receives dictionaries as hidden arguments; a method looks its
//   implementation up in the dictionary it is given (see instanceTable.js
//   for what a dictionary holds). So which instance runs is decided by the
//   types, never by looking at a value: `show` of a Double is "1.0", of an
//   Int "1", though both are the same number at runtime, and `mempty`,
//   `addZero` and a literal `3` become a value of the type the context asks
//   for — `[]`, a record of zeros, `fromInteger 3` of a hand-written ring.
// - Runtime values are numbers, booleans, characters (one-character
//   strings), closures and data values (a constructor applied to its fields
//   — lazily, as Haskell constructors are). Closures and data values are
//   plain data once forced (`run` returns them that way), so they can be
//   stored on a node and survive save/load.
import { parseLiteral } from './literals.js'
import { cons, just, left, nil, nothing, ordering, pair, right, stdGen, unit } from './dataTypes.js'
import { METHOD_CLASS, METHOD_LABEL, METHOD_PARAMS } from './classMethods.js'

export class EvalError extends Error {}

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
  return isClosure(v) ? `ƒ ${v.callee}` : isData(v) ? v.ctor : String(v)
}

/**
 * Haskell `show`-style rendering of a forced value without its type (for
 * displaying a stored value): `Model {clicks = 1, perClick = 2}`, `Tick 0.5`,
 * `Buy (Just 3)`. `types` (the project's declarations) supplies record field
 * names; without it records print positionally. Knowing the type, the
 * evaluator's `showAt` shows a value through its Show instance instead.
 */
export function showValue(v, types = {}, asArg = false) {
  if (isClosure(v)) return `ƒ ${v.callee}`
  const showValue_ = (x, t, arg = false) => showValue(x, t, arg)
  if (typeof v === 'string') return showChar(v) // a Char
  if (isData(v) && v.type === '(,)') return `(${showValue_(v.args[0], types)},${showValue_(v.args[1], types)})`
  if (isData(v) && v.type === 'List') {
    const items = []
    for (let l = v; l.ctorIndex === 1; l = l.args[1]) items.push(l.args[0])
    if (items.length && items.every((c) => typeof c === 'string')) return showString(items.join('')) // a String
    return `[${items.map((x) => showValue_(x, types)).join(',')}]`
  }
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return asArg && (v < 0 || Object.is(v, -0)) ? `(${v})` : String(v) // Haskell: Tick (-0.5)
  if (!isData(v)) return String(v)
  if (!v.args.length) return v.ctor
  const ctor = types[v.type]?.constructors.find((c) => c.name === v.ctor)
  const rendered = ctor?.record
    ? `${v.ctor} {${ctor.fields.map((f, i) => `${f.name} = ${showValue_(v.args[i], types)}`).join(', ')}}`
    : `${v.ctor} ${v.args.map((a) => showValue_(a, types, true)).join(' ')}`
  return asArg ? `(${rendered})` : rendered
}

// ---- Haskell's show for the primitive types -------------------------------

const ESCAPES = { '\n': '\\n', '\t': '\\t', '\r': '\\r', '\\': '\\\\', '\0': '\\NUL', '\b': '\\b', '\f': '\\f', '\v': '\\v', '\x07': '\\a' }
// One character as it appears inside a literal (`quote` is the delimiter that needs escaping).
function escapeChar(c, quote) {
  if (c === quote) return `\\${c}`
  if (ESCAPES[c]) return ESCAPES[c]
  const code = c.codePointAt(0)
  return code >= 32 && code < 127 ? c : `\\${code}`
}
/** `show 'a'` = "'a'". */
export function showChar(c) {
  return `'${escapeChar(c, "'")}'`
}
/** `show "a\nb"` = "\"a\\nb\"" — a numeric escape followed by a digit gets `\&`, as GHC writes it. */
export function showString(s) {
  let out = ''
  const chars = [...s]
  chars.forEach((c, i) => {
    const e = escapeChar(c, '"')
    out += e
    if (/^\\\d+$/.test(e) && /\d/.test(chars[i + 1] || '')) out += '\\&'
  })
  return `"${out}"`
}
/** `show` of a Double or Float, as GHC prints it: `1.0`, `0.1`, `1.0e7`, `1.5e-2`, `NaN`, `Infinity`. */
export function showDouble(x) {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity'
  if (x < 0 || Object.is(x, -0)) return `-${showDouble(-x)}`
  if (x === 0) return '0.0'
  // floatToDigits: x = 0.d₁d₂… × 10^e (the shortest digits that read back as x).
  const [mantissa, exp] = x.toExponential().split('e')
  const ds = mantissa.replace('.', '')
  const e = Number(exp) + 1
  if (x >= 0.1 && x < 1e7) {
    if (e <= 0) return `0.${'0'.repeat(-e)}${ds}`
    const whole = ds.slice(0, e).padEnd(e, '0')
    return `${whole}.${ds.slice(e) || '0'}`
  }
  return `${ds[0]}.${ds.slice(1) || '0'}e${e - 1}`
}
/** A host number as a fraction n / d (exactly: it's dyadic) — how a Rational is shown, `1 % 2`. */
function asFraction(q) {
  let d = 1
  while (!Number.isInteger(q * d) && d < 2 ** 60) d *= 2
  return [q * d, d]
}
const paren = (yes, s) => (yes ? `(${s})` : s)

// A closure over a function that takes dictionaries carries them (plain data).
const closure = (callee, args, dicts) => (dicts?.length ? { kind: 'closure', callee, args, dicts } : { kind: 'closure', callee, args })

/** Fully force a value into JSON-safe data (closure args included). */
function serializeValue(v) {
  v = force(v)
  if (isData(v)) return { kind: 'data', type: v.type, ctor: v.ctor, ctorIndex: v.ctorIndex, args: v.args.map(serializeValue) }
  if (!isClosure(v)) return v
  return closure(v.callee, v.args.map((a) => (a === null ? null : serializeValue(a))), v.dicts)
}

/** Turn stored closure data back into a runtime closure. */
function reviveValue(v) {
  if (isData(v)) return { ...v, args: v.args.map((a) => now(reviveValue(a))) }
  if (!isClosure(v)) return v
  return closure(v.callee, v.args.map((a) => (a === null ? null : now(reviveValue(a)))), v.dicts)
}

/**
 * Look-ups into the type pass's elaboration (`{ main, functions, instances }`,
 * see inferGraph.js and instanceTable.js) — which graph is the top-level one
 * is known only to the caller, so it's passed along.
 */
export function elaborationIndex(data, mainGraph, functionBodies) {
  return {
    forGraph(graph) {
      if (graph === mainGraph) return data.main || {}
      const id = Object.keys(functionBodies).find((k) => functionBodies[k] === graph)
      return id ? data.functions?.[id]?.nodes || {} : {}
    },
    forFunction: (id) => data.functions?.[id]?.nodes || {},
    instance: (key) => data.instances?.[key],
  }
}

const num = (t) => {
  const v = force(t)
  if (typeof v !== 'number') throw new EvalError(`Expected a number, got ${show(v)}`)
  return v
}
const nonZero = (b) => {
  if (b === 0) throw new EvalError('divide by zero')
  return b
}
const bool = (t) => {
  const v = force(t)
  if (typeof v !== 'boolean') throw new EvalError(`Expected a Bool, got ${show(v)}`)
  return v
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
const sub = (ctor, ctorIndex, args) => ({ kind: 'data', type: 'Sub', ctor, ctorIndex, args })

/** One step of mulberry32: a 32-bit state in, [a uniform number in [0, 1), the next state] out. */
function mulberry32(state) {
  const next = (state + 0x6d2b79f5) | 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

const NUMERIC = new Set(['Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational'])
const headOf = (key) => key.slice(key.indexOf('@') + 1)
const shown = (key) => key.replace('@', ' ').replace(' List', ' []')

/**
 * `registry` is `{ nodes, functionBodies, types, elaboration }` (main.js's
 * live objects): `nodes` holds every function definition, `functionBodies`
 * every custom body, `elaboration()` the type pass's elaboration (see
 * elaborationIndex) — without it, nothing that needs a dictionary can run
 * (typedEvaluator.js computes one).
 */
export function createEvaluator(registry) {
  let steps = 0

  // [arity, implementation]. Implementations receive argument thunks — and,
  // after them, the call's dictionaries — and force only what they need.
  // The first seven are the protected builtins (CLAUDE.md) — same results
  // as their original implementations.
  const builtins = {
    succ: [1, (n) => num(n) + 1],
    zero: [0, () => 0],
    identity: [1, (x) => force(x)],
    apply: [2, (f, x) => applyValue(f, [x])],
    compose: [3, (f, g, x) => applyValue(f, [delay(() => applyValue(g, [x]))])],
    isZero: [1, (n) => num(n) === 0],
    ifThenElse: [3, (c, a, b) => (bool(c) ? force(a) : force(b))],

    // Not methods, but written with them (dictionaries in hand).
    minus: [2, (x, y, [d]) => invoke(toClass(d, 'AddSemigroup'), 'plus', [x, delay(() => invoke(toClass(d, 'AddGroup'), 'negate', [y]))])], // x + negate y
    abs: [1, (x, [d]) => (bool(invoke(toClass(d, 'Ord'), 'geq', [x, now(fromIntegerVia(d, 0))])) ? force(x) : invoke(toClass(d, 'AddGroup'), 'negate', [x]))], // select (x >= 0) x (negate x)
    // The numeric conversions, the Haskell Report way (builtinSchemes.js):
    // fromInteger and fromRational aren't methods — ℤ is the initial ring
    // (ℚ the initial field of characteristic 0), so they're fixed by the
    // target's dictionary (fromIntegerVia). The rest are written with them
    // and the methods toInteger, toRational and properFraction as graphs
    // (definitionViews.js), and run natively here, the same way, unless edited.
    fromInteger: [1, (n, [d]) => fromIntegerVia(d, integer(n, 'fromInteger'))],
    fromRational: [1, (r, [d]) => fromRationalVia(d, num(r))],
    fromIntegral: [1, (x, [a, b]) => fromIntegerVia(b, integer(invoke(a, 'toInteger', [x]), 'toInteger'))], // fromInteger . toInteger
    realToFrac: [1, (x, [a, b]) => fromRationalVia(b, num(invoke(a, 'toRational', [x])))], // fromRational . toRational
    truncate: [1, (x, ds) => fraction(x, ds)[0]], // fst (properFraction x)
    floor: [1, (x, [a, b]) => {
      const [n, r] = fraction(x, [a, b])
      return bool(invoke(toClass(a, 'Ord'), 'geq', [r, now(fromIntegerVia(a, 0))])) ? n : invoke(toClass(b, 'AddSemigroup'), 'plus', [now(n), now(fromIntegerVia(b, -1))])
    }],
    ceiling: [1, (x, [a, b]) => {
      const [n, r] = fraction(x, [a, b])
      return bool(invoke(toClass(a, 'Ord'), 'geq', [now(fromIntegerVia(a, 0)), r])) ? n : invoke(toClass(b, 'AddSemigroup'), 'plus', [now(n), now(fromIntegerVia(b, 1))])
    }],
    // To the nearer of n and the integer on r's side, and on a half to the even one.
    round: [1, (x, [a, b]) => {
      const [n, r] = fraction(x, [a, b])
      const plusB = (k) => invoke(toClass(b, 'AddSemigroup'), 'plus', [now(n), now(fromIntegerVia(b, k))])
      const m = delay(() => plusB(bool(invoke(toClass(a, 'Ord'), 'geq', [r, now(fromIntegerVia(a, 0))])) ? 1 : -1))
      const size = now(builtins.abs[1](r, [toClass(a, 'OrderedRing')]))
      const half = now(fromRationalVia(toClass(a, 'Field'), 0.5))
      const even = () => bool(invoke(toClass(b, 'Eq'), 'eq', [now(invoke(b, 'mod', [now(n), now(fromIntegerVia(b, 2))])), now(fromIntegerVia(b, 0))]))
      if (bool(invoke(toClass(a, 'Eq'), 'eq', [size, half]))) return even() ? n : force(m)
      return bool(invoke(toClass(a, 'Ord'), 'geq', [size, half])) ? force(m) : n
    }],
    select: [3, (c, a, b) => (bool(c) ? force(a) : force(b))],
    and: [2, (p, q) => bool(p) && bool(q)], // lazy in q, as Haskell's (&&)
    or: [2, (p, q) => bool(p) || bool(q)],
    not: [1, (p) => !bool(p)],

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
    map: [2, (f, xs) => mapList(f, xs)],
    // The Foldable functions (length, null, elem, any, all, sum, product,
    // concat, concatMap, toList) run on the container's elements in order —
    // a list as itself (lazily), any other container through its foldMap
    // into the free monoid (listVia).
    length: [1, (t, [d]) => {
      let n = 0
      for (let l = list(listVia(d, t)); l.ctorIndex === 1; l = list(l.args[1])) n++
      return n
    }],
    toList: [1, (t, [d]) => force(listVia(d, t))],
    singleton: [1, (x) => cons(x, now(nil))],
    constFn: [2, (x) => force(x)],
    append: [2, (xs, ys) => appendList(xs, ys)],
    index: [2, (xs, i) => {
      let n = num(i)
      if (n < 0) return nothing
      for (let l = list(xs); l.ctorIndex === 1; l = list(l.args[1]), n--) if (n === 0) return just(l.args[0])
      return nothing
    }],
    uncons: [1, (xs) => {
      const l = list(xs)
      return l.ctorIndex === 0 ? nothing : just(now(pair(l.args[0], l.args[1])))
    }],
    null: [1, (t, [d]) => list(listVia(d, t)).ctorIndex === 0],
    // foldl, strict in the accumulator (Data.List's foldl'): same result on total functions, no thunk chain.
    foldl: [3, (f, z, xs) => {
      let acc = z
      for (let l = list(xs); l.ctorIndex === 1; l = list(l.args[1])) acc = now(applyValue(f, [acc, l.args[0]]))
      return force(acc)
    }],
    filter: [2, (p, xs) => {
      const go = (t) => {
        for (let l = list(t); l.ctorIndex === 1; l = list(l.args[1])) {
          if (bool(delay(() => applyValue(p, [l.args[0]])))) return cons(l.args[0], delay(() => go(l.args[1])))
        }
        return nil
      }
      return go(xs)
    }],
    reverse: [1, (xs) => {
      let acc = nil
      for (let l = list(xs); l.ctorIndex === 1; l = list(l.args[1])) acc = cons(l.args[0], now(acc))
      return acc
    }],
    concat: [1, (t, [d]) => concatMapList(null, listVia(d, t))],
    concatMap: [2, (f, t, [d]) => concatMapList(f, listVia(d, t))],
    elem: [2, (x, t, [d, eq]) => anyOf(listVia(d, t), (y) => bool(delay(() => invoke(eq, 'eq', [x, y]))))],
    any: [2, (p, t, [d]) => anyOf(listVia(d, t), (y) => bool(delay(() => applyValue(p, [y]))))],
    all: [2, (p, t, [d]) => !anyOf(listVia(d, t), (y) => !bool(delay(() => applyValue(p, [y]))))],
    // getSum . foldMap Sum, as written (definitionViews.js): right-nested, for a monoid that isn't commutative.
    sum: [1, (t, [f, d]) => listItems(listVia(f, t)).reduceRight((acc, x) => invoke(toClass(d, 'AddSemigroup'), 'plus', [x, now(acc)]), invoke(toClass(d, 'AddMonoid'), 'addZero', []))],
    product: [1, (t, [f, d]) => listItems(listVia(f, t)).reduceRight((acc, x) => invoke(toClass(d, 'MulSemigroup'), 'times', [x, now(acc)]), invoke(toClass(d, 'MulMonoid'), 'mulOne', []))],
    // mconcat = foldr (<>) mempty
    mconcat: [1, (xs, [d]) => foldList(xs, () => memptyAt(d), (x, rest) => mappendAt(d, x, rest))],

    // Functor, Applicative, Monad, Traversable: the functions written with
    // their methods (Data.Functor, Control.Applicative, Control.Monad).
    fmapOp: [2, (f, x, [d]) => invoke(d, 'fmap', [f, x])],
    constMap: [2, (x, t, [d]) => invoke(d, 'fmap', [now(fn('constFn', x)), t])],
    liftA2: [3, (h, x, y, [d]) => invoke(d, 'ap', [delay(() => fmapAt(d, h, x)), y])],
    thenA: [2, (x, y, [d]) => invoke(d, 'ap', [delay(() => fmapAt(d, now(fn('constFn', now(fn('identity')))), x)), y])],
    returnM: [1, (x, [d]) => invoke(toClass(d, 'Applicative'), 'pure', [x])],
    thenM: [2, (x, y, [d]) => invoke(d, 'bind', [x, now(fn('constFn', y))])],
    kleisli: [3, (f, g, x, [d]) => invoke(d, 'bind', [delay(() => applyValue(f, [x])), g])],
    joinM: [1, (mm, [d]) => invoke(d, 'bind', [mm, now(fn('identity'))])],
    when: [2, (c, act, [d]) => (bool(c) ? force(act) : invoke(d, 'pure', [now(unit)]))],
    mapM_: [2, (k, t, [f, d]) => {
      const go = (u) => {
        const l = list(u)
        return l.ctorIndex === 0 ? invoke(toClass(d, 'Applicative'), 'pure', [now(unit)]) : invoke(d, 'bind', [delay(() => applyValue(k, [l.args[0]])), now(fn('constFn', delay(() => go(l.args[1]))))])
      }
      return go(listVia(f, t))
    }],
    sequenceA: [1, (t, [d, a]) => invoke(d, 'traverse', [now(fn('identity')), t], [a])],
    forT: [2, (t, h, [d, a]) => invoke(d, 'traverse', [h, t], [a])],
    mapM: [2, (h, t, [d, m]) => invoke(d, 'traverse', [h, t], [toClass(m, 'Applicative')])],
    replicateM: [2, (n, act, [d]) => {
      const go = (k) => (k <= 0 ? invoke(d, 'pure', [now(nil)]) : invoke(d, 'ap', [delay(() => fmapAt(d, now(fn('cons')), act)), delay(() => go(k - 1))]))
      return go(num(n))
    }],
    unit: [0, () => unit],
    // Control.Monad.State. A State value wraps its s → (a, s) function; the
    // st* builtins are those functions, for closures built here.
    state: [1, (f) => wrapped('State', f)],
    stateGet: [0, () => wrapped('State', now(fn('stGet')))],
    statePut: [1, (v) => wrapped('State', now(fn('stPut', v)))],
    stateModify: [1, (f) => wrapped('State', now(fn('stModify', f)))],
    stateGets: [1, (f) => wrapped('State', now(fn('stGets', f)))],
    evalState: [2, (m, st) => force(force(runStateOf(m, st)).args[0])],
    execState: [2, (m, st) => force(force(runStateOf(m, st)).args[1])],
    stGet: [1, (st) => pair(st, st)],
    stPut: [2, (v) => pair(now(unit), v)],
    stModify: [2, (f, st) => pair(now(unit), delay(() => applyValue(f, [st])))],
    stGets: [2, (f, st) => pair(delay(() => applyValue(f, [st])), st)],
    stPure: [2, (x, st) => pair(x, st)],
    stMap: [3, (g, m, st) => {
      const r = runStateOf(m, st)
      return pair(delay(() => applyValue(g, [delay(() => force(force(r).args[0]))])), delay(() => force(force(r).args[1])))
    }],
    stAp: [3, (mf, mx, st) => {
      const r1 = runStateOf(mf, st)
      const r2 = runStateOf(mx, delay(() => force(force(r1).args[1])))
      return pair(delay(() => applyValue(force(r1).args[0], [delay(() => force(force(r2).args[0]))])), delay(() => force(force(r2).args[1])))
    }],
    stBind: [3, (m, k, st) => {
      const r = runStateOf(m, st)
      return force(runStateOf(delay(() => applyValue(k, [delay(() => force(force(r).args[0]))])), delay(() => force(force(r).args[1]))))
    }],
    take: [2, (n, xs) => takeList(num(n), xs)],
    drop: [2, (n, xs) => dropList(num(n), xs)],
    splitAt: [2, (n, xs) => pair(delay(() => takeList(num(n), xs)), delay(() => dropList(num(n), xs)))],
    replicate: [2, (n, x) => {
      const go = (k) => (k <= 0 ? nil : cons(x, delay(() => go(k - 1))))
      return go(num(n))
    }],
    enumFromTo: [2, (m, n, [d]) => {
      const go = (t) => (bool(delay(() => invoke(toClass(d, 'Ord'), 'gt', [t, n]))) ? nil : cons(t, delay(() => go(delay(() => invoke(toClass(d, 'AddSemigroup'), 'plus', [t, now(fromIntegerVia(d, 1))]))))))
      return go(m)
    }],
    zip: [2, (xs, ys) => zipWithList((a, b) => pair(a, b), xs, ys)],
    zipWith: [3, (f, xs, ys) => zipWithList((a, b) => applyValue(f, [a, b]), xs, ys)],
    lookup: [2, (key, pairs, [d]) => {
      for (let l = list(pairs); l.ctorIndex === 1; l = list(l.args[1])) {
        const p = force(l.args[0])
        if (bool(delay(() => invoke(d, 'eq', [key, p.args[0]])))) return just(p.args[1])
      }
      return nothing
    }],
    insertBy: [3, (cmp, x, ys) => {
      const go = (t) => {
        const l = list(t)
        if (l.ctorIndex === 0) return cons(x, now(nil))
        return ordered(cmp, x, l.args[0]) > 0 ? cons(l.args[0], delay(() => go(l.args[1]))) : cons(x, now(l))
      }
      return go(ys)
    }],
    // Stable, as insertion by foldr (insertBy cmp) [] is.
    sortBy: [2, (cmp, xs) => fromItems(listItems(xs).sort((x, y) => ordered(cmp, x, y)))],
    sort: [1, (xs, [d]) => fromItems(listItems(xs).sort((x, y) => cmpAt(d, x, y)))],
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
    left: [1, (x) => left(x)],
    right: [1, (x) => right(x)],
    maybe: [3, (b, f, m) => {
      const v = force(m)
      if (!isData(v) || v.type !== 'Maybe') throw new EvalError(`Expected a Maybe, got ${show(v)}`)
      return v.ctorIndex === 0 ? force(b) : applyValue(f, [v.args[0]])
    }],
    // Numeric.showFFloat (Just digits) x "" — simplified to take the digit count directly.
    showFFloat: [2, (d, x) => fromJsString(num(x).toFixed(Math.max(0, Math.min(20, num(d)))))],
    showCompact: [1, (x) => fromJsString(showCompact(num(x)))],
    listOf: [null, (...xs) => xs.reduceRight((tail, x) => cons(x, now(tail)), nil)], // arity = the node's slot count

    // Games (runtime.js): a Program and its widgets are plain lazy data.
    // A Program carries its settings after the four functions: steps per
    // second, the longest time away that counts (seconds), subscriptions.
    program: [4, (model, view, handle, step) => ({ kind: 'data', type: 'Program', ctor: 'Program', ctorIndex: 0, args: [model, view, handle, step, now(10), now(7 * 24 * 3600), now(NO_SUBSCRIPTIONS)] })],
    noSubscriptions: [1, () => sub('None', 0, [])], // const mempty
    setStepsPerSecond: [2, (n, p) => setProgramField(p, 4, n)],
    setMaxOffline: [2, (s, p) => setProgramField(p, 5, s)],
    setSubscriptions: [2, (f, p) => setProgramField(p, 6, f)],
    every: [2, (seconds, msg) => sub('Every', 1, [seconds, msg])],
    onKey: [1, (f) => sub('OnKey', 2, [f])],
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
  }
  // Every class method is a builtin that calls its dictionary: `plus x y` is
  // `(+) dict x y`. Its further dictionaries (foldMap's Monoid) ride along.
  for (const m of Object.keys(METHOD_CLASS)) {
    builtins[m] = [METHOD_PARAMS[m].length, (...xs) => {
      const dicts = xs.pop()
      if (!dicts?.[0]) throw new EvalError(`${METHOD_LABEL[m]}: a method of ${METHOD_CLASS[m]} needs to know its type — run it from a graph (the type pass picks the instance)`)
      return invoke(dicts[0], m, xs, dicts.slice(1))
    }]
  }

  const NO_SUBSCRIPTIONS = { kind: 'closure', callee: '#noSubscriptions', args: [null] }

  // A Foldable's elements as a list (a thunk): a list is itself, anything
  // else is folded into the free monoid — toList = foldMap singleton.
  const LIST_MONOID = { kind: 'dict', key: 'Monoid@List', sub: [] }
  // runState m s, as a thunk of the (a, s) pair.
  const runStateOf = (m, st) => delay(() => applyValue(force(m).args[0], [st]))
  const listVia = (d, t) => (d?.key === 'Foldable@List' ? t : delay(() => invoke(d, 'foldMap', [now(fn('singleton')), t], [LIST_MONOID])))

  function mapList(f, xs) {
    const go = (t) => {
      const l = list(t)
      return l.ctorIndex === 0 ? nil : cons(delay(() => applyValue(f, [l.args[0]])), delay(() => go(l.args[1])))
    }
    return go(xs)
  }
  function appendList(xs, ys) {
    const go = (t) => {
      const l = list(t)
      return l.ctorIndex === 0 ? force(ys) : cons(l.args[0], delay(() => go(l.args[1])))
    }
    return go(xs)
  }
  /** concatMap f xs, lazily (`f` null: concat). */
  function concatMapList(f, xs) {
    const go = (t) => {
      for (let l = list(t); l.ctorIndex === 1; l = list(l.args[1])) {
        const inner = f ? delay(() => applyValue(f, [l.args[0]])) : l.args[0]
        if (list(inner).ctorIndex === 1) return appendList(inner, delay(() => go(l.args[1])))
      }
      return nil
    }
    return go(xs)
  }
  function takeList(n, xs) {
    if (n <= 0) return nil
    const l = list(xs)
    return l.ctorIndex === 0 ? nil : cons(l.args[0], delay(() => takeList(n - 1, l.args[1])))
  }
  function dropList(n, xs) {
    let l = list(xs)
    for (; n > 0 && l.ctorIndex === 1; n--) l = list(l.args[1])
    return l
  }
  function zipWithList(f, xs, ys) {
    const go = (s, t) => {
      const a = list(s)
      if (a.ctorIndex === 0) return nil
      const b = list(t)
      return b.ctorIndex === 0 ? nil : cons(delay(() => f(a.args[0], b.args[0])), delay(() => go(a.args[1], b.args[1])))
    }
    return go(xs, ys)
  }
  /** Whether `test` holds for some element of `xs` — stops at the first (so works on an infinite list that has one). */
  function anyOf(xs, test) {
    for (let l = list(xs); l.ctorIndex === 1; l = list(l.args[1])) if (test(l.args[0])) return true
    return false
  }
  /** The element thunks of a finite list. */
  function listItems(xs) {
    const items = []
    for (let l = list(xs); l.ctorIndex === 1; l = list(l.args[1])) items.push(l.args[0])
    return items
  }
  const fromItems = (items) => items.reduceRight((tail, x) => cons(x, now(tail)), nil)
  /** `cmp x y` as -1, 0 or 1 (LT, EQ, GT). */
  function ordered(cmp, x, y) {
    const o = force(applyValue(cmp, [x, y]))
    if (!isData(o) || o.type !== 'Ordering') throw new EvalError(`Expected an Ordering, got ${show(o)}`)
    return o.ctorIndex - 1
  }

  /** `properFraction x` taken apart: the integral part (forced) and the fractional part (a thunk). */
  function fraction(x, [a, b]) {
    const p = force(invoke(a, 'properFraction', [x], [b]))
    return [force(p.args[0]), p.args[1]]
  }

  /** `v` checked to be an Integer — what a toInteger must give. */
  function integer(v, what) {
    const n = force(v)
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new EvalError(`${what} must give a whole number (an Integer), got ${show(n)}`)
    return n
  }

  /** A JS string from a (forced, lazy) Haskell String. */
  function jsString(t) {
    let s = ''
    for (let l = list(t); l.ctorIndex === 1; l = list(l.args[1])) s += force(l.args[0])
    return s
  }

  /** A Program with setting `index` replaced (record update). Programs from older saves get the defaults first. */
  function setProgramField(p, index, value) {
    const v = force(p)
    if (!isData(v) || v.type !== 'Program') throw new EvalError(`Expected a Program, got ${show(v)}`)
    const args = [...v.args, now(10), now(7 * 24 * 3600), now(NO_SUBSCRIPTIONS)].slice(0, 7)
    args[index] = value
    return { ...v, args }
  }

  function list(t) {
    const v = force(t)
    if (!isData(v) || v.type !== 'List') throw new EvalError(`Expected a list, got ${show(v)}`)
    return v
  }

  // A Prelude function that is a constructor or eliminator of a Prelude
  // type under another name (`text s = Text s`, `red = rgb 1 0 0`; see
  // definitionViews.js) runs that definition once it is customized — a
  // custom `Text` or a taken-over `rgb` is what every `text` or `red` runs.
  const VIA = {
    ...Object.fromEntries(Object.entries({ wText: 'Text', wButton: 'Button', wColumn: 'Column', wRow: 'Row', wProgress: 'Progress', wHeading: 'Heading', wSpacer: 'Spacer', wColor: 'Tinted', wDrawing: 'Drawing' }).map(([b, c]) => [b, `type:Widget:${c}`])),
    ...Object.fromEntries(Object.entries({ pCircle: 'Circle', pCircleSolid: 'CircleSolid', pRectangleSolid: 'RectangleSolid', pTranslate: 'Translate', pColor: 'Color' }).map(([b, c]) => [b, `type:Picture:${c}`])),
    pair: 'type:(,):(,)', rgb: 'type:Color:RGB', every: 'type:Sub:Every', onKey: 'type:Sub:OnKey', just: 'type:Maybe:Just', nothing: 'type:Maybe:Nothing', maybe: 'type:Maybe:caseMaybe',
  }
  const COLOUR_RGB = { red: [1, 0, 0], green: [0, 0.7, 0], blue: [0, 0, 1], yellow: [1, 0.85, 0], black: [0, 0, 0], white: [1, 1, 1] }
  const PROGRAM_DEFAULTS = [10, 7 * 24 * 3600]
  const customized = (id) => !!registry.nodes[id]?.custom
  function customizedVia(builtin) {
    if (VIA[builtin] && customized(VIA[builtin])) return { id: VIA[builtin] }
    if (COLOUR_RGB[builtin] && (customized('prelude:rgb') || customized(VIA.rgb))) return { id: 'prelude:rgb', args: () => COLOUR_RGB[builtin].map(now) }
    if (builtin === 'program' && customized('type:Program:Program')) return { id: 'type:Program:Program', args: (a) => [...a, ...PROGRAM_DEFAULTS.map(now), now(NO_SUBSCRIPTIONS)] }
    return null
  }

  function definition(callee) {
    // `#name`: a builtin by name, for closures the runtime builds itself (traverse's `fmap (:)`).
    if (callee.startsWith('#')) return { builtin: callee.slice(1), label: callee.slice(1) }
    const def = registry.nodes[callee]
    if (!def) throw new EvalError(`Unknown function: ${callee}`)
    return def
  }
  const fn = (name, ...args) => closure(`#${name}`, [...args, ...Array(builtins[name][0] - args.length).fill(null)])

  // ---- Dictionaries ---------------------------------------------------------
  // A dictionary is plain data `{ kind: 'dict', key, sub }` — instance `key`
  // and the dictionaries of its context — or `{ kind: 'dict', error }` when
  // the type pass found no evidence; that error is raised only if it's used.
  // `{ kind: 'dict', param: i }` stands for a dictionary a stored closure
  // will be given when it is used again (inferGraph's rootParams).
  let elab = null // the elaboration index, fetched once per run

  /** Build the dictionary evidence `e` describes, in `env` ({ dicts, ctx, self, extra }). */
  function dictionary(e, env) {
    if (!e) return { kind: 'dict', error: 'no evidence for a class constraint' }
    if (e.error) return { kind: 'dict', error: e.error }
    if ('param' in e) return env.dicts ? env.dicts[e.param] ?? { kind: 'dict', error: 'a class-constrained function was called without its dictionary (call it from a graph so its types are known)' } : { kind: 'dict', param: e.param }
    if ('ctx' in e) return env.ctx[e.ctx]
    if (e.self) return env.self
    if ('extra' in e) return env.extra[e.extra]
    if (e.inst) return { kind: 'dict', key: e.inst, sub: e.sub.map((s) => dictionary(s, env)) }
    if (e.super) return superDict(dictionary(e.of, env), e.super)
    return { kind: 'dict', error: 'malformed evidence' }
  }

  function instanceInfo(d) {
    if (!d) throw new EvalError('A class-constrained function was run without its dictionaries — run it from a graph so the type pass picks them')
    if (d.error) throw new EvalError(d.error)
    if ('param' in d) throw new EvalError("This value's type was still open when it was played — play it where its type is known")
    const info = elab?.instance(d.key)
    if (!info) throw new EvalError(`No instance ${shown(d.key)}${elab ? '' : ' (the type pass gave no instances)'}`)
    return info
  }
  /** The superclass `cls` dictionary inside dictionary `d` (of a stand-in: one remembering the way there). */
  function superDict(d, cls) {
    if ('param' in d) return { ...d, path: [...(d.path || []), cls] }
    if (d.error) return d
    const info = instanceInfo(d)
    if (!info.supers[cls]) return { kind: 'dict', error: `${shown(d.key)} has no superclass ${cls}` }
    return dictionary(info.supers[cls], { ctx: d.sub, self: d })
  }
  /** The dictionary of class `cls` (`d`'s own class or one of its superclasses, at the same type) reached from `d`. */
  function toClass(d, cls) {
    const found = (function find(x, seen) {
      const info = instanceInfo(x)
      if (info.cls === cls) return x
      for (const s of Object.keys(info.supers)) {
        if (seen.has(s)) continue
        seen.add(s)
        const sd = superDict(x, s)
        if (sd.error) continue
        const r = find(sd, seen)
        if (r) return r
      }
      return null
    })(d, new Set())
    if (!found) throw new EvalError(`${shown(d.key)} doesn't give ${cls}`)
    return found
  }
  /** Replace the stand-in dictionaries `{ param: i }` inside a stored value with `dicts`. */
  function fillDicts(v, dicts) {
    const fill = (d) => ('param' in d ? (dicts[d.param] ? (d.path || []).reduce(superDict, dicts[d.param]) : d) : d.sub ? { ...d, sub: d.sub.map(fill) } : d)
    if (v?.kind === 'literal') return literalAt(v.value, v.text, fill(v.dict))
    if (isData(v)) return { ...v, args: v.args.map((a) => now(fillDicts(force(a), dicts))) }
    if (!isClosure(v)) return v
    return closure(v.callee, v.args.map((a) => (a === null ? null : now(fillDicts(force(a), dicts)))), v.dicts?.map(fill))
  }

  // ---- Methods --------------------------------------------------------------
  /** Method `m` of dictionary `d`, applied to argument thunks `args`; `extra` are the call's further dictionaries. */
  function invoke(d, m, args, extra = []) {
    if (++steps > MAX_STEPS) throw new EvalError('Evaluation took too many steps (infinite recursion?)')
    const info = instanceInfo(d)
    if (info.how === 'written') {
      if (info.methods[m]) return runWritten(d, info, m, args, extra)
    } else if (info.how === 'newtype') return viaNewtype(d, info, m, args, extra)
    else {
      const impl = info.how === 'prim' ? prim(d.key, m) : info.how === 'stock' ? STOCK[m] : info.how === 'pointwise' ? POINTWISE[m] : null
      if (impl) return impl(args, d, info, extra)
    }
    const def = DEFAULTS[m]
    if (def) return def(args, d, info, extra)
    throw new EvalError(`instance ${shown(d.key)} has no ${METHOD_LABEL[m] || m} — pick a function for it in the class editor`)
  }
  /** Whether dictionary `d` defines method `m` itself (rather than by its class's default). */
  function defines(d, m) {
    const info = instanceInfo(d)
    if (info.how === 'written') return !!info.methods[m]
    if (info.how === 'newtype') return defines(dictionary(info.inner, { ctx: d.sub, self: d }), m)
    return !!(info.how === 'prim' ? prim(d.key, m) : info.how === 'stock' ? STOCK[m] : info.how === 'pointwise' ? POINTWISE[m] : null)
  }

  /** A hand-written method: its custom function, given the dictionaries it needs. */
  function runWritten(d, info, m, args, extra) {
    const fnId = info.methods[m]
    const needs = info.implDicts[m]
    if (needs?.error) throw new EvalError(needs.error)
    if (!registry.nodes[fnId]) throw new EvalError(`instance ${shown(d.key)}: the function for ${METHOD_LABEL[m] || m} is gone`)
    const implDicts = (needs || []).map((e) => dictionary(e, { ctx: d.sub, self: d, extra }))
    const arity = arityOf(fnId)
    if (arity === 0) {
      const v = call(fnId, [], implDicts)
      return args.length ? applyValue(now(v), args) : v
    }
    return applyValue(now(closure(fnId, Array(arity).fill(null), implDicts)), args)
  }

  // Newtype deriving: the wrapped type's method, coerced through the
  // constructor wherever the method's type mentions the class variable.
  function viaNewtype(d, info, m, args, extra) {
    const inner = dictionary(info.inner, { ctx: d.sub, self: d })
    const mt = info.coerce?.[m]
    if (!mt) return invoke(inner, m, args, extra)
    const wrap = (t) => now({ kind: 'data', type: info.type, ctor: info.ctor, ctorIndex: 0, args: [t] })
    const unwrap = (t) => delay(() => force(force(t).args[0]))
    const coerce = (type, t, out) => {
      if (type.kind === 'var' && type.id === mt.classVar) return out ? wrap(t) : unwrap(t)
      if (type.kind === 'app' && type.fn.kind === 'app' && type.fn.fn.name === '(,)') return delay(() => { const p = force(t); return pair(coerce(type.fn.arg, p.args[0], out), coerce(type.arg, p.args[1], out)) })
      return t
    }
    let type = mt.type
    const coerced = args.map((a) => { const from = type.from; type = type.to; return coerce(from, a, false) })
    return force(coerce(type, now(invoke(inner, m, coerced, extra)), true))
  }

  // Helpers on dictionaries, in the names of their methods.
  const eqAt = (d, x, y) => bool(invoke(d, 'eq', [x, y]))
  const cmpAt = (d, x, y) => force(invoke(d, 'compare', [x, y])).ctorIndex - 1
  const leAt = (d, x, y) => bool(invoke(d, 'le', [x, y]))
  const memptyAt = (d) => invoke(toClass(d, 'Monoid'), 'mempty', [])
  const mappendAt = (d, x, y) => invoke(toClass(d, 'Semigroup'), 'mappend', [x, y])
  const fmapAt = (d, f, x) => invoke(toClass(d, 'Functor'), 'fmap', [f, x])
  const field = (d, info, c, i) => dictionary(info.ctors[c].ev[i], { ctx: d.sub, self: d })

  /** `fromInteger n` at dictionary `d` (any class of the numeric tower that gives a Semiring): the unique ring map ℤ → its type. */
  function fromIntegerVia(d, n) {
    const info = instanceInfo(d)
    if (info.how === 'prim' && NUMERIC.has(headOf(d.key))) return n
    if (info.how === 'newtype') return { kind: 'data', type: info.type, ctor: info.ctor, ctorIndex: 0, args: [now(fromIntegerVia(dictionary(info.inner, { ctx: d.sub, self: d }), n))] }
    if (info.how === 'pointwise') return { kind: 'data', type: info.type, ctor: info.ctors[0].name, ctorIndex: 0, args: info.ctors[0].ev.map((_, i) => delay(() => fromIntegerVia(field(d, info, 0, i), n))) } // the diagonal ℤ → R × S
    // n · 1 by doubling (O(log n) additions); 0 is addZero; a negative n is negated.
    if (n === 0) return invoke(toClass(d, 'AddMonoid'), 'addZero', [])
    const plus = toClass(d, 'AddSemigroup')
    const add = (p, q) => invoke(plus, 'plus', [now(p), now(q)])
    let result = null
    let power = invoke(toClass(d, 'MulMonoid'), 'mulOne', [])
    for (let k = Math.abs(n); k > 0; k = Math.floor(k / 2)) {
      if (k % 2) result = result === null ? power : add(result, power)
      if (k > 1) power = add(power, power)
    }
    return n > 0 ? result : invoke(toClass(d, 'AddGroup'), 'negate', [now(result)])
  }
  /** `fromRational q` at a Field dictionary: q = n / m exactly (a host number is dyadic), so fromInteger n / fromInteger m. */
  function fromRationalVia(d, q) {
    const info = instanceInfo(d)
    if (info.how === 'prim' && NUMERIC.has(headOf(d.key))) return q
    if (info.how === 'newtype') return { kind: 'data', type: info.type, ctor: info.ctor, ctorIndex: 0, args: [now(fromRationalVia(dictionary(info.inner, { ctx: d.sub, self: d }), q))] }
    if (Number.isInteger(q)) return fromIntegerVia(d, q)
    const [n, m] = asFraction(q)
    return invoke(toClass(d, 'Field'), 'divide', [now(fromIntegerVia(d, n)), now(fromIntegerVia(d, m))])
  }
  /**
   * A numeric literal's value at its dictionary (none: the literal stands
   * for itself). At a stand-in dictionary (a stored closure's, see
   * fillDicts) it waits, as `{ kind: 'literal' }`, for the real one.
   */
  function literalAt(value, text, d) {
    if (!d || typeof value !== 'number') return value
    if ('param' in d) return { kind: 'literal', value, text: String(text), dict: d }
    return /\./.test(String(text)) ? fromRationalVia(d, value) : fromIntegerVia(d, value)
  }

  /** `showsPrec p x` at a Show dictionary, as a JS string. */
  function showAt(d, p, x) {
    const info = instanceInfo(d)
    if (info.how === 'written') {
      if (info.methods.showsPrec) return jsString(runWritten(d, info, 'showsPrec', [now(p), x], []))
      if (info.methods.show) return jsString(runWritten(d, info, 'show', [x], []))
      throw new EvalError(`instance ${shown(d.key)} defines neither show nor showsPrec`)
    }
    if (info.how === 'newtype') return showAt(dictionary(info.inner, { ctx: d.sub, self: d }), p, delay(() => force(force(x).args[0])))
    if (info.how === 'stock') {
      const v = force(x)
      const c = info.ctors[v.ctorIndex]
      if (!c.ev.length) return c.name
      if (c.record) return paren(p >= 11, `${c.name} {${c.fieldNames.map((f, i) => `${f} = ${showAt(field(d, info, v.ctorIndex, i), 0, v.args[i])}`).join(', ')}}`)
      return paren(p >= 11, `${c.name} ${v.args.map((a, i) => showAt(field(d, info, v.ctorIndex, i), 11, a)).join(' ')}`)
    }
    const head = headOf(d.key)
    const v = force(x)
    if (head === 'Double' || head === 'Float') return paren(p > 6 && (v < 0 || Object.is(v, -0)), showDouble(v))
    if (head === 'Rational') {
      const [n, m] = asFraction(v)
      return paren(p > 7, `${paren(n < 0, String(n))} % ${m}`)
    }
    if (NUMERIC.has(head)) return paren(p > 6 && v < 0, String(v))
    if (head === 'Bool') return v ? 'True' : 'False'
    if (head === 'Char') return showChar(v)
    if (head === 'StdGen') return paren(p >= 11, `StdGen ${v.args[0]}`)
    if (head === '(,)') return `(${showAt(d.sub[0], 0, v.args[0])},${showAt(d.sub[1], 0, v.args[1])})`
    if (head === 'List') {
      const items = []
      for (let l = list(now(v)); l.ctorIndex === 1; l = list(l.args[1])) items.push(l.args[0])
      // Show Char's showList: a String reads as text (GHC's showList trick).
      if (d.sub[0].key === 'Show@Char') return showString(items.map(force).join(''))
      return `[${items.map((t) => showAt(d.sub[0], 0, t)).join(',')}]`
    }
    throw new EvalError(`No show for ${shown(d.key)}`)
  }

  // Structural instances (stock deriving, and the builtin types' Eq/Ord/Show).
  const STOCK = {
    eq: ([x, y], d, info) => {
      const a = force(x)
      const b = force(y)
      return a.ctorIndex === b.ctorIndex && a.args.every((f, i) => eqAt(field(d, info, a.ctorIndex, i), f, b.args[i]))
    },
    compare: ([x, y], d, info) => {
      const a = force(x)
      const b = force(y)
      if (a.ctorIndex !== b.ctorIndex) return ordering(a.ctorIndex < b.ctorIndex ? -1 : 1)
      for (let i = 0; i < a.args.length; i++) {
        const c = cmpAt(field(d, info, a.ctorIndex, i), a.args[i], b.args[i])
        if (c) return ordering(c)
      }
      return ordering(0)
    },
    showsPrec: ([p, x], d) => fromJsString(showAt(d, num(p), x)),
  }

  // A product's structure field by field: a record that derives AddGroup
  // adds field by field (the product of the fields' structures).
  const fieldwise = (op) => ([x, y], d, info) => {
    const a = force(x)
    const b = force(y)
    return { ...a, args: a.args.map((f, i) => delay(() => invoke(field(d, info, 0, i), op, [f, b.args[i]]))) }
  }
  const identity = (op) => (_, d, info) => ({ kind: 'data', type: info.type, ctor: info.ctors[0].name, ctorIndex: 0, args: info.ctors[0].ev.map((__, i) => delay(() => invoke(field(d, info, 0, i), op, []))) })
  const POINTWISE = {
    plus: fieldwise('plus'), times: fieldwise('times'), mappend: fieldwise('mappend'), join: fieldwise('join'), meet: fieldwise('meet'),
    addZero: identity('addZero'), mulOne: identity('mulOne'), mempty: identity('mempty'),
    negate: ([x], d, info) => { const a = force(x); return { ...a, args: a.args.map((f, i) => delay(() => invoke(field(d, info, 0, i), 'negate', [f]))) } },
    scale: ([k, x], d, info) => { const a = force(x); return { ...a, args: a.args.map((f, i) => delay(() => invoke(field(d, info, 0, i), 'scale', [k, f]))) } },
    leq: ([x, y], d, info) => { const a = force(x); const b = force(y); return a.args.every((f, i) => bool(invoke(field(d, info, 0, i), 'leq', [f, b.args[i]]))) },
  }

  // The classes' default methods (classMethods.js gives the minimal sets).
  const lacks = (d, what) => { throw new EvalError(`instance ${shown(d.key)} defines none of ${what}`) }
  const DEFAULTS = {
    eq: ([x, y], d) => (defines(d, 'neq') ? !bool(invoke(d, 'neq', [x, y])) : lacks(d, '(==), (/=)')),
    neq: ([x, y], d) => !eqAt(d, x, y),
    compare: ([x, y], d) => {
      if (!defines(d, 'le') && !defines(d, 'geq')) lacks(d, 'compare, (<=)')
      return ordering(eqAt(toClass(d, 'Eq'), x, y) ? 0 : leAt(d, x, y) ? -1 : 1)
    },
    le: ([x, y], d) => (defines(d, 'geq') ? bool(invoke(d, 'geq', [y, x])) : defines(d, 'compare') ? cmpAt(d, x, y) <= 0 : lacks(d, 'compare, (<=)')),
    geq: ([x, y], d) => (defines(d, 'le') ? leAt(d, y, x) : cmpAt(d, x, y) >= 0),
    lt: ([x, y], d) => cmpAt(d, x, y) < 0,
    gt: ([x, y], d) => cmpAt(d, x, y) > 0,
    max: ([x, y], d) => (leAt(d, x, y) ? force(y) : force(x)),
    min: ([x, y], d) => (leAt(d, x, y) ? force(x) : force(y)),
    show: ([x], d) => fromJsString(showAt(d, 0, x)),
    showsPrec: ([p, x], d) => fromJsString(showAt(d, num(p), x)),
  }

  // ---- Primitive instances --------------------------------------------------
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const NUM = {
    plus: ([x, y]) => num(x) + num(y), times: ([x, y]) => num(x) * num(y), negate: ([x]) => -num(x) + 0,
    addZero: () => 0, mulOne: () => 1, divide: ([x, y]) => num(x) / num(y), sqrt: ([x]) => Math.sqrt(num(x)),
    toRational: ([x]) => num(x), toInteger: ([x]) => num(x),
    div: ([x, y]) => Math.floor(num(x) / nonZero(num(y))) + 0,
    mod: ([x, y]) => { const a = num(x); const b = nonZero(num(y)); return a - b * Math.floor(a / b) + 0 },
    properFraction: ([x], _d, _i, [b]) => { const v = num(x); const n = Math.trunc(v) + 0; return pair(now(fromIntegerVia(b, n)), now(v - n)) },
    eq: ([x, y]) => force(x) === force(y), compare: ([x, y]) => ordering(cmp(force(x), force(y))),
    leq: ([x, y]) => num(x) <= num(y), join: ([x, y]) => Math.max(num(x), num(y)), meet: ([x, y]) => Math.min(num(x), num(y)),
    scale: ([k, v]) => num(k) * num(v),
    showsPrec: STOCK.showsPrec,
  }
  const BOOL = {
    eq: NUM.eq, compare: ([x, y]) => ordering(cmp(+bool(x), +bool(y))), showsPrec: STOCK.showsPrec,
    leq: ([x, y]) => !bool(x) || bool(y), join: ([x, y]) => bool(x) || bool(y), meet: ([x, y]) => bool(x) && bool(y),
  }
  const lazyMaybe = (t) => { const v = force(t); if (!isData(v) || v.type !== 'Maybe') throw new EvalError(`Expected a Maybe, got ${show(v)}`); return v }
  const foldList = (t, nilCase, consCase) => { const go = (u) => { const l = list(u); return l.ctorIndex === 0 ? nilCase() : consCase(l.args[0], delay(() => go(l.args[1]))) }; return go(t) }
  // Data.Monoid's wrappers: combine what they wrap, and wrap it again.
  const wrapped = (type, v) => ({ kind: 'data', type, ctor: type, ctorIndex: 0, args: [v] })
  const inside = (t) => delay(() => force(force(t).args[0]))
  const PRIM = {
    Sum: { mappend: ([x, y], d) => wrapped('Sum', delay(() => invoke(d.sub[0], 'plus', [inside(x), inside(y)]))), mempty: (_, d) => wrapped('Sum', delay(() => invoke(d.sub[0], 'addZero', []))) },
    Product: { mappend: ([x, y], d) => wrapped('Product', delay(() => invoke(d.sub[0], 'times', [inside(x), inside(y)]))), mempty: (_, d) => wrapped('Product', delay(() => invoke(d.sub[0], 'mulOne', []))) },
    Min: { mappend: ([x, y], d) => (leAt(d.sub[0], inside(x), inside(y)) ? force(x) : force(y)) },
    Max: { mappend: ([x, y], d) => (leAt(d.sub[0], inside(x), inside(y)) ? force(y) : force(x)) },
    First: { mappend: ([x]) => force(x) },
    Last: { mappend: ([, y]) => force(y) },
    Any: { mappend: ([x, y]) => wrapped('Any', delay(() => bool(inside(x)) || bool(inside(y)))), mempty: () => wrapped('Any', now(false)) },
    All: { mappend: ([x, y]) => wrapped('All', delay(() => bool(inside(x)) && bool(inside(y)))), mempty: () => wrapped('All', now(true)) },
    Endo: { mappend: ([x, y]) => wrapped('Endo', now(fn('compose', inside(x), inside(y)))), mempty: () => wrapped('Endo', now(fn('identity'))) },
    State: {
      fmap: ([g, m]) => wrapped('State', now(fn('stMap', g, m))),
      pure: ([x]) => wrapped('State', now(fn('stPure', x))),
      ap: ([mf, mx]) => wrapped('State', now(fn('stAp', mf, mx))),
      bind: ([m, k]) => wrapped('State', now(fn('stBind', m, k))),
    },
    Char: { eq: NUM.eq, compare: NUM.compare, showsPrec: STOCK.showsPrec },
    StdGen: { showsPrec: STOCK.showsPrec },
    List: {
      showsPrec: STOCK.showsPrec,
      mappend: ([x, y]) => appendList(x, y), mempty: () => nil, // the free monoid
      fmap: ([f, t]) => mapList(f, t),
      foldMap: ([f, t], _d, _i, [m]) => foldList(t, () => memptyAt(m), (x, rest) => mappendAt(m, delay(() => applyValue(f, [x])), rest)),
      traverse: ([f, t], _d, _i, [g]) => foldList(t, () => invoke(g, 'pure', [now(nil)]), (x, rest) => invoke(g, 'ap', [delay(() => fmapAt(g, now(fn('cons')), delay(() => applyValue(f, [x])))), rest])),
      pure: ([x]) => cons(x, now(nil)),
      ap: ([fs, xs]) => foldList(fs, () => nil, (f, rest) => appendList(delay(() => mapList(f, xs)), rest)),
      bind: ([xs, k]) => foldList(xs, () => nil, (x, rest) => appendList(delay(() => applyValue(k, [x])), rest)),
    },
    Maybe: {
      mappend: ([x, y], d) => { const a = lazyMaybe(x); if (a.ctorIndex === 0) return force(y); const b = lazyMaybe(y); return b.ctorIndex === 0 ? a : just(delay(() => mappendAt(d.sub[0], a.args[0], b.args[0]))) },
      mempty: () => nothing,
      fmap: ([f, t]) => { const v = lazyMaybe(t); return v.ctorIndex === 0 ? nothing : just(delay(() => applyValue(f, [v.args[0]]))) },
      foldMap: ([f, t], _d, _i, [m]) => { const v = lazyMaybe(t); return v.ctorIndex === 0 ? memptyAt(m) : applyValue(f, [v.args[0]]) },
      traverse: ([f, t], _d, _i, [g]) => { const v = lazyMaybe(t); return v.ctorIndex === 0 ? invoke(g, 'pure', [now(nothing)]) : fmapAt(g, now(fn('just')), delay(() => applyValue(f, [v.args[0]]))) },
      pure: ([x]) => just(x),
      ap: ([mf, mx]) => { const f = lazyMaybe(mf); if (f.ctorIndex === 0) return nothing; const x = lazyMaybe(mx); return x.ctorIndex === 0 ? nothing : just(delay(() => applyValue(f.args[0], [x.args[0]]))) },
      bind: ([mx, k]) => { const x = lazyMaybe(mx); return x.ctorIndex === 0 ? nothing : applyValue(k, [x.args[0]]) },
    },
    Either: {
      mappend: ([x, y]) => (force(x).ctorIndex === 0 ? force(y) : force(x)), // the first Right
      fmap: ([f, t]) => { const v = force(t); return v.ctorIndex === 0 ? v : right(delay(() => applyValue(f, [v.args[0]]))) },
      foldMap: ([f, t], _d, _i, [m]) => { const v = force(t); return v.ctorIndex === 0 ? memptyAt(m) : applyValue(f, [v.args[0]]) },
      traverse: ([f, t], _d, _i, [g]) => { const v = force(t); return v.ctorIndex === 0 ? invoke(g, 'pure', [now(v)]) : fmapAt(g, now(fn('right')), delay(() => applyValue(f, [v.args[0]]))) },
      pure: ([x]) => right(x),
      ap: ([ef, ex]) => { const f = force(ef); if (f.ctorIndex === 0) return f; const x = force(ex); return x.ctorIndex === 0 ? x : right(delay(() => applyValue(f.args[0], [x.args[0]]))) },
      bind: ([ex, k]) => { const x = force(ex); return x.ctorIndex === 0 ? x : applyValue(k, [x.args[0]]) },
    },
    '(,)': {
      showsPrec: STOCK.showsPrec,
      mappend: ([x, y], d) => { const a = force(x); const b = force(y); return pair(delay(() => mappendAt(d.sub[0], a.args[0], b.args[0])), delay(() => mappendAt(d.sub[1], a.args[1], b.args[1]))) },
      mempty: (_, d) => pair(delay(() => memptyAt(d.sub[0])), delay(() => memptyAt(d.sub[1]))),
      // The writer: (w, x), its log w combined by w's monoid.
      fmap: ([f, t]) => { const v = force(t); return pair(v.args[0], delay(() => applyValue(f, [v.args[1]]))) },
      foldMap: ([f, t]) => applyValue(f, [force(t).args[1]]),
      traverse: ([f, t], _d, _i, [g]) => { const v = force(t); return fmapAt(g, now(fn('pair', v.args[0])), delay(() => applyValue(f, [v.args[1]]))) },
      pure: ([x], d) => pair(delay(() => memptyAt(d.sub[0])), x),
      ap: ([pf, px], d) => { const f = force(pf); const x = force(px); return pair(delay(() => mappendAt(d.sub[0], f.args[0], x.args[0])), delay(() => applyValue(f.args[1], [x.args[1]]))) },
      bind: ([px, k], d) => { const x = force(px); const y = delay(() => force(applyValue(k, [x.args[1]]))); return pair(delay(() => mappendAt(d.sub[0], x.args[0], delay(() => force(y).args[0]))), delay(() => force(force(y).args[1]))) },
    },
    '()': { mappend: () => unit, mempty: () => unit },
    Ordering: { mappend: ([x, y]) => (force(x).ctorIndex === 1 ? force(y) : force(x)), mempty: () => ordering(0) },
    Picture: { mappend: ([x, y]) => picture('Pictures', 6, [x, y]), mempty: () => picture('Blank', 0, []) }, // gloss: drawn one over the other
    // Subscriptions: listening to both; fmap relabels messages with a hidden Map.
    Sub: { mappend: ([x, y]) => sub('Batch', 3, [x, y]), mempty: () => sub('None', 0, []), fmap: ([f, t]) => sub('Map', 4, [f, t]) },
  }
  /** The primitive implementing method `m` of builtin instance `key`, or undefined. */
  function prim(key, m) {
    const head = headOf(key)
    if (NUMERIC.has(head)) return NUM[m]
    if (head === 'Bool') return BOOL[m]
    return PRIM[head]?.[m]
  }

  function arityOf(callee) {
    const def = definition(callee)
    if (def.method) return def.params.length
    if (def.derived) return def.derived.arity
    if (def.builtin) {
      const impl = builtins[def.builtin]
      if (!impl) throw new EvalError(`${def.label}: no runtime implementation`)
      return impl[0]
    }
    const body = registry.functionBodies[callee]
    return body ? Object.values(body).filter((n) => n.type === 'parameter').length : 0
  }

  function call(callee, args, dicts = []) {
    if (++steps > MAX_STEPS) throw new EvalError('Evaluation took too many steps (infinite recursion?)')
    const def = definition(callee)
    if (def.method) {
      if (!dicts?.length) throw new EvalError(`${def.method.name}: a method of class ${def.method.cls} needs to know its type — run it from a graph (the type pass picks the instance)`)
      return invoke(dicts[0], def.method.name, args, dicts.slice(1))
    }
    if (def.derived) return runDerived(def.derived, args)
    if (def.builtin) {
      const through = customizedVia(def.builtin)
      if (through) return call(through.id, through.args ? through.args(args) : args)
      return def.builtin === 'listOf' ? builtins.listOf[1](...args) : builtins[def.builtin][1](...args, dicts)
    }
    const body = registry.functionBodies[callee]
    const output = body?.output
    if (!output?.source || !body[output.source]) throw new EvalError(`${def.label}: Output is not connected`)
    return force(nodeValue(body, output.source, { args, memo: new Map(), dicts, elab: elab?.forFunction(callee) || {} }))
  }

  /** The morphisms derived from a type declaration (see typeDecls.js). */
  function runDerived(d, args) {
    const record = (t) => {
      const v = force(t)
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
        const fields = v.args.map((f, i) => (d.recursive[v.ctorIndex][i] ? delay(() => fold(f)) : f))
        return d.arities[v.ctorIndex] ? applyValue(branches[v.ctorIndex], fields) : force(branches[v.ctorIndex])
      }
      return fold(args[args.length - 1])
    }
    throw new EvalError(`Unknown derived operation: ${d.op}`)
  }

  /** Apply a function value to argument thunks, filling its open slots left to right. */
  function applyValue(f, argThunks) {
    let v = f
    for (const arg of argThunks) {
      v = force(v)
      if (!isClosure(v)) throw new EvalError(`Cannot apply ${show(v)} — it is not a function`)
      const args = v.args.slice()
      args[args.indexOf(null)] = arg
      v = args.includes(null) ? closure(v.callee, args, v.dicts) : call(v.callee, args, v.dicts)
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

  // The dictionaries the type pass gave the call (or literal) `key` of this frame.
  const dictsOf = (env, key) => (env.elab?.[key] || []).map((e) => dictionary(e, { dicts: env.dicts }))

  function computeNode(graph, id, env) {
    const node = graph[id]
    if (!node) throw new EvalError(`Missing node: ${id}`)
    if (node.type === 'number') {
      const text = String(node.value ?? '').trim()
      const value = Number(text)
      if (text === '' || (Number.isNaN(value) && text !== 'NaN')) throw new EvalError(`${node.label}: "${node.value}" is not a number`)
      return literalAt(value, text, dictsOf(env, id)[0])
    }
    if (node.type === 'boolean') return node.value === 'true'
    if (node.type === 'text') return fromJsString(String(node.value ?? ''))
    if (node.type === 'literal') {
      const lit = parseLiteral(node.value)
      if (!lit) throw new EvalError(`${JSON.stringify(String(node.value ?? ''))} is not a literal (a number, True/False, "text" or 'c')`)
      return lit.kind === 'string' ? fromJsString(lit.value) : literalAt(lit.value, lit.text, dictsOf(env, id)[0])
    }
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
    // A stored Play result: its stand-in dictionaries get the ones this use's types pick.
    if (node.type === 'value') return fillDicts(reviveValue(node.data), dictsOf(env, id))
    if (node.type === 'curried') {
      if (!isClosure(node.closure)) throw new EvalError(`${node.label}: no stored partial application — Play the function again`)
      return fillDicts(reviveValue(node.closure), dictsOf(env, id))
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
        if (lit) arg = delay(() => (lit.kind === 'string' ? fromJsString(lit.value) : literalAt(lit.value, lit.text, dictsOf(env, `${node.id}:${i}`)[0])))
      }
      if (!arg) return
      if (i >= arity) throw new EvalError(`${node.label}: slot ${i + 1} has no matching parameter`)
      args[i] = arg
    })
    const dicts = dictsOf(env, node.id)
    if (!args.includes(null)) return call(callee, args, dicts)
    return closure(callee, args, dicts)
  }

  /** The dictionaries `evidence` (a list, closed: no parameters) describes. */
  const dictsFrom = (evidence) => evidence.map((e) => dictionary(e, {}))

  return {
    /** Evaluate node `nodeId` of `graph` to JSON-safe data: a number, a boolean, a data value, or a closure. */
    run(graph, nodeId) {
      return guarded(() => serializeValue(nodeValue(graph, nodeId, { args: null, memo: new Map(), elab: elab?.forGraph(graph) || {} })), graph)
    },
    /** Apply builtin `name` to values, with the dictionaries `evidence` describes (closed evidence: see classEnv.js) — used by the law checker. */
    invoke(name, values, evidence = []) {
      if (!builtins[name]) throw new EvalError(`Unknown builtin: ${name}`)
      return guarded(() => serializeValue(builtins[name][1](...values.map((v) => now(reviveValue(v))), dictsFrom(evidence))))
    },
    /** The literal `n` at the type `evidence` (for its Semiring, Ring or Field) names. */
    literal(n, evidence) {
      return guarded(() => serializeValue(literalAt(n, String(n), dictsFrom([evidence])[0])))
    },
    /** `show` a value through the Show instance `evidence` names. */
    showAt(value, evidence) {
      return guarded(() => showAt(dictsFrom([evidence])[0], 0, now(reviveValue(value))))
    },
    /** Apply any function value (e.g. a closure over a custom function) to values. */
    apply(f, values) {
      return guarded(() => serializeValue(applyValue(now(reviveValue(f)), values.map((v) => now(reviveValue(v))))))
    },
  }

  function guarded(run, graph = null) {
    steps = 0
    elab = registry.elaboration?.(graph) || null
    try {
      return run()
    } catch (e) {
      if (e instanceof RangeError) throw new EvalError('Recursion too deep')
      throw e
    }
  }
}
