import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { branchPattern, captureMatchValue, convertCaseToMatch, copyOwnedFunctions, createMatch, deleteMatch, ensureTypeKeys, matchProblem, nameRecordFields, pasteOwnedFunctions, remapMatchNode, renameMatchBinder, setMatchDefault } from '../src/matchGraph.js'
import { declToDraft, declareTypes, derivedDefinitions, draftToSource } from '../src/typeDecls.js'
import { migrateTypeEdit, primitiveDefinitions } from '../src/typeEdits.js'
import { createTypedEvaluator, elaborate } from '../src/typedEvaluator.js'
import { inferGraph } from '../src/inferGraph.js'
import { printDefinition, printDefinitionTokens } from '../src/haskellPrint.js'
import { parseProject, serializeProject, upgradeProject } from '../src/project.js'
import { bundleModules, PLAYER_MODULES } from '../src/exportHtml.js'
import { showType } from '../src/typeSystem.js'
import { builtinSchemes } from '../src/builtinSchemes.js'
import { libraryDefs, preludeTypes } from '../src/library.js'
import { createGame } from '../src/runtime.js'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { buildBlankGame } from '../src/examples/blankGame.js'
import { buildBlackjack } from '../src/examples/blackjack.js'

const param = (id, label = id) => ({ id, type: 'parameter', label })
const lit = (id, value) => ({ id, type: 'literal', value: String(value) })
const call = (id, sourceFunctionId, mounted, params = mounted.map(() => '')) => ({ id, type: 'function', label: sourceFunctionId, sourceFunctionId, mounted, params })
const params = (body) => Object.values(body).filter((n) => n.type === 'parameter')
const registry = (source, names = ['tree']) => {
  const types = declareTypes({}, source)
  Object.values(types).forEach(ensureTypeKeys)
  const defs = derivedDefinitions(types)
  const nodes = Object.fromEntries([...defs, ...primitiveDefinitions(defs)].map((d) => [d.id, d]))
  nodes.plus = { id: 'plus', type: 'function', label: '(+)', builtin: 'plus' }
  nodes.apply = { id: 'apply', type: 'function', label: 'apply', builtin: 'apply' }
  nodes.f = { id: 'f', type: 'function', label: 'f', params: names, mounted: names.map(() => null), custom: true }
  const body = Object.fromEntries(names.map((name) => [name, param(name)]))
  body.output = { id: 'output', type: 'output' }
  return { nodes, functionBodies: { f: body }, types, body }
}
const match = (r, type = Object.keys(r.types)[0]) => {
  const n = createMatch(r, r.body, r.types[type], 'tree', { id: 'match', ownerId: 'f' })
  r.body.output.source = n.id
  return n
}
const branchBody = (r, n, i) => r.functionBodies[n.match.branches[i].fnId]
const constant = (body, value) => { body.answer = lit('answer', value); body.output.source = 'answer' }
const tree = (ctor, args = [], type = 'Tree') => ({ kind: 'data', type, ctor, ctorIndex: ctor === 'Leaf' ? 0 : 1, args })
const apply = (r, values) => {
  const g = Object.fromEntries(values.map((data, i) => [`v${i}`, { id: `v${i}`, type: 'value', data }]))
  g.run = call('run', 'f', values.map((_, i) => `v${i}`))
  return createTypedEvaluator(r).run(g, 'run')
}

test('a recursive match infers and evaluates a tree fold written as ordinary recursion', () => {
  const r = registry('data Tree a = Leaf a | Node (Tree a) (Tree a)')
  const n = match(r)
  constant(branchBody(r, n, 0), 1)
  const body = branchBody(r, n, 1), p = params(body)
  body.left = call('left', 'f', [p[1].id])
  body.right = call('right', 'f', [p[2].id])
  body.sum = call('sum', 'plus', ['left', 'right'])
  body.output.source = 'sum'
  assert.equal(apply(r, [tree('Node', [tree('Leaf', [7]), tree('Node', [tree('Leaf', [8]), tree('Leaf', [9])])])]), 3)
  assert.equal(inferGraph(r.nodes, r.functionBodies, r.body).brokenEdges.length, 0)
  const code = printDefinition('f', r.nodes, r.functionBodies)
  assert.match(code, /case tree of \{ Leaf x1 -> 1; Node x1 x2 -> f x1 \+ f x2 \}/)
  assert.ok(!code.includes('caseTree') && !code.includes('\\'))
  assert.ok(printDefinitionTokens('f', r.nodes, r.functionBodies).some((t) => t.scope === n.match.branches[1].fnId))
})

