// Grading for the practice exercises (exerciseContent.js). Three kinds:
//
//   type   — write the type of an expression. The answer is parsed as a
//            Haskell qualified type (`Num a => a -> a -> a`) and compared
//            with the expected one *as types*, not as text: up to renaming
//            of variables, and with constraints compared by entailment
//            (so `Num a` and the engine's structural `Ring a` agree).
//   choice — pick one of several expressions (e.g. the one that doesn't
//            type-check).
//   build  — define a function on the canvas. It is graded the way GHC
//            checks a definition against a signature: the signature the
//            learner wrote (parameter and Output annotations) must be the
//            asked one, the body must type-check, its inferred type must
//            subsume the asked one (unify with the asked type's variables
//            held rigid, then the asked context must entail what's left),
//            and only then are the test cases run.
import { canonicalClass, classLabel } from './classGroups.js'
import { entails } from './prelude.js'
import { annotationType } from './typeExpr.js'
import { DeclError, parseContext } from './typeDecls.js'
import { applySubst, createNamer, instantiate, pred, showType, tcon, unify } from './typeSystem.js'
import { inferGraph } from './inferGraph.js'
import { createTypedEvaluator } from './typedEvaluator.js'
import { EvalError, showValue } from './evaluator.js'
import { parseLiteral } from './literals.js'
import { call } from './examples/build.js'
import { reduce } from './prelude.js'

/** A grading failure the learner should read (bad syntax in an answer, a missing function). */
export class GradeError extends Error {}

// ---- Qualified types ---------------------------------------------------------

/** `Num a => a -> a` (also with ⇒, →, ▸) as `{ preds, type }`; throws GradeError if it isn't a type. */
export function parseQualType(text) {
  const clean = String(text).replace(/⇒/g, '=>').replace(/[→▸]/g, '->').replace(/::/g, ' ').trim()
  if (!clean) throw new GradeError('타입을 입력하세요.')
  const at = clean.indexOf('=>')
  const contextText = at < 0 ? '' : clean.slice(0, at)
  const typeText = at < 0 ? clean : clean.slice(at + 2)
  const names = new Map()
  let type, context
  try {
    type = annotationType(typeText, names)
    context = parseContext(contextText)
  } catch (e) {
    if (e instanceof DeclError) throw new GradeError(`타입으로 읽을 수 없어요: ${e.message}`)
    throw e
  }
  const preds = context.map(({ cls, var: v }) => {
    if (!names.has(v)) throw new GradeError(`제약의 변수 ${v}가 타입에 나오지 않아요.`)
    return pred(canonicalClass(cls), names.get(v))
  })
  return { preds, type }
}

/** Haskell text for a qualified type, under the Haskell class names (`Num`, not `Ring`). */
export function showQualHs(preds, type) {
  const namer = createNamer()
  const body = showType(type, namer).replace(/→/g, '->')
  if (!preds.length) return body
  const parts = preds.map((p) => `${classLabel(p.cls)} ${showType(p.type, namer)}`)
  return `${parts.length > 1 ? `(${parts.join(', ')})` : parts[0]} => ${body}`
}

// A bijective renaming of t1's variables onto t2's that makes them equal, or null.
function alphaMatch(t1, t2, map = new Map(), back = new Map()) {
  if (t1.kind !== t2.kind) return null
  if (t1.kind === 'var') {
    if ((map.has(t1.id) && map.get(t1.id) !== t2.id) || (back.has(t2.id) && back.get(t2.id) !== t1.id)) return null
    map.set(t1.id, t2.id); back.set(t2.id, t1.id)
    return map
  }
  if (t1.kind === 'con') return t1.name === t2.name ? map : null
  if (t1.kind === 'fun') return alphaMatch(t1.from, t2.from, map, back) && alphaMatch(t1.to, t2.to, map, back)
  return alphaMatch(t1.fn, t2.fn, map, back) && alphaMatch(t1.arg, t2.arg, map, back)
}
const renameVars = (t, map) => (t.kind === 'var' ? { kind: 'var', id: map.get(t.id) ?? t.id } : t.kind === 'con' ? t : t.kind === 'fun' ? { kind: 'fun', from: renameVars(t.from, map), to: renameVars(t.to, map) } : { kind: 'app', fn: renameVars(t.fn, map), arg: renameVars(t.arg, map) })
const arity = (t) => (t.kind === 'fun' ? 1 + arity(t.to) : 0)

