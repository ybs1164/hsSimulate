// The built-in inductive types beyond numbers and Bool: lists `[a]`,
// `Maybe a`, `Char` (and so `String = [Char]`) and the unit type `()` —
// their class instances (with contexts, as in Haskell's base: `instance
// Eq a => Eq [a]`) and their runtime representation.
//
// At runtime they are ordinary data values (see evaluator.js), exactly as
// if declared `data [a] = [] | a : [a]` and `data Maybe a = Nothing | Just a`:
// lazy, so infinite lists work, and folded by their recursors (`foldr`,
// `maybe`). A Char is a one-character JS string.
import { declareInstance } from './classEnv.js'
import { pred, tapp, tcon, tlist, ttuple, tvar } from './typeSystem.js'

const $a = tvar('$a')
const $b = tvar('$b')
declareInstance('Show', tcon('StdGen'))
for (const cls of ['Eq', 'Show']) declareInstance(cls, tcon('Color'))
for (const cls of ['Eq', 'Ord', 'Show']) {
  declareInstance(cls, ttuple($a, $b), [pred(cls, $a), pred(cls, $b)])
  declareInstance(cls, tcon('Char'))
  declareInstance(cls, tcon('()'))
  declareInstance(cls, tlist($a), [pred(cls, $a)])
  declareInstance(cls, tapp(tcon('Maybe'), $a), [pred(cls, $a)])
}

export const nil = { kind: 'data', type: 'List', ctor: '[]', ctorIndex: 0, args: [] }
export const cons = (head, tail) => ({ kind: 'data', type: 'List', ctor: ':', ctorIndex: 1, args: [head, tail] })
export const nothing = { kind: 'data', type: 'Maybe', ctor: 'Nothing', ctorIndex: 0, args: [] }
export const just = (x) => ({ kind: 'data', type: 'Maybe', ctor: 'Just', ctorIndex: 1, args: [x] })
export const pair = (a, b) => ({ kind: 'data', type: '(,)', ctor: '(,)', ctorIndex: 0, args: [a, b] })
export const stdGen = (seed) => ({ kind: 'data', type: 'StdGen', ctor: 'StdGen', ctorIndex: 0, args: [seed] })
