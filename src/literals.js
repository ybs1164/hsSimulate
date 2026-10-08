// Inline literal text typed straight into a slot ('3', '-1.5', 'true'). Both
// the type pass (inferGraph) and the evaluator treat such a slot exactly like
// one with a literal node mounted in it, so the two always agree on which
// slots of a function node are applied. Haskell literal syntax: numbers,
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