/**
 * Compare a written qualified type with an expected one: `{ ok, reason }`.
 * Equal means the same shape up to renaming, and constraints that entail
 * each other (`Num a` covers `Ring a`; `(Ord a, Eq a)` is `Ord a`).
 */
export function compareQual(answer, expected) {
  const map = alphaMatch(answer.type, expected.type)
  if (!map) {
    const [n, m] = [arity(answer.type), arity(expected.type)]
    if (n !== m) return { ok: false, reason: `인자 개수가 달라요: 쓴 타입은 화살표(->)가 ${n}개, 정답은 ${m}개예요.` }
    return { ok: false, reason: '타입의 모양이 달라요. 각 자리(인자와 결과)의 타입을 다시 확인해 보세요.' }
  }
  const mine = answer.preds.map((p) => pred(p.cls, renameVars(p.type, map)))
  const missing = expected.preds.filter((p) => !entails(mine, p))
  if (missing.length) return { ok: false, reason: `타입의 모양은 맞지만 제약이 부족해요: ${missing.map((p) => `${classLabel(p.cls)} 제약`).join(', ')}이 필요해요.` }
  const extra = mine.filter((p) => !entails(expected.preds, p))
  if (extra.length) return { ok: false, reason: `필요 없는 제약이 있어요: ${extra.map((p) => classLabel(p.cls)).join(', ')}. 정답보다 덜 일반적인 타입이에요.` }
  return { ok: true, reason: '' }
}

// ---- type / choice -----------------------------------------------------------

/** Every type that counts as right for a `type` exercise: its `answer`, each of `accept`, and the app's own scheme for `engine`. */
export function acceptedTypes(exercise, schemeOf = () => null) {
  const out = [exercise.answer, ...(exercise.accept || [])].map((text) => ({ text, ...parseQualType(text) }))
  const sch = exercise.engine && schemeOf(exercise.engine)
  if (sch) {
    const { preds, type } = instantiate(sch)
    out.push({ text: showQualHs(preds, type), preds, type, engine: true })
  }
  return out
}

/** Grade an answer to a `type` exercise: `{ ok, message }`. */
export function gradeTypeAnswer(exercise, text, schemeOf) {
  let answer
  try { answer = parseQualType(text) } catch (e) {
    if (e instanceof GradeError) return { ok: false, message: e.message }
    throw e
  }
  const accepted = acceptedTypes(exercise, schemeOf)
  const hit = accepted.find((t) => compareQual(answer, t).ok)
  if (hit) return { ok: true, message: `정답이에요! ${exercise.expr} :: ${exercise.answer}${hit.engine ? ` (이 앱의 더 세밀한 타입 ${hit.text}도 맞아요)` : ''}` }
  return { ok: false, message: compareQual(answer, accepted[0]).reason }
}

/** Grade a pick in a `choice` exercise: `{ ok, message }`. */
export function gradeChoice(exercise, index) {
  if (index === null || index === undefined || index < 0) return { ok: false, message: '보기 하나를 고르세요.' }
  const option = exercise.options[index]
  return option.correct ? { ok: true, message: `정답이에요! ${option.why || ''}`.trim() } : { ok: false, message: option.why || '다시 생각해 보세요.' }
}

// ---- build -------------------------------------------------------------------

/** The custom function named `name` among the project's top-level nodes, or null. */
export function findExerciseFunction(userNodes, name) {
  return Object.values(userNodes).find((n) => n?.type === 'function' && n.custom && !n.sourceFunctionId && !n.lambda && n.label === name) || null
}

// The signature written on a body: each parameter's annotation (in the
// function's parameter order), the Output's, and the Output's pinned context.
// `{ written: false, missing }` if some piece is still left to inference.
function writtenSignature(fn, body) {
  const params = Object.values(body).filter((x) => x.type === 'parameter')
  const ordered = fn.params.map((label) => params.find((p) => p.label === label))
  const output = Object.values(body).find((x) => x.type === 'output')
  const owners = [...ordered, output]
  const missing = owners.map((o, i) => (o?.annotation && o.annotation.trim() !== '_' ? null : i < ordered.length ? fn.params[i] : '결과')).filter(Boolean)
  if (missing.length) return { written: false, missing }
  const text = owners.map((o) => (/->/.test(o.annotation) ? `(${o.annotation})` : o.annotation)).join(' -> ')
  const context = (output.context || []).map((q) => `${q.cls} ${q.var}`).join(', ')
  try {
    return { written: true, ...parseQualType(context ? `(${context}) => ${text}` : text) }
  } catch (e) {
    if (e instanceof GradeError) return { written: false, missing: [], problem: e.message }
    throw e
  }
}

