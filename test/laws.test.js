import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvaluator } from '../src/evaluator.js'
import { checkClassLaws, checkFunctionLaw, lawfulClassesOf } from '../src/laws.js'
import { setDynamicInstances } from '../src/prelude.js'
import { declareTypes, derivedDefinitions, derivedInstances } from '../src/typeDecls.js'
import { tapp, tcon, tfun, tlist } from '../src/typeSystem.js'

const types = declareTypes({}, `
data Wallet = Wallet { clicks :: Double, gems :: Double } deriving stock (Eq, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, VectorSpace, PartialOrd, Lattice)
data Modifier = Modifier { bonus :: Sum Double, mult :: Product Double } deriving (Semigroup, Monoid) via Generically Modifier
data Flags = Flags { first :: Bool, hundred :: Bool } deriving stock (Eq, Show) deriving anyclass (PartialOrd, Lattice)
`)
const BUILTINS = ['plus', 'negate', 'times', 'compose', 'identity']
const derived = Object.fromEntries(derivedDefinitions(types).map((d) => [d.id, d]))
const nodes = { ...Object.fromEntries(BUILTINS.map((b) => [b, { id: b, builtin: b, label: b }])), ...derived }
const ctx = { ev: createEvaluator({ nodes, functionBodies: {}, types }), types }
const Double = tcon('Double')
const allOk = (r) => r.results.length > 0 && r.results.every((x) => x.ok)
const failing = (r) => r.results.filter((x) => !x.ok).map((x) => `${x.cls}: ${x.law} @ ${x.counterexample}`)

test('builtin instances satisfy their laws', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    for (const [cls, type] of [['Ring', Double], ['Lattice', Double], ['VectorSpace', Double], ['Lattice', tcon('Bool')], ['Monoid', tlist(tcon('Int'))], ['Monoid', tapp(tcon('Sum'), Double)], ['Monoid', tapp(tcon('Product'), tcon('Int'))], ['Monoid', tapp(tcon('Maybe'), tlist(tcon('Int')))], ['Monoid', tapp(tcon('Endo'), Double)]]) {
      const r = checkClassLaws(cls, type, ctx)
      assert.ok(allOk(r), `${cls} ${JSON.stringify(type)}: ${failing(r).join('; ') || r.skipped}`)
    }
  } finally {
    setDynamicInstances([])
  }
})

test('derived product instances satisfy their laws (products of models are models)', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    assert.deepEqual(lawfulClassesOf(tcon('Wallet')).sort(), ['Lattice', 'VectorSpace'], 'most specific only — VectorSpace covers AddAbelianGroup')
    for (const cls of ['AddAbelianGroup', 'VectorSpace', 'Lattice']) assert.ok(allOk(checkClassLaws(cls, tcon('Wallet'), ctx)), cls)
    assert.ok(allOk(checkClassLaws('Monoid', tcon('Modifier'), ctx)))
    assert.ok(allOk(checkClassLaws('Lattice', tcon('Flags'), ctx)))
  } finally {
    setDynamicInstances([])
  }
})

test('the checker finds counterexamples: a product is not totally ordered', () => {
  // leq on Wallet is a partial order — so "x ≤ y or y ≤ x" fails, which is why Wallet gets no Ord.
  const a = { kind: 'data', type: 'Wallet', ctor: 'Wallet', ctorIndex: 0, args: [1, 5] }
  const b = { kind: 'data', type: 'Wallet', ctor: 'Wallet', ctorIndex: 0, args: [5, 1] }
  assert.equal(ctx.ev.invokeBuiltin('leq', [a, b]), false)
  assert.equal(ctx.ev.invokeBuiltin('leq', [b, a]), false)
})

const closure = (callee, args) => ({ kind: 'closure', callee, args })

test('homomorphism: scaling is one, adding a constant is not', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    const DD = tfun(Double, Double)
    assert.ok(checkFunctionLaw('homomorphism', closure('times', [3, null]), DD, ctx).ok)
    const bad = checkFunctionLaw('homomorphism', closure('plus', [1, null]), DD, ctx)
    assert.equal(bad.ok, false)
    assert.match(bad.counterexample, /f 0 = 1/)
    // Wallet → Wallet scaling by a scalar is linear
    assert.ok(checkFunctionLaw('homomorphism', closure('scale', [2, null]), tfun(tcon('Wallet'), tcon('Wallet')), { ...ctx, ev: createEvaluator({ nodes: { ...nodes, scale: { id: 'scale', builtin: 'scale' } }, functionBodies: {}, types }) }).ok)
  } finally {
    setDynamicInstances([])
  }
})

test('inflationary: joining in flags only ever adds achievements', () => {
  setDynamicInstances(derivedInstances(types))
  try {
    const ev = createEvaluator({ nodes: { ...nodes, join: { id: 'join', builtin: 'join' }, leq: { id: 'leq', builtin: 'leq' } }, functionBodies: {}, types })
    const unlockFirst = { kind: 'data', type: 'Flags', ctor: 'Flags', ctorIndex: 0, args: [true, false] }
    const FF = tfun(tcon('Flags'), tcon('Flags'))
    assert.ok(checkFunctionLaw('inflationary', closure('join', [unlockFirst, null]), FF, { ev, types }).ok)
    const setFirstFalse = closure(Object.values(derived).find((d) => d.label === 'set first').id, [false, null])
    const r = checkFunctionLaw('inflationary', setFirstFalse, FF, { ev, types })
    assert.equal(r.ok, false, 'clearing an achievement is not inflationary')
  } finally {
    setDynamicInstances([])
  }
})
