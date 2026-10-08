// Project persistence and undo history — pure data in, data out. main.js
// owns the live `nodes`/`functionBodies` objects and decides when to call in.
//
// A snapshot is the JSON text of `{ version, nodes, functionBodies, entry,
// outputId }`. Comparing snapshots as strings is what lets the history skip
// no-op checkpoints (pan/zoom live in main.js's view state, not here).

export const STORAGE_KEY = 'hs-simulate:project'
const VERSION = 1

export class ProjectError extends Error {}

export function serializeProject({ nodes, functionBodies, entry = null, outputId = 0 }) {
  return JSON.stringify({ version: VERSION, nodes, functionBodies, entry, outputId })
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Parse and shape-check a snapshot (from localStorage or an imported file). Throws ProjectError. */
export function parseProject(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new ProjectError('Not a valid JSON file')
  }
  if (!isRecord(data) || data.version !== VERSION) throw new ProjectError('Not an hs/simulate project (or an unsupported version)')
  if (!isRecord(data.nodes) || !isRecord(data.functionBodies)) throw new ProjectError('Project is missing its nodes or function bodies')
  for (const [id, node] of Object.entries(data.nodes)) {
    if (!isRecord(node) || node.id !== id || typeof node.type !== 'string') throw new ProjectError(`Malformed node: ${id}`)
  }
  for (const [id, body] of Object.entries(data.functionBodies)) {
    if (!isRecord(body)) throw new ProjectError(`Malformed function body: ${id}`)
  }
  return {
    nodes: data.nodes,
    functionBodies: data.functionBodies,
    entry: typeof data.entry === 'string' && data.nodes[data.entry] ? data.entry : null,
    outputId: Number.isInteger(data.outputId) ? data.outputId : 0,
  }
}

// Fields of a builtin definition owned by the code, never by a saved file —
// so a save from an older version picks up renamed labels or new
// expressions, and a file can't turn a builtin into something else.
const BUILTIN_FIELDS = ['type', 'label', 'builtin', 'readonly', 'expression', 'color']

/**
 * Reconcile a loaded project with the builtins this version of the code
 * defines: builtin definitions keep their saved position and slot contents
 * but take every code-owned field from `builtinNodes`; builtins missing from
 * the save are added; saved builtins the code no longer has are dropped (and
 * anything mounted into them freed). Builtin bodies always come from code.
 */
export function mergeBuiltins(project, builtinNodes, builtinBodies) {
  const nodes = {}
  for (const [id, node] of Object.entries(project.nodes)) {
    if (node.builtin && !builtinNodes[id]) continue
    nodes[id] = builtinNodes[id] ? { ...node, ...pick(builtinNodes[id], BUILTIN_FIELDS) } : node
  }
  for (const [id, node] of Object.entries(builtinNodes)) if (!nodes[id]) nodes[id] = structuredClone(node)
  for (const node of Object.values(nodes)) {
    const host = node.mountedTo?.split(':')[0]
    if (host && !Object.values(nodes).some((n) => n.id === host)) {
      node.mountedTo = null
      node.connected = false
    }
  }
  const functionBodies = { ...project.functionBodies, ...structuredClone(builtinBodies) }
  return { ...project, nodes, functionBodies, entry: project.entry && nodes[project.entry] ? project.entry : null }
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]))
}

/** Linear undo/redo over snapshot strings. */
export function createHistory(limit = 100) {
  let past = []
  let present = null
  let future = []
  return {
    reset(snapshot) {
      past = []
      future = []
      present = snapshot
    },
    /** Record `snapshot` as the new present. Returns false (and does nothing) if it equals the present. */
    record(snapshot) {
      if (snapshot === present) return false
      if (present !== null) past.push(present)
      if (past.length > limit) past.shift()
      present = snapshot
      future = []
      return true
    },
    undo() {
      if (!past.length) return null
      future.push(present)
      present = past.pop()
      return present
    },
    redo() {
      if (!future.length) return null
      past.push(present)
      present = future.pop()
      return present
    },
    get canUndo() {
      return past.length > 0
    },
    get canRedo() {
      return future.length > 0
    },
  }
}