// Whether a function of type `sch` can be used at the expected type (GHC's
// subsumption check): `{ ok, reason }`.
function subsumes(sch, expected) {
  const rigid = new Map()
  const skolem = (t) => (t.kind === 'var' ? (rigid.has(t.id) || rigid.set(t.id, tcon(`‹${t.id}›`)), rigid.get(t.id)) : t.kind === 'con' ? t : t.kind === 'fun' ? { kind: 'fun', from: skolem(t.from), to: skolem(t.to) } : { kind: 'app', fn: skolem(t.fn), arg: skolem(t.arg) })
  const want = skolem(expected.type)
  const given = expected.preds.map((p) => pred(p.cls, skolem(p.type)))
  const { preds, type } = instantiate(sch)
  let subst
  try { subst = unify(type, want) } catch { return { ok: false, reason: '함수의 타입이 요구된 타입과 맞지 않아요.' } }
  const needed = preds.map((p) => pred(p.cls, applySubst(subst, p.type)))
  const unmet = needed.filter((p) => !entails(given, p))
  if (unmet.length) return { ok: false, reason: `요구된 타입에서는 ${unmet.map((p) => classLabel(p.cls)).join(', ')} 인스턴스를 보장할 수 없어요.` }
  return { ok: true, reason: '' }
}

// The type errors inside a function's body, as messages.
function bodyErrors(registry, bodies, fnId) {
  const body = bodies[fnId]
  const pass = inferGraph(registry, bodies, body)
  const out = []
  if (pass.brokenEdges.length) out.push(`연결 ${pass.brokenEdges.length}곳의 타입이 맞지 않아요.`)
  for (const [id, entry] of pass.perNode) {
    if (entry.error) out.push(entry.error)
    else if (entry.invalidSlots?.length && body[id]) out.push(`${body[id].label ?? id}의 슬롯에 맞지 않는 값이 있어요.`)
  }
  for (const [id, problem] of Object.entries(pass.annotations.here || {})) if (problem && id !== 'context') out.push(`${body[id]?.label ?? id}에 단 타입: ${problem}`)
  if (pass.annotations.here?.context) out.push(pass.annotations.here.context)
  for (const p of pass.preds) { try { reduce([p]) } catch (e) { out.push(e.message) } }
  return out
}

// ---- Test-case values --------------------------------------------------------

// Split `a, [b, c], "d,e"` at its top-level commas.
function splitTop(text) {
  const parts = []
  let depth = 0, quote = null, start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) { if (ch === quote && text[i - 1] !== '\\') quote = null; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map((s) => s.trim())
}

/**
 * The slot for a test-case argument written as a Haskell value: inline
 * literal text (`3`, `True`, `"hi"`), or `{ node }` for a list, whose nodes
 * are added to `graph`.
 */
export function argumentSlot(text, graph, prefix) {
  const t = text.trim()
  if (/^\[.*\]$/s.test(t)) {
    const inner = t.slice(1, -1).trim()
    const id = `${prefix}`
    if (!inner) { graph[id] = call(id, 'prelude:nil', '[]', []); return { node: id } }
    const slots = splitTop(inner).map((item, i) => argumentSlot(item, graph, `${prefix}.${i}`))
    graph[id] = call(id, 'prelude:listOf', '[ , , ]', slots)
    return { node: id }
  }
  if (!parseLiteral(t)) throw new GradeError(`테스트 값 ${t}를 읽을 수 없어요.`)
  return t
}

// Shown values compared without the spaces outside of quotes.
const normalize = (s) => String(s).replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\s+/g, (m, q) => q || '')

/**
 * Grade a `build` exercise against the project. `project` is
 * `{ registry, functionBodies, userNodes, types, classes, instances }`:
 * `registry` looks up every definition by id, `userNodes` is the top-level graph.
 * Returns `{ ok, fnId, checks: [{ id, label, ok, detail }], skipped }`, where
 * `skipped` counts the test cases a failed earlier check kept from running.
 */
