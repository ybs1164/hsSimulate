// The built-in inductive types beyond numbers and Bool: lists `[a]`,
// `Maybe a`, `Either a b`, `Ordering`, `Char` (and so `String = [Char]`) and the unit type `()` —
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
const Double = tcon('Double')
const field = (...fields) => fields

// The constructors of each builtin type, in runtime order, with their field
// types — what a structural (stock) instance walks, as GHC's deriving does.
export const BUILTIN_SHAPES = {
  List: [{ name: '[]', fields: [] }, { name: ':', fields: field($a, tlist($a)) }],
  Maybe: [{ name: 'Nothing', fields: [] }, { name: 'Just', fields: field($a) }],
  '(,)': [{ name: '(,)', fields: field($a, $b) }],
  '()': [{ name: '()', fields: [] }],
  Color: [{ name: 'RGB', fields: field(Double, Double, Double) }],
  Ordering: [{ name: 'LT', fields: [] }, { name: 'EQ', fields: [] }, { name: 'GT', fields: [] }],
  Either: [{ name: 'Left', fields: field($a) }, { name: 'Right', fields: field($b) }],
  // Data.Monoid's wrappers (library.js): one record field each.
  ...Object.fromEntries(['Sum', 'Product', 'Min', 'Max', 'First', 'Last'].map((w) => [w, [{ name: w, record: true, fieldNames: [`get${w}`], fields: field($a) }]])),
  ...Object.fromEntries(['Any', 'All'].map((w) => [w, [{ name: w, record: true, fieldNames: [`get${w}`], fields: field(tcon('Bool')) }]])),
}
const stock = (type) => ({ how: 'stock', type, shape: BUILTIN_SHAPES[type] })

declareInstance('Show', tcon('StdGen'))
for (const cls of ['Eq', 'Show']) declareInstance(cls, tcon('Color'), [], stock('Color'))
for (const cls of ['Eq', 'Ord', 'Show']) {
  // Lists and pairs show in their own syntax ([1,2], (1,2), "text"): primitive.
  declareInstance(cls, ttuple($a, $b), [pred(cls, $a), pred(cls, $b)], cls === 'Show' ? undefined : stock('(,)'))
  declareInstance(cls, tcon('Char'))
  declareInstance(cls, tcon('()'), [], stock('()'))
  declareInstance(cls, tlist($a), [pred(cls, $a)], cls === 'Show' ? undefined : stock('List'))
  declareInstance(cls, tapp(tcon('Maybe'), $a), [pred(cls, $a)], stock('Maybe'))
  declareInstance(cls, tcon('Ordering'), [], stock('Ordering'))
  declareInstance(cls, tapp(tapp(tcon('Either'), $a), $b), [pred(cls, $a), pred(cls, $b)], stock('Either'))
  // The wrappers compare and show as the records they are (`Sum {getSum = 3}`), as GHC derives them.
  for (const w of ['Sum', 'Product', 'Min', 'Max', 'First', 'Last']) declareInstance(cls, tapp(tcon(w), $a), [pred(cls, $a)], stock(w))
  for (const w of ['Any', 'All']) declareInstance(cls, tcon(w), [], stock(w))
}

export const nil = { kind: 'data', type: 'List', ctor: '[]', ctorIndex: 0, args: [] }
export const cons = (head, tail) => ({ kind: 'data', type: 'List', ctor: ':', ctorIndex: 1, args: [head, tail] })
export const nothing = { kind: 'data', type: 'Maybe', ctor: 'Nothing', ctorIndex: 0, args: [] }
export const just = (x) => ({ kind: 'data', type: 'Maybe', ctor: 'Just', ctorIndex: 1, args: [x] })
export const pair = (a, b) => ({ kind: 'data', type: '(,)', ctor: '(,)', ctorIndex: 0, args: [a, b] })
export const ordering = (c) => ({ kind: 'data', type: 'Ordering', ctor: ['LT', 'EQ', 'GT'][c + 1], ctorIndex: c + 1, args: [] })
export const left = (x) => ({ kind: 'data', type: 'Either', ctor: 'Left', ctorIndex: 0, args: [x] })
export const right = (x) => ({ kind: 'data', type: 'Either', ctor: 'Right', ctorIndex: 1, args: [x] })
export const unit = { kind: 'data', type: '()', ctor: '()', ctorIndex: 0, args: [] }
export const stdGen = (seed) => ({ kind: 'data', type: 'StdGen', ctor: 'StdGen', ctorIndex: 0, args: [seed] })
