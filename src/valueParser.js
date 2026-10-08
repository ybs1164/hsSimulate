// Read a value written in Haskell syntax — exactly what `show` prints — at
// a known type, producing a runtime value (see evaluator.js). Used to edit
// a running game's model directly:
//
//   Model {wallet = Wallet {clicks = 5}, perClick = 2, rate = 0}
//   Tick 0.5        Just (Sum 3)        [1, 2, 3]        "text"        'c'
//
// Type-directed: the type decides what's acceptable (a constructor of that
// type, every field of a record, a number for a numeric type …), and every
// error says where. Functions, Endo and widgets have no written form.
import { cons, just, nil, nothing } from './dataTypes.js'
import { showType } from './typeSystem.js'

export class ParseError extends Error {}

const NUMERIC = ['Int', 'Integer', 'Word', 'Natural', 'Float', 'Double', 'Rational']
const INTEGRAL = ['Int', 'Integer', 'Word', 'Natural']

function tokenize(text) {
  const tokens = []
  const re = /\s*(?:(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)')|([A-Za-z_][A-Za-z0-9_']*)|([{}()[\],=]))/gy
  let m
  re.lastIndex = 0
  while (re.lastIndex < text.length) {
    const at = re.lastIndex
    m = re.exec(text)
    if (!m) {
      if (/^\s*$/.test(text.slice(at))) break
      throw new ParseError(`Unexpected "${text.slice(at).trim()[0]}" at position ${at + 1}`)
    }
    const [, num, str, chr, ident, sym] = m
    tokens.push({ at: at + (m[0].length - m[0].trimStart().length), kind: num ? 'num' : str ? 'str' : chr ? 'chr' : ident ? 'ident' : 'sym', text: num || str || chr || ident || sym })
  }
  return tokens
}

/** Parse `text` as a value of `type`; `types` are the project's declarations. */
export function parseValue(text, type, types = {}) {
  const tokens = tokenize(text)
  let i = 0
  const peek = () => tokens[i]
  const where = () => (peek() ? `at position ${peek().at + 1}` : 'at the end')
  const expect = (t) => {
    if (peek()?.text !== t) throw new ParseError(`Expected "${t}" ${where()}`)
    i++
  }
  const headName = (t) => (t.kind === 'app' ? headName(t.fn) : t.kind === 'con' ? t.name : null)

  // A value of `t`. `atomic`: only an atom (a constructor with arguments needs parentheses).
  function value(t, atomic = false) {
    const tok = peek()
    if (!tok) throw new ParseError(`Expected a ${showType(t)} at the end`)
    if (tok.text === '(' && !(t.kind === 'con' && t.name === '()')) {
      i++
      const v = value(t)
      expect(')')
      return v
    }
    if (t.kind === 'fun') throw new ParseError(`A function (${showType(t)}) can't be written as a value`)
    if (t.kind === 'con' && NUMERIC.includes(t.name)) {
      if (tok.kind !== 'num') throw new ParseError(`Expected a number (${t.name}) ${where()}`)
      const n = Number(tok.text)
      if (INTEGRAL.includes(t.name) && !Number.isInteger(n)) throw new ParseError(`${t.name} needs a whole number ${where()}`)
      if (['Natural', 'Word'].includes(t.name) && n < 0) throw new ParseError(`${t.name} can't be negative ${where()}`)
      i++
      return n
    }
    if (t.kind === 'con' && t.name === 'Bool') {
      if (tok.text !== 'True' && tok.text !== 'False') throw new ParseError(`Expected True or False ${where()}`)
      i++
      return tok.text === 'True'
    }
    if (t.kind === 'con' && t.name === 'Char') {
      if (tok.kind !== 'chr') throw new ParseError(`Expected a Char like 'a' ${where()}`)
      i++
      return JSON.parse(`"${tok.text.slice(1, -1).replace(/"/g, '\\"')}"`)
    }
    if (t.kind === 'con' && t.name === '()') {
      expect('(')
      expect(')')
      return { kind: 'data', type: '()', ctor: '()', ctorIndex: 0, args: [] }
    }
    const head = headName(t)
    if (head === 'List') {
      const elem = t.arg
      if (tok.kind === 'str' && elem.kind === 'con' && elem.name === 'Char') {
        i++
        return [...JSON.parse(tok.text)].reduceRight((tail, c) => cons(c, tail), nil)
      }
      expect('[')
      const items = []
      if (peek()?.text !== ']') {
        items.push(value(elem))
        while (peek()?.text === ',') { i++; items.push(value(elem)) }
      }
      expect(']')
      return items.reduceRight((tail, x) => cons(x, tail), nil)
    }
    if (head === 'Maybe') {
      if (tok.text === 'Nothing') { i++; return nothing }
      if (tok.text !== 'Just') throw new ParseError(`Expected Nothing or Just ${where()}`)
      if (atomic) throw new ParseError(`Put parentheses around Just … ${where()}`)
      i++
      return just(value(t.arg, true))
    }
    if (head === 'Sum' || head === 'Product') {
      if (tok.text !== head) throw new ParseError(`Expected ${head} ${where()}`)
      if (atomic) throw new ParseError(`Put parentheses around ${head} … ${where()}`)
      i++
      return { kind: 'data', type: head, ctor: head, ctorIndex: 0, args: [value(t.arg, true)] }
    }
    const decl = t.kind === 'con' && types[t.name]
    if (!decl) throw new ParseError(`A ${showType(t)} can't be written as a value`)
    const ctorIndex = decl.constructors.findIndex((c) => c.name === tok.text)
    if (ctorIndex < 0) throw new ParseError(`Expected a constructor of ${decl.name} (${decl.constructors.map((c) => c.name).join(', ')}) ${where()}`)
    const ctor = decl.constructors[ctorIndex]
    i++
    let args
    if (ctor.record && peek()?.text === '{') {
      i++
      const given = new Map()
      while (peek()?.text !== '}') {
        const field = peek()
        const f = ctor.fields.find((x) => x.name === field?.text)
        if (!f) throw new ParseError(`${ctor.name} has no field "${field?.text}" ${where()}`)
        if (given.has(f.name)) throw new ParseError(`Field "${f.name}" given twice ${where()}`)
        i++
        expect('=')
        given.set(f.name, value(f.type))
        if (peek()?.text === ',') i++
        else if (peek()?.text !== '}') throw new ParseError(`Expected "," or "}" ${where()}`)
      }
      i++
      const missing = ctor.fields.filter((f) => !given.has(f.name)).map((f) => f.name)
      if (missing.length) throw new ParseError(`${ctor.name} is missing ${missing.join(', ')}`)
      args = ctor.fields.map((f) => given.get(f.name))
    } else {
      if (ctor.fields.length && atomic) throw new ParseError(`Put parentheses around ${ctor.name} … ${where()}`)
      args = ctor.fields.map((f) => value(f.type, true))
    }
    return { kind: 'data', type: decl.name, ctor: ctor.name, ctorIndex, args }
  }

  const v = value(type)
  if (i < tokens.length) throw new ParseError(`Unexpected "${peek().text}" ${where()}`)
  return v
}
