// A function's type signature drawn as a graph of type nodes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSignature, makeSignatureNode, makeTypeNode, readSignature, typeNodes } from '../src/typeGraph.js'
import { inferGraph, valueTypeOfEntry } from '../src/inferGraph.js'
import { showQual, showType } from '../src/typeSystem.js'

// Plug `kids` into `host`'s slots, the way the editor does.
function plug(graph, hostId, kids) {
  kids.forEach((kid, i) => {
    if (!kid) return
    graph[hostId].mounted[i] = kid
    graph[hostId].params[i] = graph[kid].label
    graph[kid].mountedTo = `${hostId}:${i}`
  })
}
let k = 0
const t = (graph, tkind, name, kids = []) => { const id = `t${++k}`; graph[id] = makeTypeNode(id, tkind, name); plug(graph, id, kids); return id }
const show = (sch) => showQual(sch.preds, sch.type, (id) => id.slice(1))

// inc x = x + 1
function incBody() {
  return {
    'input-inc-0': { id: 'input-inc-0', type: 'parameter', label: 'x' },
    sum: { id: 'sum', type: 'function', sourceFunctionId: 'plus', params: ['', '1'], mounted: ['input-inc-0', null] },
    output: { id: 'output', type: 'output', source: 'sum' },
  }
}
function declare(body, build, contexts = []) {
  body.signature = makeSignatureNode(contexts.length)
  plug(body, 'signature', [build(body), ...contexts.map((c) => c(body))])
  return body
}
const nodes = { plus: { id: 'plus', type: 'function', builtin: 'plus', label: '(+)', params: ['x', 'y'], mounted: [null, null] }, inc: { id: 'inc', type: 'function', label: 'inc', params: ['x'], mounted: [null], custom: true } }

test('a signature graph reads as a type scheme', () => {
  const g = {}
  g.signature = makeSignatureNode(1)
  const a1 = t(g, 'var', 'a'), a2 = t(g, 'var', 'a'), a3 = t(g, 'var', 'a')
  const list = t(g, 'con', 'List', [a2])
  const arrow = t(g, 'arrow', '->', [a1, t(g, 'arrow', '->', [list, t(g, 'con', 'Maybe', [t(g, 'con', 'Int')])])])
  plug(g, 'signature', [arrow, t(g, 'class', 'Ring', [a3])])
  const read = readSignature(g)
  assert.deepEqual(read.errors, [])
  assert.equal(show(read.scheme), 'Ring a ⇒ a → [a] → Maybe Int')
})