test('matching a polymorphic record substitutes its field types and captures outer values', () => {
  const r = registry('data Box a = Box { value :: a }', ['tree', 'amount'])
  const n = match(r), body = branchBody(r, n, 0), p = params(body)
  body.sum = call('sum', 'plus', [p[2].id, p[1].id]); body.output.source = 'sum'
  const box = { kind: 'data', type: 'Box', ctor: 'Box', ctorIndex: 0, args: [5] }
  assert.equal(apply(r, [box, 4]), 9)
  assert.match(printDefinition('f', r.nodes, r.functionBodies), /Box value -> value \+ amount/)
})

test('unselected branches and unused fields stay lazy', () => {
  const r = registry('data Tree = Leaf | Node Tree Tree')
  const n = match(r)
  constant(branchBody(r, n, 0), 7)
  const body = branchBody(r, n, 1), p = params(body)
  body.loop = call('loop', 'f', [p[0].id]); body.output.source = 'loop'
  assert.equal(apply(r, [tree('Leaf')]), 7)
  constant(body, 8)
  assert.ok(renameMatchBinder(r, n.match.branches[1], 0, '_'))
  assert.ok(renameMatchBinder(r, n.match.branches[1], 1, '_'))
  // nodeValue thunks are never forced for either subtree.
  r.nodes.spin = { id: 'spin', type: 'function', label: 'spin', params: ['x'], mounted: [null], custom: true }
  r.functionBodies.spin = { x: param('x'), again: call('again', 'spin', ['x']), output: { id: 'output', type: 'output', source: 'again' } }
  r.body.bad = call('bad', 'spin', ['tree'])
  r.body.node = call('node', 'type:Tree:Node', ['bad', 'bad'])
  r.body[n.mounted[2]].target = 'node'
  assert.equal(createTypedEvaluator(r).run(r.body, n.id), 8)
})

test('missing results, wildcard use and incompatible branch types are diagnosed', () => {
  const r = registry('data Tree = Leaf | Node Tree Tree')
  const n = match(r)
  assert.match(matchProblem(n, r.body, r.nodes, r.functionBodies), /Leaf.*결과/)
  assert.throws(() => apply(r, [tree('Leaf')]), /결과/)
  constant(branchBody(r, n, 0), 'True')
  constant(branchBody(r, n, 1), '"different"')
  assert.ok(inferGraph(r.nodes, r.functionBodies, r.body).brokenEdges.length > 0)
  assert.throws(() => apply(r, [tree('Leaf')]), /타입/)
  const b = n.match.branches[1], body = branchBody(r, n, 1)
  assert.equal(renameMatchBinder(r, b, 0, 'value'), true)
  assert.equal(renameMatchBinder(r, b, 1, 'value'), false)
  renameMatchBinder(r, b, 0, '_')
  body.output.source = params(body)[1].id
  assert.match(matchProblem(n, r.body, r.nodes, r.functionBodies), /_는 값/)
})

