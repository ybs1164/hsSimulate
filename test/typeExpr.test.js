import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annotationProblem, annotationType, chainOf, constructorWithHoles, firstHole, hole, pinAt, replaceAt, typeAt, typeFromText, typeNode, typeText } from '../src/typeExpr.js'
import { inferGraph } from '../src/inferGraph.js'
import { setUserTypeArities, showQual, showType, tcon, tfun, tlist, tvar } from '../src/typeSystem.js'

test('a function type is its curried chain of segments', () => {
  const t = tfun(tcon('Int'), tfun(tfun(tvar('a'), tvar('b')), tlist(tcon('Bool'))))
  assert.deepEqual(chainOf(t).map((s) => typeText(s)), ['Int', 'a -> b', '[Bool]'])
  assert.deepEqual(chainOf(tcon('Int')).map((s) => typeText(s)), ['Int'])
})

test('a type node is a constructor with a slot per argument — the arrow included', () => {
  const pair = typeFromText('(Maybe Int, a -> b)')
  const { head, slots } = typeNode(pair)
  assert.equal(head.name, '(,)')
  assert.deepEqual(slots.map((s) => typeText(s)), ['Maybe Int', 'a -> b'])
  assert.equal(typeNode(slots[1]).head.kind, 'arrow')
  assert.equal(typeText(typeAt(pair, [0, 0])), 'Int')
})

test('editing a type node fills its holes in order', () => {
  let t = constructorWithHoles('->')
  assert.equal(typeText(t), '_ -> _')
  t = replaceAt(t, firstHole(t), constructorWithHoles('Maybe'))
  assert.equal(typeText(t), 'Maybe _ -> _')
  assert.deepEqual(firstHole(t), [0, 0])
  t = replaceAt(t, firstHole(t), tcon('Double'))
  t = replaceAt(t, firstHole(t), constructorWithHoles('List'))
  t = replaceAt(t, firstHole(t), tvar('a'))
  assert.equal(typeText(t), 'Maybe Double -> [a]')
  assert.equal(firstHole(t), null)
  assert.equal(typeText(constructorWithHoles('String')), 'String')
})

test('annotation text round-trips, with holes as _', () => {
  for (const text of ['Int', 'Maybe a -> [b]', '(Int, _) -> _', 'String', '(a -> b) -> a -> b']) assert.equal(typeText(typeFromText(text)), text)
  assert.ok(typeFromText('_').kind === 'hole')
})

test('annotations share named variables, but each _ is its own', () => {
  const names = new Map()
  const a1 = annotationType('a -> _', names)
  const a2 = annotationType('a', names)
  assert.equal(a1.from.id, a2.id)
  const two = annotationType('_ -> _')
  assert.notEqual(two.from.id, two.to.id)
})

test('an annotation must be a known, well-applied type', () => {
  assert.equal(annotationProblem('Double'), '')
  assert.match(annotationProblem('Dubble'), /Unknown type/)
  assert.match(annotationProblem('Maybe'), /wrong number of type arguments/)
  setUserTypeArities({ Pair: 1 })
  assert.equal(annotationProblem('Pair Int'), '')
  setUserTypeArities({})
})

// ---- Annotations in inference: a body's parameter / Output nodes ----------

const param = (id, label, annotation) => ({ id, type: 'parameter', label, value: label, annotation })
const call = (id, builtin, mounted) => ({ id, type: 'function', builtin, params: mounted.map(() => ''), mounted })
function project(body) {
  const def = { id: 'f', type: 'function', label: 'f', custom: true, params: Object.values(body).filter((n) => n.type === 'parameter').map((n) => n.label), mounted: [] }
  def.mounted = def.params.map(() => null)
  return { nodes: { f: def }, bodies: { f: body } }
}
const schemeOf = (p) => {
  const pass = inferGraph(p.nodes, p.bodies, p.nodes)
  const e = pass.perNode.get('f')
  return { pass, text: showQual(e.preds, e.paramTypes.reduceRight((acc, t) => tfun(t, acc), e.resultType)) }
}

