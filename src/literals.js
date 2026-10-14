// Literal text: a literal node's value ('3', '-1.5', 'True'), or — in projects
// from before slots were dots — text typed straight into a slot (the editor
// turns that into a literal node; the type pass and the evaluator still read
// it the same way, so the two always agree on which slots are applied). Haskell literal syntax: numbers,
// True/False, "text" (a String) and 'c' (a Char). Anything else — '' or a
// placeholder parameter name like 'n' — leaves the slot open (curried).
export function parseLiteral(text) {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'number', value: Number(t), text: t }
  if (t === 'true' || t === 'True') return { kind: 'bool', value: true, text: t }
  if (t === 'false' || t === 'False') return { kind: 'bool', value: false, text: t }
  if (/^"[^"]*"$/.test(t)) return { kind: 'string', value: t.slice(1, -1), text: t }
  if (/^'.'$/u.test(t)) return { kind: 'char', value: t.slice(1, -1), text: t }
  return null
}
