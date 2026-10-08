import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { printDefinition } from '../src/haskellPrint.js'
import { derivedDefinitions } from '../src/typeDecls.js'

const ex = buildClickCounter()
const labels = { plus: '(+)', minus: '(-)', select: 'select', apply: 'apply', divide: '(/)', 'prelude:scale': '(*^)', 'prelude:leq': 'leq', 'prelude:show': 'show', 'prelude:showFFloat': 'showFFloat', 'prelude:append': '(++)', 'prelude:wText': 'text', 'prelude:wButton': 'button', 'prelude:wColumn': 'column', 'prelude:wProgress': 'progress', 'prelude:listOf': '[ , , ]', 'prelude:program': 'program' }
const defs = { ...Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, { id, label }])), ...Object.fromEntries(derivedDefinitions(ex.types).map((d) => [d.id, d])), ...ex.nodes }
const print = (f) => printDefinition(f, defs, ex.functionBodies)

test('applications, sections and Haskell\'s subtract', () => {
  assert.equal(print('onClick'), 'onClick m = over wallet (Wallet (perClick m) +) m')
  assert.equal(print('purchase'), 'purchase cost upgrade m = select (leq cost (wallet m)) (apply upgrade (over wallet (subtract cost) m)) m')
  assert.equal(print('buyClick'), 'buyClick m = purchase (Wallet 10) (over perClick (1 +)) m')
})

test('functions as values, zero-argument definitions', () => {
  assert.equal(print('handle'), 'handle msg = caseMsg onClick buyClick buyAuto msg')
  assert.equal(print('initial'), 'initial = Model (Wallet 0) 1 0')
  assert.equal(print('main'), 'main = program initial view handle onTick')
})

test('a value used twice is shared with where; lists print as literals', () => {
  const view = print('view')
  assert.match(view, /^view m = column \[text \("Clicks: " \+\+ showFFloat 0 cl\), /)
  assert.match(view, /progress \(cl \/ 25\)\]\n  where\n    cl = clicks \(wallet m\)$/)
})

test('a gap before an applied slot becomes a lambda', () => {
  const body = {
    'input-f-0': { id: 'input-f-0', type: 'parameter', label: 'y' },
    c: { id: 'c', type: 'function', sourceFunctionId: 'select', params: ['', '1', ''], mounted: [null, null, 'input-f-0'] },
    output: { id: 'output', type: 'output', source: 'c' },
  }
  assert.equal(printDefinition('f', { ...defs, f: { id: 'f', label: 'f' } }, { f: body }), 'f y = \\x -> select x 1 y')
})