test('what keeps a graph from being a type is reported', () => {
  const g = {}
  g.signature = makeSignatureNode()
  plug(g, 'signature', [t(g, 'arrow', '->', [t(g, 'con', 'Int')])])
  assert.match(readSignature(g).errors[0], /result of → is empty/)
  const h = {}
  h.signature = makeSignatureNode()
  plug(h, 'signature', [t(h, 'class', 'Ring', [t(h, 'var', 'a')])])
  assert.match(readSignature(h).errors[0], /only go in the signature's context/)
  const m = {}
  m.signature = makeSignatureNode()
  plug(m, 'signature', [t(m, 'con', 'Maybe')]) // unapplied: a constructor, not a type
  assert.match(readSignature(m).errors[0], /not a type/)
})

test('the declared type must be an instance of the inferred one', () => {
  const inferred = (body) => inferGraph(nodes, { inc: body }, { inc: nodes.inc }).perNode.get('inc')
  const sig = (body) => showType(valueTypeOfEntry(inferred(body)))
  // Int -> Int: narrower than Semiring a => a -> a, and fine
  const narrow = declare(incBody(), (g) => t(g, 'arrow', '->', [t(g, 'con', 'Int'), t(g, 'con', 'Int')]))
  assert.equal(sig(narrow), 'Int → Int', 'callers see the declared type')
  const body = inferGraph(nodes, { inc: narrow }, narrow)
  assert.deepEqual(body.signature, { errors: [], mismatch: null })
  assert.equal(showType(body.perNode.get('input-inc-0').valueType), 'Int', 'the body is pinned to it')
  // a -> a: too general — x + 1 needs numbers
  const general = declare(incBody(), (g) => t(g, 'arrow', '->', [t(g, 'var', 'a'), t(g, 'var', 'a')]))
  assert.match(inferGraph(nodes, { inc: general }, general).signature.mismatch, /needs/)
  const g2 = inferred(general)
  assert.equal(showQual(g2.preds, valueTypeOfEntry(g2)), 'Semiring a ⇒ a → a', 'a wrong signature is not believed: the inferred type stands')
  // Ring a => a -> a: the context gives everything x + 1 needs
  const ring = declare(incBody(), (g) => t(g, 'arrow', '->', [t(g, 'var', 'a'), t(g, 'var', 'a')]), [(g) => t(g, 'class', 'Ring', [t(g, 'var', 'a')])])
  assert.equal(inferGraph(nodes, { inc: ring }, ring).signature.mismatch, null)
  const e = inferred(ring)
  assert.equal(showQual(e.preds, valueTypeOfEntry(e)), 'Ring a ⇒ a → a')
  // Bool -> Bool: not an instance at all
  const wrong = declare(incBody(), (g) => t(g, 'arrow', '->', [t(g, 'con', 'Bool'), t(g, 'con', 'Bool')]))
  assert.ok(inferGraph(nodes, { inc: wrong }, wrong).signature.mismatch)
})

test('checkSignature on schemes directly', () => {
  const g = {}
  g.signature = makeSignatureNode()
  plug(g, 'signature', [t(g, 'arrow', '->', [t(g, 'var', 'b'), t(g, 'var', 'b')])])
  const declared = readSignature(g).scheme
  const id = { vars: ['x'], preds: [], type: { kind: 'fun', from: { kind: 'var', id: 'x' }, to: { kind: 'var', id: 'x' } } }
  assert.equal(checkSignature(declared, id), null, 'b → b is identity\'s type')
  const konst = { vars: ['x', 'y'], preds: [], type: { kind: 'fun', from: { kind: 'var', id: 'x' }, to: { kind: 'var', id: 'y' } } }
  assert.equal(checkSignature(declared, konst), null, 'a more general body is fine')
  const pq = { kind: 'fun', from: { kind: 'var', id: "'p" }, to: { kind: 'var', id: "'q" } }
  assert.ok(checkSignature({ vars: ["'p", "'q"], preds: [], type: pq }, id), 'p → q claims more than identity gives')
})

test('a type drawn as nodes reads back as the same type', () => {
  for (const [preds, type] of [
    [[{ cls: 'Functor', type: { kind: 'var', id: 'f' } }], { kind: 'fun', from: { kind: 'fun', from: { kind: 'var', id: 'a' }, to: { kind: 'var', id: 'b' } }, to: { kind: 'fun', from: { kind: 'app', fn: { kind: 'var', id: 'f' }, arg: { kind: 'var', id: 'a' } }, to: { kind: 'app', fn: { kind: 'var', id: 'f' }, arg: { kind: 'var', id: 'b' } } } }],
    [[], { kind: 'app', fn: { kind: 'app', fn: { kind: 'con', name: '(,)' }, arg: { kind: 'con', name: 'Int' } }, arg: { kind: 'app', fn: { kind: 'con', name: 'List' }, arg: { kind: 'con', name: 'Char' } } }],
  ]) {
    let n = 0
    const drawn = typeNodes(preds, type, () => `n${++n}`)
    const g = { ...drawn.nodes, signature: makeSignatureNode(drawn.context.length) }
    plug(g, 'signature', [drawn.root, ...drawn.context])
    const read = readSignature(g)
    assert.deepEqual(read.errors, [])
    assert.equal(show(read.scheme), showQual(preds, type))
  }
})
