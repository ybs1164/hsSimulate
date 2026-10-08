// The game runtime: runs a `Program m e` value (see builtinSchemes.js'
// `program`), the way gloss's `play` runs a world:
//
//   model  ← initial
//   on a message e:      model ← handle e model     (and e is logged)
//   on a tick of dt:     model ← step dt model
//   on screen:           view model                 (a widget tree)
//
// Everything stays pure: every update is one evaluator call producing a new
// model value. This module knows nothing about the DOM — main.js renders
// the plain widget trees it returns.
//
// Time is a monoid (ℝ≥0, +) acting on the model through `step`. When that
// is a genuine action — step (a + b) = step a ∘ step b, checked by
// laws.js — time away (offline progress) is applied in a single call;
// otherwise it is simulated in fixed slices.
import { EvalError } from './evaluator.js'

export const MAX_OFFLINE_SLICES = 20000
export const MAX_HISTORY = 500

/** A Haskell String (a list of Chars) as a JS string. */
export function toJsString(v) {
  let out = ''
  for (let l = v; l?.ctorIndex === 1; l = l.args[1]) out += l.args[0]
  return out
}

function toArray(v) {
  const out = []
  for (let l = v; l?.ctorIndex === 1; l = l.args[1]) out.push(l.args[0])
  return out
}

/**
 * A plain widget tree from a (forced) `Widget e` value:
 * { kind: 'text', text } | { kind: 'button', label, msg } |
 * { kind: 'column' | 'row', children } | { kind: 'progress', value }.
 */
export function toWidgetTree(w) {
  if (w?.type !== 'Widget') throw new EvalError('The view must return a Widget')
  if (w.ctor === 'Text') return { kind: 'text', text: toJsString(w.args[0]) }
  if (w.ctor === 'Button') return { kind: 'button', label: toJsString(w.args[0]), msg: w.args[1] }
  if (w.ctor === 'Column' || w.ctor === 'Row') return { kind: w.ctor.toLowerCase(), children: toArray(w.args[0]).map(toWidgetTree) }
  if (w.ctor === 'Progress') return { kind: 'progress', value: Math.min(1, Math.max(0, Number(w.args[0]) || 0)) }
  throw new EvalError(`Unknown widget: ${w.ctor}`)
}

/**
 * A forced `Sub e` value as plain listeners: `{ every: [{ seconds, msg, key }],
 * keys: [handler] }`. `Map f s` relabels the messages of `s`; each handler
 * is `{ fn, maps }` — apply `fn` to the key, then the `maps` to its message.
 */
export function flattenSub(v, maps = [], out = { every: [], keys: [] }) {
  if (!v || v.kind === 'mempty' || v.ctor === 'None') return out
  if (v.type !== 'Sub') throw new EvalError('subscriptions must return a Sub')
  if (v.ctor === 'Every') out.every.push({ seconds: Number(v.args[0]), msg: v.args[1], maps, key: JSON.stringify([v.args[0], v.args[1], maps]) })
  else if (v.ctor === 'OnKey') out.keys.push({ fn: v.args[0], maps })
  else if (v.ctor === 'Batch') { flattenSub(v.args[0], maps, out); flattenSub(v.args[1], maps, out) }
  else if (v.ctor === 'Map') flattenSub(v.args[1], [v.args[0], ...maps], out)
  return out
}

export function isProgram(v) {
  return v?.kind === 'data' && v.type === 'Program'
}

/**
 * `ev` is an evaluator, `program` a forced Program value (from `ev.run`).
 * `exactTime`: whether `step` is a monoid action (so any span of time can be
 * applied in one call).
 */
