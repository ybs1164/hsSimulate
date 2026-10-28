// Only record nodes actually demanded in the visible run's initial frame.
// Calls inside functions/map/recursion are deliberately not expanded here.
export function createExecutionTrace(graph) {
  const events = []
  let frame = null
  return {
    events,
    record(event) {
      if (event.graph !== graph) return
      frame ??= event.frame
      if (event.frame !== frame) return
      const { phase, nodeId, message, origin } = event
      events.push({ phase, nodeId, message, origin })
    },
    fail(nodeId, error) {
      // Serialization/elaboration can fail outside a node's compute callback.
      if (!events.some((e) => e.phase === 'error')) {
        events.push({ phase: 'error', nodeId, message: error.message, origin: false })
      }
    },
  }
}

// Playback receives data only. It has no evaluator, graph mutators or storage.
export function createExecutionPlayback({ onChange, interval = 180, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const states = new Map()
  let generation = 0, timer = null, info = null, playing = false

  function cancel(notify = true) {
    const hadState = info !== null
    generation++
    if (timer !== null) clearTimer(timer)
    timer = null
    info = null
    playing = false
    states.clear()
    if (notify && hadState) onChange()
  }

  return {
    states,
    get info() { return info },
    get playing() { return playing },
    cancel,
    play(events, details) {
      cancel(false)
      info = { ...details, last: null }
      const queue = events.map((event) => ({ ...event }))
      const token = generation
      let index = 0
      function advance() {
        if (token !== generation) return
        timer = null
        const event = queue[index++]
        if (event) {
          states.set(event.nodeId, { ...event, state: event.phase === 'start' ? 'running' : event.phase })
          info.last = event
        }
        playing = index < queue.length
        onChange()
        // A callback can cancel the run too. Never schedule an obsolete step.
        if (token === generation && playing) timer = setTimer(advance, interval)
      }
      advance()
    },
  }
}
