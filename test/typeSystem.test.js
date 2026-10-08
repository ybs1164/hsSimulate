import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySubst, showType, tapp, tcon, tfun, tlist, tvar, unify, wellKinded } from '../src/typeSystem.js'
import { builtinSchemes } from '../src/builtinSchemes.js'

const a = tvar('a')
const f = tvar('f')
const Int = tcon('Int')
const Maybe = (t) => tapp(tcon('Maybe'), t)

test('applied types unify structurally, including a variable head', () => {
  const s = unify(tapp(f, a), Maybe(Int))
  assert.deepEqual(applySubst(s, f), tcon('Maybe'))
  assert.deepEqual(applySubst(s, a), Int)
  assert.throws(() => unify(Maybe(Int), tlist(Int)))
})

test('pretty printing follows GHC', () => {
  assert.equal(showType(tlist(a)), '[a]')
  assert.equal(showType(tlist(tcon('Char'))), 'String')
  assert.equal(showType(Maybe(tlist(a))), 'Maybe [a]')
  assert.equal(showType(Maybe(Maybe(a))), 'Maybe (Maybe a)')
  assert.equal(showType(Maybe(tfun(a, a))), 'Maybe (a → a)')
  assert.equal(showType(tfun(Maybe(a), a)), 'Maybe a → a')
})

test('kinds: constructors must be applied to exactly their arity', () => {
  assert.ok(wellKinded(Maybe(Int)))
  assert.ok(!wellKinded(tcon('Maybe')))
  assert.ok(!wellKinded(tapp(Int, Int)))
  assert.ok(!wellKinded(tlist(tcon('Maybe'))))
  assert.ok(wellKinded(tapp(f, a)), 'a variable head may have any kind')
})

test('every builtin scheme is well-kinded', () => {
  for (const [name, sch] of Object.entries(builtinSchemes)) assert.ok(wellKinded(sch.type), name)
})
