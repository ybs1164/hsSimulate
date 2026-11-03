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
export function locateSourceError(error, file) {
  if (!(error instanceof SourceError) || !file || error.fileId) return error
  error.fileId = file.id
  error.span = { ...error.span, fileId: file.id }
  if (file.name) error.message = `${file.name} · ${error.message}`
  return error
}
const reserved = new Set('hiding data newtype type class instance deriving case of let in do infix infixl infixr foreign default'.split(' '))
const keywords = new Set('if then else module where import qualified as'.split(' '))
export const SOURCE_OPERATORS = { '||': 2, '&&': 3, '==': 4, '/=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, ':':5, '++':5, '+': 6, '-': 6, '*': 7 }
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
      push(keywords.has(word) ? word : ['True','False'].includes(word) ? 'boolean' : 'name', start); continue
    }
    if (/[0-9]/.test(ch)) {
      while (/[0-9]/.test(source[i] || '') && i < source.length) i++
      push('integer', start); continue
    }
    if (['::','->','==','/=','<=','>=','&&','||','++'].includes(source.slice(i,i+2))) { i += 2; push(source.slice(start, i), start); continue }
    if ('=+-*()<>`[],:'.includes(ch) || (ch === '.' && out.at(-1)?.kind === 'name' && out.at(-1).end === i)) { i++; push(ch, start); continue }
    fail(`지원하지 않는 문자 ${JSON.stringify(ch)}입니다. 튜플·가드·data·let/where 등은 미지원입니다.`, start)
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
  const upper = token => token.kind === 'name' && /^[A-Z]/.test(token.text)
  function dotted(start) {
    const parts = [start]
    while (current().kind === '.') {
      const dot = take('.'), name = take('name')
      if (!upper(parts.at(-1)) || name.start !== dot.end) error('모듈 한정 이름은 공백 없이 Module.name 형태로 작성하세요.', dot)
      parts.push(name)
    }
    return parts
  }
  function moduleName() {
    const start = take('name'), parts = dotted(start)
    if (!parts.every(upper)) error('모듈 이름의 각 부분은 영문 대문자로 시작해야 합니다.', start)
    return { name: parts.map(p => p.text).join('.'), span: span(start, parts.at(-1)) }
  }
  function reference() {
    const start = take('name'), parts = dotted(start), last = parts.at(-1)
    if (parts.length > 1 && !/^[a-z]/.test(last.text)) error('모듈 뒤에는 함수 또는 값 이름이 필요합니다.', last)
    return { kind: 'name', name: last.text, qualifier: parts.slice(0, -1).map(p => p.text).join('.'), span: span(start, last) }
  }
  function names() {
    take('(')
    const list = []
    if (current().kind !== ')') for (;;) {
      const token = identifier()
      list.push({ name: token.text, span: span(token) })
      if (current().kind !== ',') break
      take(',')
    }
    take(')')
    return list
  }
  const endLine = () => {
    if (!['newline', 'eof'].includes(current().kind)) error('모듈 선언과 import는 각각 한 줄에 지원하는 형식으로 작성하세요.')
    while (current().kind === 'newline') i++
  }
  const nested = (fn) => { if (++depth > 100) error('괄호·표현식 중첩은 최대 100단계입니다.'); try { return fn() } finally { depth-- } }
  function type() {
    let left
    if (current().kind === '(') { i++; left = nested(type); take(')') }
    else if(current().kind==='['){i++;const element=nested(type);take(']');left={kind:'list',element}}
    else { const token = take('name'); if (!['Int','Bool'].includes(token.text)) error('명시적인 Int·Bool 타입과 이들로 구성한 리스트·함수 타입만 지원합니다.', token); left = token.text === 'Int' ? intType() : {kind:'bool'} }
    if (current().kind === '->') { i++; return { kind: 'fun', from: left, to: nested(type) } }
    return left
  }
  function atom() {
    const token = current()
    if (token.kind === 'integer') { i++; return { kind: 'integer', text: token.text, span: span(token) } }
    if (token.kind === 'boolean') { i++; return { kind: 'boolean', value:token.text==='True', span:span(token) } }
    if (token.kind === 'name') return reference()
    if (token.kind === '[') {
      i++;const items=[]
      if(current().kind!==']')for(;;){items.push(nested(()=>expression(0)));if(current().kind!==',')break;i++}
      const end=take(']');return {kind:'list',items,span:span(token,end)}
    }
    if (token.kind === '(') {
      i++
      const op=current()
      if(op.kind in SOURCE_OPERATORS && tokens[i+1].kind===')'){i++;return {kind:'operator',op:op.kind,span:span(token,take(')'))}}
      if(op.kind in SOURCE_OPERATORS && op.kind!=='-'){
        i++;const right=nested(()=>expression(0));return {kind:'section',op:op.kind,right,span:span(token,take(')'))}
      }
      const expr = nested(() => expression(0)); if(current().kind===',')error('튜플 구문은 이번 버전에서 지원하지 않습니다.'); const end = take(')'); return { kind: 'group', expr, span: span(token, end) }
    }
    error('정수·Bool, 변수·함수 이름 또는 괄호 표현식이 필요합니다.')
  }
  function application() {
    let expr = atom()
    while (['name', 'integer', 'boolean', '(', '['].includes(current().kind)) {
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
      if(op.kind==='`'){callee=reference();take('`')}
      if(precedence===4&&left.kind==='binary'&&SOURCE_OPERATORS[left.op]===4)error('비교 연산자는 연속 연결할 수 없습니다. 괄호 또는 &&/||를 사용하세요.',op)
      if (current().kind === '-') error('연산자 뒤 음수는 괄호로 감싸세요. 예: 3 * (-2)')
      const right = nested(() => expression(precedence + (['&&','||',':','++'].includes(op.kind)?0:1)))
      left = { kind: 'binary', op: callee?.name||op.kind, callee, left, right, span: { start: left.span.start, end: right.span.end } }
    }
    return left
  }
  function pattern(min=0) {
    const token=current();let p
    if(token.kind==='name'){
      i++;if(token.text!=='_'&&!/^[a-z][a-zA-Z0-9_']*$/.test(token.text))error('패턴은 변수·_·리스트만 지원합니다.',token)
      p={kind:token.text==='_'?'wildcard':'variable',name:token.text,text:token.text,span:span(token),nameSpan:span(token)}
    }else if(token.kind==='('){i++;p=nested(()=>pattern());const end=take(')');p={...p,span:span(token,end)}}
    else if(token.kind==='['){
      i++;const items=[]
      if(current().kind!==']')for(;;){items.push(nested(()=>pattern()));if(current().kind!==',')break;i++}
      const end=take(']');p={kind:'nil',span:span(end)}
      for(let n=items.length-1;n>=0;n--)p={kind:'cons',head:items[n],tail:p,span:{start:items[n].span.start,end:end.end}}
      p.span=span(token,end)
    }else error('리스트 패턴([]·[x]·(x:xs)), 변수 또는 _가 필요합니다.')
    if(min===0&&current().kind===':'){i++;const tail=nested(()=>pattern());p={kind:'cons',head:p,tail,span:{start:p.span.start,end:tail.span.end}}}
    return p
  }
  const signatures = [], definitions = [], imports = []
  while (current().kind === 'newline') i++
  let module = null
  if (current().kind === 'module') {
    take('module')
    module = moduleName()
    module.exports = current().kind === '(' ? names() : null
    take('where')
    endLine()
  }
  while (current().kind === 'import') {
    take('import')
    const qualified = current().kind === 'qualified'
    if (qualified) take('qualified')
    const entry = moduleName()
    let alias = null
    if (current().kind === 'as') {
      if (!qualified) error('별칭은 import qualified … as … 형태로 지원합니다.')
      take('as')
      alias = moduleName().name
    }
    imports.push({ ...entry, qualified, alias, names: current().kind === '(' ? names() : null })
    endLine()
  }
  while (current().kind !== 'eof') {
    if (current().kind === 'newline') { i++; continue }
    if (current().kind === 'module' || current().kind === 'import') error('모듈 선언과 import는 함수 정의보다 먼저 작성하세요.')
    const name = identifier()
    if (current().kind === '::') {
      i++; const signature = type()
      signatures.push({ name: name.text, type: signature, span: span(name, tokens[i - 1]) })
    } else {
      const params = []
      while (['name','(','['].includes(current().kind)) params.push(nested(()=>pattern(1)))
      take('=')
      const expr = expression(0)
      definitions.push({ name: name.text, params, expr, nameSpan: span(name), span: { start: name.start, end: expr.span.end } })
    }
    if (current().kind === 'where') error('where 구문은 이번 버전에서 지원하지 않습니다.')
    if (!['newline', 'eof'].includes(current().kind)) error('정의·시그니처는 한 줄씩 작성하세요. 남은 구문을 해석할 수 없습니다.')
    if (definitions.length > 100) error('함수·값 정의는 최대 100개입니다.')
  }
  if (!definitions.length && !module) error('타입 시그니처와 함수 또는 값 정의를 입력하세요.', tokens[0])
  return { source, module, imports, signatures, definitions }
}