test('nested match blocks keep their scope and use the expected field types while editing', () => {
  const r = registry('data Box a = Box { item :: a }')
  const outer = match(r)
  const body = branchBody(r, outer, 0), field = params(body)[1]
  const inner = createMatch(r, body, r.types.Box, field.id, { id: 'inner', ownerId: outer.match.branches[0].fnId })
  body.output.source = inner.id
  const innerBody = branchBody(r, inner, 0)
  innerBody.output.source = params(innerBody).at(-1).id
  const box = (value) => ({ kind: 'data', type: 'Box', ctor: 'Box', ctorIndex: 0, args: [value] })
  assert.equal(apply(r, [box(box(13))]), 13)
  assert.match(printDefinition('f', r.nodes, r.functionBodies), /Box item -> case .* of \{ Box item -> item/)
  const concrete = registry('data Model = Model { count :: Int }')
  const n = match(concrete)
  const branch = branchBody(concrete, n, 0)
  branch.output.source = params(branch).at(-1).id
  const pass = inferGraph(concrete.nodes, concrete.functionBodies, branch)
  assert.equal(showType(pass.perNode.get(params(branch).at(-1).id).valueType), 'Int')
})

test('copying and deleting a match owns independent branch bodies, including defaults', () => {
  const r = registry('data Tree = Leaf | Node Tree Tree')
  const n = match(r)
  setMatchDefault(r, r.body, n, 1)
  constant(branchBody(r, n, 0), 1)
  constant(r.functionBodies[n.match.defaultBranch.fnId], 2)
  const roots = Object.values(r.body).filter((n) => !['parameter', 'output'].includes(n.type))
  const saved = copyOwnedFunctions(r, roots)
  const ids = new Map(roots.map((n) => [n.id, `${n.id}/copy`]))
  pasteOwnedFunctions(r, saved, ids, 'g')
  const graph = { tree: param('tree') }
  for (const original of roots) { const node = remapMatchNode(structuredClone(original), ids, 'g'); graph[node.id] = node }
  const copy = graph[ids.get(n.id)]
  graph.output = { id: 'output', type: 'output', source: copy.id }
  r.nodes.g = { id: 'g', type: 'function', label: 'g', custom: true, params: ['tree'], mounted: [null] }
  r.functionBodies.g = graph
  assert.notEqual(copy.match.branches[0].fnId, n.match.branches[0].fnId)
  constant(r.functionBodies[copy.match.branches[0].fnId], 99)
  assert.equal(apply(r, [tree('Leaf')]), 1)
  const run = { v: { id: 'v', type: 'value', data: tree('Leaf') }, run: call('run', 'g', ['v']) }
  assert.equal(createTypedEvaluator(r).run(run, 'run'), 99)
  deleteMatch(r, graph, copy)
  assert.ok(r.functionBodies[n.match.branches[0].fnId])
  assert.ok(!r.functionBodies[copy.match.defaultBranch.fnId])
})

test('converting an existing fully applied case call preserves its value and callers', () => {
  const r = registry('data E = A | B Int')
  r.nodes.identity = { id: 'identity', type: 'function', builtin: 'identity', label: 'identity' }
  r.body.a = lit('a', 10)
  r.body.b = call('b', 'identity', [])
  const old = call('old', 'type:E:caseE', ['a', 'b', 'tree'])
  r.body.old = old; r.body.output.source = old.id
  const a = { kind: 'data', type: 'E', ctor: 'A', ctorIndex: 0, args: [] }
  const b = { kind: 'data', type: 'E', ctor: 'B', ctorIndex: 1, args: [4] }
  assert.equal(apply(r, [a]), 10); assert.equal(apply(r, [b]), 4)
  const converted = convertCaseToMatch(r, r.body, old, r.types.E, 'f')
  assert.equal(converted.id, r.body.output.source)
  assert.equal(apply(r, [a]), 10); assert.equal(apply(r, [b]), 4)
})

test('extra outer expressions can be captured and shadowed names print without capture', () => {
  const r = registry('data Box a = Box { value :: a }', ['tree', 'value'])
  r.body.one = lit('one', 1)
  r.body.extra = call('extra', 'plus', ['value', 'one'])
  const n = match(r), b = n.match.branches[0]
  assert.equal(captureMatchValue(r, r.body, b, 'extra'), true)
  assert.equal(captureMatchValue(r, r.body, b, 'extra'), false)
  const body = branchBody(r, n, 0), p = params(body)
  body.sum = call('sum', 'plus', [p[1].id, p[2].id]); body.output.source = 'sum'
  assert.equal(apply(r, [{ kind: 'data', type: 'Box', ctor: 'Box', ctorIndex: 0, args: [100] }, 4]), 9)
  const code = printDefinition('f', r.nodes, r.functionBodies)
  assert.match(code, /outer = value/)
  assert.match(code, /Box value -> outer \+/)
})

test('defaults share one body, ignore constructor fields and cover new constructors', () => {
  const r = registry('data Tree = Leaf | Node Tree Tree')
  const n = match(r)
  setMatchDefault(r, r.body, n, 0)
  setMatchDefault(r, r.body, n, 1)
  constant(r.functionBodies[n.match.defaultBranch.fnId], 12)
  assert.equal(apply(r, [tree('Leaf')]), 12)
  assert.equal(apply(r, [tree('Node', [tree('Leaf'), tree('Leaf')])]), 12)
  const next = declareTypes({}, 'data Tree = Leaf | Node Tree Tree | Other')
  ensureTypeKeys(next.Tree)
  migrateTypeEdit(r, r.types.Tree, next.Tree, { ctors: [0, 1], fields: [[], [0, 1]] })
  r.types = next
  const defs = derivedDefinitions(next)
  Object.assign(r.nodes, Object.fromEntries([...defs, ...primitiveDefinitions(defs)].map((d) => [d.id, d])))
  assert.equal(n.match.branches[2].useDefault, true)
  assert.equal(apply(r, [{ kind: 'data', type: 'Tree', ctor: 'Other', ctorIndex: 2, args: [] }]), 12)
  assert.equal((printDefinition('f', r.nodes, r.functionBodies).match(/_ ->/g) || []).length, 1)
})

test('constructor and field reordering preserves branch identity, deletion flags live references', () => {
  const r = registry('data T = A Int Bool | B')
  const n = match(r, 'T'), a = n.match.branches[0]
  const body = branchBody(r, n, 0)
  body.output.source = params(body)[1].id
  constant(branchBody(r, n, 1), 0)
  const next = declareTypes({}, 'data T = B | Renamed Bool Int')
  migrateTypeEdit(r, r.types.T, next.T, { ctors: [1, 0], fields: [[1, 0], []] })
  assert.equal(n.match.branches[1], a)
  assert.equal(a.ctor, 'Renamed')
  assert.equal(params(body)[2].id, body.output.source)
  assert.equal(branchPattern(a), 'Renamed x1 x2')
  const last = declareTypes({}, 'data T = B | Renamed Bool')
  migrateTypeEdit(r, next.T, last.T, { ctors: [0, 1], fields: [[], [0, undefined]] })
  assert.equal(body[body.output.source].matchMissing, true)
})

test('record naming avoids project functions; saved identities and matching survive reload', () => {
  const r = registry('data Tree = Leaf | Node Tree Tree')
  const n = match(r)
  constant(branchBody(r, n, 0), 1); constant(branchBody(r, n, 1), 2)
  const loaded = upgradeProject(parseProject(serializeProject(r)))
  assert.equal(loaded.types.Tree.constructors[1].key, r.types.Tree.constructors[1].key)
  assert.deepEqual(loaded.functionBodies.f.match.match, n.match)
  assert.equal(apply({ ...loaded, body: loaded.functionBodies.f }, [tree('Leaf')]), 1)
  const draft = declToDraft(declareTypes({}, 'data Model = Model Int Int').Model)
  nameRecordFields(draft, 0, ['field1', 'field3'])
  assert.match(draftToSource(draft), /Model \{ field2 :: Int, field4 :: Int \}/)
})

test('an exported player executes the identical match graphs and primitive definitions', () => {
  const r = registry('data Tree = Leaf | Node Tree Tree')
  const n = match(r)
  constant(branchBody(r, n, 0), 3); constant(branchBody(r, n, 1), 5)
  const sources = Object.fromEntries(PLAYER_MODULES.map((name) => [name, readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')]))
  const modules = new Function(`${bundleModules(sources)}\nreturn __m`)()
  const g = { leaf: call('leaf', 'type:Tree:Leaf', []), run: call('run', 'f', ['leaf']) }
  const ev = modules.evaluator.createEvaluator({ ...r, elaboration: () => elaborate(r, g) })
  assert.equal(ev.run(g, 'run'), 3)
})

test('new template graphs can replace their case calls and still run the same games', () => {
  for (const build of [buildBlankGame, buildClickCounter, buildBlackjack]) {
    const project = build(), defs = derivedDefinitions(project.types)
    project.nodes = {
      ...Object.fromEntries(Object.keys(builtinSchemes).map((id) => [id, { id, type: 'function', builtin: id, label: id }])),
      ...libraryDefs,
      ...Object.fromEntries([...defs, ...primitiveDefinitions(defs)].map((d) => [d.id, d])),
      ...project.nodes,
    }
    const entry = { run: call('run', 'main', []) }
    const before = createTypedEvaluator(project)
    const gameBefore = createGame(before, before.run(entry, 'run'))
    const expected = gameBefore.view()
    let converted = 0
    for (const [ownerId, graph] of Object.entries(project.functionBodies)) for (const node of Object.values(graph)) {
      const def = project.nodes[node.sourceFunctionId]
      if (def?.derived?.op === 'case' && project.types[def.derived.type] && convertCaseToMatch(project, graph, node, project.types[def.derived.type], ownerId)) converted++
    }
    assert.ok(converted > 0)
    const after = createTypedEvaluator(project)
    const gameAfter = createGame(after, after.run(entry, 'run'))
    assert.deepEqual(gameAfter.view(), expected)
    const findButton = (widget) => widget.kind === 'button' ? widget : (widget.children || []).map(findButton).find(Boolean)
    const button = findButton(expected)
    gameBefore.dispatch(button.msg); gameAfter.dispatch(button.msg)
    assert.deepEqual(gameAfter.view(), gameBefore.view())
  }
})

test('Prelude Maybe, Ordering and tuple matches use their native runtime representation', () => {
  for (const [name, value, chosen] of [
    ['Maybe', { kind: 'data', type: 'Maybe', ctor: 'Just', ctorIndex: 1, args: [7] }, 1],
    ['Ordering', { kind: 'data', type: 'Ordering', ctor: 'GT', ctorIndex: 2, args: [] }, 2],
    ['(,)', { kind: 'data', type: '(,)', ctor: '(,)', ctorIndex: 0, args: [4, 5] }, 0],
  ]) {
    const r = registry('data Unused = Unused')
    Object.assign(r.nodes, libraryDefs)
    r.types[name] = preludeTypes[name]
    const n = match(r, name)
    n.match.branches.forEach((_, i) => constant(branchBody(r, n, i), i + 10))
    assert.equal(apply(r, [value]), chosen + 10)
  }
})