export function createGame(ev, program, { exactTime = false } = {}) {
  if (!isProgram(program)) throw new EvalError('The entry point is not a Program')
  const [initial, view, handle, step] = program.args
  // Settings (older Programs without them get the defaults).
  const stepsPerSecond = Math.max(1, Math.min(240, Number(program.args[4]) || 10))
  const maxOffline = Math.max(0, Number(program.args[5] ?? 7 * 24 * 3600))
  const subscriptionsFn = program.args[6]
  const timers = new Map() // Every-subscription key -> seconds accumulated
  const relabel = (msg, maps) => maps.reduce((m, f) => ev.apply(f, [m]), msg)
  let model = initial
  let log = []
  let time = 0
  // The state right after each message (and at the start), for rewinding.
  let history = [{ model, time, logLength: 0 }]
  const remember = () => {
    history = [...history, { model, time, logLength: log.length }].slice(-MAX_HISTORY)
  }

  return {
    get model() { return model },
    get log() { return log },
    get time() { return time },
    exactTime,
    stepsPerSecond,
    maxOffline,
    /** What the game listens to right now (subscriptions are a function of the model). */
    subscriptions() {
      if (!subscriptionsFn || subscriptionsFn.kind === 'mempty') return { every: [], keys: [] }
      return flattenSub(ev.apply(subscriptionsFn, [model]))
    },
    /** A key was pressed: every onKey handler that answers Just msg sends msg. */
    keyPressed(key) {
      const chars = [...String(key)].reduceRight((tail, c) => ({ kind: 'data', type: 'List', ctor: ':', ctorIndex: 1, args: [c, tail] }), { kind: 'data', type: 'List', ctor: '[]', ctorIndex: 0, args: [] })
      let sent = 0
      for (const { fn, maps } of this.subscriptions().keys) {
        const answer = ev.apply(fn, [chars])
        if (answer?.type === 'Maybe' && answer.ctorIndex === 1) { this.dispatch(relabel(answer.args[0], maps)); sent++ }
      }
      return sent
    },
    view() {
      return toWidgetTree(ev.apply(view, [model]))
    },
    dispatch(msg) {
      model = ev.apply(handle, [msg, model])
      log = [...log, msg]
      remember()
    },
    /** Go back to the state right after the first `count` messages (if still remembered); later messages are dropped. */
    rewind(count) {
      const at = history.findLast((h) => h.logLength === count)
      if (!at) return false
      model = at.model
      time = at.time
      log = log.slice(0, count)
      history = history.filter((h) => h.logLength <= count)
      return true
    },
    /** Replace the model (e.g. edited by hand while debugging); remembered as the state at this point. */
    setModel(next) {
      model = next
      history = [...history.filter((h) => h.logLength !== log.length), { model, time, logLength: log.length }]
    },
    canRewind(count) {
      return history.some((h) => h.logLength === count)
    },
    tick(dt, { timers: runTimers = true } = {}) {
      model = ev.apply(step, [dt, model])
      time += dt
      if (!runTimers) return
      // `every s msg` sends msg each s seconds of game time.
      const live = new Set()
      for (const t of this.subscriptions().every) {
        if (!(t.seconds > 0)) continue
        live.add(t.key)
        let acc = (timers.get(t.key) || 0) + dt
        let fired = 0
        // (a hair of tolerance: ten 0.1s steps add up to 0.9999999999999999, not 1)
        while (acc >= t.seconds - 1e-9 && fired < 1000) { this.dispatch(relabel(t.msg, t.maps)); acc -= t.seconds; fired++ }
        timers.set(t.key, acc)
      }
      for (const key of timers.keys()) if (!live.has(key)) timers.delete(key)
    },
    /**
     * Let `seconds` pass at once (time away from the game). One call when
     * `step` is an action of (ℝ≥0, +); otherwise fixed slices of `slice`
     * seconds (one step's worth), at most MAX_OFFLINE_SLICES of them. Time
     * beyond the program's maxOffline doesn't count.
     */
    advance(seconds, slice = 1 / stepsPerSecond) {
      seconds = Math.min(seconds, maxOffline)
      if (seconds <= 0) return { calls: 0, exact: true, simulated: 0 }
      // Nothing listens while the game is closed (as in Elm): only `step` runs.
      if (exactTime) {
        this.tick(seconds, { timers: false })
        return { calls: 1, exact: true, simulated: seconds }
      }
      const slices = Math.min(MAX_OFFLINE_SLICES, Math.ceil(seconds / slice))
      const each = seconds / slices
      for (let i = 0; i < slices; i++) this.tick(each, { timers: false })
      return { calls: slices, exact: false, simulated: seconds }
    },
    reset() {
      model = initial
      log = []
      time = 0
      history = [{ model, time, logLength: 0 }]
      timers.clear()
    },
    snapshot() {
      return { model, log, time }
    },
    restore(saved) {
      model = saved.model
      log = saved.log || []
      time = saved.time || 0
      history = [{ model, time, logLength: log.length }]
    },
  }
}
