import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClickCounter } from '../src/examples/clickCounter.js'
import { showValue } from '../src/evaluator.js'
import { ParseError, parseValue } from '../src/valueParser.js'
import { declareTypes } from '../src/typeDecls.js'
import { tapp, tcon, tfun, tlist } from '../src/typeSystem.js'

const { types } = buildClickCounter()
const all = declareTypes(types, 'data Event = Press | Tick Double | Spend (Maybe (Sum Int)) deriving Show')
const round = (text, type) => showValue(parseValue(text, type, all), all)

test('reads back exactly what show prints', () => {
  for (const [text, type] of [
    ['Model {wallet = Wallet {clicks = 5}, perClick = 2, rate = 3, elapsed = 250}', tcon('Model')],
    ['Tick 0.5', tcon('Event')],
    ['Press', tcon('Event')],
    ['Spend (Just (Sum 3))', tcon('Event')],
    ['[1,2,3]', tlist(tcon('Int'))],
    ['"hi there"', tlist(tcon('Char'))],
    ["'x'", tcon('Char')],
    ['True', tcon('Bool')],
    ['Nothing', tapp(tcon('Maybe'), tcon('Double'))],
  ]) assert.equal(round(text, type), text)
})

test('record fields may come in any order, with spaces', () => {
  assert.equal(round('Model { elapsed = 0 , rate = 1 , perClick = 3 , wallet = Wallet { clicks = 9 } }', tcon('Model')), 'Model {wallet = Wallet {clicks = 9}, perClick = 3, rate = 1, elapsed = 0}')
  assert.equal(round('Wallet 7', tcon('Wallet')), 'Wallet {clicks = 7}', 'positional syntax works for records too')
})

test('mistakes are reported with where they are', () => {
  const bad = (text, type, re) => assert.throws(() => parseValue(text, type, all), (e) => e instanceof ParseError && re.test(e.message))
  bad('Model {wallet = Wallet {clicks = 5}, perClick = 2, elapsed = 0}', tcon('Model'), /missing rate/)
  bad('Model {wallet = Wallet {clicks = 5}, perClik = 2, rate = 0, elapsed = 0}', tcon('Model'), /no field "perClik"/)
  bad('Wallet {clicks = True}', tcon('Wallet'), /Expected a number \(Int\) at position 18/)
  bad('Jump', tcon('Event'), /constructor of Event \(Press, Tick, Spend\)/)
  bad('Spend Just (Sum 3)', tcon('Event'), /parentheses around Just/)
  bad('2.5', tcon('Int'), /whole number/)
  bad('-1', tcon('Natural'), /can't be negative/)
  bad('Press Press', tcon('Event'), /Unexpected "Press"/)
  bad('x', tfun(tcon('Int'), tcon('Int')), /function/)
})
