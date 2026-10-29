import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syntaxLessons, lessonGuide, lessonSource } from '../src/learningContent.js'
import { preludeDefs } from '../src/library.js'
import { createTypedEvaluator } from '../src/typedEvaluator.js'
import { showValue } from '../src/evaluator.js'
import { parseLiteral } from '../src/literals.js'

// Construct the same literal nodes, open slots, calls and parameter uses as
// the instructions. No Haskell parser or alternate evaluator is involved.
const basics = {
  plus: ['(+)', ['x', 'y']], times: ['(*)', ['x', 'y']], minus: ['(-)', ['x', 'y']],
  eq: ['(==)', ['x', 'y']], geq: ['(>=)', ['x', 'y']], select: ['select', ['condition', 'whenTrue', 'whenFalse']],
  identity: ['identity', ['x']], apply: ['apply', ['f', 'x']], compose: ['compose', ['f', 'g', 'x']], isZero: ['isZero', ['n']],
}
function setup() {
  const nodes = { ...preludeDefs, ...Object.fromEntries(Object.entries(basics).map(([id, [label, params]]) =>
    [id, { id, type: 'function', builtin: id, label, params }])) }
  const functionBodies = {}, graph = {}
  const registry = { nodes, functionBodies }
  let count = 0
  const ref = (id) => ({ ref: id })
  function add(label, slots, into = graph) {
    const def = Object.values(nodes).find((n) => n.label === label)
    assert.ok(def, `UI function exists: ${label}`)
    const id = `call-${++count}`
    into[id] = { id, type: 'function', sourceFunctionId: def.id, label, params: slots.map((_, i) => def.params[i] || ''), mounted: slots.map(() => null) }
    slots.forEach((s, i) => {
      if (s === null) return
      if (s.ref) { into[id].mounted[i] = s.ref; return }
      assert.ok(parseLiteral(s), `valid slot literal: ${s}`)
      const lid = `${id}-literal-${i}`
      into[lid] = { id: lid, type: 'literal', value: s, mountedTo: `${id}:${i}` }
      into[id].mounted[i] = lid
    })
    return id
  }
  const change = (id, slot, value) => { graph[graph[id].mounted[slot]].value = value }
  const run = (id) => showValue(createTypedEvaluator(registry).run(graph, id))
  return { nodes, functionBodies, graph, add, ref, change, run }
}

