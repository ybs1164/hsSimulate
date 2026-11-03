// A deliberately small Haskell front end. Offsets are UTF-16, end-exclusive.
export class SourceError extends Error {
  constructor(stage, message, source, span = { start: 0, end: 0 }) {
    const location = sourceLocation(source, span.start)
    super(`${location.line}행 ${location.column}열 · ${message}`)
    Object.assign(this, { stage, span, ...location })
  }
}
export function sourceLocation(source, offset) {
  const before = source.slice(0, offset).split('\n')
  return { line: before.length, column: before.at(-1).length + 1 }
}
const reserved = new Set('module import qualified as hiding data newtype type class instance deriving case of let in where do infix infixl infixr foreign default'.split(' '))
export const SOURCE_OPERATORS = { '||': 2, '&&': 3, '==': 4, '/=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 6, '-': 6, '*': 7 }
export function tokenizeSource(source) {
  const out = []
  const fail = (message, start, end = start + 1) => { throw new SourceError('syntax', message, source, { start, end }) }
  if (source.length > 40000) fail('첫 버전은 코드 40,000자까지 지원합니다.', 0, 0)
  let i = 0
  const push = (kind, start) => out.push({ kind, text: source.slice(start, i), start, end: i })
  while (i < source.length) {
    const start = i, ch = source[i]
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue }
    if (source.startsWith('--', i)) {
      let end = i
      while (source[end] === '-') end++
      if (/[!#$%&*+./<=>?@\\^|~:]/.test(source[end] || '')) fail('지원하지 않는 연산자입니다. -- 뒤 연산 기호는 Haskell 한 줄 주석이 아닙니다.', i, end + 1)
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '\n') { i++; push('newline', start); continue }
    if (/[a-zA-Z_]/.test(ch)) {
      while (/[a-zA-Z0-9_']/.test(source[i] || '') && i < source.length) i++
      const word = source.slice(start, i)
      if (reserved.has(word)) fail(`${word} 구문은 이번 버전에서 지원하지 않습니다.`, start, i)
      push(['if','then','else'].includes(word) ? word : ['True','False'].includes(word) ? 'boolean' : 'name', start); continue
    }
    if (/[0-9]/.test(ch)) {
      while (/[0-9]/.test(source[i] || '') && i < source.length) i++
      push('integer', start); continue
    }
    if (['::','->','==','/=','<=','>=','&&','||'].includes(source.slice(i,i+2))) { i += 2; push(source.slice(start, i), start); continue }
    if ('=+-*()<>`'.includes(ch)) { i++; push(ch, start); continue }
    fail(`지원하지 않는 문자 ${JSON.stringify(ch)}입니다. Int·Bool, 조건식·산술·비교·논리와 일반 함수 호출을 지원합니다. 리스트·패턴·data는 미지원입니다.`, start)
  }
  if (out.length > 8000) fail('코드가 너무 큽니다 (토큰 최대 8,000개).', 0, 0)
  out.push({ kind: 'eof', text: '', start: i, end: i })
  return out
}
const span = (a, b = a) => ({ start: a.start, end: b.end })
const intType = () => ({ kind: 'int' })
export function parseSource(source) {
  const tokens = tokenizeSource(source)
  let i = 0, depth = 0
  const current = () => tokens[i]
  const error = (message, token = current()) => { throw new SourceError('syntax', message, source, span(token)) }
  const take = (kind) => { if (current().kind !== kind) error(`${kind}가 필요합니다. 현재: ${current().text || '줄 끝/문서 끝'}`); return tokens[i++] }
  const identifier = () => { const token = take('name'); if (!/^[a-z][a-zA-Z0-9_']*$/.test(token.text)) error('함수·매개변수 이름은 영문 소문자로 시작해야 합니다.', token); return token }
  const nested = (fn) => { if (++depth > 100) error('괄호·표현식 중첩은 최대 100단계입니다.'); try { return fn() } finally { depth-- } }
  function type() {
    let left
    if (current().kind === '(') { i++; left = nested(type); take(')') }
    else { const token = take('name'); if (!['Int','Bool'].includes(token.text)) error('코드 분석은 Int·Bool 타입만 지원합니다.', token); left = token.text === 'Int' ? intType() : {kind:'bool'} }
    if (current().kind === '->') { i++; return { kind: 'fun', from: left, to: nested(type) } }
    return left
  }
  function atom() {
    const token = current()
    if (token.kind === 'integer') { i++; return { kind: 'integer', text: token.text, span: span(token) } }
    if (token.kind === 'boolean') { i++; return { kind: 'boolean', value:token.text==='True', span:span(token) } }
    if (token.kind === 'name') { i++; return { kind: 'name', name: token.text, span: span(token) } }
    if (token.kind === '(') { i++; const expr = nested(() => expression(0)); const end = take(')'); return { kind: 'group', expr, span: span(token, end) } }
    error('정수·Bool, 변수·함수 이름 또는 괄호 표현식이 필요합니다.')
  }
  function application() {
    let expr = atom()
    while (['name', 'integer', 'boolean', '('].includes(current().kind)) {
      const arg = atom()
      expr = { kind: 'application', fn: expr, arg, span: { start: expr.span.start, end: arg.span.end } }
    }
    return expr
  }
  function expression(min) {
    let left
    if (current().kind === 'if') {
      const token=tokens[i++], condition=nested(()=>expression(0)); take('then')
      const yes=nested(()=>expression(0));take('else');const no=nested(()=>expression(0))
      left={kind:'if',condition,yes,no,span:{start:token.start,end:no.span.end}}
    }
    else if (current().kind === '-') { const token = tokens[i++]; const arg = nested(() => expression(7)); left = { kind: 'negate', arg, span: { start: token.start, end: arg.span.end } } }
    else left = application()
    while (current().kind in SOURCE_OPERATORS || current().kind === '`') {
      const op = current(), precedence = op.kind==='`' ? (['div','mod'].includes(tokens[i+1]?.text)?7:9) : SOURCE_OPERATORS[op.kind]
      if (precedence < min) break
      i++
      let callee
      if(op.kind==='`'){const name=identifier();take('`');callee={kind:'name',name:name.text,span:span(name)}}
      if(precedence===4&&left.kind==='binary'&&SOURCE_OPERATORS[left.op]===4)error('비교 연산자는 연속 연결할 수 없습니다. 괄호 또는 &&/||를 사용하세요.',op)
      if (current().kind === '-') error('연산자 뒤 음수는 괄호로 감싸세요. 예: 3 * (-2)')
      const right = nested(() => expression(precedence + (['&&','||'].includes(op.kind)?0:1)))
      left = { kind: 'binary', op: callee?.name||op.kind, callee, left, right, span: { start: left.span.start, end: right.span.end } }
    }
    return left
  }
  const signatures = [], definitions = []
  while (current().kind !== 'eof') {
    if (current().kind === 'newline') { i++; continue }
    const name = identifier()
    if (current().kind === '::') {
      i++; const signature = type()
      signatures.push({ name: name.text, type: signature, span: span(name, tokens[i - 1]) })
    } else {
      const params = []
      while (current().kind === 'name') params.push(identifier())
      take('=')
      const expr = expression(0)
      definitions.push({ name: name.text, params, expr, nameSpan: span(name), span: { start: name.start, end: expr.span.end } })
    }
    if (!['newline', 'eof'].includes(current().kind)) error('정의·시그니처는 한 줄씩 작성하세요. 남은 구문을 해석할 수 없습니다.')
    if (definitions.length > 100) error('함수·값 정의는 최대 100개입니다.')
  }
  if (!definitions.length) error('타입 시그니처와 함수 또는 값 정의를 입력하세요.', tokens[0])
  return { source, signatures, definitions }
}
