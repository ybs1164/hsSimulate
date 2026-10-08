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
  let model = initial
  let log = []
  let time = 0

  return {
    get model() { return model },
    get log() { return log },
    get time() { return time },
    exactTime,
    view() {
      return toWidgetTree(ev.apply(view, [model]))
    },
    dispatch(msg) {
      model = ev.apply(handle, [msg, model])
      log = [...log, msg]
    },
    tick(dt) {
      model = ev.apply(step, [dt, model])
      time += dt
    },
    /**
     * Let `seconds` pass at once (time away from the game). One call when
     * `step` is an action of (ℝ≥0, +); otherwise fixed slices of `slice`
     * seconds, at most MAX_OFFLINE_SLICES of them.
     */
    advance(seconds, slice = 0.1) {
      if (seconds <= 0) return { calls: 0, exact: true, simulated: 0 }
      if (exactTime) {
        this.tick(seconds)
        return { calls: 1, exact: true, simulated: seconds }
      }
      const slices = Math.min(MAX_OFFLINE_SLICES, Math.ceil(seconds / slice))
      const each = seconds / slices
      for (let i = 0; i < slices; i++) this.tick(each)
      return { calls: slices, exact: false, simulated: seconds }
    },
    reset() {
      model = initial
      log = []
      time = 0
    },
    snapshot() {
      return { model, log, time }
    },
    restore(saved) {
      model = saved.model
      log = saved.log || []
      time = saved.time || 0
    },
  }
}