const scenarios = {
  values(s) { const id = s.add('(+)', ['2', '3']); return [id, () => s.change(id, 0, '5'), '8'] },
  comparisons(s) { const id = s.add('(==)', ['4', '4']); return [id, () => s.change(id, 1, '5'), 'False'] },
  logic(s) { const neg = s.add('not', ['False']); const id = s.add('(&&)', ['True', s.ref(neg)]); return [id, () => s.change(neg, 0, 'True'), 'False'] },
  functions(s) {
    s.nodes.double = { id: 'double', type: 'function', label: 'double', params: ['x'], custom: true }
    const body = { x: { id: 'x', type: 'parameter', label: 'x' } }
    const times = s.add('(*)', [s.ref('x'), '2'], body)
    body.output = { id: 'output', type: 'output', source: times }
    s.functionBodies.double = body
    const id = s.add('double', ['4'])
    return [id, () => s.change(id, 0, '5'), '10']
  },
  conditions(s) { const eq = s.add('(==)', ['4', '4']); const id = s.add('select', [s.ref(eq), '10', '0']); return [id, () => s.change(eq, 1, '5'), '0'] },
  types(s) { const id = s.add('identity', ['True']); return [id, () => s.change(id, 0, '7'), '7'] },
  integers(s) { const id = s.add('isZero', ['0']); return [id, () => s.change(id, 0, '2'), 'False'] },
  lists(s) {
    const xs = s.add('[ , , ]', ['1', '2', '3']); const id = s.add('length', [s.ref(xs)])
    return [id, () => { const more = s.add('[ , , ]', ['1', '2', '3', '4']); s.graph[id].mounted[0] = more }, '4']
  },
  tuples(s) { const pair = s.add('(,)', ['2', 'True']); const id = s.add('fst', [s.ref(pair)]); return [id, () => s.change(pair, 0, '9'), '9'] },
  currying(s) { const plus = s.add('(+)', ['5', null]); const id = s.add('apply', [s.ref(plus), '3']); return [id, () => s.change(id, 1, '8'), '13'] },
  composition(s) { const f = s.add('(*)', ['2', null]), g = s.add('(+)', ['1', null]); const id = s.add('compose', [s.ref(f), s.ref(g), '3']); return [id, () => s.change(id, 2, '4'), '10'] },
  map(s) { const f = s.add('(*)', ['2', null]), xs = s.add('[ , , ]', ['1', '2', '3']); const id = s.add('map', [s.ref(f), s.ref(xs)]); return [id, () => s.change(f, 0, '3'), '[3,6,9]'] },
  patterns(s) {
    const xs = s.add('[ , , ]', ['7', '8']), at = s.add('(!?)', [s.ref(xs), '0']), identity = s.add('identity', [null])
    const id = s.add('maybe', ['0', s.ref(identity), s.ref(at)])
    return [id, () => s.change(xs, 0, '9'), '9', () => { s.graph[at].mounted[0] = s.add('[]', []) }, '0']
  },
  bindings(s) { const cmp = s.add('(>=)', ['6', '5']), product = s.add('(*)', ['6', '2']); const id = s.add('select', [s.ref(cmp), s.ref(product), '0']); return [id, () => s.change(cmp, 1, '7'), '0'] },
  recursion(s) {
    s.nodes.sumDown = { id: 'sumDown', type: 'function', label: 'sumDown', params: ['n'], custom: true }
    const body = { n: { id: 'n', type: 'parameter', label: 'n' } }
    // Separate parameter references, as made by the PARAMETERS library.
    for (const i of [1, 2, 3]) body[`use${i}`] = { id: `use${i}`, type: 'ref', target: 'n', label: 'n' }
    const cmp = s.add('(<=)', [s.ref('use1'), '0'], body)
    const minus = s.add('(-)', [s.ref('use2'), '1'], body)
    const rec = s.add('sumDown', [s.ref(minus)], body)
    const plus = s.add('(+)', [s.ref('use3'), s.ref(rec)], body)
    const select = s.add('select', [s.ref(cmp), '0', s.ref(plus)], body)
    body.output = { id: 'output', type: 'output', source: select }; s.functionBodies.sumDown = body
    const id = s.add('sumDown', ['3'])
    return [id, () => s.change(id, 0, '4'), '10', () => s.change(id, 0, '0'), '0']
  },
}

test('lessons distinguish support, expected output, practice and attribution', () => {
  assert.equal(new Set(syntaxLessons.map((l) => l.id)).size, syntaxLessons.length)
  assert.ok(lessonGuide.some((s) => s.includes('Export')))
  assert.equal(lessonSource.license, 'CC BY-NC-SA 3.0')
  for (const l of syntaxLessons) {
    for (const key of ['description', 'syntax', 'code', 'expected', 'explanation', 'experiment', 'caution', 'source']) assert.ok(l[key]?.trim(), `${l.id}: ${key}`)
    assert.ok(l.steps.length >= 3 && l.steps.every((s) => typeof s === 'string' && s.length))
    assert.ok(['graph', 'concept'].includes(l.support))
    assert.ok(scenarios[l.id], `${l.id}: executable graph or equivalent has regression coverage`)
    for (const e of l.examples || []) {
      for (const key of ['title', 'code', 'expected', 'explanation', 'experiment', 'caution']) assert.ok(e[key]?.trim(), `${l.id} example: ${key}`)
      assert.ok(e.steps.length >= 3)
    }
  }
})
for (const lesson of syntaxLessons) {
  test(`${lesson.id}: documented graph and changed input produce the expected values`, () => {
    const s = setup()
    const [id, change, changed, extraChange, extraExpected] = scenarios[lesson.id](s)
    assert.equal(s.run(id), lesson.expected)
    change(); assert.equal(s.run(id), changed)
    if (extraChange) { extraChange(); assert.equal(s.run(id), extraExpected) }
  })
}
test('additional list/filter lesson examples use actual UI nodes and documented results', () => {
  const s = setup()
  const xs = s.add('[ , , ]', ['1', '2', '3'])
  const lessons = syntaxLessons.find(l => l.id === 'lists').examples
  for (const [index, fn] of ['take', 'drop'].entries()) {
    const id = s.add(fn, ['2', s.ref(xs)])
    assert.equal(s.run(id), lessons[index].expected)
  }
  const ys = s.add('[ , , ]', ['1', '2', '3', '2'])
  const predicate = s.add('(==)', ['2', null])
  const filtered = s.add('filter', [s.ref(predicate), s.ref(ys)])
  assert.equal(s.run(filtered), syntaxLessons.find(l => l.id === 'map').examples[0].expected)
})
