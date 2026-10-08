// Print a function body graph as the Haskell definition it means — the
// graph *is* a lambda term (CLAUDE.md: the function structure follows the
// lambda calculus), so this is just reading it back in Haskell syntax:
//
//   - a call with its first k slots applied is the application `f a₁ … aₖ`;
//     a call with a gap before an applied slot needs a lambda,
//     `\x -> f x b` (the gap's binder is named by the call's `holeNames`);
//     operators print infix, with sections (`(+ w)`, and Haskell's
//     `subtract c` for a right section of minus);
//   - a value used more than once (a reference node) is shared with `where`
//     — the let of the lambda calculus — unless it is a parameter; it is
//     bound under the original node's `bindName` when it has one;
//   - the `[ , , ]` node prints as a list literal.
//
// The printer works on *tokens*: every piece of text remembers the graph
// node it was read from (`{ text, id, scope, slot?, role? }`, `scope` being
// the function whose body holds the node), so the text can be linked back to
// the graph — hovering a token highlights its node, selecting a node marks
// its tokens. Joining the tokens' text gives the plain definition.
import { parseLiteral } from './literals.js'

const OPERATORS = { '(+)': '+', '(-)': '-', '(*)': '*', '(/)': '/', '(>=)': '>=', '(==)': '==', '(<>)': '<>', '(++)': '++', '(:)': ':', '(!?)': '!?', '(*^)': '*^', '(\\/)': '\\/', '(/\\)': '/\\' }
// Right-associative operators (infixr): `x : y : []` needs no parentheses on the right.
const RIGHT_ASSOC = new Set([':', '++', '<>'])
export const identifier = (s) => typeof s === 'string' && /^[a-z_][A-Za-z0-9_']*$/.test(s)

/** The plain text of a token list. */
export function tokensText(tokens) {
  return tokens.map((t) => t.text).join('')
}

/**
 * `name params = expression [where bindings]` for the custom function `fnId`.
 * `definitions` resolves callee ids to their definitions (for labels).
 */
export function printDefinition(fnId, definitions, functionBodies) {
  const tokens = printDefinitionTokens(fnId, definitions, functionBodies)
  return tokens && tokensText(tokens)
}

/** printDefinition as tokens (see the header comment), or null. */
export function printDefinitionTokens(fnId, definitions, functionBodies) {
  const def = definitions[fnId]
  const printed = printBody(fnId, definitions, functionBodies)
  if (!def || !printed) return null
  const at = (id, extra) => ({ id, scope: fnId, ...extra })
  const tokens = []
  if (def.label === '[ , , ]') { // a list literal's view: [x1, x2, x3] = …
    tokens.push({ text: '[', ...at('header', { role: 'name' }) })
    printed.params.forEach((p, i) => tokens.push(...(i ? [{ text: ', ' }] : []), { text: p.name, ...at(p.id, { role: 'param' }) }))
    tokens.push({ text: ']', ...at('header', { role: 'name' }) })
  } else {
    tokens.push({ text: def.label, ...at('header', { role: 'name' }) })
    printed.params.forEach((p) => tokens.push({ text: ' ' }, { text: p.name, ...at(p.id, { role: 'param' }) }))
  }
  tokens.push({ text: ' ' }, { text: '=', ...at('output') }, { text: ' ' }, ...printed.rhs)
  if (printed.bindings.length) {
    tokens.push({ text: '\n  ' }, { text: 'where' })
    printed.bindings.forEach((b) => tokens.push({ text: '\n    ' }, { text: b.name, ...at(b.id, { role: 'binding' }) }, { text: ' = ' }, ...b.value))
  }
  return tokens
}

/** The λ (lambda-lifted function) `fnId` as the term it is, `\x y -> e`. */
export function printLambdaText(fnId, definitions, functionBodies) {
  return tokensText(printLambda(fnId, definitions, functionBodies))
}

/** A λ node's function as a lambda term: `\x y -> e` (shared values as `let … in`). */
function printLambda(fnId, definitions, functionBodies) {
  const printed = printBody(fnId, definitions, functionBodies)
  if (!printed) return [{ text: 'undefined' }]
  const at = (id, extra) => ({ id, scope: fnId, ...extra })
  let body = printed.rhs
  if (printed.bindings.length) {
    body = [{ text: 'let ' }]
    printed.bindings.forEach((b, i) => body.push(...(i ? [{ text: '; ' }] : []), { text: b.name, ...at(b.id, { role: 'binding' }) }, { text: ' = ' }, ...b.value))
    body.push({ text: ' in ' }, ...printed.rhs)
  }
  if (!printed.params.length) return body
  const head = [{ text: '\\', ...at('header', { role: 'name' }) }]
  printed.params.forEach((p, i) => head.push(...(i ? [{ text: ' ' }] : []), { text: p.name, ...at(p.id, { role: 'param' }) }))
  return [...head, { text: ' ' }, { text: '->', ...at('output') }, { text: ' ' }, ...body]
}

/** The pieces of a function body: parameters, the right-hand side, and shared bindings — each as tokens. */
function printBody(fnId, definitions, functionBodies) {
  const body = functionBodies[fnId]
  if (!body) return null
  const at = (id, extra) => ({ id, scope: fnId, ...extra })
  const tok = (text, id, extra) => (id ? { text, ...at(id, extra) } : { text })
  const params = Object.values(body).filter((n) => n.type === 'parameter')
  const shared = new Map() // node id -> where-bound name
  const bindings = []
  const used = new Set(params.map((p) => p.label))
  let fresh = 0
  const freshName = (...bases) => {
    let name = bases.find((base) => identifier(base) && !used.has(base)) || null
    while (!name) { const c = `x${++fresh}`; if (!used.has(c)) name = c }
    used.add(name)
    return name
  }
  const refCount = new Map()
  Object.values(body).forEach((n) => { if (n.type === 'ref') refCount.set(n.target, (refCount.get(n.target) || 0) + 1) })
  // A shared value's chosen name is claimed up front, so a hole can't take
  // it first; a name clashing with a parameter or another binding falls back.
  const claimed = new Map()
  Object.values(body).forEach((n) => {
    if (refCount.get(n.id) && n.type !== 'parameter' && identifier(n.bindName) && !used.has(n.bindName)) { claimed.set(n.id, n.bindName); used.add(n.bindName) }
  })

  // Each printer returns { tokens, prec }: 3 atom, 2 application, 1 infix,
  // 0 lambda. Application binds tighter than any operator, so an argument
  // needs parentheses below 3 and an operator's operand below 2.
  const atom = (tokens) => ({ tokens, prec: 3 })
  const app = (tokens) => ({ tokens, prec: 2 })
  const infix = (tokens, op = null) => ({ tokens, prec: 1, op })
  const lambda = (tokens) => ({ tokens, prec: 0 })
  const paren = (e) => (e.prec === 3 ? e.tokens : [{ text: '(' }, ...e.tokens, { text: ')' }])
  const operand = (e) => (e.prec >= 2 ? e.tokens : [{ text: '(' }, ...e.tokens, { text: ')' }])
  const spaced = (list) => list.flatMap((tokens, i) => (i ? [{ text: ' ' }, ...tokens] : tokens))

  // `via`: the node actually standing here (a reference stands for its target).
  function expr(id, via = id) {
    const n = body[id]
    if (!n) return atom([{ text: 'undefined' }])
    if (n.type === 'ref') return expr(n.target, via)
    if (n.type === 'parameter') return atom([tok(n.label, via, { role: 'param' })])
    if (refCount.get(id)) {
      if (!shared.has(id)) {
        const name = claimed.get(id) ?? freshName(id)
        shared.set(id, name)
        const binding = { name, id, value: null }
        bindings.push(binding)
        binding.value = print(n).tokens
      }
      return atom([tok(shared.get(id), via, { role: 'binding' })])
    }
    return print(n)
  }

  function literal(textValue, id, extra) {
    const t = textValue.trim()
    const shown = t === 'true' || t === 'True' ? 'True' : t === 'false' || t === 'False' ? 'False' : t
    const token = [tok(shown, id, { role: 'literal', ...extra })]
    return shown.startsWith('-') ? infix(token) : atom(token)
  }

  function print(n) {
    if (n.type === 'number') return literal(String(n.value ?? '0'), n.id)
    if (n.type === 'boolean') return atom([tok(n.value === 'true' ? 'True' : 'False', n.id, { role: 'literal' })])
    if (n.type === 'text') return atom([tok(JSON.stringify(String(n.value ?? '')), n.id, { role: 'literal' })])
    if (n.type === 'output') return n.source ? expr(n.source) : atom([{ text: 'undefined' }])
    if (n.type !== 'function') return atom([tok(n.label || '?', n.id)])
    const callee = definitions[n.sourceFunctionId || n.id]
    // A λ node is a call to its (lambda-lifted) function: print the lambda
    // itself, applied to whatever its slots capture — a β-redex.
    const labelText = callee?.label || n.label
    const head = callee?.lambda ? [tok('(', n.id, { role: 'call' }), ...printLambda(callee.id, definitions, functionBodies), tok(')', n.id, { role: 'call' })] : null
    const holes = []
    const args = (n.params || []).map((textValue, i) => {
      const mounted = n.mounted?.[i]
      if (mounted && body[mounted]) return expr(mounted)
      if (parseLiteral(textValue)) return literal(textValue, n.id, { slot: i })
      return null
    })
    // Trailing open slots are just partial application; earlier gaps need a lambda.
    let last = args.length - 1
    while (last >= 0 && args[last] === null) last--
    const applied = args.slice(0, last + 1).map((a, i) => {
      if (a) return a
      const x = freshName(n.holeNames?.[i], 'x')
      holes.push({ name: x, slot: i })
      return atom([tok(x, n.id, { role: 'hole', slot: i })])
    })
    const callTok = (t) => tok(t, n.id, { role: 'call' })
    let e
    if (labelText === '(,)' && applied.length === 2 && !head) e = atom([callTok('('), ...applied[0].tokens, callTok(', '), ...applied[1].tokens, callTok(')')])
    else if (labelText === '[ , , ]' && !head) e = atom([callTok('['), ...applied.flatMap((a, i) => (i ? [callTok(', '), ...a.tokens] : a.tokens)), callTok(']')])
    else if (OPERATORS[labelText] && !head) {
      const op = OPERATORS[labelText]
      const [a, b] = applied
      if (a && b) e = infix([...operand(a), { text: ' ' }, callTok(op), { text: ' ' }, ...(RIGHT_ASSOC.has(op) && b.op === op ? b.tokens : operand(b))], op)
      else if (a) e = atom([{ text: '(' }, ...operand(a), { text: ' ' }, callTok(op), { text: ')' }])
      else e = atom([callTok(labelText)])
    } else {
      const fn = head || [callTok(labelText)]
      if (!applied.length) e = !head && /\s/.test(labelText) ? app(fn) : atom(fn)
      else e = app(spaced([fn, ...applied.map(paren)]))
    }
    // A gap only in the first operand is a right section — `\x -> x - c` is Haskell's own `subtract c`.
    if (OPERATORS[labelText] && !head && holes.length === 1 && applied.length === 2 && holes[0].slot === 0) {
      return labelText === '(-)'
        ? app([callTok('subtract'), { text: ' ' }, ...paren(applied[1])])
        : atom([{ text: '(' }, callTok(OPERATORS[labelText]), { text: ' ' }, ...operand(applied[1]), { text: ')' }])
    }
    if (!holes.length) return e
    const binders = holes.flatMap((h, i) => [...(i ? [{ text: ' ' }] : []), tok(h.name, n.id, { role: 'hole', slot: h.slot })])
    return lambda([tok('\\', n.id, { role: 'call' }), ...binders, { text: ' -> ' }, ...e.tokens])
  }

  const output = body.output
  const rhs = output?.source ? expr(output.source).tokens : [{ text: 'undefined' }]
  return { params: params.map((p) => ({ name: p.label, id: p.id })), rhs, bindings }
}

/** A type as Haskell source (ASCII arrows). */
export function asciiType(text) {
  return text.replaceAll('→', '->').replaceAll('⇒', '=>')
}
