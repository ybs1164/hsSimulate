// Print a function body graph as the Haskell definition it means — the
// graph *is* a lambda term (CLAUDE.md: the function structure follows the
// lambda calculus), so this is just reading it back in Haskell syntax:
//
//   - a call with its first k slots applied is the application `f a₁ … aₖ`;
//     a call with a gap before an applied slot needs a lambda,
//     `\x -> f x b`; operators print infix, with sections (`(+ w)`, and
//     Haskell's `subtract c` for a right section of minus);
//   - a value used more than once (a reference node) is shared with `where`
//     — the let of the lambda calculus — unless it is a parameter;
//   - the `[ , , ]` node prints as a list literal.
const OPERATORS = { '(+)': '+', '(-)': '-', '(*)': '*', '(/)': '/', '(>=)': '>=', '(==)': '==', '(<>)': '<>', '(++)': '++', '(:)': ':', '(!?)': '!?', '(*^)': '*^', '(\\/)': '\\/', '(/\\)': '/\\' }
const identifier = (s) => /^[a-z_][A-Za-z0-9_']*$/.test(s)

/**
 * `name params = expression [where bindings]` for the custom function `fnId`.
 * `definitions` resolves callee ids to their definitions (for labels).
 */
export function printDefinition(fnId, definitions, functionBodies) {
  const def = definitions[fnId]
  const body = functionBodies[fnId]
  if (!def || !body) return null
  const params = Object.values(body).filter((n) => n.type === 'parameter')
  const shared = new Map() // node id -> where-bound name
  const bindings = []
  const used = new Set(params.map((p) => p.label))
  let fresh = 0
  const freshName = (base) => {
    let name = identifier(base) && !used.has(base) ? base : null
    while (!name) { const c = `x${++fresh}`; if (!used.has(c)) name = c }
    used.add(name)
    return name
  }
  const refCount = new Map()
  Object.values(body).forEach((n) => { if (n.type === 'ref') refCount.set(n.target, (refCount.get(n.target) || 0) + 1) })

  // Each printer returns { text, prec }: 3 atom, 2 application, 1 infix,
  // 0 lambda. Application binds tighter than any operator, so an argument
  // needs parentheses below 3 and an operator's operand below 2.
  const atom = (text) => ({ text, prec: 3 })
  const app = (text) => ({ text, prec: 2 })
  const infix = (text) => ({ text, prec: 1 })
  const lambda = (text) => ({ text, prec: 0 })
  const paren = (e) => (e.prec === 3 ? e.text : `(${e.text})`)
  const operand = (e) => (e.prec >= 2 ? e.text : `(${e.text})`)

  function expr(id) {
    const n = body[id]
    if (!n) return atom('undefined')
    if (n.type === 'ref') return expr(n.target)
    if (n.type === 'parameter') return atom(n.label)
    if (refCount.get(id) && n.type !== 'parameter') {
      if (!shared.has(id)) {
        const name = freshName(id)
        shared.set(id, name)
        bindings.push({ name, value: print(n) })
      }
      return atom(shared.get(id))
    }
    return print(n)
  }

  function literal(text) {
    const t = text.trim()
    if (t === 'true' || t === 'True') return atom('True')
    if (t === 'false' || t === 'False') return atom('False')
    return t.startsWith('-') ? infix(t) : atom(t)
  }

  function print(n) {
    if (n.type === 'number') return literal(String(n.value ?? '0'))
    if (n.type === 'boolean') return atom(n.value === 'true' ? 'True' : 'False')
    if (n.type === 'text') return atom(JSON.stringify(String(n.value ?? '')))
    if (n.type === 'output') return n.source ? expr(n.source) : atom('undefined')
    if (n.type !== 'function') return atom(n.label || '?')
    const callee = definitions[n.sourceFunctionId || n.id]
    const label = callee?.label || n.label
    const holes = []
    const args = (n.params || []).map((text, i) => {
      const mounted = n.mounted?.[i]
      if (mounted && body[mounted]) return expr(mounted)
      if (/^\s*(-?\d+(\.\d+)?|true|false|True|False|"[^"]*"|'.')\s*$/.test(text || '')) return literal(text)
      return null
    })
    // Trailing open slots are just partial application; earlier gaps need a lambda.
    let last = args.length - 1
    while (last >= 0 && args[last] === null) last--
    const applied = args.slice(0, last + 1).map((a) => {
      if (a) return a
      const x = freshName('x')
      holes.push(x)
      return atom(x)
    })
    let e
    if (label === '[ , , ]') e = atom(`[${applied.map((a) => a.text).join(', ')}]`)
    else if (OPERATORS[label]) {
      const op = OPERATORS[label]
      const [a, b] = applied
      if (a && b) e = infix(`${operand(a)} ${op} ${operand(b)}`)
      else if (a) e = atom(`(${operand(a)} ${op})`)
      else e = atom(label)
    } else if (!applied.length) e = /\s/.test(label) ? app(label) : atom(label)
    else e = app(`${label} ${applied.map(paren).join(' ')}`)
    // A gap only in the first operand is a right section — `\x -> x - c` is Haskell's own `subtract c`.
    if (OPERATORS[label] && holes.length === 1 && applied.length === 2 && applied[0].text === holes[0]) {
      return label === '(-)' ? app(`subtract ${paren(applied[1])}`) : atom(`(${OPERATORS[label]} ${operand(applied[1])})`)
    }
    return holes.length ? lambda(`\\${holes.join(' ')} -> ${e.text}`) : e
  }

  const output = body.output
  const rhs = output?.source ? expr(output.source).text : 'undefined'
  const lhs = [def.label, ...params.map((p) => p.label)].join(' ')
  const where = bindings.length ? `\n  where\n${bindings.map((b) => `    ${b.name} = ${b.value.text}`).join('\n')}` : ''
  return `${lhs} = ${rhs}${where}`
}

/** A type as Haskell source (ASCII arrows). */
export function asciiType(text) {
  return text.replaceAll('→', '->').replaceAll('⇒', '=>')
}
