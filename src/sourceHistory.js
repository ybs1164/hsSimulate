// Pure playback state. Every step can be applied and undone without an evaluator.
export function createSourceHistory(onChange, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const calls = new Map(), nodes = new Map(), values = new Map(), undo = []
  let steps = [], position = 0, timer = null

  function apply(event) {
    const changes = []
    function write(map, key, value) {
      changes.push([map, key, map.has(key), map.get(key)])
      map.set(key, value)
    }
    for (const [id, value] of event.values) write(values, id, value)
    if (event.kind === 'enter') write(calls, event.callId, { ...event, status: 'running' })
    const call = calls.get(event.callId)
    if (call && event.kind === 'return') write(calls, event.callId, { ...call, status: 'done', value: event.value })
    if (call && event.kind === 'call-error') write(calls, event.callId, { ...call, status: 'error', message: event.message })
    if (call && event.kind === 'equation') write(calls, event.callId, { ...call, equationId: event.equationId })
    if (event.kind === 'node') write(nodes, `${event.callId}:${event.nodeId}`, event)
    undo.push(changes)
  }
  function seek(target) {
    while (position < target) apply(steps[position++])
    while (position > target) {
      for (const [map, key, had, value] of undo.pop().reverse()) {
        if (had) map.set(key, value)
        else map.delete(key)
      }
      position--
    }
    onChange()
  }
  function pause() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  return {
    calls, nodes, values,
    get position() { return position },
    get length() { return steps.length },
    get event() { return steps[position - 1] },
    get playing() { return timer !== null },
    load(events) {
      pause()
      calls.clear(); nodes.clear(); values.clear(); undo.length = 0
      steps = events
      position = 0
    },
    seek(index) { pause(); seek(Math.max(0, Math.min(steps.length, index))) },
    pause(notify = true) { pause(); if (notify) onChange() },
    play() {
      if (timer !== null || position >= steps.length) return
      const stride = Math.max(1, Math.ceil(steps.length / 65))
      function advance() {
        const next = Math.min(steps.length, position + stride)
        timer = next < steps.length ? setTimer(advance, 35) : null
        seek(next)
      }
      timer = setTimer(advance, 35)
      onChange()
    },
  }
}

export function describeTraceValue(reference, values, name = id => id) {
  let remaining = 300
  function resolve(value) {
    for (let hops = 0; value?.ref; hops++) {
      if (hops === 110) return { omitted: true }
      value = values.get(value.ref)
    }
    return value
  }
  function format(value, depth) {
    if (remaining-- <= 0 || depth >= 8) return '…'
    value = resolve(value)
    if (value === undefined) return '미평가'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'True' : 'False'
    if (value.failed) return '오류'
    if (value.omitted) return '…'
    if (value.open) return '빈 슬롯'
    if (value.callee) {
      const captures = value.captures.flatMap((argument, index) =>
        argument.open ? [] : [`#${index + 1} ${format(argument, depth + 1)}`])
      return `함수 값 ${name(value.callee)}${captures.length ? ` (캡처 ${captures.join(', ')})` : ''}`
    }
    if (value.nil) return '[]'
    const items = []
    while (value?.cell && items.length < 100 && remaining > 0) {
      items.push(format(value.cell[0], depth + 1))
      value = resolve(value.cell[1])
    }
    if (!value?.nil) items.push(value === undefined ? '꼬리 미평가' : value.failed ? '꼬리 오류' : '…')
    return `[${items.join(', ')}]`
  }
  return format(reference, 0)
}