test('pinning a parameter specializes the inferred signature', () => {
  // f x = x + x — inferred AddSemigroup a ⇒ a → a; pinned x :: Double
  const body = { x: param('x', 'x'), x2: { id: 'x2', type: 'ref', target: 'x' }, plus: call('plus', 'plus', ['x', 'x2']), output: { id: 'output', type: 'output', source: 'plus' } }
  assert.equal(schemeOf(project(body)).text, 'AddSemigroup a ⇒ a → a')
  body.x.annotation = 'Double'
  assert.equal(schemeOf(project(body)).text, 'Double → Double')
})

test('a hole (_) leaves that segment to inference; a pinned result flows back', () => {
  const body = { x: param('x', 'x', '_'), output: { id: 'output', type: 'output', source: 'x', annotation: 'Maybe Int' } }
  assert.equal(schemeOf(project(body)).text, 'Maybe Int → Maybe Int')
})

test('the same variable name means the same type across segments', () => {
  // f x y = y, pinned x :: a, result :: a  ⇒  a → a → a
  const body = { x: param('x', 'x', 'a'), y: param('y', 'y'), output: { id: 'output', type: 'output', source: 'y', annotation: 'a' } }
  const { text } = schemeOf(project(body))
  assert.equal(text, 'a → a → a')
})

test('an annotation the body contradicts is reported on its node and left out', () => {
  // f x = isZero x — x is Int; pinning it Bool is a mismatch
  const body = { x: param('x', 'x', 'Bool'), z: call('z', 'isZero', ['x']), output: { id: 'output', type: 'output', source: 'z' } }
  const { pass, text } = schemeOf(project(body))
  assert.equal(text, 'Int → Bool')
  assert.match(pass.annotations.functions.f.x, /makes ‘x’ Int, not Bool/)
})

test('a pinned type must have the classes the body needs', () => {
  const body = { x: param('x', 'x', 'Bool'), x2: { id: 'x2', type: 'ref', target: 'x' }, plus: call('plus', 'plus', ['x', 'x2']), output: { id: 'output', type: 'output', source: 'plus' } }
  const { pass } = schemeOf(project(body))
  assert.match(pass.annotations.functions.f.x, /needs AddSemigroup/)
})

test('signature variables are rigid: the body may not specialize them', () => {
  const body = { x: param('x', 'x', 'a'), z: call('z', 'isZero', ['x']), output: { id: 'output', type: 'output', source: 'z' } }
  const { pass } = schemeOf(project(body))
  assert.match(pass.annotations.functions.f.x, /a must work for every type.*Int/)
  const same = { x: param('x', 'x', 'a'), y: param('y', 'y', 'b'), sel: call('sel', 'select', [null, 'x', 'y']), output: { id: 'output', type: 'output', source: 'sel' } }
  assert.match(schemeOf(project(same)).pass.annotations.functions.f.y, /a and b may be different types/)
})

test('looking at the body itself checks the same annotations', () => {
  const body = { x: param('x', 'x', 'Double'), output: { id: 'output', type: 'output', source: 'x' } }
  const { nodes, bodies } = project(body)
  const pass = inferGraph(nodes, bodies, bodies.f)
  assert.equal(showType(pass.perNode.get('output').valueType), 'Double')
  assert.deepEqual(pass.annotations.here, {})
  body.output.annotation = 'Int'
  assert.match(inferGraph(nodes, bodies, bodies.f).annotations.here.output, /makes the result Double, not Int/)
})

test('a hole stays a hole when built from scratch', () => {
  assert.equal(typeText(hole()), '_')
})

test('dropping a type node onto a part pins only what leads to it', () => {
  const shown = typeFromText('Maybe (a, b)')
  assert.equal(typeText(pinAt(hole(), shown, [], tcon('Int'))), 'Int')
  assert.equal(typeText(pinAt(hole(), shown, [0, 1], tcon('Int'))), 'Maybe (_, Int)')
  assert.equal(typeText(pinAt(typeFromText('Maybe (Bool, _)'), shown, [0, 1], tcon('Int'))), 'Maybe (Bool, Int)')
  assert.equal(typeText(pinAt(typeFromText('Maybe _'), shown, [0], hole())), 'Maybe _')
  assert.equal(typeText(pinAt(hole(), typeFromText('a -> [b]'), [1, 0], tvar('a'))), '_ -> [a]')
  assert.equal(pinAt(hole(), shown, [0, 2], tcon('Int')), null)
})