export function gradeBuild(exercise, project) {
  const { registry, functionBodies, userNodes } = project
  const checks = []
  const add = (id, label, ok, detail = '') => { checks.push({ id, label, ok, detail }); return ok }
  const expected = parseQualType(exercise.signature)
  const fn = findExerciseFunction(userNodes, exercise.name)
  const testsRan = () => checks.some((c) => c.id.startsWith('test'))
  const done = () => ({ ok: checks.every((c) => c.ok), fnId: fn?.id ?? null, checks, skipped: testsRan() ? 0 : exercise.tests.length })

  if (!add('exists', `함수 ${exercise.name} 만들기`, !!fn && !!functionBodies[fn.id], fn ? '' : `${exercise.name}이라는 이름의 커스텀 함수가 없어요. "함수 만들기"를 눌러 시작하세요.`)) return done()
  const wantArity = arity(expected.type)
  if (!add('arity', `매개변수 ${wantArity}개`, fn.params.length === wantArity, fn.params.length === wantArity ? fn.params.join(', ') : `매개변수가 ${fn.params.length}개예요. 이 함수는 ${wantArity}개를 받아야 해요.`)) return done()

  // An Output with nothing wired in has no body to check: an empty body
  // would infer `a -> b`, which fits every signature.
  const output = Object.values(functionBodies[fn.id]).find((x) => x?.type === 'output')
  const wired = !!(output?.source && functionBodies[fn.id][output.source])
  if (!add('body', '본체 연결', wired, wired ? '' : '아직 Output에 연결된 블록이 없어요. 블록을 놓고 그 결과를 Output에 이으세요.')) return done()

  const sig = writtenSignature(fn, functionBodies[fn.id])
  const sigOk = sig.written && compareQual(sig, expected).ok
  add('signature', `시그니처 ${exercise.name} :: ${exercise.signature}`, sigOk,
    sig.problem || (!sig.written ? `아직 타입을 적지 않은 자리: ${sig.missing.join(', ')}. 함수 본체 위쪽 시그니처 줄의 각 자리에 사이드바의 타입 목록에서 타입을 끌어다 놓으세요.`
      : sigOk ? '' : `적은 시그니처 ${showQualHs(sig.preds, sig.type)} — ${compareQual(sig, expected).reason}`))

  const errors = bodyErrors(registry, functionBodies, fn.id)
  if (!add('typecheck', '본체 타입 검사', !errors.length, errors.slice(0, 3).join(' / '))) return done()

  const probe = { probe: { id: 'probe', type: 'function', sourceFunctionId: fn.id, params: [], mounted: [] } }
  const pass = inferGraph(registry, functionBodies, probe)
  const ambiguous = pass.ambiguities.functions[fn.id]
  if (ambiguous?.length && !add('ambiguity', '모호한 타입 없음', false, ambiguous[0].message)) return done()
  const sch = pass.schemes.get(fn.id)
  const inferred = sch ? instantiate(sch) : null
  const fits = sch ? subsumes(sch, expected) : { ok: false, reason: '타입을 추론하지 못했어요.' }
  if (!add('type', '추론된 타입이 요구된 타입과 맞음', fits.ok, `추론: ${inferred ? showQualHs(inferred.preds, inferred.type) : '?'}${fits.ok ? '' : ` — ${fits.reason}`}`)) return done()

  const ev = createTypedEvaluator({ nodes: registry, functionBodies, types: project.types || {}, classes: project.classes || {}, instances: project.instances || {} })
  exercise.tests.forEach((test, i) => {
    const label = `${exercise.name} ${test.args.map((a) => (/\s/.test(a.trim()) && !/^[[("']/.test(a.trim()) ? `(${a})` : a)).join(' ')} == ${test.expect}`
    let shown
    try {
      const graph = {}
      const slots = test.args.map((a, j) => argumentSlot(a, graph, `arg${j}`))
      graph.out = call('out', fn.id, fn.label, slots)
      // Shown through the Prelude's show, at the result's type (a Double prints as 15.0).
      graph.shown = call('shown', 'prelude:show', 'show', [{ node: 'out' }])
      shown = JSON.parse(showValue(ev.run(graph, 'shown')))
    } catch (e) {
      if (e instanceof EvalError || e instanceof GradeError || e instanceof RangeError) return add(`test${i}`, label, false, `실행 오류: ${e.message}`)
      throw e
    }
    add(`test${i}`, label, normalize(shown) === normalize(test.expect), normalize(shown) === normalize(test.expect) ? '' : `결과가 ${shown}이에요.`)
  })
  return done()
}
