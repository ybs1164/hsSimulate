// Pattern matching is stored as an ordinary primitive case call with owned,
// lambda-lifted branch graphs. Inference, dictionaries, lazy evaluation and
// export all consume this same representation; the editor hides the lifting.
import { parseLiteral } from './literals.js'

export const matchCaseId = (name) => `prim:type:${name}:${name === '(,)' ? 'uncurry' : `case${name}`}`
const parameters = (body) => Object.values(body || {}).filter((n) => n.type === 'parameter')
const ident = (text) => /^[a-z_][\w']*$/.test(text)

export function ensureTypeKeys(decl) {
  for (const ctor of decl.constructors) {
    ctor.key ??= `ctor-${crypto.randomUUID()}`
    for (const field of ctor.fields) field.key ??= `field-${crypto.randomUUID()}`
  }
  return decl
}

/** Name every field of a constructor, avoiding generated/global function names. */
export function nameRecordFields(draft, index, labels = []) {
  const ctor = draft.constructors[index]
  const taken = new Set([...labels, ...draft.constructors.flatMap((c) => c.fields.map((f) => f.name)).filter(Boolean)])
  for (const field of ctor.fields) {
    if (field.name?.trim()) continue
    let i = 1
    while (taken.has(`field${i}`)) i++
    field.name = `field${i}`
    taken.add(field.name)
  }
}

function freshLabel(wanted, taken) {
  const stem = ident(wanted) ? wanted : 'value'
  let name = stem, i = 2
  while (taken.has(name)) name = `${stem}${i++}`
  taken.add(name)
  return name
}

function makeBody(fnId, names) {
  const body = {}
  names.forEach((label, i) => {
    const id = `${fnId}/p${i}`
    body[id] = { id, type: 'parameter', label, value: label, color: '#4f8ef7', x: 110, y: 130 + i * 130 }
  })
  body.output = { id: 'output', type: 'output', label: 'Output', value: 'open', color: '#2fbf8f', x: 590, y: 200 }
  return body
}

function defineBranch(project, graph, node, ctor, index, ownerId, captures) {
  const fnId = `${node.id}/branch-${crypto.randomUUID()}`
  const taken = new Set()
  const fields = ctor.fields.map((f, i) => ({ key: f.key, fieldName: f.name || `x${i + 1}`, name: freshLabel(f.name || `x${i + 1}`, taken) }))
  const captureNames = captures.map((id) => freshLabel(graph[id]?.label || 'outer', taken))
  const names = [...captureNames, ...fields.map((f) => f.name)]
  project.nodes[fnId] = { id: fnId, type: 'function', label: ctor.name, params: names, mounted: names.map(() => null), paramScopes: names.map(() => 'local'), custom: true, lambda: true, matchBranch: { ownerId, matchId: node.id }, scope: 'local', color: '#8b7cf2', x: -9999, y: -9999 }
  project.functionBodies[fnId] = makeBody(fnId, names)
  parameters(project.functionBodies[fnId]).slice(0, captures.length).forEach((p) => { p.matchCapture = true })
  const callId = `${fnId}/call`
  const mounted = captures.map((target, i) => {
    const id = `${callId}/capture${i}`
    graph[id] = { id, type: 'ref', target, label: graph[target]?.label, matchInternal: true, mountedTo: `${callId}:${i}` }
    return id
  }).concat(fields.map(() => null))
  graph[callId] = { id: callId, type: 'function', sourceFunctionId: fnId, label: ctor.name, params: names.map(() => ''), mounted, paramScopes: names.map(() => 'local'), matchInternal: true, mountedTo: `${node.id}:${index}`, color: '#8b7cf2', scope: 'local' }
  return { ctor: ctor.name, key: ctor.key, fields, fnId, callId, captures: [...captures] }
}

export function createMatch(project, graph, decl, targetId, { id = `match-${crypto.randomUUID()}`, ownerId = null, x = 450, y = 350 } = {}) {
  ensureTypeKeys(decl)
  const captures = parameters(graph).map((n) => n.id)
  const node = { id, type: 'function', label: '패턴 매칭', sourceFunctionId: matchCaseId(decl.name), params: decl.constructors.map(() => '').concat(''), mounted: [], paramScopes: decl.constructors.map(() => 'local').concat('local'), color: '#8b7cf2', scope: 'local', x, y, match: { type: decl.name, branches: [] } }
  graph[id] = node
  node.match.branches = decl.constructors.map((ctor, i) => defineBranch(project, graph, node, ctor, i, ownerId, captures))
  node.mounted = node.match.branches.map((b) => b.callId).concat(targetId || null)
  // A reference leaves the original input available elsewhere in the function.
  if (targetId) {
    const target = graph[targetId]
    if (target?.type === 'ref' && (!target.mountedTo || target.mountedTo === `${id}:${decl.constructors.length}`)) {
      target.mountedTo = `${id}:${decl.constructors.length}`
      target.connected = true
      return node
    }
    const refId = `${id}/input`
    graph[refId] = { id: refId, type: 'ref', target: targetId, label: graph[targetId]?.label, mountedTo: `${id}:${decl.constructors.length}`, connected: true, x: x - 180, y }
    node.mounted[node.mounted.length - 1] = refId
  }
  return node
}

export function branchPattern(branch) {
  return branch.useDefault ? '_' : [branch.ctor, ...branch.fields.map((f) => f.name)].join(' ')
}

export function renameMatchBinder(project, branch, fieldIndex, name) {
  const params = parameters(project.functionBodies[branch.fnId])
  const index = branch.captures.length + fieldIndex
  if (!(ident(name) || name === '_') || (name !== '_' && params.some((p, i) => i !== index && p.label === name))) return false
  const p = params[index]
  if (!p) return false
  branch.fields[fieldIndex].name = name
  p.label = p.value = name
  project.nodes[branch.fnId].params[index] = name
  return true
}

/** Capture a parent expression without allowing cross-branch graph references. */
export function captureMatchValue(project, graph, branch, targetId) {
  if (!graph[targetId] || branch.captures.includes(targetId)) return false
  const def = project.nodes[branch.fnId], body = project.functionBodies[branch.fnId], call = graph[branch.callId]
  const missing = branch.captures.findIndex((target, i) => !graph[target] || !graph[call.mounted[i]])
  if (missing >= 0) {
    const id = call.mounted[missing] || `${branch.fnId}/capture-${crypto.randomUUID()}`
    graph[id] = { id, type: 'ref', target: targetId, label: graph[targetId].label, matchInternal: true, mountedTo: `${call.id}:${missing}` }
    call.mounted[missing] = id
    branch.captures[missing] = targetId
    return true
  }
  const params = parameters(body), at = branch.captures.length
  const name = freshLabel(graph[targetId].label || 'outer', new Set(params.map((p) => p.label)))
  const id = `${branch.fnId}/capture-${crypto.randomUUID()}`
  const p = { id, type: 'parameter', label: name, value: name, matchCapture: true, x: 110, y: 130 + params.length * 130, color: '#4f8ef7' }
  params.splice(at, 0, p)
  const others = Object.entries(body).filter(([, n]) => n.type !== 'parameter')
  Object.keys(body).forEach((key) => delete body[key])
  Object.assign(body, Object.fromEntries(params.map((n) => [n.id, n])), Object.fromEntries(others))
  def.params.splice(at, 0, name); def.mounted.splice(at, 0, null); def.paramScopes.splice(at, 0, 'local')
  const refId = `${id}/ref`
  graph[refId] = { id: refId, type: 'ref', target: targetId, label: name, matchInternal: true }
  call.params.splice(at, 0, ''); call.mounted.splice(at, 0, refId); call.paramScopes.splice(at, 0, 'local')
  call.mounted.forEach((child, i) => { if (graph[child]) graph[child].mountedTo = `${call.id}:${i}` })
  branch.captures.push(targetId)
  return true
}

/** A default is itself a branch graph; constructor wrappers discard their fields. */
export function setMatchDefault(project, graph, node, branchIndex, enabled = true) {
  const branch = node.match.branches[branchIndex]
  if (!node.match.defaultBranch && enabled) {
    const captures = parameters(graph).map((n) => n.id)
    node.match.defaultBranch = defineBranch(project, graph, node, { name: '_', fields: [] }, -1, project.nodes[branch.fnId].matchBranch.ownerId, captures)
  }
  const body = project.functionBodies[branch.fnId]
  if (!enabled) {
    branch.useDefault = false
    body.output.source = branch.previousSource || null
    delete branch.previousSource
    return
  }
  const fallback = node.match.defaultBranch
  // Any captures added to the default must also be available in its wrappers.
  for (const target of fallback.captures) captureMatchValue(project, graph, branch, target)
  if (!branch.useDefault) branch.previousSource = body.output.source || null
  branch.useDefault = true
  const params = parameters(body)
  const id = `${branch.fnId}/default`
  body[id] = { id, type: 'function', sourceFunctionId: fallback.fnId, label: '_', params: fallback.captures.map(() => ''), mounted: fallback.captures.map((target) => params[branch.captures.indexOf(target)].id), paramScopes: fallback.captures.map(() => 'local'), x: 380, y: 200 }
  body.output.source = id
}

export function matchProblem(node, graph, definitions, bodies) {
  if (!node.match) return null
  const expected = definitions[node.sourceFunctionId]?.derived
  if (!expected || expected.op !== 'case' || expected.type !== node.match.type) return `${node.match.type}: 매칭할 타입이 없습니다`
  if (node.match.branches.length !== expected.arities.length) return '생성자 분기를 모두 작성하세요'
  for (let i = 0; i < node.match.branches.length; i++) {
    const branch = node.match.branches[i]
    if (!branch || !graph[branch.callId] || node.mounted?.[i] !== branch.callId) return '생성자 분기가 연결되지 않았습니다'
    if (branch.captures.some((target, ci) => !graph[target] || !graph[graph[branch.callId].mounted[ci]])) return `${branch.ctor}: 바깥 값을 다시 연결하세요`
    if (branch.fields.length !== expected.arities[i]) return `${branch.ctor}: 필드 패턴을 확인하세요`
    const names = branch.fields.map((f) => f.name).filter((name) => name !== '_')
    if (new Set(names).size !== names.length) return `${branch.ctor}: 패턴 변수 이름이 중복됩니다`
    const body = bodies[branch.fnId]
    if (!body?.[body.output?.source]) return `${branch.ctor}: 분기 결과를 연결하세요`
    if (!branch.useDefault && Object.values(body).some((n) => n.matchMissing)) return `${branch.ctor}: 삭제된 필드의 연결을 수정하세요`
    for (const field of branch.fields.filter((f) => !branch.useDefault && f.name === '_')) {
      const p = parameters(body)[branch.captures.length + branch.fields.indexOf(field)]
      if (p && Object.values(body).some((n) => n.target === p.id || n.source === p.id || n.mounted?.includes(p.id))) return `${branch.ctor}: _는 값으로 사용할 수 없습니다`
    }
    if (branch.useDefault) {
      const fallback = bodies[node.match.defaultBranch?.fnId]
      if (!fallback?.[fallback.output?.source]) return '기본 분기의 결과를 연결하세요'
    }
  }
  return null
}

/** Called before ordinary derived-call migration, using the editor's identity map. */
export function migrateMatch(project, graph, node, oldDecl, nextDecl, keys) {
  const oldBranches = node.match.branches
  const target = node.mounted[oldBranches.length]
  const ownerId = project.nodes[oldBranches[0]?.fnId]?.matchBranch?.ownerId
  const branches = nextDecl.constructors.map((ctor, ci) => {
    const oi = keys.ctors.indexOf(ci)
    const branch = oldBranches[oi]
    if (!branch) {
      const b = defineBranch(project, graph, node, ctor, ci, ownerId, parameters(graph).map((n) => n.id))
      return b
    }
    const def = project.nodes[branch.fnId], body = project.functionBodies[branch.fnId], call = graph[branch.callId]
    if (!def || !body || !call) return branch
    const params = parameters(body), count = branch.captures.length
    const oldFields = branch.fields
    const newParams = params.slice(0, count)
    const used = new Set(newParams.map((p) => p.label))
    branch.fields = ctor.fields.map((f, fi) => {
      const oldFi = (keys.fields[oi] || []).indexOf(fi)
      const previous = oldFields[oldFi]
      const fieldName = f.name || `x${fi + 1}`
      const name = freshLabel(previous && previous.name !== previous.fieldName ? previous.name : fieldName, used)
      const p = params[count + oldFi] && oldFi >= 0 ? params[count + oldFi] : { id: `${branch.fnId}/p-${crypto.randomUUID()}`, type: 'parameter', x: 110, y: 130 + (count + fi) * 130, color: '#4f8ef7' }
      p.label = p.value = previous?.name === '_' ? '_' : name
      newParams.push(p)
      return { key: f.key, name: p.label, fieldName }
    })
    const retained = new Set(newParams.map((p) => p.id))
    for (const p of params) if (!retained.has(p.id)) {
      const usedBy = Object.values(body).some((n) => n.target === p.id || n.source === p.id || n.mounted?.includes(p.id))
      if (usedBy) body[p.id] = { ...p, type: 'literal', value: '', matchMissing: true, label: `삭제된 ${p.label}` }
      else delete body[p.id]
    }
    const others = Object.entries(body).filter(([, n]) => n.type !== 'parameter')
    Object.keys(body).forEach((id) => delete body[id])
    Object.assign(body, Object.fromEntries(newParams.map((p) => [p.id, p])), Object.fromEntries(others))
    def.label = ctor.name; def.params = newParams.map((p) => p.label); def.mounted = newParams.map(() => null); def.paramScopes = newParams.map(() => 'local')
    call.label = ctor.name; call.params = newParams.map(() => ''); call.mounted = call.mounted.slice(0, count).concat(ctor.fields.map(() => null)); call.paramScopes = newParams.map(() => 'local'); call.mountedTo = `${node.id}:${ci}`
    branch.ctor = ctor.name; branch.key = ctor.key
    return branch
  })
  node.match.type = nextDecl.name
  node.match.branches = branches
  node.sourceFunctionId = matchCaseId(nextDecl.name)
  node.label = '패턴 매칭'
  node.params = branches.map(() => '').concat('')
  node.mounted = branches.map((b) => b.callId).concat(target)
  node.paramScopes = node.params.map(() => 'local')
  if (graph[target]) graph[target].mountedTo = `${node.id}:${branches.length}`
  branches.forEach((b, i) => { if (b.useDefault || (node.match.defaultBranch && !oldBranches.includes(b))) setMatchDefault(project, graph, node, i) })
  // Removed branches stay recoverable through undo, but cannot remain visible
  // as ordinary lambdas accidentally callable with a different constructor.
  for (const branch of oldBranches) if (!branches.includes(branch)) removeBranch(project, graph, branch)
}

function removeBranch(project, graph, branch) {
  for (const n of Object.values(project.functionBodies[branch.fnId] || {})) if (n.match) deleteMatch(project, project.functionBodies[branch.fnId], n)
  for (const id of graph[branch.callId]?.mounted || []) if (graph[id]?.matchInternal) delete graph[id]
  delete graph[branch.callId]
  delete project.nodes[branch.fnId]
  delete project.functionBodies[branch.fnId]
}

export function deleteMatch(project, graph, node) {
  for (const branch of [...node.match.branches, node.match.defaultBranch].filter(Boolean)) removeBranch(project, graph, branch)
}

/** Snapshot private branch/lambda bodies together with a copied expression. */
export function copyOwnedFunctions(project, roots) {
  const nodes = {}, functionBodies = {}
  const visit = (node) => {
    const ids = node.match ? [...node.match.branches, node.match.defaultBranch].filter(Boolean).map((b) => b.fnId) : project.nodes[node.sourceFunctionId]?.lambda ? [node.sourceFunctionId] : []
    for (const id of ids) {
      if (nodes[id] || !project.functionBodies[id]) continue
      nodes[id] = structuredClone(project.nodes[id]); functionBodies[id] = structuredClone(project.functionBodies[id])
      Object.values(functionBodies[id]).forEach(visit)
    }
  }
  roots.forEach(visit)
  return { nodes, functionBodies }
}

/** Remap both the branch metadata and the graphs it owns when pasting. */
export function pasteOwnedFunctions(project, copied, ids, ownerId) {
  for (const id of Object.keys(copied.nodes)) ids.set(id, `lambda-${crypto.randomUUID()}`)
  for (const body of Object.values(copied.functionBodies)) for (const id of Object.keys(body)) if (id !== 'output' && !ids.has(id)) ids.set(id, `${id}/copy-${crypto.randomUUID()}`)
  for (const [id, def] of Object.entries(copied.nodes)) {
    const node = remapMatchNode(structuredClone(def), ids, ownerId)
    project.nodes[node.id] = node
    project.functionBodies[node.id] = Object.fromEntries(Object.values(copied.functionBodies[id]).map((original) => {
      const n = remapMatchNode(structuredClone(original), ids, ownerId)
      return [n.id, n]
    }))
  }
}

export function remapMatchNode(node, ids, ownerId) {
  const map = (id) => ids.get(id) || id
  node.id = map(node.id)
  for (const key of ['sourceFunctionId', 'target', 'source']) if (node[key]) node[key] = map(node[key])
  if (node.mounted) node.mounted = node.mounted.map((id) => id && map(id))
  if (node.mountedTo) {
    const at = node.mountedTo.lastIndexOf(':')
    node.mountedTo = `${map(node.mountedTo.slice(0, at))}:${node.mountedTo.slice(at + 1)}`
  }
  if (node.matchBranch) node.matchBranch = { ownerId: ids.has(node.matchBranch.ownerId) ? map(node.matchBranch.ownerId) : ownerId, matchId: map(node.matchBranch.matchId) }
  if (node.match) for (const b of [...node.match.branches, node.match.defaultBranch].filter(Boolean)) {
    b.fnId = map(b.fnId); b.callId = map(b.callId); b.captures = b.captures.map(map)
    if (b.previousSource) b.previousSource = map(b.previousSource)
  }
  return node
}

/** Convert a fully applied, ordinary case call without changing its users. */
export function convertCaseToMatch(project, graph, oldNode, decl, ownerId) {
  const arity = decl.constructors.length
  if (oldNode.params.length !== arity + 1 || oldNode.params.some((text, i) => !graph[oldNode.mounted?.[i]] && !parseLiteral(text))) return null
  oldNode.mounted = oldNode.params.map((text, i) => {
    if (graph[oldNode.mounted?.[i]]) return oldNode.mounted[i]
    const id = `${oldNode.id}/argument${i}`
    graph[id] = { id, type: 'literal', label: 'literal', value: text, mountedTo: `${oldNode.id}:${i}`, x: oldNode.x, y: oldNode.y }
    return id
  })
  const mounted = [...oldNode.mounted]
  const node = createMatch(project, graph, decl, mounted[arity], { id: oldNode.id, ownerId, x: oldNode.x, y: oldNode.y })
  node.mountedTo = oldNode.mountedTo
  node.connected = oldNode.connected
  node.match.branches.forEach((branch, i) => {
    captureMatchValue(project, graph, branch, mounted[i])
    const body = project.functionBodies[branch.fnId], ps = parameters(body)
    let source = ps[branch.captures.indexOf(mounted[i])].id
    branch.fields.forEach((_, fi) => {
      const id = `${branch.fnId}/apply${fi}`
      body[id] = { id, type: 'function', sourceFunctionId: 'apply', label: 'apply', params: ['', ''], mounted: [source, ps[branch.captures.length + fi].id], x: 350 + fi * 220, y: 240 }
      source = id
    })
    if (!branch.fields.length) {
      const id = `${branch.fnId}/value`
      body[id] = { id, type: 'ref', target: source, label: graph[mounted[i]].label, x: 350, y: 200 }
      source = id
    }
    body.output.source = source
    if (graph[mounted[i]].mountedTo === `${oldNode.id}:${i}`) { graph[mounted[i]].mountedTo = null; graph[mounted[i]].matchInternal = true }
  })
  if (node.mounted[arity] !== mounted[arity] && graph[mounted[arity]].mountedTo === `${oldNode.id}:${arity}`) graph[mounted[arity]].mountedTo = null
  return node
}
