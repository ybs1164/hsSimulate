import './style.css'
import { initExercisePanel } from './exercisePanel.js'
import { findExerciseFunction } from './grader.js'
import { applySubst, classShown, constructorArity, constructorKind, showKind, ftv, generalize, setClassLabels, showQual, tcon, tfun, tvar, unify, createNamer, pred, setUserTypeArities, tapp } from './typeSystem.js'
import { annotationProblem, isInferredVar, chainOf, classPalette, constructorWithHoles, fromTypeNode, headLabel, hole, isHole, namedVariables, occurrenceOf, pinAt, typeAt, typeFromText, typeNode, typePalette, typeText, variableNames } from './typeExpr.js'
import { inferGraph, subtreeOf, valueTypeOfEntry } from './inferGraph.js'
import { branchPattern, captureMatchValue, convertCaseToMatch, copyOwnedFunctions, createMatch, deleteMatch, ensureTypeKeys, matchCaseId, matchProblem, nameRecordFields, pasteOwnedFunctions, remapMatchNode, renameMatchBinder, setMatchDefault } from './matchGraph.js'
import { builtinSchemes, listOfScheme } from './builtinSchemes.js'
import { classArity, reduce, predsOnVar, pickDefault, entails, findInstance, headName, listInstances, literalClass, numericTypes, setDynamicClasses, setDynamicInstances, superclassesOf } from './prelude.js'
import { createEvaluator, elaborationIndex, EvalError, isClosure, isData, showValue } from './evaluator.js'
import { HEAD_NAMES, classEnvironment, classMethodDefinitions, classUsesOf, classesUsingType, declareClasses, instanceEvidence, instanceMethodProblem, renameTypeInClasses, renameTypeInInstances, showHead, writtenEnvironment, writtenMethodProblem, writtenMinimalProblem } from './classDecls.js'
import { DeclError, declToDraft, declareTypes, derivedDefinitions, derivedInstances, draftToSource, paramKind, renameTypeReferences, typeArities, typeKinds } from './typeDecls.js'
import { classGraph, layoutGraph, layoutKey, renameLayout, typeGraph, universeGraph } from './declGraph.js'
import { drawDeclGraph } from './declCanvas.js'
import { TAKEABLE_TYPES, customizeDerived, isPristineOverride, libraryTypeProblem, migrateTypeEdit, primLabel, primitiveDefinitions, resetDerived, takeOverType } from './typeEdits.js'
import { BUILTIN_CLASSES, METHOD_CLASS, METHOD_LABEL, METHOD_PARAMS } from './classMethods.js'
import { FUNCTION_LAWS, checkFunctionLaw } from './laws.js'
import { createGame, isProgram } from './runtime.js'
import { asciiType, printDefinitionTokens, printNodeText } from './haskellPrint.js'
import { buildDefinitionView, isEditableView, restoreDefinition, takeOverDefinition, viewIdOf } from './definitionViews.js'
import { addParameter, hasVariadicSlots, moveParameter, removeParameter, renameFunction, renameParameter } from './signature.js'
import { ParseError, parseValue } from './valueParser.js'
import { parseLiteral } from './literals.js'
import { buildClickCounter } from './examples/clickCounter.js'
import { buildBlankGame } from './examples/blankGame.js'
import { buildDice } from './examples/dice.js'
import { buildBlackjack } from './examples/blackjack.js'
import { buildVending } from './examples/vending.js'
import { buildNim } from './examples/nim.js'
import { buildDamage } from './examples/damage.js'
import { buildRps } from './examples/rps.js'
import { buildSimon } from './examples/simon.js'
import { buildHighLow } from './examples/highLow.js'
import { renderWidget } from './player.js'
import { PRELUDE, libraryDefs, preludeDefs, preludeTypeDefs, preludeTypes } from './library.js'
import { PLAYER_MODULES, buildPlayerHtml } from './exportHtml.js'

// The player modules' source text, for bundling into an exported game (Vite inlines these).
const playerSources = Object.fromEntries(Object.entries(import.meta.glob(['./typeSystem.js', './classEnv.js', './dataTypes.js', './literals.js', './classMethods.js', './matchGraph.js', './evaluator.js', './runtime.js', './player.js'], { query: '?raw', import: 'default', eager: true })).map(([path, code]) => [path.slice(2, -3), code]))
import { STORAGE_KEY, ProjectError, createHistory, mergeBuiltins, parseProject, serializeProject, upgradeProject } from './project.js'
import { BUILTIN_GROUPS, CLASS_NOTES, classLabel } from './classGroups.js'
// Classes print under their Haskell names (Ring as Num, …) everywhere the app shows a type.
setClassLabels(classLabel)

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">λ</span><span>hs / simulate</span><span class="beta">BETA</span></div>
      <div class="top-actions"><button class="tool-button" id="help">도움말</button><button class="tool-button" id="toggle-inspector" aria-controls="inspector-panel" aria-expanded="true">속성 패널</button></div>
    </header>
    <section class="workspace">
      <aside class="sidebar">
        <div class="side-heading"><div><span class="eyebrow">작업 공간</span><h1>이름 없는 그래프</h1></div></div>
        <div class="search"><span>⌕</span><input aria-label="블록 검색" placeholder="블록 검색" /><kbd data-shortcut="K"></kbd></div>
        <nav class="node-library">
          <div class="library-title"><span>값 추가</span></div>
          <div id="value-library">
          <button class="library-item" data-type="number"><span class="lib-icon number-icon">#</span><span><b>수</b><small>Int · Double · Rational …</small></span></button>
          <button class="library-item" data-type="text"><span class="lib-icon text-icon">Aa</span><span><b>문자열</b><small>String = [Char]</small></span></button>
          <button class="library-item" data-type="list"><span class="lib-icon list-icon">[ ]</span><span><b>리스트</b><small>[a, b, c]</small></span></button>
          <button class="library-item" data-type="lambda"><span class="lib-icon function-icon">λ</span><span><b>람다</b><small>\\x -> … (이름 없는 함수)</small></span></button>
          <button class="library-item" data-type="boolean"><span class="lib-icon bool-icon">◉</span><span><b>Bool</b><small>True · False</small></span></button></div>
          <div class="library-title" id="parameter-title" hidden><span>매개변수</span></div>
          <div id="parameter-library"></div>
          <div class="library-title"><span>함수 · 열기 / 추가</span><button class="add-node" aria-label="함수 만들기" title="함수 만들기">+</button></div>
          <div id="function-library"></div>
          <details class="library-section" id="types-section"><summary>타입</summary><div class="library-title types-title"><span>타입 선언</span><button class="open-universe" aria-label="타입 우주" title="타입 우주 — 모든 타입과 클래스를 한 그래프로">◎</button><button class="add-type" aria-label="타입 선언" title="타입 선언 — 생성자 함수로 정의해요">+</button></div>
          <div id="type-palette"></div>
          <div id="type-library"></div></details>
          <details class="library-section" id="classes-section"><summary>클래스</summary><div class="library-title types-title"><span>클래스 선언</span><button class="open-universe" aria-label="타입 우주" title="타입 우주 — 모든 타입과 클래스를 한 그래프로">◎</button><button class="add-class" aria-label="클래스 선언" title="클래스 선언 — 인스턴스마다 구현할 메서드">+</button></div>
          <div id="class-palette"></div>
          <div id="class-library"></div></details>
          <details class="library-section" id="prelude-section"><summary>Prelude 함수</summary>
          <div id="prelude-library"></div></details>

        </nav>

      </aside>
      <section class="canvas-panel">
        <div class="canvas-toolbar"><div class="breadcrumbs"><button class="crumb-back" id="back-graph" hidden>← main</button><span>그래프</span><span>/</span><b id="graph-name">main</b><span class="saved" id="saved-status"><i></i> <span>방금 저장됨</span></span></div><div class="toolbar-actions"><button class="tool-button icon-only" id="undo" title="실행 취소" disabled>↶</button><button class="tool-button icon-only" id="redo" title="다시 실행" disabled>↷</button><details class="project-menu"><summary class="tool-button">프로젝트</summary><div class="project-menu-items"><button class="tool-button" id="export" title="프로젝트를 JSON으로 내려받기">⤓ <span>프로젝트 저장 (.json)</span></button><button class="tool-button" id="import" title="프로젝트 JSON 파일 불러오기">⤒ <span>프로젝트 열기</span></button><input type="file" id="import-file" accept="application/json,.json" hidden /><select class="tool-select" id="template" title="템플릿에서 시작 (실행 취소 가능)"><option value="">✦ 템플릿…</option><option value="clickCounter">클릭 카운터</option><option value="blankGame">빈 게임</option><option value="vending">자판기 (함수와 타입)</option><option value="nim">님 (조건)</option><option value="dice">주사위 (난수 · 그림)</option><option value="damage">데미지 (커링과 합성)</option><option value="rps">가위바위보 (데이터 타입)</option><option value="simon">사이먼 (리스트와 재귀)</option><option value="highLow">하이로우 (타입 클래스)</option><option value="blackjack">블랙잭 (리스트)</option></select><button class="tool-button" id="export-game" title="게임을 독립 HTML 파일 하나로 내려받기">⬇ <span>게임 내보내기 (.html)</span></button><button class="tool-button" id="reset">↺ <span>프로젝트 초기화</span></button></div></details><button class="tool-button primary" id="run">▶ <span>실행 add</span></button></div></div>
        <div class="canvas-wrap"><div id="play-panel" hidden></div><div id="type-panel" hidden></div><canvas id="graph-canvas"></canvas><div class="canvas-empty" hidden><b>빈 그래프예요</b><span>왼쪽 <i>연습 문제</i>에서 문제를 고르거나, 사이드바에서 값·함수를 끌어다 놓으세요.</span><span><kbd data-shortcut="K"></kbd> 블록 검색 · <i>프로젝트 › 템플릿</i>으로 예제 열기</span></div><div id="port-editor"></div><div class="zoom-control"><button id="zoom-out">−</button><span id="zoom-level">100%</span><button id="zoom-in">+</button><button id="fit">⌗</button><button id="unfold-all" title="모든 함수 펼치기: 슬롯에 꽂힌 것을 캔버스에 보여요">⤢</button><button id="fold-all" title="모든 함수 접기: 꽂힌 것을 슬롯 안에 넣어요">⤡</button></div></div>
        <footer class="canvas-footer"><span>블록 <b id="node-count">2</b>개</span><span>연결 <b id="connection-count">0</b>개</span><span class="footer-spacer"></span><span class="shortcut"><kbd data-shortcut="Enter"></kbd><span id="run-shortcut-label">실행 add</span></span></footer>
      </section>
      <aside class="inspector" id="inspector-panel"><div class="inspector-title"><span>속성</span><button class="close-inspector" aria-label="속성 패널 닫기">×</button></div><div id="inspector-content"></div></aside>
    </section>
  </main>
`

const disclosureState = new Map()
function restoreDisclosureState(root) {
  root.querySelectorAll('details').forEach((el) => {
    const key = el.dataset.disclosure || `${root.id}:${el.querySelector('summary')?.textContent}`
    el.open = disclosureState.get(key) ?? el.open
    el.addEventListener('toggle', () => { if (el.isConnected && !document.querySelector('.search input')?.value) disclosureState.set(key, el.open) })
  })
}
const shortcutModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
// Shortcut hints name this platform's modifier key.
function setupShortcutHints() {
  document.querySelector('#undo').title = `Undo (${shortcutModifier} Z)`
  document.querySelector('#redo').title = `Redo (${shortcutModifier} Shift Z)`
  document.querySelectorAll('[data-shortcut]').forEach((el) => { el.textContent = `${shortcutModifier} ${el.dataset.shortcut}` })
}
function toggleInspector(open) {
  document.querySelector('.inspector').hidden = !open
  document.querySelector('.workspace').classList.toggle('inspector-hidden', !open)
  document.querySelector('#toggle-inspector').setAttribute('aria-expanded', String(open))
  window.dispatchEvent(new Event('resize'))
}
// The top bar: the inspector toggle (collapsed on narrow screens), help, and
// the Project menu, which closes after use.
function setupTopBar() {
  document.querySelector('#toggle-inspector').onclick = () => toggleInspector(document.querySelector('.workspace').classList.contains('inspector-hidden'))
  if (matchMedia('(max-width:1050px)').matches) {
    toggleInspector(false)
  }
  document.querySelector('#help').onclick = () => {
    const dialog = document.createElement('dialog')
    dialog.className = 'help-dialog'
    dialog.innerHTML = `<h2>그래프 다루기</h2><ul><li>함수 이름을 눌러 본체를 열고, + 버튼으로 호출을 추가해요.</li><li>사이드바에서 값을 추가해요. 블록 오른쪽 출력 포트를 입력 슬롯이나 Output으로 끌어 이어요.</li><li>빈 입력 슬롯을 누르면 값을 적을 수 있어요.</li><li>빈 캔버스를 끌면 이동, 스크롤하면 확대·축소해요.</li><li>위쪽 실행 버튼에는 프로젝트의 시작 함수 이름이 나와요. 연습 문제의 본체 안에서는 채점 버튼이 돼요.</li><li>타입 편집기에서는 +를 눌러 타입을 고르거나 타입 목록에서 끌어 와요. 이름을 누르면 바꿀 수 있어요.</li></ul><p>${shortcutModifier} K: 검색해서 추가 · ${shortcutModifier} Enter: 실행 · ${shortcutModifier} Z: 실행 취소</p><p>프로젝트는 이 브라우저에 자동으로 저장돼요. 실행기는 이 컴퓨터에서 돌아가요.</p><form method="dialog"><button class="tool-button">닫기</button></form>`

    document.body.append(dialog)
    dialog.addEventListener('close', () => dialog.remove())
    dialog.showModal()
  }
  // File actions close their menu after use; the import picker keeps its input alive.
  document.addEventListener('click', (event) => { if (!event.target.closest('.project-menu')) document.querySelector('.project-menu').open = false })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelector('.project-menu').open = false })
  document.querySelector('.project-menu').addEventListener('click', (event) => {
    if (event.target.closest('button')) document.querySelector('.project-menu').open = false
  })
  document.querySelector('#template').addEventListener('change', () => { document.querySelector('.project-menu').open = false })
}

const canvas = document.querySelector('#graph-canvas')
const ctx = canvas.getContext('2d')
const editor = document.querySelector('#port-editor')
const inspector = document.querySelector('#inspector-content')
const state = { functionStack: [], multi: new Set(), zoom: 1, offset: { x: 0, y: 0 }, selected: 'add', running: false, drag: null, wire: null, pan: null, snapTarget: null, activeFunction: null, suppressClick: false }
const nodes = {
  add: { id: 'add', type: 'function', x: 300, y: 190, label: 'add', params: ['n'], mounted: [null], paramScopes: ['local'], color: '#6c5ce7', scope: 'main', builtin: 'succ', readonly: true, expression: 'λn f x. f (n f x)' },
  identity: { id: 'identity', type: 'function', x: 820, y: 190, label: 'identity', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#4f8ef7', scope: 'main', builtin: 'identity', readonly: true, expression: 'λx. x' },
  zero: { id: 'zero', type: 'function', x: 300, y: 410, label: 'zero', params: [], mounted: [], paramScopes: [], color: '#a96ef0', scope: 'main', builtin: 'zero', readonly: true, expression: 'λf x. x' },
  apply: { id: 'apply', type: 'function', x: 820, y: 410, label: 'apply', params: ['f', 'x'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#f0954a', scope: 'main', builtin: 'apply', readonly: true, expression: 'λf x. f x' },
  compose: { id: 'compose', type: 'function', x: 300, y: 630, label: 'compose', params: ['f', 'g', 'x'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#2bb8b0', scope: 'main', builtin: 'compose', readonly: true, expression: 'λf g x. f (g x)' },
  isZero: { id: 'isZero', type: 'function', x: 820, y: 630, label: 'isZero', params: ['n'], mounted: [null], paramScopes: ['local'], color: '#ed6b84', scope: 'main', builtin: 'isZero', readonly: true, expression: 'λn. n == 0' },
  ifThenElse: { id: 'ifThenElse', type: 'function', x: 820, y: 850, label: 'ifThenElse', params: ['condition', 'whenTrue', 'whenFalse'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#c77dd6', scope: 'main', builtin: 'ifThenElse', readonly: true, expression: 'λc a b. c ? a : b' },
  // Group-theoretic numeric hierarchy builtins (see src/numericClasses.js) —
  // each demands only the weakest algebraic structure it needs.
  plus: { id: 'plus', type: 'function', x: 300, y: 1070, label: '(+)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#e8b23c', scope: 'main', builtin: 'plus', readonly: true, expression: 'x + y' },
  negate: { id: 'negate', type: 'function', x: 820, y: 1070, label: 'negate', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#8c7cf2', scope: 'main', builtin: 'negate', readonly: true, expression: '-x' },
  divide: { id: 'divide', type: 'function', x: 300, y: 1290, label: '(/)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#35b4e0', scope: 'main', builtin: 'divide', readonly: true, expression: 'x / y' },
  sqrt: { id: 'sqrt', type: 'function', x: 820, y: 1290, label: 'sqrt', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#3cbe84', scope: 'main', builtin: 'sqrt', readonly: true },
  toRational: { id: 'toRational', type: 'function', x: 300, y: 1510, label: 'toRational', params: ['x'], mounted: [null], paramScopes: ['local'], color: '#d66bd1', scope: 'main', builtin: 'toRational', readonly: true },
  minus: { id: 'minus', type: 'function', x: 300, y: 1950, label: '(-)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#5fa8e8', scope: 'main', builtin: 'minus', readonly: true, expression: 'x - y' },
  times: { id: 'times', type: 'function', x: 820, y: 1950, label: '(*)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#f0954a', scope: 'main', builtin: 'times', readonly: true, expression: 'x * y' },
  addZero: { id: 'addZero', type: 'function', x: 300, y: 2170, label: 'addZero', params: [], mounted: [], paramScopes: [], color: '#4fc2c2', scope: 'main', builtin: 'addZero', readonly: true, expression: '0 (additive identity)' },
  mulOne: { id: 'mulOne', type: 'function', x: 820, y: 2170, label: 'mulOne', params: [], mounted: [], paramScopes: [], color: '#b98fef', scope: 'main', builtin: 'mulOne', readonly: true, expression: '1 (multiplicative identity)' },
  geq: { id: 'geq', type: 'function', x: 300, y: 2390, label: '(>=)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#ed8fa8', scope: 'main', builtin: 'geq', readonly: true, expression: 'x >= y' },
  eq: { id: 'eq', type: 'function', x: 820, y: 2390, label: '(==)', params: ['x', 'y'], mounted: [null, null], paramScopes: ['local', 'local'], color: '#3cbe9e', scope: 'main', builtin: 'eq', readonly: true, expression: 'x == y' },
  select: { id: 'select', type: 'function', x: 820, y: 2610, label: 'select', params: ['condition', 'whenTrue', 'whenFalse'], mounted: [null, null, null], paramScopes: ['local', 'local', 'local'], color: '#c77dd6', scope: 'main', builtin: 'select', readonly: true, expression: 'λc a b. c ? a : b' },
}
function activeNodes() { return state.activeFunction ? allBodies[state.activeFunction] : nodes }
// A read-only definition view (or a λ inside one) is on screen: look, don't touch.
function viewingReadonly() { return Boolean(state.activeFunction && !functionBodies[state.activeFunction] && viewBodies[state.activeFunction]) }
function activeName() { return state.activeFunction ? [...state.functionStack, state.activeFunction].map((id) => `ƒ ${definitions[id]?.label || '?'}`).join(' / ') + (viewingReadonly() ? ' · read-only' : nodes[state.activeFunction]?.library ? ' · taken over' : '') : '⌂ 최상위' }
const functionBodies = {
  add: {
    inputX: { id: 'add-input-x', type: 'parameter', typeName: 'Int', x: 110, y: 180, label: 'x', value: 'x', color: '#4f8ef7' },
    output: { id: 'add-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'x + 1', expression: 'x + 1', color: '#2fbf8f' },
  },
  identity: {
    inputX: { id: 'identity-input-x', type: 'parameter', typeName: 'Int', x: 110, y: 255, label: 'x', value: 'x', color: '#4f8ef7' },
    output: { id: 'identity-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'x', expression: '\\x -> x', color: '#2fbf8f' },
  },
  zero: {
    output: { id: 'zero-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: '0', expression: '0', color: '#2fbf8f' },
  },
  apply: {
    output: { id: 'apply-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'f x', expression: 'f x', color: '#2fbf8f' },
  },
  compose: {
    output: { id: 'compose-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'f (g x)', expression: 'f (g x)', color: '#2fbf8f' },
  },
  isZero: {
    inputN: { id: 'isZero-input-n', type: 'parameter', typeName: 'Int', x: 110, y: 255, label: 'n', value: 'n', color: '#4f8ef7' },
    output: { id: 'isZero-output', type: 'output', typeName: 'Bool', x: 570, y: 255, label: 'Output', value: 'n == 0', expression: 'n == 0', color: '#2fbf8f' },
  },
  ifThenElse: {
    inputCondition: { id: 'ifThenElse-input-condition', type: 'parameter', typeName: 'Bool', x: 110, y: 150, label: 'condition', value: 'condition', color: '#ed6b84' },
    inputTrue: { id: 'ifThenElse-input-true', type: 'parameter', typeName: 'Int', x: 110, y: 255, label: 'whenTrue', value: 'whenTrue', color: '#4f8ef7' },
    inputFalse: { id: 'ifThenElse-input-false', type: 'parameter', typeName: 'Int', x: 110, y: 360, label: 'whenFalse', value: 'whenFalse', color: '#4f8ef7' },
    output: { id: 'ifThenElse-output', type: 'output', typeName: 'Int', x: 570, y: 255, label: 'Output', value: 'condition ? whenTrue : whenFalse', expression: 'condition ? whenTrue : whenFalse', color: '#2fbf8f' },
  },
}
let outputId = 0
// The function `Run graph` (and Ctrl+Enter) plays — a node id in `nodes`.
let entryId = 'add'
// Everything in `nodes`/`functionBodies` at startup is a builtin; kept so a
// loaded project can be reconciled with this version's builtins.
const builtinNodes = structuredClone(nodes)
const builtinBodies = structuredClone(functionBodies)
// User type declarations (see typeDecls.js) and the functions derived from
// them — constructors, field projections and updates, and each type's
// eliminator — plus each one's primitive (`prim:<id>`, see typeEdits.js).
// Derived definitions don't live in `nodes` (that would put them on the
// main canvas); `definitions` is the lookup the type pass and the
// evaluator use: every function definition, real or derived. A customized
// derived function is a hidden custom function in `nodes` under the same
// id, so it shadows the derived one everywhere.
let types = {}
const derivedDefs = {}
// Prelude functions on lists, Maybe and text (src/dataTypes.js), by their
// Haskell names. Like derived definitions they're listed in the sidebar
// rather than drawn on the main canvas.
// User class declarations (classDecls.js): stored as written, resolved
// against the types; their methods are definitions too (`class:C:m`).
let classes = {}
let resolvedClasses = []
// Instances of builtin classes written by hand — the same shape as a user
// class's instances, kept per class: `{ Show: [{ head, context, methods }] }`
// (classDecls.js' resolveWritten). Resolved with the classes (`resolvedClasses.written`).
let instances = {}
const classDefs = {}
// Where each declaration graph's nodes sit (declGraph.js), saved with the project: `{ 'type:Shape': { [node id]: { x, y } } }`.
let layouts = {}
// Read-only definition views (definitionViews.js): a builtin, Prelude or
// derived function shown as a graph. `viewDefs`/`viewBodies` hold each
// view's own definition (id `view:<function id>`) and body, plus the λs it
// uses; rebuilt when the types change, never saved.
const viewDefs = {}
const viewBodies = {}
const laidOutViews = new Set()
const definitions = new Proxy({}, {
  get: (_, id) => nodes[id] ?? derivedDefs[id] ?? classDefs[id] ?? libraryDefs[id] ?? viewDefs[id],
  ownKeys: () => [...new Set([nodes, derivedDefs, classDefs, libraryDefs, viewDefs].flatMap(Object.keys))],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
})
const allBodies = new Proxy({}, {
  get: (_, id) => functionBodies[id] ?? viewBodies[id],
  ownKeys: () => [...new Set([...Object.keys(functionBodies), ...Object.keys(viewBodies)])],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
})
function clearViews() {
  for (const id of Object.keys(viewDefs)) delete viewDefs[id]
  for (const id of Object.keys(viewBodies)) delete viewBodies[id]
  laidOutViews.clear()
  if ([state.activeFunction, ...state.functionStack].some((id) => id && !allBodies[id])) { state.activeFunction = null; state.functionStack = [] }
}
// The view of the builtin/Prelude/derived function `defId` (built on first
// use), or null for a function of your own — that has a real body.
function ensureView(defId, slots = 0) {
  const def = definitions[defId]
  if (!def || def.custom || def.view || def.lambda) return null
  const viewId = viewIdOf(defId, def.builtin === 'listOf' ? slots : null)
  if (!viewDefs[viewId]) {
    const view = buildDefinitionView(def, (id) => definitions[id], { slots })
    Object.assign(viewDefs, view.defs)
    Object.assign(viewBodies, view.bodies)
  }
  return viewId
}
function openDefinitionView(defId, slots = 0) {
  if (nodes[defId]?.library) return enterFunction(defId)
  const viewId = ensureView(defId, slots)
  if (viewId) enterFunction(viewId)
}
// Take the Prelude function a view shows over: it becomes your own graph
// (definitionViews.js's takeOverDefinition), opened in place of the view.
function editDefinition(viewId) {
  const defId = viewDefs[viewId]?.view
  const def = definitions[defId]
  const node = def && takeOverDefinition({ nodes, functionBodies }, def, (id) => definitions[id])
  if (!node) return showToast(`${def?.label ?? defId} is a primitive — it has no definition to edit`)
  for (const id of Object.keys(functionBodies)) if (id === defId || id.startsWith(`${defId}/λ`)) layoutBody(functionBodies[id])
  if (state.activeFunction === viewId) state.activeFunction = defId
  else enterFunction(defId)
  state.selected = 'output'
  renderFunctionLibrary(); renderPreludeLibrary(); updateInspector(); draw()
  showToast(`${def.label} is your own graph now — every call runs it (↺ goes back to the Prelude's)`)
}
// Drop a taken-over definition: calls run the Prelude's again.
function restoreLibraryDefinition(id) {
  const label = definitions[id]?.label
  const chain = [...state.functionStack, state.activeFunction]
  const at = chain.findIndex((f) => f === id || f?.startsWith(`${id}/λ`))
  if (at >= 0) { const kept = chain.slice(0, at); state.activeFunction = kept.pop() || null; state.functionStack = kept }
  restoreDefinition({ nodes, functionBodies }, id)
  state.selected = state.activeFunction ? 'output' : 'add'
  renderFunctionLibrary(); renderPreludeLibrary(); updateInspector(); fitToView()
  showToast(`${label} is the Prelude's definition again`)
}
function applyTypes(next, nextClasses = classes, nextInstances = instances) {
  types = next
  clearViews()
  Object.keys(derivedDefs).forEach((id) => delete derivedDefs[id])
  const derived = derivedDefinitions(types)
  ;[...derived, ...primitiveDefinitions(derived)].forEach((def) => { derivedDefs[def.id] = def })
  setUserTypeArities(typeArities(types), typeKinds(types))
  classes = nextClasses
  instances = nextInstances
  try {
    resolvedClasses = declareClasses(classes, types, classLabelsTaken(), instances)
  } catch (e) {
    if (!(e instanceof DeclError)) throw e
    resolvedClasses = []
    showToast(`Classes not loaded: ${e.message}`)
  }
  Object.keys(classDefs).forEach((id) => delete classDefs[id])
  classMethodDefinitions(resolvedClasses).forEach((def) => { classDefs[def.id] = { ...def, expression: `${def.label} :: ${showQual(def.scheme.preds, def.scheme.type)} — a method of ${def.method.cls}; the instance is picked from the types` } })
  const env = classEnvironment(resolvedClasses)
  setDynamicClasses(env.classes)
  setDynamicInstances([...derivedInstances(types), ...env.instances])
  elaborationCache = null
  projectPassCache = null
}
// Names a class method may not take: every function name but the class methods' own.
function classLabelsTaken() {
  return [...Object.values(nodes).filter((n) => isFunction(n) && !n.sourceFunctionId && !isHiddenDefinition(n)), ...Object.values(preludeDefs), ...Object.values(derivedDefs).filter((d) => !d.primitive)].map((n) => n.label)
}
// The type pass's elaboration of the whole project — which instance each
// call means, the dictionaries functions take, the user type a conversion
// lands in (inferGraph.js) — plus each instance's runtime side
// (classDecls.js). The evaluator asks for it on every run; it's recomputed
// after any edit (draw() drops it).
let elaborationCache = null
let projectPassCache = null
// The type pass over the whole project (the top-level graph, and through it every function).
function projectPass() {
  return (projectPassCache ??= inferGraph(definitions, functionBodies, nodes))
}
function elaborationData() {
  if (!elaborationCache) {
    const pass = projectPass()
    elaborationCache = { ...pass.elaboration, instances: instanceEvidence(resolvedClasses, (fnId) => pass.schemes.get(fnId)) }
  }
  return elaborationCache
}

// --- Ambiguity (inferGraph.js: GHC's ambiguity check) ---------------------------
// An ambiguous constraint can't be solved by anything, so it's an error at
// once: the node is marked, a connection that would create one is refused,
// and nothing that depends on one runs.

/** Why `node` (in the graph `pass` typed) is ambiguous, or null. A custom function is ambiguous if its body is. */
function ambiguityProblem(node, pass) {
  const own = pass.ambiguities?.main.find((a) => a.nodeId === node.id)
  if (own) return own.message
  const fnId = node.sourceFunctionId || node.id
  const inner = nodes[fnId]?.custom && projectPass().ambiguities.functions[fnId]
  return inner?.length ? `${nodes[fnId].lambda ? 'This λ' : nodes[fnId].label}'s body is ambiguous — ${inner[0].message}` : null
}
// Every ambiguity in the graph on screen and in every function, as comparable keys.
function ambiguityKeys() {
  const local = typePass().ambiguities
  projectPassCache = null
  const project = projectPass().ambiguities
  return new Set([...local.main.map((a) => `here:${a.nodeId}`), ...Object.entries(project.functions).flatMap(([fn, list]) => list.map((a) => `${fn}:${a.nodeId}`))])
}
// The custom functions running `ids` (nodes of `graph`) may call — through
// calls, and through dictionaries (a class method may run any instance's function).
function reachableFunctions(graph, ids) {
  const found = new Set()
  const visit = (g, nodeIds) => {
    for (const id of nodeIds) {
      const n = g[id]
      if (n?.type !== 'function') continue
      const callee = n.sourceFunctionId || n.id
      const def = definitions[callee]
      const builtinCls = METHOD_CLASS[def?.builtin]
      const next = def?.method ? Object.values(classes[def.method.cls]?.instances || []).flatMap((i) => Object.values(i.methods || {})).concat((classes[def.method.cls]?.methods || []).map((m) => m.default)).filter(Boolean) : builtinCls ? (instances[builtinCls] || []).flatMap((i) => Object.values(i.methods || {})).filter(Boolean) : nodes[callee]?.custom ? [callee] : []
      for (const fn of next) {
        if (found.has(fn) || !functionBodies[fn]) continue
        found.add(fn)
        visit(functionBodies[fn], Object.keys(functionBodies[fn]))
      }
    }
  }
  visit(graph, [...ids])
  return found
}
/** Why running node `nodeId` of `graph` must be refused (an ambiguity it depends on), or null. */
function runBlocker(graph, nodeId) {
  const inside = subtreeOf(graph, nodeId)
  for (const id of inside) {
    const problem = graph[id]?.match && matchProblem(graph[id], graph, definitions, functionBodies)
    if (problem) return problem
  }
  const localTypes = typePass(graph)
  if ([...inside].some((id) => graph[id]?.match) && localTypes.brokenEdges.some((e) => inside.has(e.nodeId))) return '패턴 매칭 분기의 타입이나 연결을 확인하세요'
  const local = localTypes.ambiguities.main.find((a) => inside.has(a.nodeId))
  if (local) return local.message
  projectPassCache = null
  const projectTypes = projectPass()
  const inner = projectTypes.ambiguities.functions
  for (const fn of reachableFunctions(graph, inside)) {
    const broken = projectTypes.brokenFunctions[fn]?.[0]
    if (broken && (nodes[fn]?.matchBranch || Object.values(functionBodies[fn]).some((n) => n.match))) return broken.message || `${nodes[fn]?.label || fn}: 분기의 타입이 맞지 않습니다`
    for (const node of Object.values(functionBodies[fn])) {
      const problem = node.match && matchProblem(node, functionBodies[fn], definitions, functionBodies)
      if (problem) return problem
    }
    if (inner[fn]?.length) return `${nodes[fn]?.lambda ? 'a λ' : nodes[fn]?.label ?? fn}: ${inner[fn][0].message}`
  }
  return null
}
// Definitions in `nodes` that aren't drawn on the main canvas or listed as
// functions: a λ's lifted function (its call node is the λ) and a
// customized derived function (listed under its type).
const isHiddenDefinition = (n) => !!(n?.lambda || n?.override || n?.library)
// A builtin's own definition: listed under Built-in functions (open it, or + a call), not drawn on the top level, where only the project's own functions sit.
const isBuiltinDefinition = (n) => !!(n && n.readonly && !n.custom && !n.sourceFunctionId && nodes[n.id] === n)
// Every name a function definition already has, but `exceptId`'s: custom
// functions, builtins, Prelude, and everything derived from types.
function functionLabelsExcept(exceptId = null) {
  return [...Object.values(nodes).filter((n) => isFunction(n) && !n.sourceFunctionId && !n.lambda && n.id !== exceptId), ...Object.values(preludeDefs), ...Object.values(derivedDefs).filter((d) => !d.primitive), ...Object.values(classDefs)].map((n) => n.label)
}
// Why `label` can't name a custom function, or null if it can (a Haskell variable name not already taken).
function functionNameProblem(label, exceptId = null) {
  if (!/^[a-z_][A-Za-z0-9_']*$/.test(label)) return `"${label}" isn't a function name (a lowercase letter, then letters, digits, _ or ')`
  if (functionLabelsExcept(exceptId).includes(label)) return `"${label}" is already the name of a function`
  return null
}
const evaluator = createEvaluator({ nodes: definitions, functionBodies, get types() { return types }, elaboration: () => { const data = elaborationData(); return data && elaborationIndex(data, nodes, functionBodies) } })
const history = createHistory()
const functionLibrary = document.querySelector('#function-library')

function renderFunctionLibrary() {
  const items = Object.values(nodes).filter((n) => isFunction(n) && !n.sourceFunctionId && !isHiddenDefinition(n))
  const row = (node) => `
    <div class="function-library-row"><button class="library-item function-library-item ${state.activeFunction === node.id ? 'active' : ''}" data-function-id="${node.id}" title="Open ${escapeAttr(node.label)} definition">
      <span class="lib-icon function-icon">ƒ</span>
      <span><b>${escapeAttr(node.label)}</b><small>${functionChainHtml(node, nodes)}</small></span>
    </button><button class="add-call" data-add-function="${node.id}" aria-label="Add call to ${escapeAttr(node.label)}" title="Add call to ${escapeAttr(node.label)}">+</button></div>
  `
  // The builtins, grouped as the Prelude is (classGroups.js); one this version doesn't group goes last.
  const builtins = items.filter((n) => !n.custom)
  const grouped = new Set(BUILTIN_GROUPS.flatMap((g) => g.ids))
  const groups = [...BUILTIN_GROUPS.map((g) => [g.group, g.ids.map((id) => builtins.find((n) => n.id === id)).filter(Boolean), g.advanced]), ['Other', builtins.filter((n) => !grouped.has(n.id))]].filter(([, ns]) => ns.length)
  const groupHtml = ([group, ns]) => `<div class="builtin-group">${escapeAttr(group)}</div>${ns.map(row).join('')}`
  // The advanced ones (unused, or Int-only duplicates) fold away, as the class palette's do.
  const advanced = groups.filter(([, , adv]) => adv)
  functionLibrary.innerHTML = items.filter((n) => n.custom).map(row).join('') + `<details class="library-group" data-disclosure="builtin-functions"><summary>기본 함수</summary>${groups.filter(([, , adv]) => !adv).map(groupHtml).join('')}${advanced.length ? `<details class="builtin-advanced" data-disclosure="builtin-advanced"><summary><small>고급</small></summary>${advanced.map(groupHtml).join('')}</details>` : ''}</details>`
  restoreDisclosureState(functionLibrary)
  functionLibrary.querySelectorAll('.function-library-item').forEach((item) => {
    item.addEventListener('click', () => onLibraryFunction(item.dataset.functionId))
  })
  functionLibrary.querySelectorAll('[data-add-function]').forEach((button) => { button.onclick = () => addFunctionCall(button.dataset.addFunction) })
  renderParameterLibrary()
  renderTypeLibrary()
  renderClassLibrary()
  applySearch()
}
// Inside a function body, its parameters are listed in the workspace: each
// click puts another use of that parameter on the canvas as a value node (a
// reference to the body's parameter, shown just as the parameter itself).
function renderParameterLibrary() {
  const graph = activeNodes()
  const params = state.activeFunction ? Object.values(graph).filter((n) => n.type === 'parameter' && n.label !== '_') : []
  document.querySelector('#parameter-title').hidden = !params.length
  const library = document.querySelector('#parameter-library')
  const item = (p) => {
    const q = resolvedValueQual(p)
    return `<button class="library-item parameter-item" data-parameter-id="${escapeAttr(p.id)}" title="Add a use of this parameter to the canvas"><span class="lib-icon number-icon">#</span><span><b>${escapeAttr(p.label)}</b><small>${qualChainHtml(q.preds, q.type)}</small></span></button>`
  }
  library.innerHTML = params.filter((p) => !p.matchCapture).map(item).join('') + (params.some((p) => p.matchCapture) ? `<details class="match-outer-values" data-disclosure="outer-values:${state.activeFunction}"><summary>바깥 값</summary>${params.filter((p) => p.matchCapture).map(item).join('')}</details>` : '')
  library.querySelectorAll('.parameter-item').forEach((item) => { item.onclick = () => addParameterUse(item.dataset.parameterId) })
  if (nodes[state.activeFunction]?.matchBranch) {
    library.insertAdjacentHTML('beforeend', '<button class="library-item" id="match-capture">+ 바깥 값 가져오기</button>')
    library.querySelector('#match-capture').onclick = chooseMatchCapture
  }
  restoreDisclosureState(library)
}
function addParameterUse(parameterId) {
  if (readonlyBlocked()) return
  const graph = activeNodes()
  const parameter = graph[parameterId]
  if (!parameter) return
  const id = `ref-${Date.now()}`
  graph[id] = { id, type: 'ref', target: parameter.id, label: parameter.label, ...freePosition(graph, CHIP_W) }
  state.selected = id
  updateInspector(); draw()
}
// A λ (anonymous function), by lambda lifting: a hidden custom function
// owned by the graph it was made in, plus a call node to it — which *is* the
// λ on the canvas. Its slots are the λ's parameters; plugging an outer value
// into one captures it (a lifted capture is just an applied argument), and
// slots left open are what the λ still takes.
let lambdaCount = 0
function createLambda() {
  if (readonlyBlocked()) return
  const graph = activeNodes()
  const id = `lambda-${Date.now()}-${++lambdaCount}`
  nodes[id] = { id, type: 'function', label: 'λ', params: ['x'], mounted: [null], paramScopes: ['local'], scope: 'local', color: '#8b7cf2', custom: true, lambda: true, x: -9999, y: -9999 }
  functionBodies[id] = createFunctionBody(id, ['x'])
  addFunctionCall(id)
  renderFunctionLibrary()
  showToast('λ를 추가했어요 — 더블클릭(또는 본체 열기)해서 정의하고, 바깥 값을 슬롯에 꽂으면 캡처해요')
}

function beginPatternMatch(target) {
  if (!state.activeFunction || readonlyBlocked()) return
  let type = resolvedValueQual(target).type
  while (type?.kind === 'app') type = type.fn
  const choices = Object.values({ ...preludeTypes, ...types }).filter((d) => definitions[matchCaseId(d.name)])
  const add = (decl) => {
    const node = createMatch({ nodes, functionBodies }, activeNodes(), decl, target.id, { ownerId: state.activeFunction, ...freePosition(activeNodes(), 180 + decl.constructors.length * SLOT_STRIDE) })
    state.selected = node.id
    renderFunctionLibrary(); updateInspector(); draw(); fitToView()
  }
  const known = choices.find((d) => d.name === type?.name)
  if (known) return add(known)
  const dialog = document.createElement('dialog')
  dialog.className = 'type-picker'
  dialog.innerHTML = `<h3>매칭할 타입</h3><div class="constructor-options">${choices.map((d, i) => `<button class="library-item" data-choice="${i}">${escapeAttr([d.name, ...d.params].join(' '))}</button>`).join('') || '<p>먼저 타입을 추가하세요.</p>'}</div><form method="dialog"><button class="tool-button">취소</button></form>`
  dialog.querySelectorAll('[data-choice]').forEach((b) => { b.onclick = () => { add(choices[Number(b.dataset.choice)]); dialog.close() } })
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog); dialog.showModal()
}

function chooseMatchCapture() {
  const info = nodes[state.activeFunction]?.matchBranch
  if (!info) return
  const graph = info.ownerId ? functionBodies[info.ownerId] : nodes
  const node = graph?.[info.matchId]
  const branch = [...(node?.match.branches || []), node?.match.defaultBranch].find((b) => b?.fnId === state.activeFunction)
  if (!branch) return
  // Do not capture the match itself or any expression depending on its result.
  const choices = Object.values(graph).filter((n) => n.id !== node.id && !n.matchInternal && !isHiddenDefinition(n) && n.type !== 'output' && !subtreeOf(graph, n.id).has(node.id) && !branch.captures.includes(n.id))
  const dialog = document.createElement('dialog')
  dialog.className = 'type-picker'
  dialog.innerHTML = `<h3>바깥 값 가져오기</h3><div class="constructor-options">${choices.map((n, i) => `<button class="library-item" data-choice="${i}">${escapeAttr(nodeDisplayText(n, graph))}</button>`).join('') || '<p>가져올 값이 없습니다. 바깥 함수에서 값을 추가하세요.</p>'}</div><form method="dialog"><button class="tool-button">닫기</button></form>`
  dialog.querySelectorAll('[data-choice]').forEach((b) => { b.onclick = () => {
    captureMatchValue({ nodes, functionBodies }, graph, branch, choices[Number(b.dataset.choice)].id)
    if (branch === node.match.defaultBranch) node.match.branches.forEach((arm, i) => { if (arm.useDefault) setMatchDefault({ nodes, functionBodies }, graph, node, i) })
    dialog.close(); renderFunctionLibrary(); updateInspector(); draw()
  } })
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog); dialog.showModal()
}
// The name always opens the definition; the separate + always inserts a call.
function onLibraryFunction(id) {
  if (nodes[id]?.custom) enterFunction(id)
  else openDefinitionView(id)
}
function renderPreludeLibrary() {
  document.querySelector('#prelude-library').innerHTML = PRELUDE.map(([group, fns]) => `<div class="prelude-group">${group}</div>${fns.map(([builtin]) => {
    const def = preludeDefs[`prelude:${builtin}`]
    const sch = builtin === 'listOf' ? listOfScheme(3) : builtinSchemes[builtin]
    const mine = nodes[def.id]?.library // taken over: your own graph runs
    return `<button class="derived-item${mine ? ' edited' : ''}" data-function-id="${def.id}" title="Add to the canvas${mine ? ' · your own graph (double-click a call to open it)' : ''}"><b>${def.label}${mine ? ' ✎' : ''}</b><small>${qualChainHtml(sch.preds, sch.type)}</small></button>`
  }).join('')}`).join('')
  // The Prelude's own data types (library.js): their constructors and eliminators.
  const byType = {}
  for (const def of Object.values(preludeTypeDefs)) if (def.derived.op !== 'case') (byType[def.derived.type] ||= []).push(def)
  // Each constructor and eliminator can be customized like a declared type's (✎).
  // A type taken over is listed in TYPES instead; one that can be taken over has its own ✎.
  const head = (d) => (d.name === '(,)' ? '(a, b)' : [d.name, ...d.params].join(' '))
  const takeOver = (d) => (TAKEABLE_TYPES.includes(d.name) ? `<button class="derived-edit prelude-take-type" data-type-name="${escapeAttr(d.name)}" title="Take the declaration over: edit it in the type editor">✎</button>` : '')
  document.querySelector('#prelude-library').insertAdjacentHTML('beforeend', Object.values(preludeTypes).map((d) => types[d.name] ? `<div class="prelude-group" title="Your declaration is in TYPES">${d.keyword} ${escapeAttr(head(d))} <i class="customized">✎ yours</i></div>` : `<div class="derived-row"><div class="prelude-group" title="${escapeAttr(d.source)}">${d.keyword} ${escapeAttr(head(d))}</div>${takeOver(d)}</div>${(byType[d.name] || []).map((def) => `<div class="derived-row"><button class="derived-item" data-function-id="${def.id}" title="Add to the canvas"><b>${escapeAttr(def.label)}${nodes[def.id]?.override ? ' <i class="customized">✎ custom</i>' : ''}</b><small>${qualChainHtml(def.scheme.preds, def.scheme.type)}</small></button><button class="derived-edit" data-edit-id="${def.id}" title="${nodes[def.id]?.override ? 'Open its custom body' : 'Customize: redefine it with a body of your own'}">✎</button></div>`).join('')}`).join(''))
  const preludeLibrary = document.querySelector('#prelude-library')
  let group = null
  for (const child of [...preludeLibrary.children]) {
    const heading = child.matches('.prelude-group') ? child : child.querySelector('.prelude-group')
    if (heading) {
      group = document.createElement('details')
      group.className = 'library-group'
      const summary = document.createElement('summary')
      summary.textContent = heading.textContent
      group.append(summary)
      preludeLibrary.insertBefore(group, child)
      heading.remove()
      if (child !== heading && child.childElementCount) group.append(child)
    } else if (group) group.append(child)
  }
  restoreDisclosureState(preludeLibrary)
  document.querySelectorAll('#prelude-library .derived-item').forEach((item) => { item.onclick = () => addFunctionCall(item.dataset.functionId) })
  document.querySelectorAll('#prelude-library .derived-edit[data-edit-id]').forEach((item) => { item.onclick = () => editDerived(item.dataset.editId) })
  document.querySelectorAll('#prelude-library .prelude-take-type').forEach((item) => { item.onclick = () => takeOverPreludeType(item.dataset.typeName) })
  applySearch()
}
// --- Search ---------------------------------------------------------------
// Filters every sidebar entry — functions, functions derived from types,
// the Prelude — by name or signature. Enter adds the first hit to the graph
// you're looking at (a custom function on `main` opens its body instead).
const searchInput = document.querySelector('.search input')
function searchHits() {
  return [...document.querySelectorAll('#value-library .library-item, .function-library-item, #type-library .derived-item, #class-library .derived-item, #prelude-library .derived-item')].filter((item) => !item.hidden && !item.closest('[hidden]'))
}
const searchExpansion = new Map()
function applySearch() {
  const q = searchInput.value.trim().toLowerCase()
  const matches = (el) => !q || (el?.textContent || '').toLowerCase().includes(q)
  document.querySelectorAll('#value-library .library-item, .function-library-item, #prelude-library .derived-item').forEach((item) => {
    item.hidden = !matches(item)
    const row = item.closest('.function-library-row, .derived-row')
    if (row) row.hidden = item.hidden
  })
  document.querySelectorAll('#type-library .type-entry, #class-library .type-entry').forEach((entry) => {
    const typeHit = matches(entry.querySelector('.type-item'))
    const items = [...entry.querySelectorAll('.derived-item')]
    items.forEach((item) => {
      item.hidden = !(typeHit || matches(item))
      const row = item.closest('.derived-row')
      if (row) row.hidden = item.hidden
    })
    entry.hidden = !typeHit && items.every((item) => item.hidden)
  })
  document.querySelectorAll('.node-library details').forEach((group) => {
    const items = [...group.querySelectorAll('.function-library-item, .derived-item, .type-item')]
    const any = items.some((item) => !item.hidden && !item.closest('.type-entry[hidden]'))
    group.hidden = !!q && !any
    if (q) {
      if (!searchExpansion.has(group)) searchExpansion.set(group, group.open)
      if (any) group.open = true
    } else if (searchExpansion.has(group)) {
      group.open = searchExpansion.get(group)
      searchExpansion.delete(group)
    }
  })
  if (!q) searchExpansion.clear()
  // A group heading shows only while some row under it does.
  document.querySelectorAll('.node-library .builtin-group').forEach((heading) => {
    let rows = 0, shown = 0
    for (let el = heading.nextElementSibling; el && !el.matches('.builtin-group'); el = el.nextElementSibling) {
      if (!el.matches('.function-library-row')) continue
      rows++
      if (!el.hidden) shown++
    }
    heading.hidden = rows > 0 && shown === 0
  })
  const valueTitle = document.querySelector('#value-library').previousElementSibling
  valueTitle.hidden = [...document.querySelectorAll('#value-library .library-item')].every((item) => item.hidden)
}
function setupSearch() {
  searchInput.addEventListener('input', applySearch)
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const hit = searchHits()[0]
      if (!hit) return showToast(`"${searchInput.value}"와 맞는 블록이 없어요`)
      if (hit.matches('.function-library-item')) addFunctionCall(hit.dataset.functionId)
      else hit.click()
      searchInput.value = ''
      applySearch()
      searchInput.blur()
    } else if (event.key === 'Escape') {
      searchInput.value = ''
      applySearch()
      searchInput.blur()
    }
  })
}
const typeLibrary = document.querySelector('#type-library')
function renderTypeLibrary() {
  document.querySelector('#type-palette').innerHTML = typePaletteHtml()
  const byType = Object.groupBy(Object.values(derivedDefs).filter((def) => !def.primitive), (def) => def.derived.type)
  const row = (def) => `<div class="derived-row"><button class="derived-item" data-function-id="${def.id}" title="Add to the canvas"><b>${escapeAttr(def.label)}${nodes[def.id]?.override ? ' <i class="customized">✎</i>' : ''}</b><small>${qualChainHtml(def.scheme.preds, def.scheme.type)}</small></button><button class="derived-edit" data-edit-id="${def.id}" title="정의 편집">✎</button></div>`
  typeLibrary.innerHTML = Object.values(types).map((d) => `
    <div class="type-entry">
      <div class="type-library-head">
      <button class="library-item type-item" data-type-name="${d.name}" title="Edit declaration">
        <span class="lib-icon type-icon">T</span>
        <span><b>${[d.name, ...(d.params || [])].join(' ')}${d.library ? ' <i class="customized">✎</i>' : ''}</b>${d.constructors.length > 1 ? `<small>${d.constructors.map((c) => c.name).join(' | ')}</small>` : ''}</span>
      </button>
      <button class="add-call add-type-call" data-type-name="${d.name}" title="생성자 호출 추가 · 캔버스로 드래그">+</button></div>
      ${d.constructors.length > 1 ? (byType[d.name] || []).filter((def) => def.derived.op === 'construct').map(row).join('') : ''}
      <details class="type-functions" data-disclosure="type-functions:${escapeAttr(d.name)}"><summary>필드 · 함수</summary>${(byType[d.name] || []).filter((def) => !['case', 'construct'].includes(def.derived.op)).map(row).join('')}${d.constructors.length === 1 ? (byType[d.name] || []).filter((def) => def.derived.op === 'construct').map(row).join('') : ''}</details>
    </div>`).join('')
  typeLibrary.querySelectorAll('.type-item').forEach((item) => { item.onclick = () => openTypeEditor(item.dataset.typeName) })
  typeLibrary.querySelectorAll('.add-type-call').forEach((item) => {
    item.onclick = () => addTypeCall(item.dataset.typeName)
    item.onpointerdown = (event) => {
      if (event.button !== 0) return
      const start = { x: event.clientX, y: event.clientY }
      const move = (e) => { if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) item.dataset.dragging = 'true' }
      const up = (e) => {
        document.removeEventListener('pointermove', move)
        const dragged = item.dataset.dragging
        delete item.dataset.dragging
        if (!dragged) return
        const rect = canvas.getBoundingClientRect()
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) addTypeCall(item.dataset.typeName, { x: (e.clientX - rect.left - state.offset.x) / state.zoom, y: (e.clientY - rect.top - state.offset.y) / state.zoom })
        item.onclick = null
        setTimeout(() => { item.onclick = () => addTypeCall(item.dataset.typeName) }, 0)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up, { once: true })
    }
  })
  typeLibrary.querySelectorAll('.derived-item').forEach((item) => { item.onclick = () => addFunctionCall(item.dataset.functionId) })
  typeLibrary.querySelectorAll('.derived-edit').forEach((item) => { item.onclick = () => editDerived(item.dataset.editId) })
  restoreDisclosureState(typeLibrary)
}

function addTypeCall(name, position) {
  const d = types[name]
  if (!d) return
  const add = (ctor) => {
    addFunctionCall(`type:${name}:${ctor.name}`)
    if (position && activeNodes()[state.selected]) Object.assign(activeNodes()[state.selected], position)
    updateInspector(); draw()
  }
  if (d.constructors.length === 1) return add(d.constructors[0])
  const dialog = document.createElement('dialog')
  dialog.className = 'type-picker constructor-picker'
  dialog.innerHTML = `<h3>${escapeAttr(name)} 생성자</h3><div class="constructor-options">${d.constructors.map((c, i) => `<button class="library-item" data-choice="${i}">${escapeAttr(c.name)}</button>`).join('')}</div><form method="dialog"><button class="tool-button">취소</button></form>`
  dialog.querySelectorAll('[data-choice]').forEach((button) => { button.onclick = () => { add(d.constructors[Number(button.dataset.choice)]); dialog.close() } })
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog); dialog.showModal()
}
// Whether `id` (or the primitive `prim:<id>`) is something a Prelude type derives.
const definitionsOfPrelude = (id) => !!preludeTypeDefs[id.replace(/^prim:/, '')]
// Take Prelude type `name` over: its declaration becomes the project's, opened in the type editor (typeEdits.js).
function takeOverPreludeType(name) {
  if (!types[name]) applyTypes(takeOverType(types, preludeTypes[name]))
  openTypeEditor(name)
  renderFunctionLibrary(); renderPreludeLibrary(); updateInspector(); draw()
  showToast(`${name} is your declaration now — name its fields, derive classes, write its instances (its constructors stay the runtime's)`)
}
// Customize a derived function (or open its customization): its body
// starts as a call to its primitive, `wallet m = wallet# m`, ready to be
// changed. Every existing call now runs the custom body.
function editDerived(id) {
  const def = derivedDefs[id] ?? preludeTypeDefs[id]
  if (!def || def.primitive) return
  const fresh = !nodes[id]
  if (fresh) customizeDerived({ nodes, functionBodies }, def)
  closeTypeEditor()
  state.activeFunction = null
  enterFunction(id)
  if (fresh) renderPreludeLibrary()
  if (fresh) showToast(`${def.label} is now yours to edit — its body starts as the primitive ${primLabel(def.label)}. Reset it ${preludeTypeDefs[id] ? "from its Output's inspector" : 'in the type editor'}.`)
}
function resetDerivedFunction(id) {
  if (state.activeFunction === id || state.functionStack.includes(id)) { state.activeFunction = null; state.functionStack = [] }
  resetDerived({ nodes, functionBodies }, id)
  renderFunctionLibrary(); renderPreludeLibrary(); updateInspector(); draw()
}
// --- Type editor -------------------------------------------------------------
// A type is shown and edited as its Haskell declaration, an algebraic data
// type: `data Shape a = Circle { r :: Double } | Poly [a] deriving (…)` —
// a line per constructor (`|`: a value is one of them, a sum), each with its
// fields (a product), named (record syntax) or not. A field's type is a slot
// for the same type nodes as a signature, dragged from TYPES; a constructor's
// comment is its type as a function (`-- Circle :: Double ▸ Shape a`). Every edit is turned back into a Haskell
// declaration (typeDecls.js' draftToSource) and checked by declareTypes; a
// valid edit applies at once (undoable), an invalid one shows why and waits.
//
// Each constructor and field carries a key for as long as the editor is
// open, so an edit can be told apart from a delete-and-add: renaming the
// field `wallet` renames every `wallet`/`set wallet`/`over wallet` call,
// adding a field gives every constructor call a new empty slot, adding a
// constructor gives every case call a new branch (typeEdits.js).
const typePanel = document.querySelector('#type-panel')
let typeEditor = null // { original: name of the declaration being edited (null until first applied), draft, appliedDraft: the draft as last applied }
function keyed(draft) {
  return ensureTypeKeys(draft)
}
function editorFor(name) {
  const draft = keyed(declToDraft(types[name]))
  return { original: name, draft, appliedDraft: structuredClone(draft) }
}
// Where each constructor/field of draft `before` went in draft `after` (see typeEdits.js' derivedRenames).
function draftKeyMap(before, after) {
  const ctors = before.constructors.map((c) => { const j = after.constructors.findIndex((x) => x.key === c.key); return j < 0 ? undefined : j })
  const fields = before.constructors.map((c, i) => {
    const next = after.constructors[ctors[i]]
    return c.fields.map((fl) => { const k = next ? next.fields.findIndex((x) => x.key === fl.key) : -1; return k < 0 ? undefined : k })
  })
  return { ctors, fields }
}
function openTypeEditor(name = null) {
  stopGame()
  classEditor = null
  universeOpen = false
  if (!name) {
    // A new type: one constructor without fields, under a free name — valid at once.
    let n = 1
    while (types[`NewType${n === 1 ? '' : n}`]) n++
    const draft = declToDraft(null)
    draft.name = draft.constructors[0].name = `NewType${n === 1 ? '' : n}`
    typeEditor = { original: null, draft: keyed(draft), appliedDraft: null }
    applyTypeDraft()
  } else typeEditor = editorFor(name)
  typePanel.hidden = false
  renderTypeEditor()
}

// --- Type universe ------------------------------------------------------------
// Every type and class of the project as one graph (declGraph.js'
// universeGraph): a type points at the types whose fields use it, a
// superclass at its subclasses, a type at the classes it has an instance
// of. A click on a card opens that declaration's own graph; ◎ in its bar
// comes back here.
let universeOpen = false
function universeButtonHtml() { return '<button class="tool-button" data-universe title="All types and classes as one graph">◎ 타입 우주</button>' }
function openUniverse() {
  stopGame()
  typeEditor = null
  classEditor = null
  universeOpen = true
  typePanel.hidden = false
  renderUniverse()
}
function renderUniverse() {
  if (!universeOpen) return
  const graph = universeGraph(types, classes, instances)
  typePanel.innerHTML = `
    <div class="play-bar type-bar"><b>타입 우주</b>
      <span class="te-status ok">${Object.keys(types).length} types · ${Object.keys(classes).length} classes</span>
      <button class="tool-button" data-u="add-type">+ type</button>
      <button class="tool-button" data-u="add-class">+ class</button>
      <button class="tool-button icon-only" data-u="close" title="Back to the canvas">×</button>
    </div>
    <p class="te-hint decl-hint">A type points at the types that use it in a field and at the classes it has an instance of; a superclass points at its subclasses. Click a card to open its declaration.</p>
    <div class="decl-host"></div>`
  typePanel.querySelector('[data-u="add-type"]').onclick = () => openTypeEditor()
  typePanel.querySelector('[data-u="add-class"]').onclick = () => openClassEditor()
  typePanel.querySelector('[data-u="close"]').onclick = closeTypeEditor
  const host = typePanel.querySelector('.decl-host')
  if (!graph.nodes.length) { host.innerHTML = '<p class="decl-empty">No types or classes yet — + type or + class to start.</p>'; return }
  const card = (n) => n.kind === 'type'
    ? `<div class="decl-kind">${n.library ? 'type · Prelude, yours' : 'type'}</div><div class="decl-head"><span class="lib-icon type-icon">T</span><b>${escapeAttr([n.name, ...n.params].join(' '))}</b></div><small class="decl-sub">${escapeAttr(n.constructors.join(' | '))}</small>`
    : `<div class="decl-kind">${n.builtin ? 'class · builtin' : 'class'}</div><div class="decl-head"><span class="lib-icon class-icon">C</span><b>${escapeAttr(n.builtin ? n.name : `${n.name} ${n.param}`)}</b></div>`
  drawDeclGraph(host, {
    graph, at: layoutGraph(graph, layouts.universe, { universe: true }), fixed: new Set(Object.keys(layouts.universe || {})), viewKey: 'universe', card,
    className: () => 'decl-openable',
    onMoved: (_, positions) => { layouts.universe = { ...positions }; draw() },
    onOpen: (id) => {
      const [kind, name] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
      if (kind === 'type') openTypeEditor(name)
      else openClassEditor(name)
    },
  })
}
// A renamed declaration's layout goes with it.
function moveLayout(from, to) {
  if (from === to || !layouts[from]) return
  layouts[to] = layouts[from]
  delete layouts[from]
}
function closeTypeEditor() {
  typeEditor = null
  classEditor = null
  universeOpen = false
  typePanel.hidden = true
  typePanel.innerHTML = ''
}

// Check the draft; apply it if valid — rewiring every call to what the
// type derives (renamed, reshaped). Returns the error message, or ''.
// Deriving clauses and instances aren't edited here (a type is its
// constructors): Eq, Ord and Show are derived whenever the fields allow,
// and a class an edit makes impossible — say a field no longer has it — is
// dropped rather than refusing the edit.
const AUTO_STOCK = ['Eq', 'Ord', 'Show']
function applyTypeDraft() {
  const d = keyed(typeEditor.draft)
  // Comparing and showing are just there when the fields allow them (dropped quietly when they don't).
  const auto = AUTO_STOCK.filter((cls) => !d.deriving.stock.includes(cls) && !(instances[cls] || []).some((i) => i.head === (typeEditor.original || d.name)))
  d.deriving.stock.push(...auto)
  let checked
  try {
    checked = checkTypeDraft(d)
  } catch (e) {
    if (!(e instanceof DeclError)) throw e
    const dropped = dropImpossibleInstances(d)
    if (!dropped) {
      d.deriving.stock = d.deriving.stock.filter((cls) => !auto.includes(cls))
      return e.message
    }
    checked = checkTypeDraft(d)
    const noticed = dropped.filter((cls) => !auto.includes(cls) && !AUTO_STOCK.includes(cls))
    if (noticed.length) showToast(`${d.name} no longer has ${noticed.join(', ')} (it isn't possible after this edit)`)
  }
  const { before, next, nextClasses, nextInstances } = checked
  next[d.name].constructors.forEach((c, i) => {
    c.key = d.constructors[i].key
    c.fields.forEach((f, j) => { f.key = d.constructors[i].fields[j].key })
  })
  const changed = before && typeEditor.appliedDraft ? migrateTypeEdit({ nodes, functionBodies }, before, next[d.name], draftKeyMap(typeEditor.appliedDraft, d)) : 0
  if (before && d.name !== before.name) renameTypeInAnnotations(before.name, d.name)
  if (before && d.name !== before.name) moveLayout(layoutKey('type', before.name), layoutKey('type', d.name))
  applyTypes(next, nextClasses, nextInstances)
  typeEditor.original = d.name
  typeEditor.appliedDraft = structuredClone(d)
  if (changed) showToast(`Updated ${changed} call${changed > 1 ? 's' : ''} to match`)
  renderFunctionLibrary(); updateInspector(); draw()
  return ''
}
// The declarations draft `d` would make (throws DeclError if it can't).
function checkTypeDraft(d) {
  const before = typeEditor.original ? types[typeEditor.original] : null
  // A taken-over Prelude type keeps what the runtime relies on (typeEdits.js); its
  // constructors are the Prelude's own names for them (`Just` is both).
  const library = before?.library ? [before.name] : []
  const own = new Set(library.length ? preludeTypes[before.name].constructors.map((c) => c.name) : [])
  const labels = [...Object.values(nodes).filter((n) => isFunction(n) && !n.sourceFunctionId && !isHiddenDefinition(n)), ...Object.values(preludeDefs)].map((n) => n.label).filter((l) => !own.has(l))
  if (library.length && d.name !== before.name) throw new DeclError(libraryTypeProblem(preludeTypes[before.name], { ...before, name: d.name }))
  // Renaming a type renames it in the declarations that mention it.
  const base = before && d.name !== before.name ? renameTypeReferences(types, before.name, d.name) : types
  // Classes and instances mention types too (method signatures, instance heads): they follow a rename, and must still make sense.
  const renamed = before && d.name !== before.name
  const nextClasses = renamed ? renameTypeInClasses(classes, before.name, d.name) : classes
  const nextInstances = renamed ? renameTypeInInstances(instances, before.name, d.name) : instances
  const next = declareTypes(base, draftToSource(d), { replacing: typeEditor.original, functionLabels: [...labels, ...Object.values(classDefs).map((c) => c.label)], assumed: (ts) => writtenEnvironment(nextInstances, ts), library })
  const problem = library.length ? libraryTypeProblem(preludeTypes[before.name], next[d.name]) : ''
  if (problem) throw new DeclError(problem)
  declareClasses(nextClasses, next, classLabelsTaken(), nextInstances)
  return { before, next, nextClasses, nextInstances }
}
// Keep only the derived classes of `d` that still declare; returns the
// dropped classes' names, or null if `d` fails even without any.
function dropImpossibleInstances(d) {
  const kept = { deriving: structuredClone(d.deriving) }
  const ok = () => { try { checkTypeDraft(d); return true } catch (e) { if (e instanceof DeclError) return false; throw e } }
  d.deriving = Object.fromEntries(Object.keys(kept.deriving).map((g) => [g, []]))
  if (Object.values(kept.deriving).every((cs) => !cs.length)) return null
  if (!ok()) { Object.assign(d, kept); return null }
  // Add them back while they still fit — repeatedly, as one may need another (AddMonoid needs AddSemigroup).
  let pending = Object.entries(kept.deriving).flatMap(([g, cs]) => cs.map((cls) => ({ g, cls })))
  for (let progress = true; progress && pending.length; ) {
    progress = false
    pending = pending.filter((x) => {
      d.deriving[x.g].push(x.cls)
      if (ok()) { progress = true; return false }
      d.deriving[x.g].pop()
      return true
    })
  }
  return pending.map((x) => x.cls)
}
// Type annotations mention types by name (typeExpr.js): they follow a rename.
function renameTypeInAnnotations(from, to) {
  const word = new RegExp(`\\b${from}\\b`, 'g')
  for (const graph of Object.values(functionBodies)) for (const n of Object.values(graph)) if (n.annotation && n.type !== 'number') n.annotation = n.annotation.replace(word, to)
}

// Custom function `fnId`'s generalized type, or why it can't be checked yet (a string).
function implementationScheme(fnId) {
  if (!nodes[fnId]) return 'pick a function'
  if (!functionBodies[fnId]?.output?.source) return 'its Output is not connected yet'
  const entry = typePass(nodes).perNode.get(fnId)
  if (!entry?.paramTypes) return 'no type yet'
  return generalize(entry.preds || [], entry.paramTypes.reduceRight((acc, t) => tfun(t, acc), entry.resultType))
}

// A custom function to implement `method` for type `typeName`, named after both (`showMoney`), with an open body.
function createMethodFunction(method, typeName, params = METHOD_PARAMS[method]) {
  let label = `${method}${typeName}`
  for (let k = 2; functionNameProblem(label); k++) label = `${method}${typeName}${k}`
  const id = `custom-${Date.now()}-${method}-${Math.random().toString(36).slice(2, 6)}`
  nodes[id] = { id, type: 'function', ...freePosition(nodes, 120 + params.length * SLOT_STRIDE), label, params: [...params], mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true }
  functionBodies[id] = createFunctionBody(id, params)
  delete functionBodies[id].output.source
  functionBodies[id].output.value = 'open'
  return id
}

function chooseType(title, commit, { variable = false, initial = '' } = {}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'type-picker'
  const choices = variable ? ['a', 'b', 'c', 'd', 'e', 'f'] : [...new Set(typePalette().flatMap((g) => g.items.map((it) => typeText(constructorWithHoles(it.name))))), 'a', 'b', '_']
  dialog.innerHTML = `<form><h2>${escapeAttr(title)}</h2><label for="pick-type">${variable ? 'Type variable' : 'Type'}</label><input id="pick-type" name="type" value="${escapeAttr(initial)}" placeholder="${variable ? 'a' : 'Int, Maybe Int, [a]…'}" autocomplete="off" required /><div class="type-choices">${choices.map((type) => `<button type="button" data-choice="${escapeAttr(type)}">${escapeAttr(type)}</button>`).join('')}</div><p class="type-error" role="alert"></p><div class="dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Apply</button></div></form>`
  document.body.append(dialog)
  const form = dialog.querySelector('form')
  const input = form.elements.type
  dialog.querySelectorAll('[data-choice]').forEach((button) => { button.onclick = () => { input.value = button.dataset.choice; input.focus() } })
  const close = () => { dialog.close(); dialog.remove() }
  dialog.querySelector('[data-cancel]').onclick = close
  dialog.addEventListener('close', () => dialog.remove())
  form.onsubmit = (event) => {
    event.preventDefault()
    try {
      const type = typeFromText(input.value.trim())
      if (variable && type.kind !== 'var') throw new Error('Use a type variable such as a or b.')
      commit(type)
      close()
    } catch (error) { dialog.querySelector('.type-error').textContent = error.message }
  }
  dialog.showModal()
  input.focus()
}

function renderTypeEditor(error = '') {
  if (!typeEditor) return
  const d = typeEditor.draft
  const applied = typeEditor.original && types[typeEditor.original]
  const chainOfDef = (id) => {
    const def = derivedDefs[id]
    return def ? qualChainHtml(def.scheme.preds, def.scheme.type) : ''
  }
  const derived = applied ? Object.values(derivedDefs).filter((def) => def.derived.type === typeEditor.original && !def.primitive && def.derived.op !== 'construct') : []
  const namer = createNamer()
  // A field's type, as type nodes (a slot of the same type drag as signatures); text that doesn't parse yet is shown as is.
  const fieldType = (f) => { try { return typeFromText(f.type || '_') } catch { return null } }
  const derivingText = applied ? applied.deriving.filter((c) => c.classes.length).map((c) => `deriving${c.strategy === 'stock' ? '' : ` ${c.strategy}`} (${c.classes.join(', ')})`).join(' ') : ''
  // A name is a token of the declaration, renamed by clicking it — names are the only thing typed here.
  const ident = (kind, name, title, data = '') => `<button class="te-ident te-ident-${kind}" data-ident="${kind}"${data} title="${escapeAttr(title)} — click to rename">${escapeAttr(name)}</button>`
  const field = (ci, f, fi, record) => {
    const t = fieldType(f)
    const getId = `type:${typeEditor.original}:${f.name}`
    const actions = d.constructors.length === 1 && derivedDefs[getId] ? `<details class="te-field-actions"><summary title="필드 사용">⋯</summary>${[['읽기', f.name], ['바꾸기', `set ${f.name}`], ['고치기', `over ${f.name}`]].map(([label, name]) => `<button data-use-derived="type:${typeEditor.original}:${name}">${label}</button>`).join('')}</details>` : ''
    return `<div class="te-field" data-field-row="${fi}">${ident('field', f.name || `field${fi + 1}`, '필드 이름', ` data-ci="${ci}" data-fi="${fi}"`)}<i>::</i><span class="te-ftype" data-fi="${fi}" title="필드 타입 선택">${t ? typeNodeHtml(t, namer, { paths: true, named: true }) : `<span class="tn tn-con">${escapeAttr(f.type)}</span>`}</span>${actions}<button class="te-x" data-te="drop-field" data-fi="${fi}" title="필드 삭제">−</button></div>`
  }
  // The kinds the declaration gives the type and its parameters (once applied).
  const kindOf = (i) => { try { return applied ? showKind(i === undefined ? constructorKind(applied.name) : paramKind(applied, i), '▸') : '' } catch { return '' } }
  const sub = (n) => String(n).replace(/\d/g, (x) => '₀₁₂₃₄₅₆₇₈₉'[x])
  const cards = {
    type: () => `
      <div class="decl-head">
        ${ident('type', d.name, 'Type name')}
        ${(d.params || []).map((v, i) => `<span class="te-param"><span class="tn tn-var" style="--tc:${colorForType(tvar(v), namer)}">${escapeAttr(v)}</span><button class="te-x" data-te="drop-param" data-pi="${i}" title="타입 매개변수 삭제">−</button></span>`).join(' ')}
        <button class="te-drop te-add-param" data-te="add-param" title="타입 매개변수 추가" aria-label="Add type parameter">+</button>
      </div>
      `,
    param: (n) => `
      <div class="decl-kind">parameter${kindOf(n.index) ? ` :: ${escapeAttr(kindOf(n.index))}` : ''}</div>
      <span class="te-param"><span class="tn tn-var" style="--tc:${colorForType(tvar(n.name), namer)}">${escapeAttr(n.name)}</span><button class="te-x" data-te="drop-param" data-pi="${n.index}" title="Remove this type parameter">−</button></span>`,
    ctor: (n) => {
      const ci = n.index, c = d.constructors[ci]
      const record = c.fields.some((f) => f.name)
      return `
      <div class="decl-head">
        ${d.constructors.length === 1 && c.name === d.name ? `<details class="te-ctor-options"><summary>생성자 설정</summary>${ident('ctor', c.name, '생성자 이름', ` data-ci="${ci}"`)}</details>` : ident('ctor', c.name, '생성자 이름', ` data-ci="${ci}"`)}
        <button class="te-use" data-te="use-ctor" title="이 생성자를 함수처럼 추가">+ 사용</button>
        ${ci ? '<button class="te-x" data-te="move-ctor" title="생성자 위로 이동">↑</button>' : ''}
        ${d.constructors.length > 1 ? '<button class="te-x" data-te="drop-ctor" title="Remove constructor">×</button>' : ''}
      </div>
      <div class="decl-fields">${c.fields.map((f, fi) => field(ci, f, fi, record)).join('')}<button class="te-drop te-add" data-te="add-field" title="Add field — click to choose or drop a type" aria-label="Add field">+</button></div>
      `
    },
    derived: (n) => `
      <div class="decl-kind">${{ get: 'projections π', update: 'updates (set / over)', case: 'copairing [f₁, …, fₙ]', fold: 'recursor (fold)' }[n.op] ?? 'derived'}</div>
      ${n.fns.map(({ fnId }) => {
        const def = derivedDefs[fnId]
        const custom = nodes[def.id]?.override
        const changed = custom && !isPristineOverride({ nodes, functionBodies }, def)
        return `<div class="te-derived"><b>${escapeAttr(def.label)}</b> <small>${chainOfDef(def.id)}</small> ${custom ? `<i class="customized">✎ custom${changed ? '' : ' (unchanged)'}</i> <button class="law-check" data-edit="${def.id}">Edit body →</button> <button class="law-check" data-reset="${def.id}" title="Back to the derived definition">Reset</button>` : `<button class="law-check icon-only" data-edit="${def.id}" title="Customize: redefine it with a body of your own (starting from ${escapeAttr(primLabel(def.label))})">✎</button>`}</div>`
      }).join('')}`,
  }
  typePanel.innerHTML = `
    <div class="play-bar type-bar"><b>TYPE</b>
      <span class="te-status ${error ? 'bad' : 'ok'}" role="status">${error ? escapeAttr(error) : ''}</span>
      ${universeButtonHtml()}
      ${applied?.library ? `<button class="tool-button" data-te="delete" title="Drop your declaration: ${escapeAttr(d.name)} is the Prelude's again">↺ Prelude's ${escapeAttr(d.name)}</button>` : '<button class="tool-button" data-te="delete">Delete type</button>'}
      <button class="tool-button icon-only" data-te="close" title="Back to the canvas">×</button>
    </div>
    <div class="te-simple">
      ${cards.type()}
      <div class="te-constructors ${d.constructors.every((c) => !c.fields.length) ? 'te-choices' : ''}">${d.constructors.map((c, index) => `<section class="te-ctor" data-ci="${index}">${cards.ctor({ index })}</section>`).join('')}</div>
      <button class="te-drop te-add-ctor" data-te="add-ctor" title="생성자 추가 또는 타입 드롭">+ 생성자</button>
      <details class="te-details" data-disclosure="type-details:${escapeAttr(d.name)}"><summary>상세 설정</summary>
        <div class="te-settings"><button class="te-keyword" data-te="keyword" title="data / newtype">${d.keyword}</button><small>${escapeAttr(kindOf())}</small><span>${escapeAttr(derivingText)}</span></div>
        ${graphDetailsHtml()}
        <details><summary>구조 그래프</summary><div class="decl-host te-structure"></div></details>
      </details>
    </div>`
  function graphDetailsHtml() {
    const groups = typeGraph(d, { derived: derived.filter((def) => def.derived.op !== 'case').map((def) => ({ id: def.id, label: def.label, op: def.derived.op })) }).nodes.filter((n) => n.kind === 'derived')
    return groups.map((n) => `<details class="te-function-group"><summary>${{ get: '필드 읽기', update: '필드 갱신', fold: '재귀 함수' }[n.op] || n.op}</summary>${cards.derived(n)}</details>`).join('')
  }
  // The declaration as a graph (declGraph.js): the type, its parameters, its constructors injecting into it, what it derives.
  const graph = typeGraph(d, { derived: derived.map((def) => ({ id: def.id, label: def.label, op: def.derived.op })) })
  graph.edges = graph.edges.map((e) => (e.field === undefined ? e : { ...e, toPort: `[data-field-row="${e.field}"]` }))
  const key = layoutKey('type', typeEditor.original || d.name)
  const at = layoutGraph(graph, layouts[key])
  drawDeclGraph(typePanel.querySelector('.decl-host'), {
    graph, at, viewKey: key, fixed: new Set(Object.keys(layouts[key] || {})),
    card: (n) => `<b>${escapeAttr(n.name || n.op)}</b>${n.fields ? `<small>${n.fields.map((f) => escapeAttr(f.type)).join(', ')}</small>` : ''}`,
    className: () => '',
    onMoved: (_, positions) => {
      layouts[key] = { ...positions }
      draw()
    },
  })
  restoreDisclosureState(typePanel)
  // Every _ must be filled before the declaration can apply.
  const update = (mutate) => { mutate(d); renderTypeEditor(d.constructors.some((c) => c.fields.some((f) => /(^|[^\w'])_(?![\w'])/.test(f.type))) ? 'Fill each _ in a field — drag a type into it' : applyTypeDraft()) }
  // A type variable a field mentions must be a parameter of the type (as in Haskell): it's added by itself.
  const addParamsOf = (type) => {
    const vars = typeText(type).match(/(?<![\w'])[a-z][\w']*/g) || []
    d.params = [...(d.params || []), ...new Set(vars.filter((v) => !(d.params || []).includes(v)))]
  }
  const $ = (sel) => typePanel.querySelector(sel)
  const renames = {
    type: (name) => {
      const old = d.name
      d.name = name
      // a lone constructor named after the type follows its rename (the Haskell convention)
      if (d.constructors.length === 1 && d.constructors[0].name === old) d.constructors[0].name = d.name
      // and so does a field that mentions the type itself (a recursive type)
      const self = new RegExp(`\\b${old}\\b`, 'g')
      if (/^[A-Z]\w*$/.test(d.name)) d.constructors.forEach((c) => c.fields.forEach((fl) => { fl.type = fl.type.replace(self, d.name) }))
    },
    ctor: (name, el) => {
      const c = d.constructors[Number(el.dataset.ci)]
      // its card stays where it is
      const key = layoutKey('type', typeEditor.original || d.name)
      if (layouts[key]) layouts[key] = renameLayout(layouts[key], { [`ctor:${c.name}`]: `ctor:${name}` })
      c.name = name
    },
    field: (name, el) => { const ci = Number(el.dataset.ci); d.constructors[ci].fields[Number(el.dataset.fi)].name = name; nameRecordFields(d, ci, functionLabelsExcept()) },
  }
  typePanel.querySelectorAll('.te-ident').forEach((el) => {
    el.onclick = el.ondblclick = () => {
      if (!el.isConnected) return
      const input = document.createElement('input')
      input.className = `te-rename te-ident-${el.dataset.ident}`
      input.value = el.textContent
      input.spellcheck = false
      const fit = () => { input.style.width = `${Math.max(input.value.length + 2, 6)}ch` }
      fit()
      let done = false
      const finish = (commit) => {
        if (done) return
        done = true
        const name = input.value.trim()
        if (commit && name && name !== el.textContent) update(() => renames[el.dataset.ident](name, el))
        else renderTypeEditor()
      }
      input.onchange = () => finish(true)
      input.onblur = () => finish(true)
      input.oninput = fit
      input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false) }
      el.replaceWith(input)
      input.focus()
      input.select()
    }
  })
  $('[data-te="keyword"]').onclick = () => update(() => { d.keyword = d.keyword === 'data' ? 'newtype' : 'data'; if (d.keyword !== 'newtype') d.deriving.newtype = [] })
  const addParam = $('[data-te="add-param"]')
  addParam.onclick = () => chooseType('Add type parameter', (type) => {
    if ((d.params || []).includes(type.id)) throw new Error(`${type.id} is already a parameter`)
    update(() => { d.params = [...(d.params || []), type.id] })
  }, { variable: true })
  dropZone(addParam, {
    shown: hole(),
    current: hole,
    commit: (type) => {
      if (type.kind !== 'var') return showToast('A type parameter is a type variable — drag a, b, c or d here')
      if ((d.params || []).includes(type.id)) return showToast(`${type.id} is already a parameter of ${d.name}`)
      update(() => { d.params = [...(d.params || []), type.id] })
    },
  })
  typePanel.querySelectorAll('[data-te="drop-param"]').forEach((b) => { b.onclick = () => update(() => { d.params.splice(Number(b.dataset.pi), 1) }) })
  typePanel.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editDerived(b.dataset.edit) })
  typePanel.querySelectorAll('[data-reset]').forEach((b) => { b.onclick = () => { resetDerivedFunction(b.dataset.reset); renderTypeEditor() } })
  typePanel.querySelectorAll('[data-use-derived]').forEach((b) => { b.onclick = () => { const id = b.dataset.useDerived; closeTypeEditor(); addFunctionCall(id) } })
  typePanel.querySelectorAll('.te-ctor').forEach((row) => {
    const c = d.constructors[Number(row.dataset.ci)]
    row.querySelector('[data-te="use-ctor"]').onclick = () => { closeTypeEditor(); addFunctionCall(`type:${d.name}:${c.name}`) }
    row.querySelector('[data-te="move-ctor"]')?.addEventListener('click', () => update(() => {
      const ci = Number(row.dataset.ci)
      ;[d.constructors[ci - 1], d.constructors[ci]] = [d.constructors[ci], d.constructors[ci - 1]]
    }))
    row.querySelectorAll('.te-ftype').forEach((slot) => {
      const fl = c.fields[Number(slot.dataset.fi)]
      let shown = hole()
      try { shown = typeFromText(fl.type || '_') } catch {}
      const changeType = (type) => update(() => { fl.type = typeText(type); addParamsOf(type) })
      dropZone(slot, { shown, current: () => shown, commit: changeType })
      slot.tabIndex = 0
      slot.setAttribute('role', 'button')
      slot.title = 'Change field type — click to choose or drop a type'
      slot.onclick = () => chooseType('Change field type', changeType, { initial: fl.type })
      slot.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); slot.click() } }
    })
    row.querySelectorAll('[data-te="drop-field"]').forEach((b) => { b.onclick = () => update(() => { c.fields.splice(Number(b.dataset.fi), 1) }) })
    const addField = row.querySelector('[data-te="add-field"]')
    const appendField = (type) => update(() => {
        c.fields.push({ name: '', type: typeText(type) })
        nameRecordFields(d, Number(row.dataset.ci), functionLabelsExcept())
        addParamsOf(type)
      })
    addField.onclick = () => chooseType('Add field', appendField)
    dropZone(addField, { shown: hole(), current: hole, commit: appendField })
    row.querySelector('[data-te="drop-ctor"]')?.addEventListener('click', () => update(() => { d.constructors.splice(Number(row.dataset.ci), 1) }))
  })
  const addCtor = (type) => update(() => {
    let k = d.constructors.length + 1
    while (d.constructors.some((c) => c.name === `${d.name}${k}`)) k++
    d.constructors.push({ name: `${d.name}${k}`, fields: type ? [{ name: '', type: typeText(type) }] : [] })
    nameRecordFields(d, d.constructors.length - 1, functionLabelsExcept())
    if (type) addParamsOf(type)
  })
  $('[data-te="add-ctor"]').onclick = () => addCtor(null)
  dropZone($('[data-te="add-ctor"]'), { shown: hole(), current: hole, commit: addCtor })
  $('[data-te="close"]').onclick = closeTypeEditor
  $('[data-te="delete"]').onclick = () => {
    const name = typeEditor.original
    if (!name) return closeTypeEditor()
    const prefix = `type:${name}:`
    // (Its own customized functions go with it, so calls inside them don't count.)
    const own = Object.values(nodes).filter((n) => n.override === name).map((n) => n.id)
    const graphsOutside = [nodes, ...Object.entries(functionBodies).filter(([id]) => !own.includes(id)).map(([, g]) => g)]
    // A taken-over Prelude type goes back to the Prelude's: only what the Prelude's doesn't derive (a projection of a named field) must be unused.
    const restoring = !!types[name]?.library
    const gone = (id) => !restoring || !definitionsOfPrelude(id)
    const calls = graphsOutside.flatMap((g) => Object.values(g)).filter((n) => (n.sourceFunctionId?.startsWith(prefix) || n.sourceFunctionId?.startsWith(`prim:${prefix}`)) && gone(n.sourceFunctionId)).length
    const usedIn = [...Object.values(types).filter((t) => t.name !== name && JSON.stringify(t.constructors).includes(`"name":"${name}"`)).map((t) => t.name), ...classesUsingType(classes, name).map((c) => `class ${c}`), ...Object.entries(instances).flatMap(([cls, list]) => list.filter((i) => i.head === name).map(() => `instance ${cls} ${name}`)), ...Object.entries(functionBodies).filter(([id, g]) => !own.includes(id) && Object.values(g).some((n) => n.type !== 'number' && new RegExp(`\\b${name}\\b`).test(n.annotation || ''))).map(([id]) => `the signature of ${nodes[id]?.label ?? id}`)]
    if (restoring) {
      const users = Object.entries(functionBodies).filter(([id, g]) => !own.includes(id) && Object.values(g).some((n) => n.sourceFunctionId?.includes(prefix) && gone(n.sourceFunctionId))).map(([id]) => nodes[id]?.label ?? id)
      if (calls) return renderTypeEditor(`${name}: ${calls} call node${calls > 1 ? 's' : ''}${users.length ? ` (in ${users.join(', ')})` : ''} use${calls > 1 ? '' : 's'} what only your declaration derives`)
    } else if (calls || usedIn.length) return renderTypeEditor(`${name} is still used${calls ? ` by ${calls} call node${calls > 1 ? 's' : ''}` : ''}${usedIn.length ? ` in ${usedIn.join(', ')}` : ''}`)
    // (A customization of what the Prelude's also derives stays: it now customizes the Prelude's.)
    own.filter(gone).forEach((id) => { delete nodes[id]; delete functionBodies[id] })
    const next = { ...types }
    delete next[name]
    applyTypes(next)
    closeTypeEditor()
    renderFunctionLibrary(); renderPreludeLibrary(); updateInspector(); draw()
    showToast(restoring ? `${name} is the Prelude's declaration again (undo to bring yours back)` : `Deleted type ${name} (undo to bring it back)`)
  }
}

// --- Class editor ---------------------------------------------------------------
// A class is its methods (name :: signature, mentioning the class variable,
// optionally with a default function) and its instances (a type
// constructor, a context, and a custom function per method). Shown in the
// same panel as the type editor; every edit is checked by classDecls.js and
// applied at once (undoable). Methods are tracked by key so renaming one
// renames its calls.
let classEditor = null // { original, draft, appliedDraft }
let classKeys = 0
function keyedClass(draft) {
  for (const m of draft.methods || []) m.key ??= ++classKeys
  return draft
}
// A builtin class opens too: its declaration read-only, its hand-written instances (`instances[name]`) editable.
function classEditorFor(name) {
  if (BUILTIN_CLASSES[name] && !classes[name]) {
    const draft = { name, instances: structuredClone(instances[name] || []) }
    return { builtin: name, original: name, draft, appliedDraft: structuredClone(draft) }
  }
  const draft = keyedClass(structuredClone(classes[name]))
  return { original: name, draft, appliedDraft: structuredClone(draft) }
}
function openClassEditor(name = null) {
  stopGame()
  typeEditor = null
  universeOpen = false
  if (name) classEditor = classEditorFor(name)
  else {
    let k = 1
    while (classes[`NewClass${k === 1 ? '' : k}`]) k++
    let method = 'newMethod'
    for (let j = 2; functionNameProblem(method); j++) method = `newMethod${j}`
    classEditor = { original: null, draft: keyedClass({ name: `NewClass${k === 1 ? '' : k}`, param: 'a', supers: [], methods: [{ name: method, sig: 'a -> String', default: null }], instances: [] }), appliedDraft: null }
    applyClassDraft()
  }
  typePanel.hidden = false
  renderClassEditor()
}
// Check the draft; apply it if valid — renaming calls to renamed methods and
// references to a renamed class. Returns the error message, or ''.
function applyClassDraft() {
  if (classEditor.builtin) return applyBuiltinInstances()
  const d = keyedClass(classEditor.draft)
  const old = classEditor.original
  try {
    let next = { ...classes }
    if (old) delete next[old]
    if (old && old !== d.name) {
      // Other classes' superclasses and instance contexts follow the rename.
      next = Object.fromEntries(Object.entries(next).map(([k, c]) => [k, { ...c, supers: c.supers.map((s) => (s === old ? d.name : s)), instances: c.instances.map((i) => ({ ...i, context: (i.context || []).map((q) => (q.cls === old ? { ...q, cls: d.name } : q)) })) }]))
    }
    if (next[d.name]) throw new DeclError(`There is already a class named ${d.name}`)
    next[d.name] = structuredClone(d)
    next[d.name].methods.forEach((m) => { delete m.key })
    // Hand-written instances' contexts follow a rename too.
    const nextInstances = old && old !== d.name ? Object.fromEntries(Object.entries(instances).map(([cls, list]) => [cls, list.map((i) => ({ ...i, context: (i.context || []).map((q) => (q.cls === old ? { ...q, cls: d.name } : q)) }))])) : instances
    declareClasses(next, types, classLabelsTaken(), nextInstances)
    if (old && classEditor.appliedDraft) renameMethodCalls(classEditor.appliedDraft, d)
    // Signatures' pinned constraints follow a rename too.
    if (old && old !== d.name) for (const body of Object.values(functionBodies)) for (const n of Object.values(body)) if (n.context) n.context = n.context.map((q) => (q.cls === old ? { ...q, cls: d.name } : q))
    applyTypes(types, next, nextInstances)
    classEditor.original = d.name
    classEditor.appliedDraft = structuredClone(d)
    renderFunctionLibrary(); updateInspector(); draw()
    return ''
  } catch (e) {
    if (!(e instanceof DeclError)) throw e
    return e.message
  }
}
// A builtin class's draft is its hand-written instances: check them with
// everything else and apply. Returns the error message, or ''.
function applyBuiltinInstances() {
  const d = classEditor.draft
  const next = { ...instances, [d.name]: structuredClone(d.instances) }
  if (!d.instances.length) delete next[d.name]
  try {
    declareClasses(classes, types, classLabelsTaken(), next)
  } catch (e) {
    if (!(e instanceof DeclError)) throw e
    return e.message
  }
  applyTypes(types, classes, next)
  classEditor.appliedDraft = structuredClone(d)
  renderFunctionLibrary(); updateInspector(); draw()
  return ''
}
// Calls to a method follow its renames (and its class's).
function renameMethodCalls(before, after) {
  const renames = new Map()
  for (const m of before.methods) {
    const now = after.methods.find((x) => x.key === m.key)
    if (now) renames.set(`class:${before.name}:${m.name}`, { id: `class:${after.name}:${now.name}`, label: now.name })
  }
  for (const graph of [nodes, ...Object.values(functionBodies)]) {
    for (const n of Object.values(graph)) {
      const r = n.type === 'function' && renames.get(n.sourceFunctionId)
      if (r) { n.sourceFunctionId = r.id; n.label = r.label }
    }
  }
}
// The type variables of an instance head: `Maybe a` has a, `Double` none.
function instanceHeadVars(c, inst) {
  const classK = BUILTIN_CLASSES[c.name] && !classes[c.name] ? classArity(c.name) : resolvedClasses.find((r) => r.name === c.name)?.arity || 0
  const arity = (types[inst.head] ? (types[inst.head].params || []).length : (constructorArity[inst.head] || 0)) - classK
  return ['a', 'b', 'c', 'd'].slice(0, Math.max(0, arity))
}
// The instance head as Haskell writes it: `Double`, `(Maybe a)`, `[]`.
function classInstanceHead(c, inst) {
  const vars = instanceHeadVars(c, inst)
  if (inst.head === 'List' && vars.length === 1) return '[a]'
  return vars.length ? `(${[showHead(inst.head), ...vars].join(' ')})` : showHead(inst.head)
}
// The same, with each type variable a token a class from CLASSES can be dropped on.
function classInstanceHeadHtml(c, inst) {
  const vars = instanceHeadVars(c, inst)
  const v = (name) => `<span class="tn tn-var ce-hvar" data-var="${name}" title="Drag a class from CLASSES here to ask it of ${name}: Show ${name} ⇒ …">${name}</span>`
  if (inst.head === 'List' && vars.length === 1) return `[${v('a')}]`
  return vars.length ? `(${escapeAttr(showHead(inst.head))} ${vars.map(v).join(' ')})` : escapeAttr(showHead(inst.head))
}
const methodArity = (sig) => {
  // arrows at the top level of the signature (outside parentheses), after any context
  const t = sig.includes('=>') ? sig.slice(sig.indexOf('=>') + 2) : sig
  let depth = 0
  let n = 0
  for (let i = 0; i < t.length; i++) {
    if ('([{'.includes(t[i])) depth++
    else if (')]}'.includes(t[i])) depth--
    else if (t[i] === '-' && t[i + 1] === '>' && depth === 0) n++
  }
  return n
}
const methodParams = (sig) => Array.from({ length: methodArity(sig) }, (_, i) => ['x', 'y', 'z', 'w'][i] || `x${i + 1}`)

// Turn token `el` into a text box for its own text; `commit(text)` on Enter/blur when changed, `rerender()` otherwise.
function editInPlace(el, commit, rerender) {
  if (!el.isConnected) return
  const input = document.createElement('input')
  input.className = `te-rename ${el.className}`
  input.value = el.dataset.text ?? el.textContent
  input.spellcheck = false
  const fit = () => { input.style.width = `${Math.max(input.value.length + 2, 6)}ch` }
  fit()
  let done = false
  const finish = (keep) => {
    if (done) return
    done = true
    const text = input.value.trim()
    if (keep && text && text !== (el.dataset.text ?? el.textContent)) commit(text)
    else rerender()
  }
  input.onchange = () => finish(true)
  input.onblur = () => finish(true)
  input.oninput = fit
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false) }
  el.replaceWith(input)
  input.focus()
  input.select()
}
// A class as a graph (declGraph.js' classGraph): the class, the superclasses
// implying it, its methods, and its instances — each one the class's record
// of methods applied to an implementation per method, the implementing
// functions wired into the methods they implement. Every edit is checked by
// classDecls.js and applied at once (undoable).
function renderClassEditor(error = '') {
  if (!classEditor) return
  const d = classEditor.draft
  const builtin = classEditor.builtin
  const applied = !builtin && classEditor.original && resolvedClasses.find((c) => c.name === classEditor.original)
  const takenHeads = new Set(d.instances.map((i) => i.head))
  // An instance can be added for a type that hasn't the class yet (a builtin class's own instances, or derived ones, already give it)
  // — or that has the Prelude's, for a type the Prelude declares: a written one replaces it (classDecls.js).
  const arity = builtin ? classArity(d.name) : applied?.arity || 0
  const derivedKeys = new Set(derivedInstances(types).map((i) => `${i.cls}@${headName(i.head)}`))
  const alreadyHas = (h) => {
    if (!builtin) return false
    const n = (types[h] ? (types[h].params || []).length : constructorArity[h] || 0) - arity
    if (n < 0) return true
    const found = findInstance(pred(d.name, ['a', 'b', 'c', 'd'].slice(0, n).reduce((acc, v) => tapp(acc, tvar(v)), tcon(h))))
    return !!found && !(preludeTypes[h] && found.inst.how !== 'written' && !derivedKeys.has(found.inst.key))
  }
  const heads = [...Object.keys(types), ...HEAD_NAMES.filter((h) => !types[h])].filter((h) => !takenHeads.has(h) && !alreadyHas(h))
  // The class's methods as an instance sees them: name, Haskell label, default, a function's parameters.
  const methods = builtin
    ? BUILTIN_CLASSES[d.name].methods.map((m) => ({ name: m, label: METHOD_LABEL[m], params: METHOD_PARAMS[m] }))
    : d.methods.map((m) => ({ name: m.name, label: m.name, default: m.default, params: methodParams(m.sig) }))
  const written = builtin ? (resolvedClasses.written || []).filter((w) => w.cls === d.name) : []
  const minimal = builtin ? (BUILTIN_CLASSES[d.name].minimal || []).map((set) => set.map((m) => METHOD_LABEL[m]).join(', ')).join(' | ') : ''
  const statusOf = (inst, m) => {
    const fnId = inst.methods?.[m.name]
    if (builtin) {
      const w = written.find((x) => x.headName === inst.head)
      if (!fnId) return w && !writtenMinimalProblem(w) ? '<span class="law ok">from the class default</span>' : ''
      if (!w) return ''
      const have = implementationScheme(fnId)
      const problem = typeof have === 'string' ? have : writtenMethodProblem(have, w, m.name)
      return `<span class="law ${problem ? 'bad' : 'ok'}">${problem ? `✗ ${escapeAttr(problem)}` : '✓'}</span>`
    }
    const rInst = applied?.instances.find((r) => r.headName === inst.head)
    const rm = applied?.methods.find((x) => x.name === m.name)
    if (!fnId) return m.default && nodes[m.default] ? '<span class="law ok">uses the default</span>' : '<span class="law bad">✗ give it a function</span>'
    if (!rInst || !rm) return ''
    const have = implementationScheme(fnId)
    const problem = typeof have === 'string' ? have : instanceMethodProblem(have, applied, rm, rInst)
    return `<span class="law ${problem ? 'bad' : 'ok'}">${problem ? `✗ ${escapeAttr(problem)}` : '✓'}</span>`
  }
  const namer = createNamer()
  const kind = arity ? ['*', ...Array(arity).fill('*')].join(' ▸ ') : '*'
  // A slot a function is put in: dragged from FUNCTIONS in the workspace, or picked (or made new) from its menu.
  const fnSlot = (fnId, none, data) => `<span class="ce-fn-slot" data-fn-slot ${data}>${nodes[fnId] ? `<b>ƒ ${escapeAttr(nodes[fnId].label)}</b>` : `<i>${none}</i>`}<select title="Pick a function — or drag one from FUNCTIONS in the workspace onto this slot" ${data}><option value="">${none}</option>${customFunctionChoices(fnId)}<option value="__new">+ new function</option></select></span>${nodes[fnId] ? ` <button class="law-check" data-open="${fnId}" title="Open ${escapeAttr(nodes[fnId].label)}'s body">→</button>` : ''}`
  const sigHtml = (m) => {
    let t = null
    try { if (!m.sig.includes('=>')) t = typeFromText(m.sig) } catch {}
    return `<span class="ce-sig-slot" data-sig title="The method's type, mentioning ${escapeAttr(d.param)} — drag a type from TYPES onto it (or a part of it); click to type it">${t ? typeNodeHtml(t, namer, { paths: true, named: true }) : `<span class="tn tn-con">${escapeAttr(m.sig)}</span>`}</span>`
  }
  const cards = {
    class: () => `
      <div class="decl-kind">class :: ${escapeAttr(kind)} ▸ Constraint${builtin ? ' · builtin' : ''}</div>
      <div class="decl-head">
        <b class="te-keyword">class</b>
        ${builtin ? `${superclassesOf(d.name).length ? `<span class="ce-supers-shown">${escapeAttr(superclassesOf(d.name).length > 1 ? `(${superclassesOf(d.name).join(', ')})` : superclassesOf(d.name)[0])} ⇒</span>` : ''}<b>${escapeAttr(d.name)}</b> <span class="tn tn-var">${arity ? 'f' : 'a'}</span>` : `<button class="te-ident te-ident-type" data-ce-ident="name" title="Class name — click to rename">${escapeAttr(d.name)}</button><button class="te-ident tn tn-var" data-ce-ident="param" title="The class variable — the type an instance is for; click to rename">${escapeAttr(d.param)}</button>`}
        <b class="te-keyword">where</b>
      </div>
      <div class="decl-actions">
        ${builtin ? '' : '<span class="te-drop te-add-ctor ce-add-super" data-ce="add-super" title="Drag a class from CLASSES here: every instance must have it too (a superclass)">+ superclass</span><button class="te-add-ctor" data-ce="add-method">+ method</button>'}
        <span class="ce-add-instance-wrap te-drop te-add-ctor" data-ce="add-instance-zone" title="Drag a type from TYPES here for an instance of it — or pick one">+ instance <select class="ce-add-instance"><option value="">for…</option>${heads.map((h) => `<option value="${escapeAttr(h)}">${escapeAttr(showHead(h))}</option>`).join('')}</select></span>
      </div>
      ${minimal ? `<small class="ce-minimal">{-# MINIMAL ${escapeAttr(minimal)} #-}</small>` : ''}`,
    super: (n) => `
      <div class="decl-kind">superclass</div>
      <span class="cc pinned">${escapeAttr(classShown(n.name))} ${escapeAttr(d.param)}<button class="cc-x" data-ce="drop-super" data-super="${escapeAttr(n.name)}" title="Remove this superclass">×</button></span>`,
    method: (n) => {
      if (n.builtin) return `
      <div class="decl-kind">method</div>
      <div class="te-method ce-method"><code>${escapeAttr(n.label)}</code> <small class="ce-sigshow">${qualChainHtml(builtinSchemes[n.name].preds, builtinSchemes[n.name].type)}</small></div>`
      const m = d.methods[n.index]
      const shown = classDefs[`class:${d.name}:${m.name}`]
      return `
      <div class="decl-kind">method${shown ? ` :: ${qualChainHtml(shown.scheme.preds, shown.scheme.type)}` : ''}</div>
      <div class="decl-head ce-method" data-mi="${n.index}"><button class="te-ident" data-ce-ident="method" data-mi="${n.index}" title="Method name — click to rename">${escapeAttr(m.name)}</button><i>::</i>${sigHtml(m)}${d.methods.length > 1 ? `<button class="te-x" data-ce="drop-method" data-mi="${n.index}" title="Remove method">−</button>` : ''}</div>
      <div class="decl-actions"><small>default</small>${fnSlot(m.default, 'none', `data-default="${n.index}"`)}</div>`
    },
    instance: (n) => {
      const inst = d.instances[n.index]
      const ctx = inst.context || []
      const chips = ctx.map((q, k) => `<span class="cc pinned" data-ci="${k}" title="${escapeAttr(`${classShown(q.cls)} ${q.var} — drop another class here to change it, _ to remove it`)}">${escapeAttr(`${classShown(q.cls)} ${q.var}`)}<button class="cc-x" title="Remove ${escapeAttr(`${classShown(q.cls)} ${q.var}`)}">×</button></span>`)
      const context = chips.length ? `<span class="tc-ctx ce-ctx">${chips.length > 1 ? '<i>(</i>' : ''}${chips.join('<i>,</i> ')}${chips.length > 1 ? '<i>)</i>' : ''} ⇒</span>` : ''
      const w = written.find((x) => x.headName === inst.head)
      const incomplete = w && writtenMinimalProblem(w)
      return `
      <div class="decl-kind">instance — the methods applied to one function each</div>
      <div class="ce-instance-head"><b>instance</b> ${context} <b>${escapeAttr(d.name)}</b> <span class="ce-head">${classInstanceHeadHtml(d, inst)}</span> <b>where</b> <button class="te-x" data-ce="drop-instance" title="Remove this instance (its functions stay)">×</button></div>
      ${incomplete ? `<span class="law bad">✗ ${escapeAttr(incomplete)}</span>` : ''}
      ${methods.map((m) => `<div class="te-method" data-method-row="${escapeAttr(m.name)}"><code>${escapeAttr(m.label)} =</code> ${fnSlot(inst.methods?.[m.name], m.default || builtin ? '— the default —' : '— a function —', `data-method="${escapeAttr(m.name)}"`)} ${statusOf(inst, m)}</div>`).join('')}`
    },
    fn: (n) => `
      <div class="decl-kind">function</div>
      <div class="decl-head"><b>ƒ ${escapeAttr(nodes[n.fnId]?.label ?? n.fnId)}</b>${nodes[n.fnId] ? ` <small>${functionChainHtml(nodes[n.fnId], nodes)}</small>` : ''}</div>
      ${nodes[n.fnId] ? `<div class="decl-actions"><button class="law-check" data-open="${n.fnId}">Open body →</button></div>` : ''}`,
  }
  typePanel.innerHTML = `
    <div class="play-bar type-bar"><b>CLASS</b>
      <span class="te-status ${error ? 'bad' : 'ok'}">${error ? escapeAttr(error) : applied ? '✓ applied' : ''}</span>
      ${universeButtonHtml()}
      ${builtin ? '' : '<button class="tool-button" data-ce="delete">Delete class</button>'}
      <button class="tool-button icon-only" data-ce="close" title="Back to the canvas">×</button>
    </div>
    <p class="te-hint decl-hint">${builtin
      ? `A builtin class: its methods are fixed, and so are the instances it comes with (${escapeAttr(listInstances().filter((i) => i.cls === d.name && i.how !== 'written').map((i) => showHead(headName(i.head))).join(', ') || 'none')}). Give it an instance of your own — drag a type onto + instance — and a function for each method${minimal ? `; it's enough to define ${escapeAttr(minimal)}` : ''}.`
      : `A class is a set of methods every instance implements. Drag a class from CLASSES onto + superclass, a type from TYPES onto + instance or a method's type, a function from FUNCTIONS onto a slot. Drag a card to move it.`}</p>
    <div class="decl-host"></div>`
  const graph = classGraph(d, builtin ? { builtin: true, methods: methods.map((m) => ({ name: m.name, label: m.label })) } : {})
  graph.edges = graph.edges.map((e) => (e.kind === 'implements' ? { ...e, toPort: `[data-method-row="${e.method}"]`, label: e.method } : e))
  const key = layoutKey('class', classEditor.original || d.name)
  const at = layoutGraph(graph, layouts[key])
  drawDeclGraph(typePanel.querySelector('.decl-host'), {
    graph, at, viewKey: key, fixed: new Set(Object.keys(layouts[key] || {})),
    card: (n) => cards[n.kind](n),
    onMoved: (_, positions) => { layouts[key] = { ...positions }; draw() },
  })
  const nodeOf = (el) => graph.nodes.find((n) => n.id === el.closest('.decl-node').dataset.node)
  const update = (mutate) => { mutate(d); renderClassEditor(applyClassDraft()) }
  const $ = (sel) => typePanel.querySelector(sel)
  // A function slot: a pick from its menu, or a function dragged from FUNCTIONS (see setupFunctionDrag).
  const bindFnSlot = (slot, set, newFor) => {
    const select = slot.querySelector('select')
    select.onchange = () => update(() => { set(select.value === '__new' ? newFor() : select.value || null); renderFunctionLibrary() })
    fnSlots.set(slot, (fnId) => update(() => { set(fnId); renderFunctionLibrary() }))
  }
  if (!builtin) {
    typePanel.querySelectorAll('[data-ce-ident]').forEach((el) => {
      el.onclick = () => editInPlace(el, (text) => update(() => {
        if (el.dataset.ceIdent === 'name') {
          moveLayout(layoutKey('class', d.name), layoutKey('class', text))
          d.name = text
        } else if (el.dataset.ceIdent === 'param') {
          const old = d.param
          d.param = text
          const word = new RegExp(`\\b${old}\\b`, 'g')
          if (/^[a-z]\w*$/.test(d.param)) d.methods.forEach((m) => { m.sig = m.sig.replace(word, d.param) })
        } else {
          const m = d.methods[Number(el.dataset.mi)]
          if (layouts[key]) layouts[key] = renameLayout(layouts[key], { [`method:${m.name}`]: `method:${text}` })
          // each instance's implementation goes with the name
          for (const inst of d.instances) if (inst.methods && m.name in inst.methods) { inst.methods[text] = inst.methods[m.name]; delete inst.methods[m.name] }
          m.name = text
        }
      }), () => renderClassEditor())
    })
    typePanel.querySelectorAll('[data-sig]').forEach((slot) => {
      const m = d.methods[Number(slot.closest('[data-mi]').dataset.mi)]
      let shown = hole()
      try { shown = typeFromText(m.sig) } catch {}
      dropZone(slot, { shown, current: () => shown, commit: (type) => update(() => { m.sig = typeText(type) }) })
      slot.dataset.text = m.sig
      slot.onclick = () => editInPlace(slot, (text) => update(() => { m.sig = text }), () => renderClassEditor())
    })
    typePanel.querySelectorAll('[data-default]').forEach((slot) => {
      if (!slot.matches('[data-fn-slot]')) return
      const m = d.methods[Number(slot.dataset.default)]
      bindFnSlot(slot, (fnId) => { m.default = fnId }, () => createMethodFunction(m.name, 'Default', methodParams(m.sig)))
    })
    typePanel.querySelectorAll('[data-ce="drop-method"]').forEach((b) => {
      const m = d.methods[Number(b.dataset.mi)]
      b.onclick = () => update(() => { d.methods.splice(Number(b.dataset.mi), 1); d.instances.forEach((i) => { delete i.methods?.[m.name] }) })
    })
    $('[data-ce="add-method"]').onclick = () => update(() => {
      let name = 'newMethod'
      for (let k = 2; functionNameProblem(name) || d.methods.some((x) => x.name === name); k++) name = `newMethod${k}`
      d.methods.push({ name, sig: `${d.param} -> String`, default: null })
    })
    const addSuper = $('[data-ce="add-super"]')
    dropZone(addSuper, {
      take: () => showToast('Drag a class from CLASSES here to make it a superclass'),
      constrain: (_, cls) => {
        if (cls === d.name || d.supers.includes(cls)) return showToast(`${cls} is already ${cls === d.name ? 'this class' : 'a superclass'}`)
        update(() => { d.supers = [...d.supers, cls] })
      },
    })
    addSuper.onclick = () => showToast('Drag a class from CLASSES here to make it a superclass')
    typePanel.querySelectorAll('[data-ce="drop-super"]').forEach((b) => { b.onclick = () => update(() => { d.supers = d.supers.filter((s) => s !== b.dataset.super) }) })
  }
  const fnNameOf = (inst) => (inst.head === 'List' ? 'List' : inst.head.replace(/\W/g, ''))
  typePanel.querySelectorAll('.decl-instance').forEach((card) => {
    const inst = d.instances[nodeOf(card).index]
    const at = d.instances.indexOf(inst)
    card.querySelector('[data-ce="drop-instance"]').onclick = () => update(() => { d.instances.splice(at, 1) })
    // The context is built by dragging classes from the workspace: onto a
    // type variable of the head to ask that class of it, onto a constraint to
    // change its class; _ or × removes one. A context the class can't take is rolled back.
    const setContext = (next) => {
      const before = inst.context
      inst.context = next
      const error = applyClassDraft()
      if (error) inst.context = before
      renderClassEditor(error)
    }
    const ctx = inst.context || []
    card.querySelectorAll('.ce-hvar').forEach((el) => {
      const v = el.dataset.var
      dropZone(el, {
        take: () => showToast(`Drag a class from CLASSES onto ${v} to ask it of ${v}`),
        constrain: (_, cls) => {
          if (classArity(cls)) return showToast(`${cls} is a class of type constructors (* ▸ *) — ${v} is a type`)
          if (ctx.some((q) => q.cls === cls && q.var === v)) return showToast(`${cls} ${v} is already in the context`)
          setContext([...ctx, { cls, var: v }])
        },
      })
      el.addEventListener('click', () => showToast(`Drag a class from CLASSES onto ${v} to ask it of ${v}`))
    })
    card.querySelectorAll('.ce-ctx .cc').forEach((chip) => {
      const q = ctx[Number(chip.dataset.ci)]
      const without = () => ctx.filter((c) => c !== q)
      dropZone(chip, {
        take: (sub) => (isHole(sub) ? setContext(without()) : showToast('Drop a class here to change this constraint, or _ to remove it')),
        constrain: (_, cls) => setContext(ctx.filter((c) => c === q || !(c.cls === cls && c.var === q.var)).map((c) => (c === q ? { cls, var: q.var } : c))),
      })
      chip.querySelector('.cc-x').addEventListener('click', (event) => { event.stopPropagation(); setContext(without()) })
    })
    card.querySelectorAll('[data-fn-slot][data-method]').forEach((slot) => {
      const m = methods.find((x) => x.name === slot.dataset.method)
      bindFnSlot(slot, (fnId) => { inst.methods = { ...inst.methods, [m.name]: fnId || undefined } }, () => createMethodFunction(m.name, fnNameOf(inst), m.params))
    })
  })
  // A new instance — for a type picked, or dragged from TYPES.
  const addInstance = (head) => {
    if (!head) return
    if (takenHeads.has(head)) return renderClassEditor(`${d.name} already has an instance for ${showHead(head)}`)
    if (!heads.includes(head)) return renderClassEditor(`${showHead(head)} already has ${d.name}`)
    // The context asks the class of each of the head's type variables (`Pretty a => Pretty (Maybe a)`); edit it if that's too much.
    const n = (types[head] ? (types[head].params || []).length : (constructorArity[head] || 0)) - arity
    const context = arity ? [] : ['a', 'b', 'c', 'd'].slice(0, Math.max(0, n)).map((v) => ({ cls: d.name, var: v }))
    d.instances.push({ head, context, methods: {} })
    const error = applyClassDraft()
    if (error) { d.instances.pop(); return renderClassEditor(error) }
    // Valid: a fresh function for every method the instance must give — a
    // user class's without a default, a builtin class's first minimal set.
    const inst = d.instances[d.instances.length - 1]
    const fresh = builtin ? (BUILTIN_CLASSES[d.name].minimal?.[0] || BUILTIN_CLASSES[d.name].methods).map((name) => methods.find((m) => m.name === name)) : methods.filter((m) => !m.default)
    for (const m of fresh) inst.methods[m.name] = createMethodFunction(m.name, fnNameOf(inst), m.params)
    renderFunctionLibrary()
    renderClassEditor(applyClassDraft())
    if (fresh.length) showToast(`instance ${d.name} ${showHead(head)}: define ${fresh.map((m) => m.label).join(', ')} in the new function${fresh.length > 1 ? 's' : ''} (Open body →)`)
  }
  $('.ce-add-instance').onchange = (e) => addInstance(e.target.value)
  dropZone($('[data-ce="add-instance-zone"]'), {
    shown: hole(), current: hole,
    commit: (type) => {
      const { head: h } = typeNode(type)
      if (h.kind !== 'con') return showToast('Drag a type constructor (Int, Maybe, a type of yours) here for an instance of it')
      addInstance(h.name)
    },
  })
  typePanel.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { const id = b.dataset.open; closeTypeEditor(); state.activeFunction = null; enterFunction(id) } })
  $('[data-ce="close"]').onclick = closeTypeEditor
  if (builtin) return
  $('[data-ce="delete"]').onclick = () => {
    const name = classEditor.original
    if (!name) return closeTypeEditor()
    const calls = [nodes, ...Object.values(functionBodies)].flatMap((g) => Object.values(g)).filter((n) => n.sourceFunctionId?.startsWith(`class:${name}:`)).length
    const users = Object.values(classes).filter((c) => c.name !== name && (c.supers.includes(name) || c.methods.some((m) => new RegExp(`\\b${name}\\b`).test(m.sig)) || c.instances.some((i) => (i.context || []).some((q) => q.cls === name)))).map((c) => c.name)
    users.push(...Object.entries(instances).flatMap(([cls, list]) => list.filter((i) => (i.context || []).some((q) => q.cls === name)).map((i) => `instance ${cls} ${showHead(i.head)}`)))
    users.push(...Object.entries(functionBodies).filter(([, g]) => Object.values(g).some((n) => (n.context || []).some((q) => q.cls === name))).map(([id]) => `the signature of ${nodes[id]?.label ?? id}`))
    if (calls || users.length) return renderClassEditor(`${name} is still used${calls ? ` by ${calls} call node${calls > 1 ? 's' : ''}` : ''}${users.length ? ` by ${users.join(', ')}` : ''}`)
    const next = { ...classes }
    delete next[name]
    applyTypes(types, next)
    delete layouts[layoutKey('class', name)]
    closeTypeEditor()
    renderFunctionLibrary(); updateInspector(); draw()
    showToast(`Deleted class ${name} (undo to bring it back)`)
  }
}

// Functions dragged from FUNCTIONS in the workspace onto a function slot of
// a class graph (a method's default, an instance's method): the slot's
// handler, by element.
const fnSlots = new WeakMap()
function setupFunctionDrag() {
  let drag = null
  document.addEventListener('pointerdown', (event) => {
    const item = event.target.closest?.('.function-library-item')
    if (!item || event.button !== 0 || typePanel.hidden || !nodes[item.dataset.functionId]?.custom) return
    drag = { fnId: item.dataset.functionId, item, start: { x: event.clientX, y: event.clientY }, ghost: null, over: null }
  })
  window.addEventListener('pointermove', (event) => {
    if (!drag) return
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 5) return
      drag.ghost = document.createElement('span')
      drag.ghost.className = 'type-ghost fn-ghost'
      drag.ghost.textContent = `ƒ ${nodes[drag.fnId].label}`
      document.body.append(drag.ghost)
      document.body.classList.add('type-dragging')
    }
    drag.ghost.style.left = `${event.clientX + 10}px`
    drag.ghost.style.top = `${event.clientY + 10}px`
    const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-fn-slot]')
    if (drag.over !== slot) { drag.over?.classList.remove('drop-over'); slot?.classList.add('drop-over'); drag.over = slot }
  })
  const end = (event) => {
    if (!drag) return
    const { fnId, ghost, over } = drag
    drag = null
    if (!ghost) return
    ghost.remove()
    over?.classList.remove('drop-over')
    document.body.classList.remove('type-dragging')
    // (not a click on the item: it was dragged)
    window.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault() }, { capture: true, once: true })
    const slot = event && document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-fn-slot]')
    if (slot && fnSlots.has(slot)) fnSlots.get(slot)(fnId)
    else showToast('Drop a function on a slot of the class graph (a method’s default, an instance’s method)')
  }
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', () => end(null))
}
const classLibrary = document.querySelector('#class-library')
// Classes in the workspace, as nodes: drag one onto a type variable of a
// signature to constrain it (`Ord a ⇒`) — see constrainVariable.
function classPaletteHtml() {
  // Grouped by task (classGroups.js); the numeric tower under its Haskell names, with a note on what each piece of Num is.
  const groupHtml = (g) => `<div class="tchip-group cchip-group"><small>${g.group}</small>${g.items.map((it) => `<span class="type-chip class-chip" data-cls="${escapeAttr(it.name)}" title="${escapeAttr(`class ${it.supers.length ? `${it.supers.map(classLabel).join(', ')} ⇒ ` : ''}${it.label} :: ${it.kind}${it.label !== it.name ? ` (structurally ${it.name})` : ''}${CLASS_NOTES[it.name] ? ` — ${CLASS_NOTES[it.name]}` : ''} — drag onto a type variable of a signature to constrain it; click to open the class (its methods and instances)`)}"><span class="tn tn-class"><b>${escapeAttr(it.label)}</b></span></span>`).join('')}</div>`
  const groups = classPalette()
  const advanced = groups.filter((g) => g.advanced)
  return groups.filter((g) => !g.advanced).map(groupHtml).join('') + (advanced.length ? `<details class="cchip-advanced"><summary><small>고급</small></summary>${advanced.map(groupHtml).join('')}</details>` : '')
}
function renderClassLibrary() {
  document.querySelector('#class-palette').innerHTML = classPaletteHtml()
  const byClass = Object.groupBy(Object.values(classDefs), (def) => def.method.cls)
  // Builtin classes given instances by hand are listed too (a click on any class in CLASSES opens it).
  const builtinWritten = Object.entries(instances).filter(([cls, list]) => list.length && !classes[cls]).map(([cls, list]) => `
    <div class="type-entry">
      <button class="library-item type-item class-item" data-class-name="${escapeAttr(cls)}" title="Edit its hand-written instances">
        <span class="lib-icon class-icon">C</span>
        <span><b>${escapeAttr(cls)}</b><small>instances written: ${list.map((i) => showHead(i.head)).join(', ')}</small></span>
      </button>
    </div>`).join('')
  classLibrary.innerHTML = builtinWritten + Object.values(classes).map((c) => `
    <div class="type-entry">
      <button class="library-item type-item class-item" data-class-name="${escapeAttr(c.name)}" title="Edit class">
        <span class="lib-icon class-icon">C</span>
        <span><b>${escapeAttr(c.supers.length ? `${c.supers.join(', ')} ⇒ ` : '')}${escapeAttr(c.name)} ${escapeAttr(c.param)}</b><small>${c.instances.length ? `instances: ${c.instances.map((i) => showHead(i.head)).join(', ')}` : 'no instances yet'}</small></span>
      </button>
      ${(byClass[c.name] || []).map((def) => `<button class="derived-item" data-function-id="${def.id}" title="Add to the canvas"><b>${escapeAttr(def.label)}</b><small>${qualChainHtml(def.scheme.preds, def.scheme.type)}</small></button>`).join('')}
    </div>`).join('')
  classLibrary.querySelectorAll('.class-item').forEach((item) => { item.onclick = () => openClassEditor(item.dataset.className) })
  classLibrary.querySelectorAll('.derived-item').forEach((item) => { item.onclick = () => addFunctionCall(item.dataset.functionId) })
}

function customFunctionChoices(selected) {
  return Object.values(nodes).filter((n) => n.custom && !isHiddenDefinition(n)).map((n) => `<option value="${n.id}" ${n.id === selected ? 'selected' : ''}>${escapeAttr(n.label)}</option>`).join('')
}

// Shown (and true) when the canvas is a read-only definition view.
function readonlyBlocked() {
  if (!viewingReadonly()) return false
  showToast('This is a read-only definition — go back to edit, or take it over (Edit definition)')
  return true
}
function addFunctionCall(sourceId) {
  if (readonlyBlocked()) return
  const source = definitions[sourceId]
  if (!source) return
  const graph = activeNodes()
  const id = `call-${sourceId}-${Date.now()}`
  graph[id] = {
    id, type: 'function', sourceFunctionId: sourceId,
    ...freePosition(graph, 120 + source.params.length * SLOT_STRIDE),
    label: source.label, params: source.params.map(() => ''),
    mounted: source.params.map(() => null), paramScopes: source.params.map(() => 'local'),
    scope: 'local', color: source.color,
  }
  state.selected = id
  updateInspector()
  draw()
}

function createFunctionBody(id, params) {
  const body = {}
  params.forEach((name, index) => {
    body[`input-${id}-${index}`] = {
      id: `input-${id}-${index}`, type: 'parameter',
      x: 110, y: 180 + index * 160, label: name, value: name, color: '#4f8ef7',
    }
  })
  body.output = {
    id: 'output', type: 'output', x: 570, y: 255,
    label: 'Output', value: params[0] || '0', color: '#2fbf8f',
  }
  if (params.length) body.output.source = `input-${id}-0`
  return body
}

function createCustomFunction() {
  if (document.querySelector('#function-dialog')) return
  const dialog = document.createElement('div')
  dialog.id = 'function-dialog'
  dialog.innerHTML = `<form class="function-form"><h2>새 커스텀 함수</h2><label>함수 이름<input name="label" value="customFn" required /></label><label>매개변수 <small>(쉼표로 구분)</small><input name="params" value="x, y" /></label><p>생성 후 함수 본체에서 노드를 Output에 연결하세요.</p><div><button type="button" data-cancel>취소</button><button class="tool-button primary">생성</button></div></form>`
  document.body.append(dialog)
  const form = dialog.querySelector('form')
  dialog.querySelector('[data-cancel]').onclick = () => dialog.remove()
  form.onsubmit = (event) => {
    event.preventDefault()
    const label = new FormData(form).get('label').toString().trim()
    const params = new FormData(form).get('params').toString().split(',').map(param => param.trim()).filter(Boolean)
    const nameProblem = functionNameProblem(label)
    if (nameProblem) return window.alert(nameProblem)
    if (new Set(params).size !== params.length) return window.alert('매개변수 이름은 중복될 수 없습니다.')
    const id = `custom-${Date.now()}`
    nodes[id] = { id, type: 'function', ...freePosition(nodes, 120 + params.length * SLOT_STRIDE), label, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true }
    functionBodies[id] = createFunctionBody(id, params)
    state.selected = id
    dialog.remove()
    renderFunctionLibrary()
    functionLibrary.querySelector(`[data-function-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    updateInspector()
    draw()
  }
}

// A fit asked for while the canvas had no size (another column showing on a
// phone) waits for the canvas to be shown again.
let fitPending = false
function resize() {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (fitPending && canvas.clientWidth) { fitPending = false; return fitToView() }
  draw()
}
// --- Node geometry --------------------------------------------------------
// A function IS a value in this language, so a function block and a value
// chip are drawn as the exact same shape: a white stadium/pill with a
// neutral outline, a flat offset shadow, one small round head badge on the
// left, and a label underneath. A function block is just the wide version
// with embedded holes; a value chip is the same pill with no holes because
// every one of its arguments is already filled in (down to zero of them).
// World-space units; screen coordinates always come from `point()`/
// `toScreen()` (zoom + pan applied).
//
// Every embedded parameter slot is, likewise, one plain circle regardless of
// what it expects — deliberately NOT Scratch's shape-per-concrete-type
// convention (oval for numbers, hexagon for booleans, ...): this app's types
// are Hindley-Milner, so a slot can just as easily expect an open type
// variable (`a`) as a concrete `Int`/`Bool`, and a fixed shape set has
// nothing sensible to draw for "any type that unifies".
//
// Color is spent deliberately narrowly, to keep the canvas reading as one
// calm, mostly-monochrome surface: every pill's big surfaces (fill, border,
// shadow) are neutral ink/white, with violet reserved for selection/brand,
// and color only appears in the one small head badge per node — a violet ƒ
// for anything function-shaped, a TYPE-colored dot (colorForType below) for
// everything else. Two slots/badges sharing a color still means "same
// type", including a still-open type variable colored by its own display
// letter (e.g. apply's `f :: a -> b` and its `x :: a` read as the same
// color even though neither is pinned to a concrete type yet) — that part
// is unchanged, just confined to a smaller footprint now.
const FN_H = 96          // function block height
const FN_LEFT = 46       // world px from node.x (head badge center) to the block's left edge
const SLOT_START = 118   // world px from node.x to the first parameter slot's center
const SLOT_STRIDE = 94   // world px between consecutive slot centers
const SLOT_D = 22        // parameter slot: an in-port dot a wire is dropped on
const FN_TAIL = 52       // right padding after the last slot before the block's right edge — room for the ▶ badge on the top border, clear of the last slot's tag
const TAG_MIN_ZOOM = .45 // below this zoom slot tags are hidden (too small to read)
const TAG_GAP = 8        // world px kept free between neighbouring slot tags (a tag is at most SLOT_STRIDE - TAG_GAP wide)
const CHIP_W = 150       // default (and minimum) value-chip width; a chip grows with its content up to CHIP_MAX_W
const CHIP_MAX_W = 420   // past this a chip's text is cut with an ellipsis (never squeezed)
const CHIP_H = FN_H      // chip height — the same height as a function block, so a value is visibly the same pill, not a flattened one
const CHIP_FONT = 15     // world px, value text inside a chip
const TYPE_COLORS = { Int: '#4f8ef7', Integer: '#e8b23c', Word: '#35b4e0', Float: '#3cbe84', Double: '#a96ef0', Rational: '#d66bd1', Natural: '#e07a5f', Bool: '#ed6b84' }
const VAR_PALETTE = ['#8b7cf2', '#5fa8e8', '#3cbe9e', '#e8b23c', '#ed8fa8', '#4fc2c2', '#b98fef', '#f0954a']
const FN_TYPE_COLOR = '#6c5ce7'
const USER_TYPE_PALETTE = ['#e07a5f', '#3d9970', '#d4a017', '#c2508a', '#2f8fb8', '#8a6bd6', '#d9653b'] // declared types: one steady colour each, by name
const NEUTRAL_BORDER = '#d6d1e8'  // shared, undecorated outline for every pill — function block or value chip alike
const ACCENT = '#6c5ce7'
function colorForType(type, namer) {
  if (!type) return '#9691a8'
  if (type.kind === 'fun') return FN_TYPE_COLOR
  if (type.kind === 'con') return TYPE_COLORS[type.name] || (types[type.name] ? USER_TYPE_PALETTE[[...type.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % USER_TYPE_PALETTE.length] : '#9691a8')
  if (type.kind === 'app') return colorForType(type.fn, namer) // `Maybe Int` reads as its head, `Maybe`
  return VAR_PALETTE[namer(type.id).charCodeAt(0) % VAR_PALETTE.length]
}
function point(node) { return { x: node.x * state.zoom + state.offset.x, y: node.y * state.zoom + state.offset.y } }
function toScreen(world) { return { x: world.x * state.zoom + state.offset.x, y: world.y * state.zoom + state.offset.y } }
function slotWorldCenter(node, index) { return { x: node.x + SLOT_START + index * SLOT_STRIDE, y: node.y } }
function slotScreenCenter(node, index) { return toScreen(slotWorldCenter(node, index)) }
function functionBlockLeft(node) { return node.x - FN_LEFT }
// A folded call shows no slots: just its head and, where they were, the
// whole expression it stands for (`add 3 (mul x 2)`) — the block grows to fit it.
function isFolded(node) { return !!node.folded && node.params.length > 0 }
const FOLDED_W = 124     // world px from node.x to a folded call's right edge, at least
const FOLDED_TEXT_X = 37 // world px from node.x to the start of a folded call's expression
const FOLDED_TAIL = 44   // world px after the expression — room for the ▶ badge
let foldedTexts = new Map() // node id -> its expression, until the next draw()
function foldedText(node) {
  if (!foldedTexts.has(node.id)) foldedTexts.set(node.id, printNodeText(activeNodes(), node.id, definitions, allBodies) || '⋯')
  return foldedTexts.get(node.id)
}
function foldedWidth(node) {
  ctx.save()
  ctx.font = `600 ${CHIP_FONT}px ui-monospace, monospace`
  const text = ctx.measureText(foldedText(node)).width
  ctx.restore()
  return Math.max(FOLDED_W, FOLDED_TEXT_X + text + FOLDED_TAIL)
}
function functionBlockRight(node) {
  if (isFolded(node)) return node.x + foldedWidth(node)
  return node.params.length > 0
    ? node.x + SLOT_START + (node.params.length - 1) * SLOT_STRIDE + SLOT_D / 2 + FN_TAIL
    : node.x + 78
}
function functionBlockWidth(node) { return functionBlockRight(node) - functionBlockLeft(node) }
function functionBlockScreenRect(node) {
  const p = point(node)
  return {
    left: p.x + (functionBlockLeft(node) - node.x) * state.zoom,
    right: p.x + (functionBlockRight(node) - node.x) * state.zoom,
    top: p.y - (FN_H / 2) * state.zoom,
    height: FN_H * state.zoom,
  }
}
function pointInFunctionBlock(node, x, y) { return x >= functionBlockLeft(node) && x <= functionBlockRight(node) && Math.abs(y - node.y) <= FN_H / 2 }
// Value/boolean/output/curried chip geometry — the same rect-plus-stadium-
// radius recipe as the function block above, just fixed-width since these
// never grow embedded slots.
// A value chip is as wide as its content needs (head badge + text), within
// [CHIP_W, CHIP_MAX_W] world px.
function chipWidth(node) {
  ctx.save()
  ctx.font = `600 ${CHIP_FONT}px ui-monospace, monospace`
  const text = ctx.measureText(nodeDisplayText(node)).width
  ctx.restore()
  return Math.min(CHIP_MAX_W, Math.max(CHIP_W, 46 + 23 + 14 + text + 32))
}
function chipHalfWidth(node) { return chipWidth(node) / 2 }
function valueBlockScreenRect(node) {
  const p = point(node)
  const half = chipHalfWidth(node)
  return {
    left: p.x - half * state.zoom,
    right: p.x + half * state.zoom,
    top: p.y - (CHIP_H / 2) * state.zoom,
    height: CHIP_H * state.zoom,
  }
}
function pointInValueBlock(node, x, y) { return Math.abs(x - node.x) <= chipHalfWidth(node) && Math.abs(y - node.y) <= CHIP_H / 2 }
// World-space bounding box of every node currently on screen (skips anything
// mounted into a slot, same filter draw() uses) — the block/chip's own rect
// widened with fixed padding for what draw() puts just outside that rect:
// the param-tag pills above a function block's slots, and the two label
// lines below every block/chip.
function graphBounds(graphNodes = Object.values(activeNodes()).filter(isVisible)) {
  if (!graphNodes.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  graphNodes.forEach((n) => {
    const isFn = n.type === 'function'
    const left = isFn ? functionBlockLeft(n) : n.x - chipHalfWidth(n)
    const right = isFn ? functionBlockRight(n) : n.x + chipHalfWidth(n)
    const halfH = (isFn ? FN_H : CHIP_H) / 2
    minX = Math.min(minX, left); maxX = Math.max(maxX, right)
    minY = Math.min(minY, n.y - halfH - 40); maxY = Math.max(maxY, n.y + halfH + 50)
  })
  return { minX, minY, maxX, maxY }
}
// Real "fit to content": zooms/pans so every node on the active graph sits
// inside the canvas viewport, instead of the old #fit handler which just
// reset to a hardcoded zoom/offset and left anything below the fold (e.g.
// the lower rows of the 15-node main graph) cut off below the canvas edge.
function fitToView() {
  if (!canvas.clientWidth) { fitPending = true; return draw() }
  placeNewArguments() // measure where new arguments will actually be drawn
  const w = canvas.clientWidth, h = canvas.clientHeight
  const bounds = graphBounds()
  const PAD = 36
  if (!bounds) { state.zoom = 1; state.offset = { x: 0, y: 0 } } else {
    const boundsW = bounds.maxX - bounds.minX, boundsH = bounds.maxY - bounds.minY
    const zoom = Math.min((w - PAD * 2) / boundsW, (h - PAD * 2) / boundsH, 1.4)
    state.zoom = Math.max(.15, zoom)
    state.offset.x = PAD - bounds.minX * state.zoom + Math.max(0, (w - PAD * 2 - boundsW * state.zoom)) / 2
    state.offset.y = PAD - bounds.minY * state.zoom + Math.max(0, (h - PAD * 2 - boundsH * state.zoom)) / 2
  }
  document.querySelector('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`
  draw()
}
// Where to put a newly added node of roughly `width` world px: the free spot
// nearest the middle of what's on screen, searched outward ring by ring so
// it lands visible and clear of existing nodes.
function freePosition(graph, width) {
  const view = { left: -state.offset.x / state.zoom, top: -state.offset.y / state.zoom, right: (canvas.clientWidth - state.offset.x) / state.zoom, bottom: (canvas.clientHeight - state.offset.y) / state.zoom }
  const cx = (view.left + view.right) / 2 - width / 2
  const cy = (view.top + view.bottom) / 2
  const overlaps = (x, y) => Object.values(graph).some((n) => {
    if (!isVisible(n)) return false
    const left = n.type === 'function' ? functionBlockLeft(n) : n.x - chipHalfWidth(n)
    const right = n.type === 'function' ? functionBlockRight(n) : n.x + chipHalfWidth(n)
    return Math.abs(n.y - y) < FN_H + 40 && x - FN_LEFT - 40 < right && x + width + 40 > left
  })
  const inside = (x, y) => x - FN_LEFT >= view.left + 30 && x + width <= view.right - 30 && y - FN_H / 2 >= view.top + 30 && y + FN_H / 2 + 50 <= view.bottom - 30
  const stepX = width + 80, stepY = FN_H + 50
  // Prefer a free spot on screen; zoomed in on a small body there may be
  // none, so then take the nearest free spot anywhere (and bring it into
  // view) — never stack a node on top of another.
  for (const mustBeVisible of [true, false]) {
    for (let ring = 0; ring < 14; ring++) {
      for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const x = cx + dx * stepX, y = cy + dy * stepY
        if ((!mustBeVisible || inside(x, y)) && !overlaps(x, y)) {
          if (!mustBeVisible) requestAnimationFrame(() => fitToView())
          return { x, y }
        }
      }
    }
  }
  return { x: cx, y: cy }
}
function roundedRectPath(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r)
  c.closePath()
}
// One inferGraph() pass over `graph` (defaults to whatever's on screen). Not
// cached — cheap for this app's graph sizes, and always fresh so a
// connect/disconnect is reflected on the very next call, no invalidation needed.
function typePass(graph = activeNodes()) { return inferGraph(definitions, allBodies, graph) }
// Shared per-draw() letter assignment (a, b, c, ...) so every node label and
// port-type badge drawn in the same pass agrees on which variable is which —
// reset at the top of draw(). A caller outside that pass (e.g. the sidebar
// library list) omits `namer` and gets its own fresh lettering, which is
// fine: it's a separate inferGraph() pass with its own fresh type variables
// anyway, so there's nothing to stay consistent with across passes.
let labelNamer = createNamer()
// `pass` defaults to a fresh typePass() when not given, so every existing
// caller keeps working unchanged. Pass one in explicitly (as draw() does)
// when several nodes/ports need to be read from the SAME inference pass —
// otherwise e.g. `plus`'s two ports, which genuinely share one type
// variable, would each trigger their own independent inferGraph() call and
// get unrelated fresh ids for what should display as the same letter.
function functionSignature(node, graph = activeNodes(), namer, pass = typePass(graph)) {
  const entry = pass.perNode.get(node.id)
  return entry?.paramTypes ? showQual(entry.preds || [], entry.paramTypes.reduceRight((acc, t) => tfun(t, acc), entry.resultType), namer) : '?'
}
// The same, as a chevron chain.
function functionChainHtml(node, graph = activeNodes(), pass = typePass(graph)) {
  const entry = pass.perNode.get(node.id)
  return entry?.paramTypes ? chainHtml([...entry.paramTypes, entry.resultType], createNamer(), { preds: entry.preds }) : '?'
}
function isFunction(node) { return node.type === 'function' }
function expectedParamType(node, index, graph = activeNodes(), namer, pass = typePass(graph)) {
  const entry = pass.perNode.get(node.id)
  const t = entry?.paramTypes?.[index]
  if (!t) return '?'
  const relevant = t.kind === 'var' ? predsOnVar(entry.preds || [], t.id) : []
  return showQual(relevant, t, namer)
}
// The (preds, Type) of `node` as a value — a function node folds to its
// arrow type, so it can be unified against a Function-shaped slot (e.g.
// apply's `f`). Preds are whatever's still pending on that value (e.g. an
// unconnected numeric literal carries `Semiring a` until something pins it).
function resolvedValueQual(node, graph = activeNodes(), pass = typePass(graph)) {
  const entry = pass.perNode.get(node.id)
  return { preds: entry?.preds || [], type: valueTypeOfEntry(entry) }
}
// --- Types as nodes (see typeExpr.js) -----------------------------------------
// A type is drawn the way a call is: a head with a slot per argument, each
// slot holding a type node of its own — `Maybe ⟨Int⟩`, `[ ⟨a⟩ ]`. A function
// type is its curried chain of chevrons, `A ▸ B ▸ C`, each pointing at the
// rest: a function block's chain sits under it, one chevron under each slot
// and the result last, so a filled slot visibly consumes its chevron.
// The chevrons of a custom function (on its definition, or its parameters'
// and Output's own, inside the body) can be pinned: that's its type
// signature, checked against the inferred type (inferGraph.js' annotate).
function typeNodeHtml(t, namer, opts = {}, path = []) {
  const attr = opts.paths ? ` data-path="${path.join('.')}"${opts.selected && opts.selected.join('.') === path.join('.') ? ' data-selected' : ''}` : ''
  const sub = (child, i) => typeNodeHtml(child, namer, opts, [...path, i])
  if (isHole(t)) return `<span class="tn tn-hole"${attr}>_</span>`
  const varName = (id) => (opts.named && !isInferredVar(id) ? id : namer(id))
  if (t.kind === 'var') return `<span class="tn tn-var" style="--tc:${colorForType(t, namer)}"${attr}>${escapeAttr(varName(t.id))}</span>`
  if (t.kind === 'con') return `<span class="tn tn-con" style="--tc:${colorForType(t, namer)}"${attr}>${escapeAttr(t.name === 'List' ? '[]' : t.name)}</span>`
  if (t.kind === 'fun') {
    const segs = chainOf(t)
    const at = (i) => (i < segs.length - 1 ? [...Array(i).fill(1), 0] : Array(i).fill(1))
    return `<span class="tn tn-fun"${attr}>${segs.map((s, i) => `<span class="tc-seg${i === segs.length - 1 ? ' tc-result' : ''}">${typeNodeHtml(s, namer, opts, [...path, ...at(i)])}</span>`).join('')}</span>`
  }
  const { head, slots } = typeNode(t)
  if (head.kind === 'con' && head.name === 'List' && slots.length === 1) {
    if (slots[0].kind === 'con' && slots[0].name === 'Char') return `<span class="tn tn-con" style="--tc:${colorForType(t, namer)}"${attr}>String</span>`
    return `<span class="tn tn-app tn-list"${attr}><i>[</i>${sub(slots[0], 0)}<i>]</i></span>`
  }
  if (head.kind === 'con' && head.name === '(,)' && slots.length === 2) return `<span class="tn tn-app tn-tuple"${attr}><i>(</i>${sub(slots[0], 0)}<i>,</i>${sub(slots[1], 1)}<i>)</i></span>`
  const headText = head.kind === 'var' ? varName(head.id) : headLabel(head)
  return `<span class="tn tn-app" style="--tc:${colorForType(t, namer)}"${attr}><b>${escapeAttr(headText)}</b>${slots.map(sub).join('')}</span>`
}
// A chain of chevrons, one per segment (arguments, then the result). `opts`:
// `preds` (a class context, shown in front), and per segment `pinned`,
// `bad` (why its annotation was refused), `applied` (a filled slot),
// `editable`, `widths` (min widths, to line up under slots).
function chainHtml(segments, namer, opts = {}) {
  const context = contextHtml(opts, namer)
  const whole = segments.slice(0, -1).reduceRight((acc, t) => tfun(t, acc), segments[segments.length - 1])
  return `<span class="type-chain${opts.big ? ' big' : ''}" title="${escapeAttr(showQual(opts.preds || [], whole, namer))}">${context}${segments.map((t, i) => {
    const cls = ['tc-seg', i === segments.length - 1 && 'tc-result', opts.pinned?.[i] && 'pinned', opts.bad?.[i] && 'bad', opts.applied?.[i] && 'applied', opts.editable?.[i] && 'editable'].filter(Boolean).join(' ')
    const title = opts.bad?.[i] || (opts.editable?.[i] ? (opts.pinned?.[i] ? `Pinned :: ${opts.pinned[i]} — drop a type here to change it, _ to un-pin` : 'Inferred — drop a type here (from TYPES) to pin it') : '')
    return `<span class="${cls}" data-seg="${i}"${title ? ` title="${escapeAttr(title)}"` : ''} style="--sc:${colorForType(t, namer)}${opts.widths?.[i] ? `;min-width:${opts.widths[i]}` : ''}">${opts.labels ? `<small class="tc-label">${escapeAttr(opts.labels[i] ?? '')}</small>` : ''}${typeNodeHtml(t, namer, { paths: opts.editable?.[i] })}</span>`
  }).join('')}</span>`
}
// A chain's class context, `(Ord a, Show b) ⇒`, one chip per constraint.
// On a signature (`opts.context`, its pinned constraints) the pinned ones
// come first, solid, each with × to un-pin; the rest are what the body
// needs besides — inferred, and pinned with a click.
function contextParts(opts) {
  const pinned = opts.context || []
  const isPinned = (p) => pinned.some((q) => q.varId && q.cls === p.cls && p.type.kind === 'var' && p.type.id === q.varId)
  return { pinned, inferred: (opts.preds || []).filter((p) => !isPinned(p)) }
}
function contextHtml(opts, namer) {
  const { pinned, inferred } = contextParts(opts)
  const text = (p) => showQual([p], tcon('_'), namer).split(' ⇒ ')[0]
  const chips = [
    ...pinned.map((q, k) => `<span class="cc pinned${opts.contextBad ? ' bad' : ''}" data-ci="${k}" title="${escapeAttr(opts.contextBad || `Pinned: ${classShown(q.cls)} ${q.var} — drop another class here to change it, _ to un-pin`)}">${escapeAttr(q.varId ? text(pred(q.cls, tvar(q.varId))) : `${classShown(q.cls)} ${q.var}`)}<button class="cc-x" data-ci="${k}" title="Un-pin ${escapeAttr(`${classShown(q.cls)} ${q.var}`)}">×</button></span>`),
    ...inferred.map((p, k) => `<span class="cc${opts.context ? ' inferred' : ''}" data-pi="${k}"${opts.context ? ` title="Inferred — what the body needs. Click to pin it in the signature"` : ''}>${escapeAttr(text(p))}</span>`),
  ]
  if (!chips.length) return ''
  return `<span class="tc-ctx">${chips.length > 1 ? '<i>(</i>' : ''}${chips.join('<i>,</i> ')}${chips.length > 1 ? '<i>)</i>' : ''} ⇒</span>`
}
/** A whole (qualified) type as a chain, for lists and labels. */
function qualChainHtml(preds, type, namer = createNamer()) {
  return chainHtml(chainOf(type), namer, { preds })
}
function bodyParams(fnId) { return Object.values(functionBodies[fnId] || {}).filter((n) => n.type === 'parameter') }
// What the chain under/inside `node` shows, and which of its segments can be
// pinned (`targets[i]`: `{ fnId, nodeId }`, the body node whose annotation it is).
function chainInfo(node, pass) {
  const entry = pass.perNode.get(node.id)
  if (!entry) return null
  if (node.match) return { segments: [valueTypeOfEntry(entry)], targets: [], opts: { preds: entry.preds } }
  // (A value node may share its source's entry — Output does — so it's the node's kind that decides.)
  if (node.type === 'function' && entry.paramTypes) {
    const editable = isSignatureEditable(node) === 'signature'
    const fnId = nodes[node.sourceFunctionId]?.lambda ? node.sourceFunctionId : node.id
    const owners = editable ? [...bodyParams(fnId), functionBodies[fnId]?.output] : []
    const problems = pass.annotations?.functions?.[fnId] || {}
    const segments = [...entry.paramTypes, entry.resultType]
    const names = signatureNames(segments, owners)
    const byName = new Map([...names].map(([id, name]) => [name, id]))
    return {
      fnId,
      segments,
      names,
      targets: owners.map((o) => (o ? { fnId, nodeId: o.id } : null)),
      opts: { preds: entry.preds, pinned: owners.map((o) => o?.annotation), bad: owners.map((o) => o && problems[o.id]), applied: entry.applied, editable: owners.map(Boolean), context: editable ? signatureContext(fnId).map((q) => ({ ...q, varId: byName.get(q.var) })) : null, contextBad: editable && problems.context },
    }
  }
  const pinnable = !!state.activeFunction && !viewingReadonly() && !nodes[state.activeFunction]?.library && (node.type === 'parameter' || node.type === 'output')
  // Inside the body every parameter and Output is typed in one pass, so their annotations name its variables.
  const owners = pinnable ? signatureOwners(state.activeFunction) : []
  return {
    fnId: pinnable && state.activeFunction,
    segments: [valueTypeOfEntry(entry)],
    names: signatureNames(owners.map((o) => pass.perNode.get(o.id) && valueTypeOfEntry(pass.perNode.get(o.id))), owners),
    targets: [pinnable ? { fnId: state.activeFunction, nodeId: node.id } : null],
    opts: { preds: entry.preds, pinned: [pinnable && node.annotation], bad: [pinnable && pass.annotations?.here?.[node.id]], editable: [pinnable] },
  }
}
// The body nodes that carry a function's signature: its parameters, then Output.
function signatureOwners(fnId) {
  return Object.values(functionBodies[fnId] || {}).filter((n) => n.type === 'parameter' || n.type === 'output').sort((a, b) => (a.type === 'output') - (b.type === 'output'))
}
function signatureOutput(fnId) { return Object.values(functionBodies[fnId] || {}).find((n) => n.type === 'output') }
// The class constraints pinned in a function's signature: `[{ cls, var }]`, kept on its Output.
function signatureContext(fnId) { return signatureOutput(fnId)?.context || [] }
function parsedAnnotation(node) { try { return node?.annotation ? typeFromText(node.annotation) : hole() } catch { return hole() } }
// The names a signature's annotations give the variables of the types its
// owners are shown with: shown variable id → name (see typeExpr.js' variableNames).
function signatureNames(shown, owners) {
  const names = new Map()
  shown.forEach((t, i) => { if (t && owners[i]?.annotation) variableNames(t, parsedAnnotation(owners[i]), names) })
  return names
}
// Where a type node dragged from the workspace can land (see the type drag
// below): an element, the type it shows, the type written there so far
// (holes where nothing is), and what to do with the new one.
const dropZones = new WeakMap() // element → { shown, current(), commit(type) }
function dropZone(el, zone) {
  dropZones.set(el, zone)
  el.classList.add('drop-zone')
}
// The editable segments of a rendered chain (inside `el`) pin its annotation.
function wireChain(el, info) {
  el.querySelectorAll('.type-chain > .tc-seg.editable').forEach((seg) => {
    const i = Number(seg.dataset.seg)
    const target = info.targets[i]
    if (!target) return
    dropZone(seg, {
      shown: info.segments[i],
      current: () => { try { const a = functionBodies[target.fnId]?.[target.nodeId]?.annotation; return a ? typeFromText(a) : hole() } catch { return hole() } },
      commit: (type) => { const problem = commitAnnotation(target.fnId, target.nodeId, typeText(type)); if (problem) showToast(problem) },
      constrain: (path, cls) => constrainAt(info, i, path, cls),
    })
    seg.addEventListener('pointerdown', (event) => { event.stopPropagation(); event.preventDefault() })
    seg.addEventListener('click', (event) => { event.stopPropagation(); showToast('작업 공간의 타입 목록에서 타입을 이 자리(또는 그 일부)에 끌어다 놓으세요 — _는 추론에 맡겨요. 클래스 목록의 클래스를 타입 변수에 놓으면 제약이 돼요') })
  })
  if (!info.opts.context) return
  const { pinned, inferred } = contextParts(info.opts)
  const stop = (chip) => chip.addEventListener('pointerdown', (event) => { event.stopPropagation(); event.preventDefault() })
  el.querySelectorAll('.tc-ctx .cc.pinned').forEach((chip) => {
    const q = pinned[Number(chip.dataset.ci)]
    const same = (c) => c.cls === q.cls && c.var === q.var
    const unpin = () => editContext(info.fnId, (ctx) => ctx.filter((c) => !same(c)), `${classShown(q.cls)} ${q.var} is un-pinned`)
    stop(chip)
    dropZone(chip, {
      take: (sub) => (isHole(sub) ? unpin() : showToast('Drop a class here to change this constraint, or _ to un-pin it')),
      constrain: (_, cls) => {
        if (classArity(cls) !== classArity(q.cls)) return showToast(`${cls} and ${q.cls} constrain different kinds of type — drop ${cls} on a type variable instead`)
        editContext(info.fnId, (ctx) => ctx.filter((c) => !(c.cls === cls && c.var === q.var)).map((c) => (same(c) ? { cls, var: q.var } : c)), `${classShown(q.cls)} ${q.var} is now ${classShown(cls)} ${q.var}`)
      },
    })
    chip.querySelector('.cc-x').addEventListener('click', (event) => { event.stopPropagation(); unpin() })
  })
  el.querySelectorAll('.tc-ctx .cc.inferred').forEach((chip) => {
    const p = inferred[Number(chip.dataset.pi)]
    stop(chip)
    const { head, slots } = typeNode(p.type)
    if (head.kind !== 'var' || slots.length) return chip.classList.remove('inferred')
    chip.addEventListener('click', (event) => { event.stopPropagation(); constrainVariable(info, head.id, p.cls) })
  })
}
// Drop class `cls` onto the part at `path` of segment `i`: constrain the type variable there.
function constrainAt(info, i, path, cls) {
  const part = typeAt(info.segments[i], path)
  const { head, slots } = typeNode(part)
  const arity = classArity(cls)
  if (head?.kind !== 'var' || isHole(part)) return showToast(`${typeText(part, labelNamer)} is a concrete type — it is ${cls} or not by its instances. Drop ${cls} on a type variable`)
  if (slots.length !== arity) return showToast(arity ? `${cls} is a class of type constructors (* ▸ *), like Maybe — drop it on the f of an f a` : `${cls} is a class of types — drop it on the whole ${typeText(part, labelNamer)}`)
  constrainVariable(info, head.id, cls)
}
// Pin `cls v` for the variable shown as `varId`. A variable the signature
// doesn't name yet gets a name first — pinned where it's shown, just like
// dropping that type variable there.
function constrainVariable(info, varId, cls) {
  const fnId = info.fnId
  const arity = classArity(cls)
  let name = info.names.get(varId)
  const edits = {}
  if (!name) {
    const at = info.segments.findIndex((t, i) => info.targets[i] && occurrenceOf(t, varId, arity))
    if (at < 0) return showToast(`${cls} can't constrain that variable here`)
    const path = occurrenceOf(info.segments[at], varId, arity)
    const owner = functionBodies[fnId]?.[info.targets[at].nodeId]
    const taken = new Set(signatureOwners(fnId).flatMap((o) => [...namedVariables(parsedAnnotation(o))]))
    name = [...(arity ? 'fghkmn' : 'abcdepqrsuvwxyz')].find((c) => !taken.has(c))
    const next = name && owner && pinAt(parsedAnnotation(owner), info.segments[at], path, fromTypeNode(tvar(name), Array.from({ length: arity }, hole)))
    if (!next) return showToast(`${cls} can't constrain that variable here — pin the type around it first`)
    edits[owner.id] = typeText(next)
  }
  if (signatureContext(fnId).some((q) => q.cls === cls && q.var === name)) return showToast(`${cls} ${name} is already in the signature`)
  editContext(fnId, (ctx) => [...ctx, { cls, var: name }], `Pinned ${cls} ${name} ⇒ in the signature of ${nodes[fnId]?.lambda ? 'λ' : nodes[fnId]?.label ?? 'it'}`, edits)
}
// Change a function's pinned class context (and, with `edits`, annotations
// along with it) — kept only if inference accepts it.
function editContext(fnId, change, message, edits = {}) {
  const problem = commitSignature(fnId, edits, change(signatureContext(fnId)), { done: () => message, broken: `A call to ${nodes[fnId]?.label ?? 'it'} passes a type that doesn't fit — change that call first` })
  if (problem) showToast(problem)
}
// The chains on the canvas: under each function block (lined up with its
// slots) and each value chip. Hidden zoomed far out, like slot tags.
function drawCanvasChains(pass) {
  if (state.zoom < TAG_MIN_ZOOM) return
  for (const node of Object.values(activeNodes()).filter(isVisible)) {
    if (node.type === 'law') continue
    const info = chainInfo(node, pass)
    if (!info) continue
    const el = document.createElement('div')
    el.className = 'canvas-chain'
    el.style.fontSize = `${11 * state.zoom}px`
    const isFn = node.type === 'function'
    const rect = isFn ? functionBlockScreenRect(node) : valueBlockScreenRect(node)
    el.style.top = `${rect.top + rect.height + 30 * state.zoom}px`
    if (isFn && !node.match && node.params.length && !isFolded(node)) {
      el.style.left = `${slotScreenCenter(node, 0).x - (SLOT_STRIDE / 2) * state.zoom}px`
      info.opts.widths = node.params.map(() => `calc(${SLOT_STRIDE * state.zoom}px + .7em)`)
    } else {
      el.style.left = `${point(node).x}px`
      el.classList.add('centered')
    }
    el.innerHTML = chainHtml(info.segments, labelNamer, info.opts)
    wireChain(el, info)
    editor.append(el)
  }
}

// Inside a function body, its signature is a row of chevron blocks pinned
// to the top of the canvas — `ƒ f :: [x: A ▸][y: B ▸][C]` — one per
// parameter (named on top) and the result; drop a type from the workspace on a block to pin it.
const signatureBar = document.createElement('div')
signatureBar.id = 'signature-bar'
function drawSignatureBar() {
  if (!signatureBar.isConnected) document.querySelector('.canvas-wrap')?.append(signatureBar)
  const fnId = state.activeFunction
  const def = fnId && nodes[fnId]
  if (def?.matchBranch) {
    signatureBar.hidden = false
    const fields = bodyParams(fnId).filter((p) => !p.matchCapture).map((p) => p.label)
    signatureBar.innerHTML = `<span class="sig-name"><b>⑂ ${escapeAttr([def.label, ...fields].join(' '))}</b></span><span class="sig-hint">분기 본문 · ←로 함수에 돌아가기</span>`
    return
  }
  const info = def && chainInfo(def, typePass(nodes))
  signatureBar.hidden = !info
  if (!info) return
  const names = [...bodyParams(fnId).map((p) => p.label), 'result']
  signatureBar.innerHTML = `<span class="sig-name"><b>ƒ ${escapeAttr(def.lambda ? 'λ' : def.label)}</b><i>::</i></span>${chainHtml(info.segments, createNamer(), { ...info.opts, big: true, labels: names })}<span class="sig-hint">${def.library ? "Prelude의 타입 — 유지됨" : '함수 시그니처'}</span>`
  wireChain(signatureBar, info)
}

// Types in the workspace: every type constructor (each with its kind),
// type variables and the hole `_`, drawn as type nodes. Drag one onto a
// chevron of a signature to pin that segment — or onto a part of it (a slot
// of `Maybe _`, the `a` of an inferred `[a]`) to pin just that part; its own
// slots come as holes, left to inference until something is dropped there.
// `_` dropped on a part un-pins it. An annotation inference refuses is
// rolled back, with why.
const TYPE_VARIABLES = ['a', 'b', 'c', 'd']
const CONSTRUCTOR_VARIABLES = ['f', 'g']
function typePaletteHtml() {
  const namer = createNamer()
  const chip = (attr, t, title) => `<span class="type-chip" ${attr} title="${escapeAttr(title)}">${typeNodeHtml(t, namer, { named: true })}</span>`
  return [
    ...typePalette().map((g) => `<div class="tchip-group"><small>${g.group}</small>${g.items.map((it) => chip(`data-con="${escapeAttr(it.name)}"`, constructorWithHoles(it.name), `${it.name === '->' ? '(▸)' : it.name === 'List' ? '[ ]' : it.name} :: ${it.kind}`)).join('')}</div>`),
    `<div class="tchip-group"><small>Variables</small>${TYPE_VARIABLES.map((v) => chip(`data-var="${v}"`, tvar(v), 'A type variable: any type — the body must work for every one (the same name is the same type across the signature)')).join('')}${CONSTRUCTOR_VARIABLES.map((v) => chip(`data-varapp="${v}"`, tapp(tvar(v), hole()), `A type variable applied to a type: ${v} stands for a type constructor (its kind is * ▸ * or more — Maybe, [ ], …), as in data Fix f = Fix (f (Fix f))`)).join('')}${chip('data-hole', hole(), 'A hole: left to inference (drop it to un-pin)')}</div>`,
  ].join('')
}
let typeDrag = null // { sub, ghost, start, moved, over }
function typeDropTarget(x, y) {
  const el = document.elementFromPoint(x, y)
  const zoneEl = el?.closest?.('.drop-zone')
  const zone = zoneEl && dropZones.get(zoneEl)
  if (!zone) return null
  const part = el.closest('[data-path]')
  const inside = part && zoneEl.contains(part)
  return { zone, path: inside && part.dataset.path ? part.dataset.path.split('.').map(Number) : [], el: inside ? part : zoneEl }
}
function startTypeDrag(chip, event) {
  if (readonlyBlocked()) return
  event.preventDefault()
  const cls = chip.dataset.cls
  const sub = cls ? null : chip.dataset.con ? constructorWithHoles(chip.dataset.con) : chip.dataset.var ? tvar(chip.dataset.var) : chip.dataset.varapp ? tapp(tvar(chip.dataset.varapp), hole()) : hole()
  const ghost = chip.cloneNode(true)
  ghost.classList.add('type-ghost')
  document.body.append(ghost)
  typeDrag = { sub, cls, ghost, start: { x: event.clientX, y: event.clientY }, moved: false, over: null }
  document.body.classList.add('type-dragging')
  moveTypeDrag(event)
}
function moveTypeDrag(event) {
  typeDrag.ghost.style.left = `${event.clientX + 10}px`
  typeDrag.ghost.style.top = `${event.clientY + 10}px`
  if (Math.hypot(event.clientX - typeDrag.start.x, event.clientY - typeDrag.start.y) > 4) typeDrag.moved = true
  const drop = typeDropTarget(event.clientX, event.clientY)
  if (typeDrag.over?.el !== drop?.el) {
    typeDrag.over?.el.classList.remove('drop-over')
    drop?.el.classList.add('drop-over')
  }
  typeDrag.over = drop
}
function endTypeDrag(event) {
  const { sub, cls, ghost, moved } = typeDrag
  const drop = event && typeDropTarget(event.clientX, event.clientY)
  typeDrag.over?.el.classList.remove('drop-over')
  ghost.remove()
  typeDrag = null
  document.body.classList.remove('type-dragging')
  if (drop && cls) drop.zone.constrain ? drop.zone.constrain(drop.path, cls) : showToast(`A class constrains a type variable of a signature — drop ${cls} on one`)
  else if (drop) dropType(drop.zone, drop.path, sub)
  else if (event && !moved && cls) openClassEditor(cls) // a click: the class itself — its methods and instances
  else if (event && !moved) showToast('타입을 시그니처의 자리에 끌어다 놓아 고정하세요')
}
function setupTypeDrag() {
  document.addEventListener('pointerdown', (event) => { const chip = event.target.closest?.('.type-chip'); if (chip && event.button === 0) startTypeDrag(chip, event) })
  window.addEventListener('pointermove', (event) => { if (typeDrag) moveTypeDrag(event) })
  window.addEventListener('pointerup', (event) => { if (typeDrag) endTypeDrag(event) })
  window.addEventListener('pointercancel', () => { if (typeDrag) endTypeDrag(null) })
}
// Put `sub` at `path` of what a drop zone holds (see typeExpr.js' pinAt).
function dropType(zone, path, sub) {
  if (zone.take) return zone.take(sub)
  const next = pinAt(zone.current(), zone.shown, path, sub)
  if (!next) return showToast('That part can only be set with the whole type — drop it on the whole slot')
  zone.commit(next)
}
// How many type errors there are in `fnId`'s body and the graphs that call
// it: edges that don't unify, and constraints no instance meets (a call
// passing Bool where the signature pins Semiring a).
function typeErrorsAround(fnId) {
  const unmet = (p) => { try { reduce([p]); return false } catch { return true } }
  const graphs = [nodes, ...Object.values(functionBodies)].filter((g) => g === functionBodies[fnId] || Object.values(g).some((n) => n.type === 'function' && n.sourceFunctionId === fnId))
  return graphs.reduce((sum, g) => { const pass = inferGraph(definitions, functionBodies, g); return sum + pass.brokenEdges.length + pass.preds.filter(unmet).length }, 0)
}
// Pin `text` as the annotation of body node `nodeId` (`_` removes it) — kept
// only if inference accepts it and no call to the function stops
// type-checking. Returns why not, or ''.
function commitAnnotation(fnId, nodeId, text) {
  const target = functionBodies[fnId]?.[nodeId]
  if (!target) return ''
  const label = target.type === 'output' ? 'the result' : target.label
  return commitSignature(fnId, { [nodeId]: text }, null, {
    done: () => (target.annotation ? `Pinned ${label} :: ${target.annotation}` : `${label[0].toUpperCase()}${label.slice(1)} is inferred again`),
    broken: `Something plugged into a call to ${nodes[fnId]?.label ?? 'it'} doesn't fit ${text} — change that call first`,
  })
}
// Change a function's signature: `edits` are annotation texts by body node
// id (`_` removes one), `context` its pinned class context (null: as it is).
// A constraint on a variable no annotation names any more goes too. Kept
// only if inference accepts it and no call to the function stops
// type-checking; else rolled back. Returns why not, or ''.
function commitSignature(fnId, edits, context, messages) {
  const body = functionBodies[fnId]
  const output = signatureOutput(fnId)
  if (!body || !output) return ''
  const before = Object.fromEntries(Object.keys(edits).map((id) => [id, body[id]?.annotation]))
  const contextBefore = output.context
  const hereBefore = inferGraph(definitions, functionBodies, body).annotations.here
  const errorsBefore = typeErrorsAround(fnId)
  const set = (node, key, value) => { if (value === undefined || value === null || value === '' || value === '_' || (Array.isArray(value) && !value.length)) delete node[key]; else node[key] = value }
  for (const [id, text] of Object.entries(edits)) if (body[id]) set(body[id], 'annotation', text)
  const named = new Set(signatureOwners(fnId).flatMap((o) => [...namedVariables(parsedAnnotation(o))]))
  const wanted = context ?? output.context ?? []
  const gone = wanted.filter((q) => !named.has(q.var))
  set(output, 'context', wanted.filter((q) => named.has(q.var)))
  const here = inferGraph(definitions, functionBodies, body).annotations.here
  let problem = Object.keys(edits).map((id) => (body[id]?.annotation ? annotationProblem(body[id].annotation) || here[id] || '' : '')).find(Boolean) || (here.context !== hereBefore.context && here.context) || ''
  if (!problem && typeErrorsAround(fnId) > errorsBefore) problem = messages.broken
  if (problem) {
    for (const [id, text] of Object.entries(before)) if (body[id]) set(body[id], 'annotation', text)
    set(output, 'context', contextBefore)
    return problem
  }
  if (Object.entries(before).every(([id, text]) => body[id]?.annotation === text) && JSON.stringify(output.context) === JSON.stringify(contextBefore)) return ''
  renderFunctionLibrary(); updateInspector(); draw()
  showToast(`${messages.done()}${gone.length ? ` (${gone.map((q) => `${classShown(q.cls)} ${q.var}`).join(', ')} went with it)` : ''}`)
  return ''
}
function canConnect(source, target, index) {
  if (target.match && index < target.match.branches.length) return false
  const pass = typePass()
  const expected = pass.perNode.get(target.id)?.paramTypes?.[index]
  if (!expected) return false
  try {
    const s2 = unify(valueTypeOfEntry(pass.perNode.get(source.id)), expected, pass.subst)
    // Unification alone doesn't know about classes — it would happily let a
    // function value (e.g. identity :: x -> x) bind to a `Semiring a` slot.
    // Re-check every outstanding predicate against the hypothetical result;
    // reduce() throws if any of them turns out unsatisfiable (wrong concrete
    // type, or a fun-headed type where a numeric one was required).
    reduce(pass.preds.map((p) => pred(p.cls, applySubst(s2, p.type))))
    return true
  } catch {
    return false
  }
}
// A reference to a function body's parameter (from the workspace's
// PARAMETERS list) is just another use of that parameter: it reads and is
// labelled as the parameter itself, with no "↪".
function parameterOf(node, graph = activeNodes()) {
  const target = node?.type === 'ref' ? graph[node.target] : node
  return target?.type === 'parameter' ? target : null
}
function nodeName(node, graph = activeNodes()) { return parameterOf(node, graph)?.label ?? node.label }
function literalGlyph(node) { const kind = parseLiteral(node.value)?.kind; return kind === 'string' ? '"' : kind === 'char' ? "'" : kind === 'bool' ? '◉' : '#' }
function nodeTypeLabel(node) { if (parameterOf(node)) return 'Parameter'; if (node.type === 'literal') return 'Literal · double-click to edit'; return node.type === 'boolean' ? 'Boolean · Bool' : node.type === 'curried' ? 'Curried function' : node.type === 'ref' ? 'Reference · another use (Δ)' : node.type === 'parameter' ? 'Parameter' : node.type === 'value' ? `Value · ${node.data?.type ?? '?'}` : node.type === 'text' ? 'Text · String' : node.type === 'law' ? 'Law claim' : `Number · ${node.annotation || 'literal'}` }
// The short text a node shows inside its chip (and Output shows of its source). A
// reference shows what it refers to, so it always reads the same as its
// original even after the original's value is edited.
function nodeDisplayText(node, graph = activeNodes()) {
  if (!node) return '?'
  if (node.type === 'ref') return parameterOf(node, graph) ? nodeDisplayText(graph[node.target], graph) : `↪ ${nodeDisplayText(graph[node.target], graph)}`
  if (node.type === 'function') return `ƒ ${node.label}`
  if (node.type === 'curried') return node.value || 'ƒ'
  if (node.type === 'output') return node.value ?? 'Output'
  if (node.type === 'value') return showValue(node.data, types)
  if (node.type === 'text') return JSON.stringify(String(node.value ?? ''))
  if (node.type === 'law') { const r = lawNodeResults.get(node.id); return `${!r ? '…' : r.ok ? '✓' : '✗'} ${node.law} ${nodes[node.target]?.label ?? '?'}` }
  return String(node.value ?? node.label)
}
// Another use of `n`'s value — the diagonal Δ : A → A × A. A node can only be
// plugged into one slot, so to use a value twice (say a parameter `m` read by
// two calls), plug in references to it.
function useAgain(n) {
  const graph = activeNodes()
  const original = n.type === 'ref' ? graph[n.target] : n
  if (!original) return
  const id = `ref-${Date.now()}`
  graph[id] = { id, type: 'ref', target: original.id, label: original.type === 'parameter' ? original.label : `↪ ${original.label}`, x: n.x + 40, y: n.y + 90 }
  state.selected = id
  updateInspector(); draw()
}
// A node plugged into a slot is also drawn on the canvas, to the left of the
// call it feeds, with a link into its slot — so its own slots can be seen and
// edited. Each call can be *folded* (one toggle for all its slots): then its
// slots are hidden too — the block shrinks to its head and a "⋯" — and so is
// everything plugged into them. Purely a view — it all stays plugged in.
// Everything starts open.
function isVisible(n) { // a λ's (lifted) definition is never drawn — its call node is the λ — nor a customized derived function (it's listed under its type)
  if (n.matchInternal || n.matchCapture || isHiddenDefinition(n) || isBuiltinDefinition(n)) return false
  if (n.type === 'parameter' && n.label === '_' && nodes[state.activeFunction]?.matchBranch) return false
  for (let at = slotHost(n), guard = 0; at && guard < 500; at = slotHost(at.host), guard++) if (at.host.folded || at.host.matchInternal) return false
  return true
}
// `mountedTo` is `hostId:slotIndex` — split at the last colon, since ids can
// contain colons themselves (`call-prelude:show-…`).
function splitMountedTo(mountedTo) {
  const at = String(mountedTo || '').lastIndexOf(':')
  return at < 0 ? [null, NaN] : [mountedTo.slice(0, at), Number(mountedTo.slice(at + 1))]
}
function slotHost(n) {
  const [hostId, index] = splitMountedTo(n.mountedTo)
  const host = activeNodes()[hostId]
  return host && host.type === 'function' ? { host, index } : null
}
function treeRoot(n) {
  let root = n
  for (let at = slotHost(n), guard = 0; at && guard < 500; at = slotHost(at.host), guard++) root = at.host
  return root
}
function hasPlugged(n, graph = activeNodes()) { return (n.mounted || []).some((id) => id && graph[id]) }
// Each link leaves the plugged node's right end, runs under the block that
// holds the slot (below its name and signature; one lane per slot, so the
// links of neighbouring slots don't merge) and comes up into the slot's
// bottom — drawn over the blocks, so it visibly reaches the slot instead of
// vanishing under the block.
function drawUnfoldedLinks() {
  ctx.save()
  ctx.strokeStyle = '#b8b2cf'; ctx.lineWidth = 1.5
  Object.values(activeNodes()).filter((n) => n.mountedTo && isVisible(n)).forEach((n) => {
    const at = slotHost(n)
    if (!at) return
    const from = toScreen({ x: rightEdge(n), y: n.y })
    const slot = slotScreenCenter(at.host, at.index)
    const to = { x: slot.x, y: slot.y + (SLOT_D / 2) * state.zoom }
    const below = slot.y + (FN_H / 2 + 50 + 5 * at.index) * state.zoom, g = 30 * state.zoom
    ctx.beginPath(); ctx.moveTo(from.x, from.y)
    if (from.x + 2 * g <= to.x - g) {
      ctx.bezierCurveTo(from.x + g, from.y, from.x + g, below, from.x + 2 * g, below)
      ctx.lineTo(to.x - g, below)
      ctx.quadraticCurveTo(to.x, below, to.x, to.y)
    } else ctx.bezierCurveTo(from.x + 60 * state.zoom, from.y, to.x, Math.max(below, from.y), to.x, to.y) // dragged off to the right of its slot
    ctx.stroke()
    ctx.beginPath(); ctx.arc(to.x, to.y, 3 * state.zoom, 0, Math.PI * 2); ctx.fillStyle = '#b8b2cf'; ctx.fill()
  })
  ctx.restore()
}
// Fold or open call `n` (its slots and everything plugged into them). Its
// right end stays put, so the link into the call it feeds doesn't jump, and
// so does the camera; opening lays out just what it reveals, to its left.
function foldKeepingRight(n, folded) {
  if (n.match || n.matchInternal) return
  const right = rightEdge(n)
  n.folded = folded
  setRightEdge(n, right)
}
function setFolded(n, folded) {
  foldKeepingRight(n, folded)
  if (!folded) layoutTree(n)
  draw()
}
// Open every call in the current graph and lay each expression tree out
// right-to-left from its root (arguments to the left of the call that uses
// them), or fold every call that has something plugged in. The camera stays.
function setAllFolded(folded) {
  const graph = activeNodes()
  Object.values(graph).forEach((n) => { if (n.type === 'function' && (folded ? hasPlugged(n, graph) : n.folded)) foldKeepingRight(n, folded) })
  if (!folded) Object.values(graph).filter((n) => !n.mountedTo && n.type === 'function').forEach((n) => layoutTree(n, graph))
  draw()
}
// A plugged-in node that has never been laid out (just plugged in, or from a
// template / older project) gets its tree laid out once, so it doesn't sit on
// top of the call it feeds.
function placeNewArguments(graph = activeNodes()) {
  const roots = new Set()
  Object.values(graph).forEach((n) => { if (n.mountedTo && !n.placed && isVisible(n)) roots.add(treeRoot(n)) })
  roots.forEach((root) => layoutTree(root, graph))
}
// Moving a node carries everything plugged into it (shown or folded) along.
function pluggedDescendants(n, graph = activeNodes(), into = new Set()) {
  for (const id of n.mounted || []) {
    const k = id && graph[id]
    if (k && !into.has(k)) { into.add(k); pluggedDescendants(k, graph, into) }
  }
  return into
}
const TREE_ROW = FN_H + 70
const TREE_GAP = 70
function nodeWidth(n) { return n.type === 'function' ? functionBlockWidth(n) : chipWidth(n) }
function rightEdge(n) { return n.type === 'function' ? functionBlockRight(n) : n.x + chipHalfWidth(n) }
function setRightEdge(n, right) { n.x = n.type === 'function' ? right - (functionBlockRight(n) - n.x) : right - chipHalfWidth(n) }
function shownKids(n, graph = activeNodes()) {
  return n.folded ? [] : (n.mounted || []).map((id) => graph[id]).filter(Boolean)
}
function treeHeight(n, graph = activeNodes()) {
  const kids = shownKids(n, graph)
  return kids.length ? Math.max(TREE_ROW, kids.reduce((sum, k) => sum + treeHeight(k, graph), 0)) : TREE_ROW
}
// Keep `root` where it is; place its shown arguments in a column to its
// left, each subtree stacked in its own band, recursively.
function layoutTree(root, graph = activeNodes()) {
  const place = (n, right, top) => {
    const h = treeHeight(n, graph)
    setRightEdge(n, right)
    n.y = top + h / 2
    n.placed = true
    const left = n.type === 'function' ? functionBlockLeft(n) : n.x - chipHalfWidth(n)
    let y = top
    shownKids(n, graph).forEach((k) => { place(k, left - TREE_GAP, y); y += treeHeight(k, graph) })
  }
  place(root, rightEdge(root), root.y - treeHeight(root, graph) / 2)
}
// Lay a whole function body out as its expression tree: Output on the right,
// the tree feeding it to its left (shown arguments further left), and
// anything outside the tree (an unused parameter) below.
function layoutBody(graph) {
  const root = graph[graph.output?.source]
  if (!root) return
  graph.output.x = 0; graph.output.y = 0
  setRightEdge(root, -chipHalfWidth(graph.output) - TREE_GAP * 2)
  root.y = 0
  layoutTree(root, graph)
  const inTree = new Set()
  const walk = (n) => { inTree.add(n.id); shownKids(n, graph).forEach(walk) }
  walk(root)
  let y = treeHeight(root, graph) / 2 + TREE_ROW
  for (const n of Object.values(graph)) if (!inTree.has(n.id) && n.type !== 'output' && !n.mountedTo) { setRightEdge(n, rightEdge(root)); n.y = y; y += TREE_ROW }
}
// A solid link from whatever feeds a function body's Output into its in-port.
function drawOutputLink() {
  const output = activeNodes().output
  const source = output?.source && activeNodes()[output.source]
  if (!source || !isVisible(source)) return
  const from = toScreen({ x: source.type === 'function' ? functionBlockRight(source) : source.x + chipHalfWidth(source), y: source.y })
  const to = toScreen({ x: output.x - chipHalfWidth(output), y: output.y })
  ctx.save()
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2
  const bend = Math.max(40 * state.zoom, Math.abs(to.x - from.x) / 2) // the node stays wherever it was wired from, so curve like the wire did
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.bezierCurveTo(from.x + bend, from.y, to.x - bend, to.y, to.x, to.y); ctx.stroke()
  ctx.beginPath(); ctx.arc(to.x, to.y, 4, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill()
  ctx.restore()
}
// A dashed hairline from each free-standing reference back to its original.
function drawReferenceLinks() {
  const graph = activeNodes()
  ctx.save()
  ctx.setLineDash([4 * state.zoom, 4 * state.zoom]); ctx.strokeStyle = '#b8b2cf'; ctx.lineWidth = 1
  Object.values(graph).filter((n) => (n.type === 'ref' || n.type === 'law') && isVisible(n) && !parameterOf(n, graph)).forEach((ref) => {
    const target = graph[ref.target]
    if (!target || !isVisible(target)) return
    const a = point(ref), b = point(target)
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  })
  ctx.restore()
}
function draw() {
  foldedTexts = new Map()
  updateRunLabel()
  document.querySelector('.canvas-empty').hidden = !!state.activeFunction || Object.values(activeNodes()).some(isVisible)
  elaborationCache = null // something may have changed
  projectPassCache = null
  labelNamer = createNamer()
  const pass = typePass() // shared by every node label and port badge below, so nodes/ports that truly share a type variable display the same letter
  const w = canvas.clientWidth, h = canvas.clientHeight
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#f8f7fc'; ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#ecebf5'; ctx.lineWidth = 1
  for (let x = state.offset.x % 24; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = state.offset.y % 24; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  materializeLiterals(activeNodes())
  placeNewArguments()
  drawReferenceLinks()
  drawOutputLink()
  Object.values(activeNodes()).filter((n) => isVisible(n)).forEach(n => {
    const selected = state.selected === n.id || state.multi.has(n.id)
    const snapHighlight = n.type === 'output' && state.snapTarget?.kind === 'output'
    if (n.type === 'function') drawFunctionBlock(n, pass, selected)
    else drawValueChip(n, pass, selected, snapHighlight)
  })
  drawUnfoldedLinks()
  drawLinkHighlights()
  drawWire()
  updatePortEditor(pass)
  document.querySelector('#node-count').textContent = Object.values(activeNodes()).filter((n) => !isHiddenDefinition(n) && !isBuiltinDefinition(n)).length
  document.querySelector('#connection-count').textContent = Object.values(activeNodes()).filter(n => n.connected).length
  document.querySelector('#graph-name').textContent = activeName()
  document.querySelector('#back-graph').hidden = !state.activeFunction
  document.querySelector('#back-graph').textContent = `← ${state.functionStack.length ? `ƒ ${definitions[state.functionStack[state.functionStack.length - 1]]?.label}` : '최상위'}`
  // Every mutation ends in a draw(), so this is the one place that notices
  // them — debounced, and skipped mid-drag so a drag records one step.
  if (!state.drag && !state.wire) scheduleCheckpoint()
}
// A function node renders as one unified stadium block — the ƒ head badge
// and every parameter slot live inside the SAME silhouette (no separate
// satellite circles/connecting line), so the block's proportions stay clean
// regardless of how many parameters it has. Corner radius is exactly half
// the block's height, i.e. a true stadium/pill — the same silhouette
// drawValueChip below draws at a smaller size, so "function" and "value"
// are visibly the same shape family, differing only in whether the pill has
// holes in it.
function drawFunctionBlock(node, pass, selected) {
  const rect = functionBlockScreenRect(node), p = point(node)
  const broken = callProblem(node) || ambiguityProblem(node, pass)
  ctx.save()
  ctx.shadowColor = selected ? `${ACCENT}40` : '#211d3414'; ctx.shadowBlur = 0; ctx.shadowOffsetY = selected ? 4 : 3
  roundedRectPath(ctx, rect.left, rect.top, rect.right - rect.left, rect.height, (FN_H / 2) * state.zoom)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.shadowColor = 'transparent'; ctx.lineWidth = selected || broken ? 3 : 2; ctx.strokeStyle = broken ? '#e0537d' : selected ? ACCENT : NEUTRAL_BORDER; ctx.stroke()
  ctx.beginPath(); ctx.arc(p.x, p.y, 23 * state.zoom, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = `700 ${22 * state.zoom}px 'Space Grotesk', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(node.match ? '⑂' : 'ƒ', p.x, p.y + 1)
  if (isFolded(node)) {
    ctx.textAlign = 'left'; ctx.fillStyle = '#211d34'; ctx.font = `600 ${CHIP_FONT * state.zoom}px ui-monospace, monospace`
    ctx.fillText(foldedText(node), p.x + FOLDED_TEXT_X * state.zoom, p.y + 1)
    ctx.textAlign = 'center'
  }
  const playX = rect.right - 24 * state.zoom, playY = rect.top + 2 * state.zoom
  ctx.beginPath(); ctx.arc(playX, playY, 13 * state.zoom, 0, Math.PI * 2); ctx.fillStyle = '#211d34'; ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = `${11 * state.zoom}px sans-serif`; ctx.fillText('▶', playX + 1, playY + 1)
  label(node, p, rect.top + rect.height, pass)
  ctx.restore()
}
// Value/boolean/output/curried chips share the function block's exact
// stadium silhouette above (white fill, neutral outline, flat offset
// shadow) — a value is just a function with every hole already filled, so
// it gets the same pill, only shorter. The one place color still lives is
// the small head badge on the left: a violet ƒ for anything function-shaped
// (a curried partial application, or a function value plugged in), a
// TYPE-colored dot (see colorForType) for everything else — the sidebar's
// own glyphs (#, ◉, →) carry over so the badge reads consistently with the
// node library.
function drawValueChip(node, pass, selected, snapHighlight) {
  const rect = valueBlockScreenRect(node), p = point(node)
  const isFunctionValued = node.type === 'curried'
  const typeColor = colorForType(resolvedValueQual(node, activeNodes(), pass).type, labelNamer)
  const badgeColor = node.type === 'law' ? (lawNodeResults.get(node.id)?.ok ? '#1f8f74' : '#c0335e') : isFunctionValued ? ACCENT : typeColor
  const glyph = isFunctionValued ? 'ƒ' : node.type === 'output' ? '→' : node.type === 'boolean' ? '◉' : node.type === 'ref' && !parameterOf(node) ? '↪' : node.type === 'value' ? '◆' : node.type === 'text' ? '"' : node.type === 'law' ? '⚖' : node.type === 'literal' ? literalGlyph(node) : '#'
  // A literal reads red when its text isn't a literal, or doesn't fit the slot it's in.
  const literalSlot = node.type === 'literal' && slotHost(node)
  const badLiteral = node.type === 'literal' && state.editingLiteral !== node.id && (!parseLiteral(node.value) || (literalSlot && pass.perNode.get(literalSlot.host.id)?.invalidSlots?.includes(literalSlot.index)))
  ctx.save()
  ctx.shadowColor = snapHighlight ? `${ACCENT}66` : selected ? `${ACCENT}40` : '#211d3414'
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 3
  roundedRectPath(ctx, rect.left, rect.top, rect.right - rect.left, rect.height, (CHIP_H / 2) * state.zoom)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = snapHighlight ? 4 : selected || badLiteral ? 3 : 2
  ctx.strokeStyle = badLiteral ? '#e0537d' : snapHighlight || selected ? ACCENT : NEUTRAL_BORDER
  ctx.stroke()
  // Same proportions as a function block's head: a 23px badge, 46px in from the left end.
  const badgeX = rect.left + 46 * state.zoom
  ctx.beginPath(); ctx.arc(badgeX, p.y, 23 * state.zoom, 0, Math.PI * 2); ctx.fillStyle = badgeColor; ctx.fill()
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'
  ctx.font = isFunctionValued ? `700 ${22 * state.zoom}px 'Space Grotesk', sans-serif` : `700 ${16 * state.zoom}px ui-monospace, monospace`
  ctx.fillText(glyph, badgeX, p.y + 1)
  // Text never gets squeezed to fit (fillText's maxWidth would narrow the
  // glyphs): a chip grows with its content, and past CHIP_MAX_W the text
  // is cut with an ellipsis.
  ctx.textAlign = 'left'; ctx.fillStyle = '#211d34'; ctx.font = `600 ${CHIP_FONT * state.zoom}px ui-monospace, monospace`
  const textX = badgeX + (23 + 14) * state.zoom
  const room = rect.right - textX - 28 * state.zoom
  let content = nodeDisplayText(node)
  if (ctx.measureText(content).width > room) {
    while (content.length > 1 && ctx.measureText(`${content}…`).width > room) content = content.slice(0, -1)
    content = `${content}…`
  }
  ctx.fillText(content, textX, p.y + 1)
  label(node, p, rect.top + rect.height, pass)
  ctx.restore()
}
// The name under a node; its type is the chevron chain below that (drawCanvasChains).
function label(node, p, baseY) {
  ctx.fillStyle = '#2b2640'; ctx.font = `600 ${13 * state.zoom}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.fillText(nodeName(node), p.x, baseY + 20 * state.zoom)
}
// The declared parameter name at this call site's index (e.g. `n`, `x`,
// `condition`) when known, so a slot can label itself meaningfully instead
// of a generic "input N".
// A canonical definition node's `params` double as its slot *contents* (type
// `3` into add's slot and params[0] becomes '3'), so the declared name comes
// from the builtin as shipped, or a custom function's body parameter nodes.
function paramDisplayName(node, index) {
  if (node.match) return index === node.match.branches.length ? '대상' : branchPattern(node.match.branches[index])
  const sourceId = node.sourceFunctionId || node.id
  const declared = builtinNodes[sourceId]?.params?.[index]
    ?? Object.values(functionBodies[sourceId] || {}).filter((n) => n.type === 'parameter')[index]?.label
  return declared || definitions[sourceId]?.params?.[index] || `#${index + 1}`
}
// Unmounts whatever is plugged into `node`'s slot `index` and returns it
// (or null) — used by both the "−" remove-parameter button and the
// drag-to-detach gesture on a filled slot's chip. Always clears BOTH sides
// of the connection so a moving node never comes back stuck with a stale
// mountedTo pointing at a slot that no longer references it.
function detachMounted(node, index) {
  const mountedId = node.mounted[index]
  const moving = mountedId ? activeNodes()[mountedId] : null
  node.params[index] = ''
  node.mounted[index] = null
  if (moving) { moving.mountedTo = null; moving.connected = false; moving.placed = false }
  return moving
}
// A block that just grew (a slot was added) pushes whatever it now overlaps
// on its right further right, so nothing ends up hidden underneath it.
function makeRoom(grown) {
  const graph = activeNodes()
  const leftOf = (n) => (n.type === 'function' ? functionBlockLeft(n) : n.x - chipHalfWidth(n))
  const rightOf = (n) => (n.type === 'function' ? functionBlockRight(n) : n.x + chipHalfWidth(n))
  const queue = [grown]
  for (let guard = 0; queue.length && guard < 200; guard++) {
    const block = queue.shift()
    for (const n of Object.values(graph)) {
      if (n === block || n === grown || !isVisible(n) || Math.abs(n.y - block.y) >= FN_H + 40) continue
      if (leftOf(n) >= leftOf(block) && leftOf(n) < rightOf(block) + 40) {
        n.x += rightOf(block) + 60 - leftOf(n)
        queue.push(n)
      }
    }
  }
}
// 'signature' for a custom function's own definition, 'elements' for a list literal, else false.
// Why a call node no longer matches what it calls (a type edit renamed a
// constructor or field, or a signature changed underneath it), or null.
function callProblem(node) {
  if (node.match) return matchProblem(node, activeNodes(), definitions, functionBodies)
  if (node.type !== 'function' || !node.sourceFunctionId) return null
  const def = definitions[node.sourceFunctionId]
  if (!def) return `${node.label} no longer exists (renamed or deleted)`
  if (def.builtin === 'listOf') return null
  const arity = def.custom ? Object.values(functionBodies[def.id] || {}).filter((n) => n.type === 'parameter').length : def.derived ? def.derived.arity : def.params?.length
  if (arity !== undefined && arity !== node.params.length) return `${def.label} now takes ${arity} argument${arity === 1 ? '' : 's'}, this call has ${node.params.length} slot${node.params.length === 1 ? '' : 's'}`
  return null
}
// Give a call node exactly as many slots as its function takes (dropping the extra ones' contents).
function fixCallSlots(node) {
  const def = definitions[node.sourceFunctionId]
  if (!def) return
  const arity = def.custom ? Object.values(functionBodies[def.id] || {}).filter((n) => n.type === 'parameter').length : def.derived ? def.derived.arity : def.params.length
  while (node.params.length > arity) { detachMounted(node, node.params.length - 1); node.params.pop(); node.mounted.pop(); node.paramScopes?.pop() }
  while (node.params.length < arity) { node.params.push(''); node.mounted.push(null); node.paramScopes?.push('local') }
}
function isSignatureEditable(node) {
  if (viewingReadonly()) return false
  if (nodes[node.id] === node && node.custom && !node.library) return 'signature' // a taken-over definition keeps the library's type
  if (nodes[node.sourceFunctionId]?.lambda) return 'signature'
  if (hasVariadicSlots(node, definitions)) return 'elements'
  return false
}
function updatePortEditor(pass = typePass()) {
  // The overlay is rebuilt from scratch on every draw(), including the one a
  // keystroke in a literal triggers — remember the caret so typing `12`
  // doesn't lose focus after the `1`.
  const focused = editor.contains(document.activeElement) && document.activeElement.classList.contains('literal-input')
    ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : null
  rebuildingEditor = true
  editor.innerHTML = ''
  rebuildingEditor = false
  // A call folded away inside another's (folded) slot is hidden, and so are its own slots.
  const visibleFunctions = Object.values(activeNodes()).filter((n) => isFunction(n) && isVisible(n))
  // One fold toggle per call, on the top border above its head badge: folds
  // (or opens) all its slots, and everything plugged into them, at once.
  visibleFunctions.filter((node) => !node.match && node.params.length > 0).forEach((node) => {
    const p = point(node)
    const size = 20 * state.zoom
    const toggle = document.createElement('button')
    toggle.className = 'fold-toggle'; toggle.type = 'button'
    toggle.dataset.functionId = node.id
    toggle.textContent = node.folded ? '⤢' : '⤡'
    toggle.title = node.folded ? 'Open: show the slots of this call and what is plugged into them' : 'Fold: hide the slots of this call and what is plugged into them'
    toggle.style.width = toggle.style.height = `${size}px`
    toggle.style.left = `${p.x - size / 2}px`; toggle.style.top = `${p.y - (FN_H / 2) * state.zoom - size / 2}px`
    toggle.style.fontSize = `${12 * state.zoom}px`; toggle.style.lineHeight = `${size}px`
    toggle.addEventListener('pointerdown', (event) => { event.stopPropagation(); event.preventDefault() })
    toggle.addEventListener('click', (event) => { event.stopPropagation(); setFolded(node, !node.folded) })
    editor.append(toggle)
  })
  visibleFunctions.filter((node) => !isFolded(node)).forEach(node => node.params.forEach((rawValue, index) => {
    const center = slotScreenCenter(node, index)
    if (node.match && index < node.match.branches.length) {
      const branch = node.match.branches[index]
      const button = document.createElement('button')
      button.className = 'match-arm-button'
      button.dataset.matchId = node.id; button.dataset.branchIndex = index
      button.textContent = branchPattern(branch)
      button.title = `${branchPattern(branch)} → 분기 본문 편집`
      button.style.left = `${center.x - 58 * state.zoom}px`; button.style.top = `${center.y - 18 * state.zoom}px`
      button.style.width = `${116 * state.zoom}px`; button.style.height = `${36 * state.zoom}px`; button.style.fontSize = `${11 * state.zoom}px`
      button.onpointerdown = (event) => { event.stopPropagation(); event.preventDefault() }
      button.onclick = () => enterFunction(branch.useDefault ? node.match.defaultBranch.fnId : branch.fnId)
      editor.append(button)
      return
    }
    const mountedId = node.mounted[index]
    const mountedNode = mountedId ? activeNodes()[mountedId] : null
    const expectedType = pass.perNode.get(node.id)?.paramTypes?.[index]
    const slotColor = colorForType(expectedType, labelNamer)
    const isSnapTarget = state.snapTarget?.kind === 'param' && state.snapTarget.targetId === node.id && state.snapTarget.index === index
    const slot = document.createElement('div')
    slot.className = `param-slot ${mountedNode ? 'filled' : ''} ${isSnapTarget ? 'snap-target' : ''}`
    slot.style.left = `${center.x - (SLOT_D / 2) * state.zoom}px`; slot.style.top = `${center.y - (SLOT_D / 2) * state.zoom}px`
    slot.style.width = `${SLOT_D * state.zoom}px`; slot.style.height = `${SLOT_D * state.zoom}px`
    slot.style.borderColor = mountedNode ? 'transparent' : slotColor
    slot.style.borderWidth = `${Math.max(1, 2 * state.zoom)}px`
    slot.dataset.functionId = node.id; slot.dataset.index = index
    // One small pill above the slot names the parameter. Its type isn't
    // repeated here: it's the chevron right under this slot in the block's
    // type chain (drawCanvasChains), where it can also be pinned.
    const tag = document.createElement('span')
    tag.className = 'param-tag'
    const tagName = document.createElement('b')
    tagName.className = 'param-tag-name'; tagName.textContent = paramDisplayName(node, index)
    tag.append(tagName)
    tag.title = `${paramDisplayName(node, index)} :: ${expectedParamType(node, index, activeNodes(), labelNamer, pass)}`
    // Plain DOM elements laid over the canvas, not canvas-drawn text — the
    // slot's own width/height already scale with state.zoom above, but this
    // tag's font-size/spacing need the same treatment explicitly or it stays
    // pinned at its CSS default size while the slot around it grows/shrinks,
    // drifting out of place at anything but 100% zoom.
    tag.style.fontSize = `${10 * state.zoom}px`
    tag.style.padding = `${2 * state.zoom}px ${7 * state.zoom}px`
    tag.style.marginBottom = `${(FN_H / 2 - SLOT_D / 2 - 18) * state.zoom}px` // up near the block's top, clear of the dot
    tag.style.maxWidth = `${(SLOT_STRIDE - TAG_GAP) * state.zoom}px`
    // Zoomed far out the tag is a few px of unreadable text (or, under a
    // browser minimum font size, a full-size pill piling onto its
    // neighbours) — leave it to the tooltip until it can be read.
    if (state.zoom >= TAG_MIN_ZOOM) slot.append(tag)
    else slot.title = tag.title
    // A slot is just an in-port: a dot that wires are dropped on. What fills
    // it is always a node on the canvas, wired in — a value like `3` too, as
    // a literal node: clicking an empty dot makes one, plugged in and ready
    // to type into. A filled dot takes the colour of its type; one whose
    // literal doesn't fit is marked.
    const invalid = pass.perNode.get(node.id)?.invalidSlots?.includes(index)
    if (mountedNode) slot.style.background = invalid ? '#e0537d' : slotColor
    if (invalid) { slot.classList.add('invalid'); slot.title = `${nodeDisplayText(mountedNode)} doesn't fit ${tag.title}` }
    else if (!mountedNode && !viewingReadonly()) slot.title = `${tag.title} — click to type a value, or drop a wire here`
    slot.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation() })
    slot.addEventListener('click', (event) => {
      event.stopPropagation()
      if (mountedNode) { state.selected = mountedNode.id; updateInspector(); draw() }
      else createLiteralIn(node, index)
    })
    // Slots can only be added/removed where that means something: a custom
    // function's definition (its signature — synced to its body and every
    // call, see signature.js) or a list literal (its length). Everywhere else
    // the slots are the callee's parameters.
    const editable = isSignatureEditable(node)
    if (!editable) { editor.append(slot); return }
    const remove = document.createElement('button')
    remove.className = 'param-remove'; remove.type = 'button'; remove.textContent = '−'; remove.title = editable === 'signature' ? `Remove parameter ${paramDisplayName(node, index)} (from the body and every call)` : 'Remove this element'
    remove.style.width = remove.style.height = `${16 * state.zoom}px`
    remove.style.right = remove.style.top = `${-14 * state.zoom}px`
    remove.style.fontSize = `${12 * state.zoom}px`; remove.style.lineHeight = `${16 * state.zoom}px`
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      if (editable === 'signature') removeParameter({ nodes, functionBodies }, nodes[node.sourceFunctionId]?.lambda ? node.sourceFunctionId : node.id, index)
      else {
        const moving = detachMounted(node, index)
        if (moving) { moving.x = node.x + 150; moving.y = node.y + 110 }
        node.params.splice(index, 1); node.mounted.splice(index, 1); node.paramScopes.splice(index, 1)
      }
      state.selected = node.id; renderFunctionLibrary(); updateInspector(); draw()
    })
    slot.append(remove)
    editor.append(slot)
  }))
  visibleFunctions.forEach(node => {
    const editable = isSignatureEditable(node)
    if (!editable || isFolded(node)) return
    const add = document.createElement('button')
    add.className = 'param-add'; add.type = 'button'; add.textContent = '+'; add.title = editable === 'signature' ? 'Add a parameter (to the body and every call)' : 'Add an element'
    // Just past the block's right edge (not at the next slot's would-be
    // center, which lands on the edge itself once the tail is wider).
    const center = toScreen({ x: functionBlockRight(node) + 34, y: node.y }) // past the out-port
    const addSize = 26 * state.zoom
    add.style.width = add.style.height = `${addSize}px`
    add.style.fontSize = `${18 * state.zoom}px`; add.style.lineHeight = `${20 * state.zoom}px`
    add.style.left = `${center.x - addSize / 2}px`; add.style.top = `${point(node).y - addSize / 2}px`
    add.addEventListener('click', () => {
      if (editable === 'signature') addParameter({ nodes, functionBodies }, nodes[node.sourceFunctionId]?.lambda ? node.sourceFunctionId : node.id)
      else { node.params.push(''); node.mounted.push(null); node.paramScopes.push('local') }
      makeRoom(node)
      state.selected = node.id; renderFunctionLibrary(); updateInspector(); draw()
    })
    editor.append(add)
  })
  drawCanvasChains(pass)
  drawSignatureBar()
  // Every node's out-port, on its right end: drag from it to stretch a wire
  // and release over a slot (or Output) to plug the node in there. A port
  // that already feeds something can be pulled again to re-plug it, or
  // dropped on empty canvas to disconnect.
  const graph = activeNodes(), output = state.activeFunction ? graph.output : null
  const portSize = 14 * state.zoom
  const placePort = (el, at) => {
    el.style.width = el.style.height = `${portSize}px`
    el.style.left = `${at.x - portSize / 2}px`; el.style.top = `${at.y - portSize / 2}px`
    el.style.borderWidth = `${Math.max(1, 2 * state.zoom)}px`
  }
  Object.values(graph).filter((n) => isVisible(n) && n.type !== 'output' && n.type !== 'law').forEach((n) => {
    const port = document.createElement('div')
    const feeding = !!n.mountedTo || output?.source === n.id
    port.className = `out-port ${feeding ? 'filled' : ''} ${state.wire?.node === n ? 'active' : ''}`
    port.dataset.nodeId = n.id
    port.title = feeding ? 'Drag to re-plug (drop on empty canvas to disconnect)' : 'Drag onto a slot to plug this in'
    placePort(port, toScreen({ x: rightEdge(n), y: n.y }))
    port.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); beginWire(n, event) })
    editor.append(port)
  })
  // Output's in-port on its left end: wires are dropped here; grabbing it
  // when filled pulls out the wire of what feeds it.
  if (output?.type === 'output' && isVisible(output)) {
    const port = document.createElement('div')
    const source = graph[output.source]
    port.className = `in-port ${source ? 'filled' : ''} ${state.snapTarget?.kind === 'output' ? 'snap-target' : ''}`
    port.title = source ? 'Drag to pull out the wire feeding Output' : 'Drop a wire here to make it the result'
    placePort(port, toScreen({ x: output.x - chipHalfWidth(output), y: output.y }))
    port.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); if (source && isVisible(source)) beginWire(source, event) })
    editor.append(port)
  }
  // The literal being typed into: an input laid over its chip's text.
  const editing = state.editingLiteral && graph[state.editingLiteral]
  if (editing && isVisible(editing) && !viewingReadonly()) {
    const rect = valueBlockScreenRect(editing)
    const left = rect.left + (46 + 23 + 10) * state.zoom
    const input = document.createElement('input')
    input.className = 'literal-input'; input.type = 'text'; input.spellcheck = false
    input.value = editing.value ?? ''
    input.placeholder = '3, "text", True'
    input.style.left = `${left}px`; input.style.top = `${rect.top + rect.height / 2 - 16 * state.zoom}px`
    input.style.width = `${Math.max(90 * state.zoom, rect.right - 22 * state.zoom - left)}px`; input.style.height = `${32 * state.zoom}px`
    input.style.fontSize = `${CHIP_FONT * state.zoom}px`
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('input', () => { editing.value = input.value; updateInspector(); draw() })
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); input.blur() } })
    input.addEventListener('blur', () => { if (!rebuildingEditor) finishLiteralEdit(editing.id) })
    editor.append(input)
    input.focus()
    if (focused) input.setSelectionRange(focused.start, focused.end)
    else input.select()
  }
}
// Clicking an empty slot: a literal node, plugged into it and laid out to the
// left of the call with its other arguments, open for typing its value.
let rebuildingEditor = false
function createLiteralIn(host, index) {
  if (readonlyBlocked()) return
  const graph = activeNodes()
  const id = `literal-${Date.now()}`
  graph[id] = { id, type: 'literal', label: 'literal', value: '', color: '#4f8ef7', x: host.x, y: host.y, mountedTo: `${host.id}:${index}`, connected: true, placed: true }
  host.mounted[index] = id
  host.params[index] = ''
  layoutTree(host)
  state.selected = id
  state.editingLiteral = id
  updateInspector(); draw()
}
// Done typing: a literal left empty goes away (its slot is open again).
function finishLiteralEdit(id) {
  if (state.editingLiteral !== id) return
  state.editingLiteral = null
  const n = activeNodes()[id]
  if (n && String(n.value ?? '').trim() === '') return deleteNode(id)
  const at = n && slotHost(n)
  if (at) at.host.params[at.index] = nodeDisplayText(n)
  updateInspector(); draw()
}
function startLiteralEdit(n) {
  if (viewingReadonly() || n?.type !== 'literal') return
  state.selected = n.id
  state.editingLiteral = n.id
  updateInspector(); draw()
}
// Slot text from before slots were dots (a `3` typed straight into a slot)
// becomes a literal node plugged into that slot — same meaning, now visible.
function materializeLiterals(graph) {
  let changed = false
  for (const n of Object.values(graph)) {
    if (n?.type !== 'function') continue
    ;(n.params || []).forEach((text, i) => {
      if (n.mounted?.[i] || !parseLiteral(text)) return
      const id = `literal-${n.id}-${i}-${Math.random().toString(36).slice(2, 7)}`
      graph[id] = { id, type: 'literal', label: 'literal', value: text.trim(), color: '#4f8ef7', x: n.x, y: n.y, mountedTo: `${n.id}:${i}`, connected: true, placed: false }
      n.mounted = n.mounted || n.params.map(() => null)
      n.mounted[i] = id
      changed = true
    })
  }
  return changed
}
// After a `number` node's type annotation changes, any existing wire into it
// may no longer type-check (e.g. it was plugged into an Int-only port, then
// re-annotated Double). inferGraph's per-edge catch would otherwise leave the
// wire visibly connected while silently no longer constraining anything —
// actually clear it so the canvas reflects reality.
function invalidateStaleWires(node) {
  const graph = activeNodes()
  Object.values(graph).filter(isFunction).forEach((fn) => {
    fn.mounted?.forEach((mountedId, i) => {
      if (mountedId === node.id && !canConnect(node, fn, i)) {
        fn.mounted[i] = null
        fn.params[i] = ''
        node.mountedTo = null
        node.connected = false
      }
    })
  })
}
function escapeAttr(text) { return String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') }
function renderLawInspector(n) {
  const r = lawNodeResults.get(n.id)
  const fn = nodes[n.target]
  return `<div class="selected-node"><span class="selected-icon">⚖</span><div><b>${escapeAttr(n.law)}</b><small>Law claim on ${escapeAttr(fn?.label ?? '?')}</small></div><span class="live">${!r ? '' : r.ok ? 'HOLDS' : 'BROKEN'}</span></div><div class="property"><label>CLAIM</label><div class="connection-tag">${escapeAttr(fn?.label ?? '?')} is ${n.law === 'homomorphism' ? 'a monoid homomorphism' : n.law === 'action' ? 'a monoid action' : 'inflationary'}</div></div><div class="property"><label>RESULT</label><div class="connection-tag"><span class="law ${r?.ok ? 'ok' : 'bad'}">${!r ? 'not checked yet' : `${r.ok ? '✓' : '✗'} ${escapeAttr(r.law)}${r.ok ? '' : ` — ${escapeAttr(r.counterexample)}`}`}</span></div></div>${deleteButton(n)}<div class="inspector-note">Re-checked after every edit.</div>`
}
function renderValueInspector(n) {
  if (n.type === 'law') return renderLawInspector(n)
  const q = resolvedValueQual(n)
  const isNumber = n.type === 'number'
  const defaultType = q.type.kind === 'var' ? pickDefault(q.preds, q.type.id) : null
  const defaultRow = defaultType ? `<div class="property"><label>DEFAULT</label><div class="connection-tag">${defaultType} <em>(디폴팅: Integer → Double)</em></div></div>` : ''
  // Only offer annotations whose type actually has the structure the literal's
  // text demands (e.g. `-3` needs Ring, so Natural isn't offered) — keeping
  // the current choice listed even if a later edit made it unfit.
  const litPred = (t) => pred(literalClass(n.value ?? ''), tcon(t))
  const annotateRow = isNumber
    ? `<div class="property"><label>ANNOTATE TYPE</label><select class="type-annotate"><option value="">자동 (추론)</option>${numericTypes.filter((t) => n.annotation === t || entails([], litPred(t))).map((t) => `<option ${n.annotation === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`
    : ''
  if (parameterOf(n)) return `<div class="selected-node"><span class="selected-icon number">#</span><div><b>${escapeAttr(nodeName(n))}</b></div></div><div class="property"><label>TYPE${state.activeFunction && (n.type === 'parameter' || n.type === 'output' || parameterOf(n)) ? ' — drag a type onto it to pin it' : ''}</label><div class="inspector-chain">${inspectorChainHtml(parameterOf(n) || n)}</div></div>${deleteButton(n)}<div class="inspector-note">Another use of this parameter: add it from PARAMETERS in the workspace.</div>`
  return `<div class="selected-node"><span class="selected-icon number">#</span><div><b>${escapeAttr(n.label)}</b></div></div><div class="property"><label>TYPE${state.activeFunction && (n.type === 'parameter' || n.type === 'output' || parameterOf(n)) ? ' — drag a type onto it to pin it' : ''}</label><div class="inspector-chain">${inspectorChainHtml(parameterOf(n) || n)}</div></div>${defaultRow}${annotateRow}<div class="property"><label>VALUE</label>${n.type === 'boolean' ? `<select class="bool-input"><option ${n.value === 'true' ? 'selected' : ''}>true</option><option ${n.value !== 'true' ? 'selected' : ''}>false</option></select>` : `<input class="value-input" value="${escapeAttr(n.type === 'ref' || n.type === 'value' ? nodeDisplayText(n) : n.value ?? 'partial')}" ${isNumber || n.type === 'text' || n.type === 'literal' || n.type === 'value' ? '' : 'readonly'} />`}</div>${useAgainButton(n)}${deleteButton(n)}`
}
// Why `n` can't be deleted, or null if it can. Builtins are the language
// itself; a function's Output and parameters are its signature, changed
// through the function's own ports instead; a custom function still called
// from some body would leave those calls dangling.
function deleteBlocker(n) {
  if (n.readonly) return "Builtin functions can't be deleted"
  if (n.type === 'output' || n.type === 'parameter') return "A function's Output and parameters can't be deleted"
  if (n.custom && nodes[n.id] === n) {
    const callers = Object.values(functionBodies).flatMap((body) => Object.values(body)).filter((m) => m.sourceFunctionId === n.id).length
    if (callers) return `${n.label} is still called ${callers} time${callers > 1 ? 's' : ''} — delete those calls first`
    const uses = classUsesOf(classes, n.id)
    if (uses.length) return `${n.label} is ${uses.join(', ')} — pick another function there first`
  }
  return null
}
// Laws a custom function can be checked against: a monoid homomorphism (e.g.
// production :: Owned → Wallet), a monoid action (tick :: Double → Model →
// Model — then offline progress is one step), or inflationary on a
// partial order (achievements never go backwards).
const lawResults = new Map() // function id -> { [law]: result }
function functionLawsPanel(n) {
  const results = lawResults.get(n.id) || {}
  const rows = FUNCTION_LAWS.map((law) => {
    const r = results[law]
    const status = !r ? '' : r.ok ? `<span class="law ok">✓ ${escapeAttr(r.law)}</span>` : `<span class="law bad">✗ ${escapeAttr(r.law)} — <em>${escapeAttr(r.counterexample)}</em></span>`
    return `<div class="law-row"><button class="law-check" data-law="${law}">${law}</button><button class="law-check" data-pin="${law}" title="Pin this claim on the canvas (re-checked after every edit)">📌</button>${status}</div>`
  })
  return `<details class="property" data-disclosure="laws:${escapeAttr(n.id)}"><summary>Law checks</summary>${rows.join('')}</details>`
}
function runFunctionLaw(n, law) {
  lawResults.set(n.id, { ...(lawResults.get(n.id) || {}), [law]: computeFunctionLaw(n, law) })
  updateInspector()
}
function computeFunctionLaw(n, law) {
  const entry = typePass(nodes).perNode.get(n.id)
  const arity = Object.values(functionBodies[n.id] || {}).filter((m) => m.type === 'parameter').length
  let fnType = entry?.paramTypes ? entry.paramTypes.reduceRight((acc, t) => tfun(t, acc), entry.resultType) : null
  // Samples need concrete types: default each type variable the way GHC
  // resolves an ambiguous one (Semiring a → Integer, Field a → Double).
  const unresolved = []
  if (fnType) {
    const defaults = new Map()
    ftv(fnType).forEach((v) => { const d = pickDefault(entry.preds || [], v); if (d) defaults.set(v, tcon(d)); else unresolved.push(v) })
    fnType = applySubst(defaults, fnType)
  }
  const result = !fnType ? { law, ok: false, counterexample: 'no type' }
    : unresolved.length ? { law, ok: false, counterexample: `${showQual(entry.preds || [], fnType)} is polymorphic — use it at a concrete type to check its laws` }
    : checkFunctionLaw(law, { kind: 'closure', callee: n.id, args: Array(arity).fill(null) }, fnType, { ev: evaluator, types })
  return result
}
// --- Law nodes ----------------------------------------------------------------
// A claim pinned on the canvas next to a function — "this is a monoid
// homomorphism / action / inflationary" — re-checked after every edit and
// shown as ✓ or ✗. Results aren't saved; they're recomputed.
const lawNodeResults = new Map() // law node id -> result
function pinLaw(fn, law) {
  const id = `law-${Date.now()}`
  nodes[id] = { id, type: 'law', law, target: fn.id, label: law, x: functionBlockRight(fn) + 120, y: fn.y + 70 }
  recheckLawNodes()
  state.selected = id
  updateInspector(); draw()
}
function recheckLawNodes() {
  for (const n of Object.values(nodes)) {
    if (n.type !== 'law') continue
    const fn = nodes[n.target]
    lawNodeResults.set(n.id, fn ? computeFunctionLaw(fn, n.law) : { law: n.law, ok: false, counterexample: 'the function is gone' })
  }
}
// The custom function `id` as Haskell: its signature and its definition,
// read back from the body graph (src/haskellPrint.js).
// The function `id` as Haskell — a function of your own, or a definition
// view — read back from its body graph (haskellPrint.js). Every token is
// linked to the node it came from: hovering one lights the node up on the
// canvas, clicking it goes there (opening the body if need be), and the
// selected node's tokens are marked.
function definitionBlock(id, title = 'DEFINITION') {
  const def = definitions[id]
  const tokens = def && printDefinitionTokens(id, definitions, allBodies)
  if (!tokens) return ''
  const type = def.scheme ? showQual(def.scheme.preds, def.scheme.type) : functionSignature(def, nodes)
  const note = def.note ? `\n-- ${def.note}` : ''
  return `<details class="property definition" data-disclosure="definition:${escapeAttr(id)}"><summary>${escapeAttr(title)}</summary><pre class="haskell">${escapeAttr(`${def.label} :: ${asciiType(type)}`)}\n${tokensHtml(tokens)}${escapeAttr(note)}</pre></details>`
}
// A call's DEFINITION: your own function's, or the definition graph of a
// library one — with the way into it.
function callDefinitionBlock(n) {
  const defId = n.sourceFunctionId || n.id
  const def = definitions[defId]
  if (!def || def.lambda) return ''
  if (def.method) return `<div class="property"><label>DEFINITION</label><div class="connection-tag">${escapeAttr(def.expression)}</div></div>` // a method of a class you declared: its instances are in the class editor
  if (def.custom) return `${definitionBlock(defId)}${def.library ? '<button class="use-again" id="open-definition">Open definition → <small>(your graph)</small></button>' : ''}`
  const viewId = ensureView(defId, n.params.length)
  if (!viewId) return ''
  return `${definitionBlock(viewId)}<button class="use-again" id="open-definition">Open definition → <small>${isEditableView(viewId, viewDefs) ? (viewDefs[viewId].note ? '(a primitive you can take over)' : '(a graph you can take over)') : '(a primitive · read-only)'}</small></button>`
}
function tokensHtml(tokens) {
  const graph = activeNodes()
  const marked = new Set([state.selected, ...state.multi])
  // A reference stands for its target: selecting either marks both.
  Object.values(graph).forEach((n) => { if (n.type === 'ref' && (marked.has(n.id) || marked.has(n.target))) { marked.add(n.id); marked.add(n.target) } })
  return tokens.map((t) => {
    if (!t.id) return escapeAttr(t.text)
    const linked = t.scope === state.activeFunction && marked.has(t.id)
    return `<span class="tok ${t.role || ''} ${linked ? 'linked' : ''}" data-scope="${escapeAttr(t.scope)}" data-node="${escapeAttr(t.id)}"${t.slot === undefined ? '' : ` data-slot="${t.slot}"`}>${escapeAttr(t.text)}</span>`
  }).join('')
}
function wireDefinitionTokens() {
  inspector.querySelectorAll('.haskell .tok').forEach((span) => {
    const target = { scope: span.dataset.scope, id: span.dataset.node, slot: span.dataset.slot === undefined ? undefined : Number(span.dataset.slot) }
    span.onmouseenter = () => { state.hover = target; draw() }
    span.onmouseleave = () => { state.hover = null; draw() }
    span.onclick = () => goToToken(target)
  })
}
// Show the node a token was read from: open the body it lives in, then select it.
function goToToken({ scope, id }) {
  state.hover = null
  if (scope !== state.activeFunction) {
    if (!allBodies[scope]) return
    enterFunction(scope)
    if (state.activeFunction !== scope) return
  }
  if (activeNodes()[id]) { state.multi.clear(); state.selected = id }
  updateInspector(); draw()
}
// Where on the canvas a node is: the node itself, or — while it sits folded
// in a slot — that slot (on the nearest visible host).
function visibleAnchor(id, slot) {
  let n = activeNodes()[id]
  let index = slot
  for (let guard = 0; n && !isVisible(n) && guard < 50; guard++) {
    const at = slotHost(n)
    if (!at) return null
    n = at.host; index = at.index
  }
  return n ? { node: n, slot: index } : null
}
// A highlight ring around what the hovered DEFINITION token was read from.
function drawLinkHighlights() {
  if (!state.hover || state.hover.scope !== state.activeFunction) return
  const anchor = visibleAnchor(state.hover.id, state.hover.slot)
  if (!anchor) return
  const { node, slot } = anchor
  ctx.save()
  ctx.strokeStyle = '#f0a020'; ctx.lineWidth = 3; ctx.setLineDash([])
  if (slot !== undefined && isFunction(node)) {
    const c = slotScreenCenter(node, slot)
    ctx.beginPath(); ctx.arc(c.x, c.y, (SLOT_D / 2 + 6) * state.zoom, 0, Math.PI * 2); ctx.stroke()
  } else {
    const r = isFunction(node) ? functionBlockScreenRect(node) : valueBlockScreenRect(node)
    const pad = 7 * state.zoom
    roundedRectPath(ctx, r.left - pad, r.top - pad, r.right - r.left + pad * 2, r.height + pad * 2, r.height / 2 + pad)
    ctx.stroke()
  }
  ctx.restore()
}
// In a read-only view: what a node is, its type, and the way into what it calls.
function readonlyInspector(n) {
  const active = state.activeFunction
  if (n.type === 'output') {
    const def = definitions[active]
    const editable = def?.view && isEditableView(active, viewDefs)
    return `<div class="selected-node"><span class="selected-icon output-icon">→</span><div><b>${escapeAttr(def?.label ?? '')}</b><small>Definition · read-only</small></div><span class="live">VIEW</span></div>${definitionBlock(active)}${editable ? '<button class="evaluate" id="edit-definition">✎ &nbsp; Edit definition</button>' : ''}<div class="inspector-note">${editable ? (def.note ? `A primitive of the runtime. Edit definition makes it your own graph, starting as the primitive itself (${escapeAttr(primLabel(def.label))}) — wrap or replace it; every call then runs yours, checked against the same type.` : 'How the Prelude defines it. Edit definition makes it your own graph — every call then runs yours, checked against the same type.') : 'A read-only definition: nodes can be moved to look, not changed.'}</div>`
  }
  return `<div class="selected-node"><span class="selected-icon">${n.type === 'function' ? 'ƒ' : '·'}</span><div><b>${escapeAttr(nodeDisplayText(n))}</b><small>Read-only definition</small></div></div><div class="property"><label>TYPE</label><div class="inspector-chain">${inspectorChainHtml(n)}</div></div>${n.type === 'function' ? callDefinitionBlock(n) : ''}${definitions[n.sourceFunctionId]?.lambda ? '<button class="use-again" id="open-body">Open body →</button>' : ''}`
}
function useAgainButton(n) {
  return n.type === 'output' ? '' : '<button class="use-again" id="use-again" title="Make a reference to plug this value into another slot">↪ Use again</button>'
}
function deleteButton(n) {
  return deleteBlocker(n) ? '' : '<button class="delete-node" id="delete-node">Delete node <kbd>Del</kbd></button>'
}
// Removes `id` from the active graph, unplugging it from wherever it was
// mounted and freeing whatever was mounted into it (placed beside it). A
// custom function's definition takes its body with it.
function deleteNode(id) {
  if (readonlyBlocked()) return
  const graph = activeNodes()
  const n = graph[id]
  if (!n) return
  const blocker = deleteBlocker(n)
  if (blocker) return showToast(blocker)
  // References to a deleted node would dangle — they go with it.
  Object.values(graph).filter((m) => (m.type === 'ref' || m.type === 'law') && m.target === id).forEach((ref) => deleteNode(ref.id))
  Object.values(graph).forEach((other) => {
    if (other.type === 'function') other.mounted?.forEach((mountedId, i) => { if (mountedId === id) { other.mounted[i] = null; other.params[i] = '' } })
    if (other.type === 'output' && other.source === id) { other.source = null; other.value = 'open' }
  })
  ;(n.mounted || []).forEach((mountedId, i) => {
    const child = mountedId && graph[mountedId]
    if (child) { child.mountedTo = null; child.connected = false; child.x = n.x + 150 + i * 40; child.y = n.y + 120 }
  })
  delete graph[id]
  if (n.match) deleteMatch({ nodes, functionBodies }, graph, n)
  if (graph === nodes && n.custom) delete functionBodies[id]
  // The last call to a λ is the λ: take its hidden definition and body with it.
  const lambdaId = n.sourceFunctionId
  if (nodes[lambdaId]?.lambda && ![nodes, ...Object.values(functionBodies)].some((g) => Object.values(g).some((m) => m.sourceFunctionId === lambdaId))) {
    delete nodes[lambdaId]
    delete functionBodies[lambdaId]
  }
  if (entryId === id) entryId = null
  state.selected = state.activeFunction ? 'output' : 'add'
  renderFunctionLibrary(); updateInspector(); draw()
}
// An ambiguous node says why (GHC's message, in short) and what fixes it.
function ambiguityRow(n) {
  const why = ambiguityProblem(n, typePass())
  return why ? `<div class="property broken-call"><label>AMBIGUOUS TYPE</label><div class="connection-tag">${escapeAttr(why)}</div></div>` : ''
}
// A custom function's own definition can be renamed (calls refer to it by id, and follow).
function functionNameRow(n) {
  if (!(nodes[n.id] === n && n.custom && !isHiddenDefinition(n))) return ''
  return `<div class="property"><label>NAME</label><input class="value-input" id="function-rename" value="${escapeAttr(n.label)}" title="Rename this function — every call follows" spellcheck="false" /></div>`
}
// A call to (or the definition of) a customized derived function says so, with the way back.
function customizedRow(n) {
  const id = n.sourceFunctionId || n.id
  const def = nodes[id]
  if (def?.library) return `<div class="property"><label>TAKEN OVER</label><div class="connection-tag">Your own graph for the Prelude's ${escapeAttr(def.label)} — every call runs it, and it keeps the Prelude's type</div><button class="law-check" id="restore-library" data-id="${escapeAttr(id)}">↺ Back to the Prelude's definition</button></div>`
  if (!def?.override) return ''
  return `<div class="property"><label>CUSTOMIZED</label><div class="connection-tag">Your own definition of ${escapeAttr(def.label)}, derived from type ${escapeAttr(def.override)} (its body can use ${escapeAttr(primLabel(def.label))})</div><button class="law-check" id="reset-derived" data-id="${id}">Reset to the derived definition</button></div>`
}
// The inspector shows a node's type as the same chain as the canvas (and
// pins it the same way); the targets are kept for wiring after render.
let inspectorChainInfo = null
function inspectorChainHtml(n) {
  const info = chainInfo(n, typePass())
  inspectorChainInfo = info
  return info ? chainHtml(info.segments, createNamer(), info.opts) : '?'
}
// Inside a body, whatever is selected, the body's own definition is shown
// too (its tokens marking the selection) — the way back to any other node.
function enclosingDefinition(n) {
  const fn = state.activeFunction
  if (!fn || n.type === 'output' || definitions[fn]?.lambda || (n.sourceFunctionId || n.id) === fn) return ''
  return definitionBlock(fn, `DEFINITION · ƒ ${definitions[fn]?.label ?? ''}`)
}
function parameterControls(n) {
  if (!n.params.length) return ''
  const editable = nodes[n.id] === n && n.custom
  return `<div class="property"><label>INPUTS</label>${n.params.map((value, i) => {
    const source = n.mounted[i] && activeNodes()[n.mounted[i]]
    return `<div class="port-row">${editable ? `<input class="param-rename" aria-label="Parameter ${i + 1} name" data-index="${i}" value="${escapeAttr(paramDisplayName(n, i))}" />${i ? `<button class="param-move" data-index="${i}" title="Move parameter left">↑</button>` : ''}` : `<span>${escapeAttr(paramDisplayName(n, i))}</span>`}${source ? `<button class="input-source" data-select-input="${i}" title="Select connected value">${escapeAttr(nodeDisplayText(source))}</button><button class="disconnect-input" data-disconnect-input="${i}" title="Disconnect input" aria-label="Disconnect ${escapeAttr(paramDisplayName(n, i))}">×</button>` : '<small>Not connected</small>'}</div>`
  }).join('')}</div>`
}
function scopeControls(n) {
  const options = (value) => ['local', 'main', 'shared'].map((scope) => `<option ${value === scope ? 'selected' : ''}>${scope}</option>`).join('')
  return `<details class="property" data-disclosure="scopes"><summary>Scope settings</summary><label for="function-scope">Function scope</label><select class="scope-select" id="function-scope">${options(n.scope)}</select>${n.params.map((_, i) => `<label class="scope-row">${escapeAttr(paramDisplayName(n, i))}<select class="param-scope" data-index="${i}">${options(n.paramScopes[i])}</select></label>`).join('')}</details>`
}
function renderFunctionInspector(n) {
  if (n.match) return renderMatchInspector(n)
  const problem = callProblem(n)
  const editable = nodes[n.id] === n && n.custom
  return `<div class="selected-node"><span class="selected-icon">ƒ</span><div><b>${escapeAttr(n.label)}</b><small>${editable ? 'Function definition' : 'Function call'}</small></div></div>
    ${functionNameRow(n)}${ambiguityRow(n)}
    ${problem ? `<div class="property broken-call"><label>CONNECTION ERROR</label><div class="connection-tag">${escapeAttr(problem)}</div>${definitions[n.sourceFunctionId] ? '<button class="law-check" id="fix-slots">Fit slots to the function</button>' : ''}</div>` : ''}
    <div class="property"><label>${isSignatureEditable(n) === 'signature' ? 'FUNCTION SIGNATURE' : 'TYPE AFTER CONNECTIONS'}</label><div class="inspector-chain">${inspectorChainHtml(n)}</div></div>
    ${parameterControls(n)}
    <button class="evaluate" id="evaluate">▶ Run this node</button>
    ${nodes[n.sourceFunctionId]?.lambda || (!state.activeFunction && nodes[n.sourceFunctionId || n.id]?.custom) ? '<button class="use-again" id="open-body">Open body →</button>' : ''}
    ${useAgainButton(n)}
    ${nodes[n.id] === n ? `<div class="property"><label>PROJECT ENTRY</label><button class="entry-toggle ${entryId === n.id ? 'on' : ''}" id="entry-toggle">${entryId === n.id ? '● Project entry · unset' : 'Set as project entry'}</button></div>` : ''}
    ${canConvertMatch(n) ? '<button class="use-again" id="convert-match">⑂ 패턴 매칭으로 변환</button>' : ''}
    ${callDefinitionBlock(n)}${customizedRow(n)}${editable ? functionLawsPanel(n) : ''}${scopeControls(n)}${deleteButton(n)}`
}
function canConvertMatch(n) {
  const def = definitions[n.sourceFunctionId]
  return state.activeFunction && !nodes[n.sourceFunctionId]?.override && def?.derived?.op === 'case' && n.mounted?.length === def.derived.arity && n.mounted.every((id) => activeNodes()[id])
}
function renderMatchInspector(n) {
  const problem = matchProblem(n, activeNodes(), definitions, functionBodies)
  const q = resolvedValueQual(n)
  return `<div class="selected-node"><span class="selected-icon">⑂</span><div><b>${escapeAttr(n.match.type)} 패턴 매칭</b><small>분기를 눌러 본문을 작성하세요</small></div></div>
    ${problem ? `<div class="property broken-call">${escapeAttr(problem)}</div>` : ''}
    <div class="property"><label>결과 타입</label>${qualChainHtml(q.preds, q.type)}</div>
    <div class="match-branches">${n.match.branches.map((b, i) => `<div class="match-branch-row"><button class="match-open" data-match-open="${i}">${escapeAttr(b.ctor)}${b.useDefault ? ' → _' : ' →'}</button>${!b.useDefault ? `<div class="match-binders">${b.fields.map((f, fi) => `<input aria-label="${escapeAttr(b.ctor)} 패턴 변수 ${fi + 1}" data-match-binder="${i}" data-field="${fi}" value="${escapeAttr(f.name)}" />`).join('')}</div>` : ''}<label class="match-default"><input type="checkbox" data-match-default="${i}" ${b.useDefault ? 'checked' : ''}/>기본 분기로 처리</label></div>`).join('')}</div>
    ${n.match.defaultBranch ? '<button class="use-again" id="match-default-body">_ 기본 분기 편집 →</button>' : ''}
    <button class="evaluate" id="evaluate">▶ Run this node</button>${useAgainButton(n)}${deleteButton(n)}`
}
function updateInspector() {
  const n = activeNodes()[state.selected]
  inspectorChainInfo = null
  if (!n) { inspector.innerHTML = '<p class="inspector-empty">Select a node to edit its inputs and inspect its type.</p>'; return }
  inspector.innerHTML = (viewingReadonly() ? readonlyInspector(n) : n.type === 'output'
    ? `<div class="selected-node"><span class="selected-icon output-icon">→</span><div><b>Output</b><small>Function result</small></div></div><div class="property"><label>RESULT TYPE</label><div class="inspector-chain">${inspectorChainHtml(n)}</div></div><div class="property"><label>RETURN VALUE</label><div class="connection-tag">${n.source ? escapeAttr(nodeDisplayText(activeNodes()[n.source]) || n.value) : 'Connect a node to Output'}</div></div>${n.source ? '<button class="delete-node" id="disconnect-output">Disconnect</button>' : ''}${state.activeFunction ? `${nodes[state.activeFunction]?.library || nodes[state.activeFunction]?.override ? customizedRow(nodes[state.activeFunction]) : ''}${definitionBlock(state.activeFunction)}` : ''}`
    : n.type === 'function' ? renderFunctionInspector(n) : renderValueInspector(n)) + enclosingDefinition(n)
  if (!viewingReadonly() && state.activeFunction && !['output', 'law'].includes(n.type) && !n.matchInternal) inspector.insertAdjacentHTML('beforeend', '<button class="use-again" id="pattern-match">⑂ 패턴 매칭</button>')
  restoreDisclosureState(inspector)
  inspector.querySelector('#pattern-match')?.addEventListener('click', () => beginPatternMatch(n))
  inspector.querySelector('#convert-match')?.addEventListener('click', () => {
    const name = definitions[n.sourceFunctionId].derived.type
    convertCaseToMatch({ nodes, functionBodies }, activeNodes(), n, types[name] || preludeTypes[name], state.activeFunction)
    renderFunctionLibrary(); updateInspector(); draw()
  })
  inspector.querySelectorAll('[data-match-open]').forEach((b) => { b.onclick = () => {
    const branch = n.match.branches[Number(b.dataset.matchOpen)]
    enterFunction(branch.useDefault ? n.match.defaultBranch.fnId : branch.fnId)
  } })
  inspector.querySelector('#match-default-body')?.addEventListener('click', () => enterFunction(n.match.defaultBranch.fnId))
  inspector.querySelectorAll('[data-match-binder]').forEach((input) => { input.onchange = () => {
    const branch = n.match.branches[Number(input.dataset.matchBinder)]
    if (!renameMatchBinder({ nodes, functionBodies }, branch, Number(input.dataset.field), input.value.trim())) showToast('소문자로 시작하는 고유 이름 또는 _를 입력하세요')
    renderFunctionLibrary(); updateInspector(); draw()
  } })
  inspector.querySelectorAll('[data-match-default]').forEach((input) => { input.onchange = () => {
    setMatchDefault({ nodes, functionBodies }, activeNodes(), n, Number(input.dataset.matchDefault), input.checked)
    renderFunctionLibrary(); updateInspector(); draw()
  } })
  inspector.querySelectorAll('[data-select-input]').forEach((button) => { button.onclick = () => { state.selected = n.mounted[Number(button.dataset.selectInput)]; updateInspector(); draw() } })
  inspector.querySelectorAll('[data-disconnect-input]').forEach((button) => { button.onclick = () => {
    const i = Number(button.dataset.disconnectInput)
    const source = activeNodes()[n.mounted[i]]
    if (source) { detachMounted(n, i); source.placed = true; source.x = n.x + 100; source.y = n.y + 120; updateInspector(); draw() }
  } })
  const chain = inspector.querySelector('.inspector-chain')
  if (chain && inspectorChainInfo) wireChain(chain, inspectorChainInfo)
  wireDefinitionTokens()
  const openDefinition = document.querySelector('#open-definition')
  if (openDefinition) openDefinition.onclick = () => openDefinitionView(n.sourceFunctionId || n.id, n.params.length)
  const editDefinitionButton = document.querySelector('#edit-definition')
  if (editDefinitionButton) editDefinitionButton.onclick = () => editDefinition(state.activeFunction)
  const restoreLibrary = document.querySelector('#restore-library')
  if (restoreLibrary) restoreLibrary.onclick = () => restoreLibraryDefinition(restoreLibrary.dataset.id)
  const evaluate = document.querySelector('#evaluate')
  if (evaluate) evaluate.onclick = () => executeFunction(n)
  const entryToggle = document.querySelector('#entry-toggle')
  if (entryToggle) entryToggle.onclick = () => { entryId = entryId === n.id ? null : n.id; updateInspector(); draw() }
  const fnRename = document.querySelector('#function-rename')
  if (fnRename) fnRename.onchange = () => {
    const label = fnRename.value.trim()
    const problem = label === n.label ? null : functionNameProblem(label, n.id)
    if (problem) showToast(problem)
    else if (label !== n.label) { renameFunction({ nodes, functionBodies }, n.id, label); showToast(`${label}(으)로 이름을 바꿨어요 — 모든 호출이 따라가요`) }
    renderFunctionLibrary(); updateInspector(); draw()
  }
  const resetCustom = document.querySelector('#reset-derived')
  if (resetCustom) resetCustom.onclick = () => resetDerivedFunction(resetCustom.dataset.id)
  document.querySelectorAll('.param-move').forEach((button) => {
    button.onclick = () => {
      const i = Number(button.dataset.index)
      moveParameter({ nodes, functionBodies }, n.id, i, i - 1)
      renderFunctionLibrary(); updateInspector(); draw()
    }
  })
  document.querySelectorAll('.param-rename').forEach((input) => {
    input.onchange = () => {
      if (!renameParameter({ nodes, functionBodies }, n.id, Number(input.dataset.index), input.value.trim())) showToast(`"${input.value}" can't be a parameter name here (lowercase identifier, not already used)`)
      renderFunctionLibrary(); updateInspector(); draw()
    }
  })
  const disconnectOutput = document.querySelector('#disconnect-output')
  if (disconnectOutput) disconnectOutput.onclick = () => { const source = activeNodes()[n.source]; if (source) source.connected = false; n.source = null; n.value = 'open'; updateInspector(); draw() }
  document.querySelectorAll('.law-check[data-law]').forEach((button) => { button.onclick = () => runFunctionLaw(n, button.dataset.law) })
  document.querySelectorAll('.law-check[data-pin]').forEach((button) => { button.onclick = () => pinLaw(n, button.dataset.pin) })
  const fixSlots = document.querySelector('#fix-slots')
  if (fixSlots) fixSlots.onclick = () => { fixCallSlots(n); updateInspector(); draw() }
  const openBody = document.querySelector('#open-body')
  if (openBody) openBody.onclick = () => enterFunction(n.sourceFunctionId || n.id)
  const useAgainNode = document.querySelector('#use-again')
  if (useAgainNode) useAgainNode.onclick = () => useAgain(n)
  const deleteNodeButton = document.querySelector('#delete-node')
  if (deleteNodeButton) deleteNodeButton.onclick = () => deleteNode(n.id)
  const boolInput = document.querySelector('.bool-input')
  if (boolInput) boolInput.onchange = () => { n.value = boolInput.value; updateInspector(); draw() }
  const scopeSelect = document.querySelector('#function-scope')
  if (scopeSelect) scopeSelect.onchange = () => { n.scope = scopeSelect.value; updateInspector(); draw() }
  document.querySelectorAll('.param-scope').forEach((select) => {
    select.onchange = () => { n.paramScopes[Number(select.dataset.index)] = select.value; updateInspector(); draw() }
  })
  const typeAnnotate = document.querySelector('.type-annotate')
  if (typeAnnotate) typeAnnotate.onchange = () => { n.annotation = typeAnnotate.value || null; invalidateStaleWires(n); updateInspector(); draw() }
  const valueInput = document.querySelector('.value-input')
  // Don't call updateInspector() here — it would tear down and recreate this
  // very input on every keystroke and steal focus/cursor position. draw()
  // alone is enough to keep the canvas label live; the inspector's own TYPE
  // line catches up next time something reselects this node.
  if (valueInput && (n.type === 'number' || n.type === 'text' || n.type === 'literal')) valueInput.oninput = () => { n.value = valueInput.value; draw() }
  // A data value is edited as Haskell text, read back at its type (valueParser.js).
  if (valueInput && n.type === 'value') valueInput.onchange = () => {
    try { n.data = parseValue(valueInput.value, resolvedValueQual(n).type, types) } catch (error) {
      if (!(error instanceof ParseError)) throw error
      valueInput.value = nodeDisplayText(n)
      return showToast(`Not a ${showQual([], resolvedValueQual(n).type)} — ${error.message}`)
    }
    const at = slotHost(n)
    if (at) at.host.params[at.index] = nodeDisplayText(n)
    updateInspector(); draw()
  }
}
// Plays `fn`: evaluates it as a value (callee applied to its applied slots —
// see src/evaluator.js) and drops the result next to it. A fully-applied
// call yields a number/boolean node; anything with open slots yields a
// curried node carrying both its residual type and its runtime closure, so it
// can be plugged in and played again later.
function executeFunction(fn) {
  if (!isFunction(fn)) return
  if (viewingReadonly()) return showToast('읽기 전용 정의예요 — 이 함수를 쓰는 곳에서 실행하세요')
  const graph = activeNodes()
  const pass = typePass(graph)
  const entry = pass.perNode.get(fn.id)
  const bad = entry?.invalidSlots?.[0]
  if (bad !== undefined) return showToast(`"${fn.params[bad]}" doesn't fit ${paramDisplayName(fn, bad)} :: ${expectedParamType(fn, bad, graph)}`)
  const ambiguous = runBlocker(graph, fn.id)
  if (ambiguous) return showToast(`실행할 수 없어요 — ${ambiguous}`)
  let result
  try {
    result = evaluator.run(graph, fn.id)
  } catch (error) {
    if (error instanceof EvalError) return showToast(error.message)
    throw error
  }
  state.running = true
  const position = { x: functionBlockRight(fn) + 90, y: fn.y + ((outputId + 1) % 2) * 45 }
  const valueType = entry ? valueTypeOfEntry(entry) : null
  // A function value comes back as a call you can keep editing and play again.
  const rebuilt = isClosure(result) && rebuildCall(result, graph, position)
  if (rebuilt) {
    // Its arguments sit to its left: move the whole tree clear of `fn`.
    const tree = [graph[rebuilt], ...pluggedDescendants(graph[rebuilt], graph)]
    const left = Math.min(...tree.map((k) => (isFunction(k) ? functionBlockLeft(k) : k.x - chipHalfWidth(k))))
    tree.forEach((k) => { k.x += position.x - left })
    state.selected = rebuilt; updateInspector(); draw()
    setTimeout(() => { state.running = false; draw() }, 300)
    return
  }
  const id = `output-${++outputId}`
  if (isClosure(result)) {
    const appliedCount = entry?.applied?.filter(Boolean).length ?? 0
    // Keep the residual's class constraints with it (`Semiring a ⇒ a → a`,
    // not a bare `a → a`), generalized so each later pass instantiates it
    // fresh — in the order of the closure's stand-in dictionaries, which
    // each use fills in (inferGraph's rootParams).
    const own = pass.rootParams?.[fn.id] || []
    const resolvedScheme = valueType ? generalize(own, valueType) : undefined
    graph[id] = { id, type: 'curried', typeName: valueType ? showQual(resolvedScheme.preds, valueType) : functionSignature(fn), resolvedScheme, closure: result, ...position, label: `${fn.label} · ${appliedCount}/${fn.params.length}`, value: 'ƒ', remaining: result.args.filter((a) => a === null).length, color: '#a96ef0' }
  } else if (isData(result) || typeof result === 'string') {
    // A data value (a declared type, a list, a Maybe — e.g. `Model {clicks = 1, perClick = 2}`) or a Char.
    const resolvedScheme = valueType ? generalize((entry.preds || []).filter((p) => [...ftv(p.type)].some((v) => ftv(valueType).has(v))), valueType) : undefined
    graph[id] = { id, type: 'value', data: result, resolvedScheme, ...position, label: 'result', color: '#3cbe9e' }
  } else {
    const booleanResult = typeof result === 'boolean'
    // Inherit the function's actual resolved result type when it's concrete
    // (e.g. Play `sqrt` on a Double literal → the result node is Double too,
    // not a hardcoded Int) via the same annotation mechanism a literal uses.
    const concreteType = !booleanResult && valueType?.kind === 'con' ? valueType.name : undefined
    graph[id] = { id, type: booleanResult ? 'boolean' : 'number', typeName: booleanResult ? 'Bool' : (concreteType || 'Int'), annotation: concreteType, ...position, label: 'result', value: String(result), color: booleanResult ? '#ed6b84' : '#8c7cf2' }
  }
  state.selected = id; updateInspector(); draw()
  setTimeout(() => { state.running = false; draw() }, 300)
}
// A closure (a Play result with open slots) as an ordinary call of its
// callee: each filled argument plugged back in — a number, Bool, Char or
// String as a literal, other data as a value node, a function as a call
// rebuilt the same way (or the stored closure, when it can't be) — and the
// open slots left open. The call's own type is inferred again like any
// other, so it can be edited, filled and played. Null when the callee isn't
// a definition a call can name.
function rebuildCall(closure, graph, position) {
  const def = definitions[closure.callee]
  if (!def?.params || viewDefs[closure.callee] || def.builtin === 'listOf' || def.params.length !== closure.args.length) return null
  const id = `output-${++outputId}`
  const node = graph[id] = {
    id, type: 'function', sourceFunctionId: closure.callee, ...position,
    label: def.label, params: def.params.map(() => ''),
    mounted: def.params.map(() => null), paramScopes: def.params.map(() => 'local'),
    scope: 'local', color: def.color,
  }
  closure.args.forEach((arg, i) => {
    if (arg === null) return
    const child = argumentNode(arg, graph, position)
    Object.assign(graph[child], { mountedTo: `${id}:${i}`, connected: true, placed: true })
    if (graph[child].type === 'function') graph[child].composedInto = id
    node.mounted[i] = child
    node.params[i] = nodeDisplayText(graph[child], graph)
  })
  layoutTree(node, graph)
  return id
}
// One argument of a rebuilt call, as a new node (see rebuildCall).
function argumentNode(value, graph, position) {
  if (isClosure(value)) {
    const rebuilt = rebuildCall(value, graph, position)
    if (rebuilt) return rebuilt
    const id = `output-${++outputId}`
    graph[id] = { id, type: 'curried', closure: value, ...position, label: definitions[value.callee]?.label ?? value.callee, value: 'ƒ', remaining: value.args.filter((a) => a === null).length, color: '#a96ef0' }
    return id
  }
  const id = `output-${++outputId}`
  // A numeric literal still waiting for its dictionary (evaluator.js literalAt) keeps its text.
  const text = value?.kind === 'literal' ? value.text : showValue(value, types)
  if (parseLiteral(text)) graph[id] = { id, type: 'literal', label: 'literal', value: text, color: '#4f8ef7', ...position }
  else graph[id] = { id, type: 'value', data: value, ...position, label: 'value', color: '#3cbe9e' }
  return id
}
// The node under a canvas point (hidden ones — inside a folded call — have no hitbox).
function hitNode(x, y) {
  return Object.values(activeNodes()).find(n => {
    if (!isVisible(n)) return false
    return n.type === 'function' ? pointInFunctionBlock(n, x, y) : pointInValueBlock(n, x, y)
  })
}
// Connections are made with wires: every node has an out-port on its right
// end (see updatePortEditor); dragging from it stretches a wire to the
// cursor, and releasing over a slot (or the function body's Output in-port)
// connects. This is the slot (or Output) under the wire's free end at world
// point `at` — the single source of truth for both "what glows right now" and
// "what do we connect to on release", so the two always agree. A slot that
// already shows text (a typed literal, or a builtin's placeholder name) is
// overridden by a wire dropped on it; one with a node plugged in is not —
// pull that wire out first.
const WIRE_SLOT_RADIUS = 42 // a dot is small: a wire's end catches it from a little way off
function findWireTarget(source, at) {
  if (viewingReadonly()) return null // nodes may be moved around to look, never reconnected
  if (!source || source.type === 'output' || source.type === 'law') return null
  const graph = activeNodes()
  const downstream = new Set([source.id, ...[...pluggedDescendants(source, graph)].map((k) => k.id)]) // plugging into its own argument would be a cycle
  let best = null, bestDist = WIRE_SLOT_RADIUS
  Object.values(graph).filter(isFunction).forEach((target) => {
    if (downstream.has(target.id) || isFolded(target) || !isVisible(target)) return
    target.params.forEach((value, index) => {
      if (target.mounted[index]) return
      const c = slotWorldCenter(target, index)
      const dist = Math.hypot(at.x - c.x, at.y - c.y)
      if (dist < bestDist && canConnect(source, target, index)) { bestDist = dist; best = { kind: 'param', targetId: target.id, index } }
    })
  })
  const output = state.activeFunction && graph.output
  if (!best && output && output.id !== source.id && Math.abs(at.x - (output.x - chipHalfWidth(output))) <= chipHalfWidth(output) + 24 && Math.abs(at.y - output.y) <= CHIP_H / 2 + 24) best = { kind: 'output' }
  return best
}
// Whatever `node`'s out-port currently feeds — a slot or Output — is
// disconnected (its wire is being pulled out to be re-plugged elsewhere).
function unplug(node) {
  const at = slotHost(node)
  if (at) detachMounted(at.host, at.index)
  const output = activeNodes().output
  if (output?.type === 'output' && output.source === node.id) { output.source = null; output.value = 'open'; node.connected = false }
}
// Applies state.snapTarget (computed live while a wire is dragged) on
// release, so "connect to the thing that was glowing" is a single code path.
function finishConnection(dragged) {
  const target = state.snapTarget
  if (!target) return false
  if (target.kind === 'output') {
    const output = activeNodes().output
    // Unlike a slot, Output doesn't swallow the node: it stays on the canvas
    // where it is (still editable, its own slots still reachable), with a
    // link line drawn between them.
    const previous = activeNodes()[output.source]
    if (previous) previous.connected = false
    output.source = dragged.id
    output.value = nodeDisplayText(dragged)
    dragged.connected = true
    state.selected = output.id
    return true
  }
  const targetNode = activeNodes()[target.targetId]
  if (!targetNode) return false
  const before = ambiguityKeys()
  const previousText = targetNode.params[target.index]
  targetNode.params[target.index] = nodeDisplayText(dragged)
  targetNode.mounted[target.index] = dragged.id
  dragged.mountedTo = `${targetNode.id}:${target.index}`
  dragged.connected = true
  // GHC would reject the program this edge makes if it leaves a constraint nothing can decide: so does the editor.
  const fresh = [...ambiguityKeys()].filter((k) => !before.has(k))
  if (fresh.length) {
    const pass = typePass()
    const why = ambiguityProblem(targetNode, pass) || ambiguityProblem(dragged, pass) || ambiguityProblem(nodes[state.activeFunction] || targetNode, pass) || 'it would leave a type nothing can decide'
    targetNode.params[target.index] = previousText
    targetNode.mounted[target.index] = null
    dragged.mountedTo = null
    dragged.connected = false
    projectPassCache = null
    showToast(`연결되지 않았어요 — ${why}`)
    return false
  }
  if (dragged.type === 'function') dragged.composedInto = targetNode.id
  dragged.placed = true // a wired node stays where it was put; ⤢ lays the tree out
  state.selected = targetNode.id
  return true
}
// A drag that starts on the DOM slot overlay (detach) is still, physically,
// a mousedown-then-move across ordinary text-bearing elements (sidebar,
// inspector) — `preventDefault()` on the originating pointerdown alone isn't
// reliably enough to stop the browser from turning that into a native text
// selection as the pointer crosses those elements. Suppressing selection
// page-wide for the duration of any drag (canvas-native or slot-detach
// alike) sidesteps that regardless of the exact event path.
function beginDrag(node, worldPoint, { moved = false } = {}) {
  state.drag = { node, dx: worldPoint.x - node.x, dy: worldPoint.y - node.y, moved }
  document.body.classList.add('dragging')
}
function endDrag() { state.drag = null; document.body.classList.remove('dragging') }
// Pulling a wire out of `node`'s out-port. What it fed stays connected until
// the wire actually moves (a plain click on a port changes nothing).
function beginWire(node, event) {
  if (viewingReadonly()) return // a read-only definition can be looked at, never rewired
  state.wire = { node, at: canvasPoint(event), moved: false }
  state.selected = node.id
  document.body.classList.add('dragging')
  updateInspector(); draw()
}
function endWire() { state.wire = null; state.snapTarget = null; document.body.classList.remove('dragging') }
// The wire being dragged: from the out-port to the cursor, or straight into
// the slot / Output it would connect to — solid when it would connect.
function drawWire() {
  if (!state.wire) return
  const graph = activeNodes(), target = state.snapTarget
  const from = toScreen({ x: rightEdge(state.wire.node), y: state.wire.node.y })
  let to = toScreen(state.wire.at)
  if (target?.kind === 'param' && graph[target.targetId]) to = slotScreenCenter(graph[target.targetId], target.index)
  else if (target?.kind === 'output') to = toScreen({ x: graph.output.x - chipHalfWidth(graph.output), y: graph.output.y })
  const bend = Math.max(40 * state.zoom, Math.abs(to.x - from.x) / 2)
  ctx.save()
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2
  if (!target) ctx.setLineDash([6 * state.zoom, 5 * state.zoom])
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.bezierCurveTo(from.x + bend, from.y, to.x - bend, to.y, to.x, to.y); ctx.stroke()
  ctx.setLineDash([]); ctx.beginPath(); ctx.arc(to.x, to.y, 4, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill()
  ctx.restore()
}
function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left - state.offset.x) / state.zoom, y: (event.clientY - rect.top - state.offset.y) / state.zoom } }
function setZoom(nextZoom, clientX = canvas.clientWidth / 2, clientY = canvas.clientHeight / 2) {
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left, y = clientY - rect.top
  const worldX = (x - state.offset.x) / state.zoom, worldY = (y - state.offset.y) / state.zoom
  state.zoom = Math.max(.6, Math.min(1.8, nextZoom))
  state.offset.x = x - worldX * state.zoom
  state.offset.y = y - worldY * state.zoom
  document.querySelector('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`
  draw()
}
function setupCanvasInput() {
  canvas.addEventListener('pointerdown', (event) => {
    if (state.editingLiteral) finishLiteralEdit(state.editingLiteral) // clicking away is done typing
    const p = canvasPoint(event), node = hitNode(p.x, p.y)
    canvas.setPointerCapture(event.pointerId)
    if (node) {
      // Shift+click adds to / removes from a multi-selection (moved, deleted and copied together).
      if (event.shiftKey) {
        if (state.multi.size === 0 && state.selected && activeNodes()[state.selected]) state.multi.add(state.selected)
        state.multi.has(node.id) ? state.multi.delete(node.id) : state.multi.add(node.id)
      } else if (!state.multi.has(node.id)) state.multi.clear()
      state.selected = node.id
      if (node.type === 'output') {
        updateInspector()
        draw()
        return
      }
      beginDrag(node, p)
      updateInspector(); draw()
    } else {
      if (!event.shiftKey) state.multi.clear()
      state.pan = { x: event.clientX, y: event.clientY, offsetX: state.offset.x, offsetY: state.offset.y }
      canvas.classList.add('panning')
    }
  })
  // pointermove/pointerup/pointercancel live on `window`, not `canvas`, because
  // a drag can now also START on a DOM slot chip (see updatePortEditor's
  // detach handler) — that pointerdown's target is a sibling overlay element,
  // not a descendant of canvas, so canvas-scoped listeners would never see the
  // rest of that drag. Both drag origins funnel through the same state.drag,
  // so one pair of window listeners drives them identically.
  window.addEventListener('pointermove', (event) => {
    if (state.wire) {
      state.wire.at = canvasPoint(event)
      if (!state.wire.moved && Math.hypot(event.movementX, event.movementY) > 2) { state.wire.moved = true; unplug(state.wire.node) }
      if (state.wire.moved) state.snapTarget = findWireTarget(state.wire.node, state.wire.at)
      draw()
    } else if (state.drag) {
      const p = canvasPoint(event)
      if (Math.hypot(event.movementX, event.movementY) > 2) state.drag.moved = true
      const dx = p.x - state.drag.dx - state.drag.node.x, dy = p.y - state.drag.dy - state.drag.node.y
      // the rest of a multi-selection moves with it, and everything plugged into what moves
      const moving = new Set([state.drag.node])
      if (state.multi.has(state.drag.node.id)) state.multi.forEach((id) => { const m = activeNodes()[id]; if (m) moving.add(m) })
      ;[...moving].forEach((m) => pluggedDescendants(m, activeNodes(), moving))
      moving.forEach((m) => { m.x += dx; m.y += dy })
      draw()
    } else if (state.pan) {
      state.offset.x = state.pan.offsetX + event.clientX - state.pan.x
      state.offset.y = state.pan.offsetY + event.clientY - state.pan.y
      draw()
    }
  })
  window.addEventListener('pointerup', (event) => {
    if (state.wire) {
      // Released over nothing, a moved wire stays pulled out: disconnected.
      if (state.wire.moved) finishConnection(state.wire.node)
      endWire(); updateInspector(); draw()
      return
    }
    if (!state.drag && !state.pan) return
    if (!state.drag) {
      state.pan = null
      canvas.classList.remove('panning')
      return
    }
    const wasDragged = state.drag.moved
    endDrag(); updateInspector(); draw()
    if (wasDragged) {
      state.suppressClick = true
      event.stopPropagation()
    }
  })
  window.addEventListener('pointercancel', () => { endDrag(); endWire(); state.pan = null; canvas.classList.remove('panning'); draw() })
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    setZoom(state.zoom + (event.deltaY < 0 ? .1 : -.1), event.clientX, event.clientY)
  }, { passive: false })
  canvas.addEventListener('click', (event) => {
    if (state.suppressClick) {
      state.suppressClick = false
      return
    }
    const p = canvasPoint(event)
    const fn = Object.values(activeNodes()).find(n => n.type === 'function' && isVisible(n) && Math.hypot(p.x - (functionBlockRight(n) - 16), p.y - (n.y - FN_H / 2 + 2)) < 18)
    if (fn) {
      executeFunction(fn)
      return
    }
  })
  // A single click only selects (so the inspector shows the function);
  // double-clicking a custom function — its definition or a call to it — on
  // `main` opens its body, as does the inspector's "Open body". Double-clicking
  // a call to anything else opens its definition (a read-only view, or what
  // you took over), as does "Open definition".
  canvas.addEventListener('dblclick', (event) => {
    const p = canvasPoint(event)
    const literal = Object.values(activeNodes()).find((n) => n.type === 'literal' && isVisible(n) && pointInValueBlock(n, p.x, p.y))
    if (literal) return startLiteralEdit(literal)
    const selected = Object.values(activeNodes()).find(n => n.type === 'function' && isVisible(n) && pointInFunctionBlock(n, p.x, p.y))
    const definitionId = selected && (selected.sourceFunctionId || selected.id)
    if (selected && definitions[definitionId]?.lambda) enterFunction(definitionId)
    else if (selected && nodes[definitionId]?.library) enterFunction(definitionId)
    else if (selected && !state.activeFunction && nodes[definitionId]?.custom) enterFunction(definitionId)
    else if (selected && !definitions[definitionId]?.custom) openDefinitionView(definitionId, selected.params.length)
  })
}
function enterFunction(id) {
  if (nodes[id]?.readonly) return
  const view = !functionBodies[id] && viewBodies[id]
  if (view && !laidOutViews.has(id)) { layoutBody(view); laidOutViews.add(id) }
  if (!view && !functionBodies[id]) functionBodies[id] = { output: { id: 'output', type: 'output', x: 570, y: 255, label: 'Output', value: 'open', color: '#2fbf8f' } }
  // A λ or a definition (a view, or one taken over) opens inside the graph it was opened from (Back returns there); a function of your own opens from main.
  const nested = definitions[id]?.lambda || definitions[id]?.view || nodes[id]?.library
  state.functionStack = nested && state.activeFunction ? [...state.functionStack, state.activeFunction] : []
  state.activeFunction = id
  state.selected = 'output'
  renderFunctionLibrary()
  updateInspector()
  fitToView()
}
function setupBackButton() {
  document.querySelector('#back-graph').onclick = () => {
    state.activeFunction = state.functionStack.pop() || null
    state.selected = state.activeFunction ? 'output' : 'add'
    renderFunctionLibrary(); updateInspector(); fitToView()
  }
}
// The practice panel (exercisePanel.js), once set up.
let exercisePanel = null
// Inside the body of the build exercise on screen, Run grades it instead:
// there is nothing to play in a body, and the entry lives at top level.
function gradingExercise() {
  const exercise = exercisePanel?.currentBuild()
  const fn = exercise && state.activeFunction && nodes[state.activeFunction]
  return fn && fn.custom && fn.label === exercise.name ? exercise : null
}
// Plays the entry function (always in `main`), falling back to whichever
// function is selected when no entry has been set.
function updateRunLabel() {
  const button = document.querySelector('#run')
  const exercise = gradingExercise()
  if (exercise) {
    const label = `채점 ${exercise.name}`
    button.querySelector('span').textContent = label
    button.title = `연습 문제 ${exercise.name} 채점 (${shortcutModifier} Enter)`
    button.disabled = false
    document.querySelector('#run-shortcut-label').textContent = label
    return
  }
  const entry = entryId && nodes[entryId]
  const selected = activeNodes()[state.selected]
  const target = entry || (selected && isFunction(selected) ? selected : null)
  const label = target ? `실행 ${target.label}${entry ? '' : ' (선택)'}` : '함수를 선택하세요'
  button.querySelector('span').textContent = label
  button.title = `${entry ? '프로젝트 시작 함수' : '선택한 블록'}: ${target?.label || '없음'} (${shortcutModifier} Enter)`
  button.disabled = !target
  document.querySelector('#run-shortcut-label').textContent = label
}
function runEntry() {
  if (gradingExercise()) { exercisePanel.grade(); return showMobileView('examples') }
  const ambiguous = entryId && nodes[entryId] && runBlocker(nodes, entryId)
  if (ambiguous) return showToast(`실행할 수 없어요 — ${ambiguous}`)
  if (entryId && nodes[entryId] && startGameIfProgram(entryId)) return
  if (entryId && nodes[entryId]) {
    if (state.activeFunction) { state.activeFunction = null; renderFunctionLibrary(); fitToView() }
    return executeFunction(nodes[entryId])
  }
  const selected = activeNodes()[state.selected]
  if (selected && isFunction(selected)) return executeFunction(selected)
  showToast('함수를 선택하거나, 속성 패널에서 시작 함수로 지정하세요')
}
function setupRunButton() {
  document.querySelector('#run').onclick = runEntry
}
// --- Playing a Program ------------------------------------------------------
// When the entry point evaluates to a `Program m e` (see builtinSchemes.js'
// `program` and src/runtime.js), Run graph plays it: the view is rendered in
// a panel over the canvas, buttons send their messages through `handle`,
// and time runs through `step` in fixed slices. The game state is saved
// with a timestamp; reopening it applies the time away — in one call if
// `step` passes the monoid-action law, otherwise slice by slice.
const GAME_KEY = 'hs-simulate:game'
const playPanel = document.querySelector('#play-panel')
let play = null // { game, entry, modelType, speed, running, last, acc, frame, saveTimer, law }

// The Program the function `id` evaluates to (or null), its model type, and
// whether its `step` is an action of (ℝ≥0, +) — then any span of time is one call.
function programInfo(id) {
  let program
  try {
    program = evaluator.run(nodes, id)
  } catch (error) {
    if (error instanceof EvalError) return null
    throw error
  }
  if (!isProgram(program)) return null
  const programType = valueTypeOfEntry(typePass(nodes).perNode.get(id))
  const modelType = programType?.kind === 'app' && programType.fn.kind === 'app' ? programType.fn.arg : null
  const law = modelType && !ftv(modelType).size
    ? checkFunctionLaw('action', program.args[3], tfun(tcon('Double'), tfun(modelType, modelType)), { ev: evaluator, types })
    : { ok: false, counterexample: 'the model type is not concrete' }
  return { program, modelType, law }
}

function startGameIfProgram(id) {
  const info = programInfo(id)
  if (!info) return false
  const { program, modelType, law } = info
  stopGame()
  const game = createGame(evaluator, program, { exactTime: law.ok })
  play = { game, entry: id, modelTypeObj: modelType, modelType: modelType ? showQual([], modelType) : '?', speed: 1, running: true, last: null, acc: 0, frame: null, saveTimer: null, law }
  let offline = null
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_KEY) || 'null')
    if (saved && saved.entry === id && saved.modelType === play.modelType) {
      game.restore(saved)
      const away = Math.max(0, (Date.now() - saved.savedAt) / 1000) // capped by the program's maxOffline
      if (away > 1) offline = { away: Math.min(away, game.maxOffline), ...game.advance(away) }
    }
  } catch (error) {
    if (!(error instanceof EvalError) && !(error instanceof SyntaxError)) throw error
    game.reset()
  }
  playPanel.hidden = false
  buildPlayPanel()
  renderPlay()
  if (offline) showToast(offline.exact ? `While you were away: ${formatSeconds(offline.away)} applied in one step (step is a monoid action)` : `While you were away: ${formatSeconds(offline.away)} simulated in ${offline.calls} slices`)
  play.saveTimer = setInterval(saveGame, 2000)
  play.frame = requestAnimationFrame(loop)
  return true
}

function formatSeconds(t) {
  if (t < 90) return `${Math.round(t)}s`
  if (t < 5400) return `${Math.round(t / 60)}m`
  return `${(t / 3600).toFixed(1)}h`
}

function loop(now) {
  if (!play) return
  if (play.running && play.last !== null) {
    play.acc += Math.min(1, (now - play.last) / 1000) * play.speed
    let ticked = false
    try {
      const slice = 1 / play.game.stepsPerSecond // the program's own tick rate
      while (play.acc >= slice) { play.game.tick(slice); play.acc -= slice; ticked = true }
    } catch (error) {
      gameError(error)
    }
    if (ticked) renderPlay()
  }
  play.last = now
  play.frame = requestAnimationFrame(loop)
}

function gameError(error) {
  if (!(error instanceof EvalError)) throw error
  play.running = false
  showToast(`Game stopped: ${error.message}`)
  renderPlay()
}

function saveGame() {
  if (!play) return
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify({ ...play.game.snapshot(), entry: play.entry, modelType: play.modelType, savedAt: Date.now() }))
  } catch {}
}

function stopGame() {
  if (!play) return
  saveGame()
  cancelAnimationFrame(play.frame)
  clearInterval(play.saveTimer)
  play = null
  playPanel.hidden = true
  playPanel.innerHTML = ''
}

function buildPlayPanel() {
  playPanel.innerHTML = `<div class="play-bar"><b></b><span class="play-time"></span><button class="tool-button icon-only" data-play="toggle" title="Pause / resume"></button><button class="tool-button" data-play="step" title="Advance one second">+1s</button><select data-play="speed" title="Speed">${[1, 2, 10, 60].map((x) => `<option value="${x}">${x}×</option>`).join('')}</select><button class="tool-button" data-play="reset">Reset game</button><button class="tool-button icon-only" data-play="close" title="Back to the editor">×</button></div><div class="play-body"><div class="play-view"></div><aside class="play-side"><label class="play-model-label"></label><button class="law-check" data-play="edit-model" title="Edit the model in Haskell syntax">Edit</button><pre class="play-model"></pre><div class="play-model-editor" hidden><textarea spellcheck="false" rows="5"></textarea><p class="type-error"></p><button class="law-check" data-play="apply-model">Apply</button> <button class="law-check" data-play="cancel-model">Cancel</button></div><label>TIME</label><p class="play-law"></p><label class="play-log-label"></label><ol class="play-log"></ol></aside></div>`
  playPanel.querySelector('[data-play="toggle"]').onclick = () => { play.running = !play.running; play.last = null; renderPlay() }
  playPanel.querySelector('[data-play="step"]').onclick = () => { try { play.game.tick(1) } catch (error) { return gameError(error) } renderPlay() }
  playPanel.querySelector('[data-play="speed"]').onchange = (event) => { play.speed = Number(event.target.value) }
  playPanel.querySelector('[data-play="reset"]').onclick = () => { play.game.reset(); saveGame(); renderPlay() }
  playPanel.querySelector('[data-play="close"]').onclick = stopGame
  // Editing the model: written in Haskell syntax (exactly what's shown),
  // read back at the model's type by src/valueParser.js.
  const editor = playPanel.querySelector('.play-model-editor')
  playPanel.querySelector('[data-play="edit-model"]').onclick = () => {
    play.running = false
    play.editing = true
    editor.hidden = false
    editor.querySelector('textarea').value = showValue(play.game.model, types)
    editor.querySelector('.type-error').textContent = ''
    renderPlay()
  }
  playPanel.querySelector('[data-play="cancel-model"]').onclick = () => { play.editing = false; editor.hidden = true; renderPlay() }
  playPanel.querySelector('[data-play="apply-model"]').onclick = () => {
    try {
      play.game.setModel(parseValue(editor.querySelector('textarea').value, play.modelTypeObj, types))
    } catch (error) {
      if (!(error instanceof ParseError)) throw error
      editor.querySelector('.type-error').textContent = error.message
      return
    }
    play.editing = false
    editor.hidden = true
    saveGame()
    renderPlay()
    showToast('Model updated (paused — press ▶ to continue)')
  }
  playPanel.querySelector('.play-view').addEventListener('pointerdown', (event) => {
    const button = event.target.closest('.w-button')
    if (!button || !play) return
    event.preventDefault()
    try { play.game.dispatch(play.msgs[Number(button.dataset.msg)]) } catch (error) { return gameError(error) }
    renderPlay()
  })
}

function renderPlay() {
  if (!play) return
  const { game } = play
  const $ = (sel) => playPanel.querySelector(sel)
  play.msgs = []
  let view
  try {
    view = renderWidget(game.view(), play.msgs)
  } catch (error) {
    if (!(error instanceof EvalError)) throw error
    view = Object.assign(document.createElement('p'), { className: 'w-error', textContent: `view failed: ${error.message}` })
  }
  $('.play-view').replaceChildren(view)
  $('.play-bar b').textContent = `▶ ${nodes[play.entry]?.label || play.entry}`
  $('.play-time').textContent = `t = ${game.time.toFixed(1)}s`
  $('[data-play="toggle"]').textContent = play.running ? '⏸' : '▶'
  $('[data-play="speed"]').value = String(play.speed)
  $('.play-model-label').textContent = `MODEL :: ${play.modelType}`
  $('.play-model').textContent = showValue(game.model, types)
  $('.play-model').hidden = Boolean(play.editing)
  const law = $('.play-law')
  law.className = `play-law ${play.law.ok ? 'ok' : ''}`
  law.textContent = play.law.ok ? '✓ step is a monoid action of (ℝ≥0, +): time away is applied in one step' : `step is not a monoid action (${play.law.counterexample || play.law.law}): time away is simulated in slices`
  $('.play-log-label').textContent = `LOG · ${game.log.length} messages`
  $('.play-log').start = Math.max(1, game.log.length - 11)
  // Each entry rewinds to the state right after that message (time travel).
  const first = Math.max(0, game.log.length - 12)
  $('.play-log').replaceChildren(...game.log.slice(first).map((m, i) => {
    const li = Object.assign(document.createElement('li'), { textContent: showValue(m, types) })
    const count = first + i + 1
    if (game.canRewind(count) && count < game.log.length) {
      li.className = 'rewindable'
      li.title = 'Rewind to just after this message'
      li.onclick = () => { game.rewind(count); play.running = false; renderPlay(); showToast(`Rewound to message ${count} (paused)`) }
    }
    return li
  }))
}
function setupPlayInput() {
  window.addEventListener('beforeunload', saveGame)
  // Keys go to the game's onKey subscriptions while it's playing (not while typing in a field).
  window.addEventListener('keydown', (event) => {
    if (!play || play.editing || document.querySelector('dialog[open]') || event.target.closest?.('input, select, textarea')) return
    try {
      if (play.game.keyPressed(event.key)) { event.preventDefault(); renderPlay() }
    } catch (error) {
      gameError(error)
    }
  })
}
// Lay a template's custom functions out in a grid on the top level (the
// builtins aren't drawn there, so it starts at the left).
function layoutCustomDefinitions() {
  const customs = Object.values(nodes).filter((n) => n.custom && !isHiddenDefinition(n))
  if (!customs.length) return
  const left = 110
  const top = 190
  const colWidth = Math.max(...customs.map(functionBlockWidth)) + 160
  customs.forEach((n, i) => {
    n.x = left + (i % 2) * colWidth + FN_LEFT
    n.y = top + Math.floor(i / 2) * (FN_H + 110)
  })
  draw()
}
const TEMPLATES = { clickCounter: ['the click-counter example', buildClickCounter], blankGame: ['a blank game', buildBlankGame], dice: ['the dice roller', buildDice], blackjack: ['the blackjack game', buildBlackjack],
  vending: ['the vending machine', buildVending], nim: ['the nim game', buildNim], damage: ['the damage pipeline', buildDamage], rps: ['rock, paper, scissors', buildRps], simon: ['the simon game', buildSimon], highLow: ['the high-low game', buildHighLow] }
function setupTemplates() {
  document.querySelector('#template').onchange = (event) => {
    const [name, build] = TEMPLATES[event.target.value] || []
    event.target.value = ''
    if (!build) return
    stopGame()
    state.activeFunction = null
    loadProject(mergeBuiltins(upgradeProject(parseProject(serializeProject(build()))), builtinNodes, builtinBodies))
    // Newly loaded templates teach the direct matching workflow. Imported
    // projects retain their original case calls and offer explicit conversion.
    for (const [ownerId, graph] of Object.entries(functionBodies)) for (const n of Object.values(graph)) {
      const def = definitions[n.sourceFunctionId]
      const decl = def?.derived?.op === 'case' && types[def.derived.type]
      if (decl && !n.match && n.mounted?.length === def.derived.arity && n.mounted.every((id) => graph[id])) convertCaseToMatch({ nodes, functionBodies }, graph, n, decl, ownerId)
    }
    layoutCustomDefinitions()
    fitToView()
    showToast(`Loaded ${name} — Run graph to play it (undo to go back)`)
  }
}
// Download the entry point's game as one HTML file that runs without the
// editor: the player modules plus every definition, body and type it needs.
function setupGameExport() {
  document.querySelector('#export-game').onclick = () => {
    const ambiguous = entryId && nodes[entryId] && runBlocker(nodes, entryId)
    if (ambiguous) return showToast(`Can't export — ${ambiguous}`)
    const info = entryId && nodes[entryId] ? programInfo(entryId) : null
    if (!info) return showToast('Make a function that returns a Program (see the Game group) the Run graph entry first')
    const title = nodes[entryId].label === 'main' ? 'hs-simulate game' : nodes[entryId].label
    const data = { title, definitions: { ...libraryDefs, ...derivedDefs, ...classDefs, ...nodes }, functionBodies, types, entry: entryId, exactTime: info.law.ok, elaboration: elaborationData() }
    const url = URL.createObjectURL(new Blob([buildPlayerHtml(data, playerSources)], { type: 'text/html' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: `${title.replace(/[^\w-]+/g, '-')}.html` })
    link.click()
    URL.revokeObjectURL(url)
    showToast(`Exported ${link.download} — open it in any browser to play`)
  }
}
// --- Toasts ---------------------------------------------------------------
let toastTimer = null
function showToast(message) {
  let toast = document.querySelector('#toast')
  if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.setAttribute('role', 'status'); document.body.append(toast) }
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200)
}
// --- Project snapshots, autosave, undo/redo ---------------------------------
function currentSnapshot() { return serializeProject({ nodes, functionBodies, types, classes, instances, layouts, entry: entryId, outputId }) }
// Replaces the live project with `project` (already parsed + merged) in place
// — `nodes`/`functionBodies` are shared with the evaluator, so they're
// refilled rather than reassigned.
function loadProject(project) {
  Object.keys(nodes).forEach((id) => delete nodes[id])
  Object.assign(nodes, project.nodes)
  Object.keys(functionBodies).forEach((id) => delete functionBodies[id])
  Object.assign(functionBodies, project.functionBodies)
  ;[nodes, ...Object.values(functionBodies)].forEach(materializeLiterals)
  state.editingLiteral = null
  applyTypes(project.types || {}, project.classes || {}, project.instances || {})
  layouts = project.layouts || {}
  if (typeEditor) { if (types[typeEditor.original]) { typeEditor = editorFor(typeEditor.original); renderTypeEditor() } else closeTypeEditor() }
  if (classEditor) { if (classes[classEditor.original] || classEditor.builtin) { classEditor = classEditorFor(classEditor.original); renderClassEditor() } else closeTypeEditor() }
  renderUniverse()
  entryId = project.entry
  outputId = project.outputId
  if (state.activeFunction && !allBodies[state.activeFunction]) state.activeFunction = null
  if (!activeNodes()[state.selected]) state.selected = state.activeFunction ? 'output' : 'add'
  recheckLawNodes()
  renderFunctionLibrary(); renderPreludeLibrary(); updateInspector(); draw()
}
function restoreSnapshot(snapshot) { loadProject(parseProject(snapshot)) }
const defaultSnapshot = currentSnapshot()
let checkpointTimer = null
function scheduleCheckpoint() {
  clearTimeout(checkpointTimer)
  checkpointTimer = setTimeout(flushCheckpoint, 300)
}
function flushCheckpoint() {
  clearTimeout(checkpointTimer)
  checkpointTimer = null
  const snapshot = currentSnapshot()
  if (history.record(snapshot)) { persist(snapshot); renderFunctionLibrary(); recheckLawNodes(); draw() } // keep sidebar signatures and pinned laws current
  updateHistoryButtons()
}
function persist(snapshot) {
  const status = document.querySelector('#saved-status span')
  try {
    localStorage.setItem(STORAGE_KEY, snapshot)
    status.textContent = `저장됨 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  } catch {
    status.textContent = 'Not saved (storage unavailable)'
  }
}
function updateHistoryButtons() {
  document.querySelector('#undo').disabled = !history.canUndo
  document.querySelector('#redo').disabled = !history.canRedo
}
function undo() {
  flushCheckpoint()
  const snapshot = history.undo()
  if (snapshot) { restoreSnapshot(snapshot); persist(snapshot) }
  updateHistoryButtons()
}
function redo() {
  flushCheckpoint()
  const snapshot = history.redo()
  if (snapshot) { restoreSnapshot(snapshot); persist(snapshot) }
  updateHistoryButtons()
}
function setupProjectActions() {
  document.querySelector('#undo').onclick = undo
  document.querySelector('#redo').onclick = redo
  // Reset is an ordinary (undoable) edit back to the built-in starting graph.
  document.querySelector('#reset').onclick = () => { state.activeFunction = null; restoreSnapshot(defaultSnapshot); fitToView() }
  document.querySelector('#export').onclick = () => {
    const url = URL.createObjectURL(new Blob([currentSnapshot()], { type: 'application/json' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'hs-simulate-project.json' })
    link.click()
    URL.revokeObjectURL(url)
  }
  const importFile = document.querySelector('#import-file')
  document.querySelector('#import').onclick = () => importFile.click()
  importFile.onchange = async () => {
    const file = importFile.files[0]
    importFile.value = ''
    if (!file) return
    try {
      state.activeFunction = null
      loadProject(mergeBuiltins(upgradeProject(parseProject(await file.text())), builtinNodes, builtinBodies))
      fitToView()
      showToast(`${file.name}을(를) 불러왔어요`)
    } catch (error) {
      if (error instanceof ProjectError) return showToast(`불러오기 실패: ${error.message}`)
      throw error
    }
  }
}
// --- Copy / paste -------------------------------------------------------------
// Copies the selected node(s) together with everything plugged into their
// slots (the whole expression), and pastes them with fresh ids into the
// graph in view. Builtins, Output and parameters aren't copied.
let clipboard = null
let clipboardOwned = null
function copySelection() {
  const graph = activeNodes()
  const roots = (state.multi.size ? [...state.multi] : [state.selected]).map((id) => graph[id]).filter((n) => n && !n.readonly && n.type !== 'output' && n.type !== 'parameter' && !(graph === nodes && n.custom))
  if (!roots.length) return showToast('Nothing copyable selected (builtins, Output, parameters and function definitions stay put)')
  const take = new Map()
  const visit = (n) => { if (!n || take.has(n.id)) return; take.set(n.id, structuredClone(n)); (n.mounted || []).forEach((id) => visit(graph[id])); if (n.match?.defaultBranch) visit(graph[n.match.defaultBranch.callId]) }
  roots.forEach(visit)
  clipboard = [...take.values()]
  clipboardOwned = copyOwnedFunctions({ nodes, functionBodies }, clipboard)
  showToast(`블록 ${clipboard.length}개를 복사했어요`)
}
function pasteClipboard() {
  if (!clipboard || readonlyBlocked()) return
  const graph = activeNodes()
  const stamp = Date.now()
  const ids = new Map(clipboard.map((n, i) => [n.id, `${n.id.replace(/-copy-\d+-\d+$/, '')}-copy-${stamp}-${i}`]))
  pasteOwnedFunctions({ nodes, functionBodies }, clipboardOwned || { nodes: {}, functionBodies: {} }, ids, state.activeFunction)
  state.multi.clear()
  for (const original of clipboard) {
    const n = structuredClone(original)
    n.id = ids.get(original.id)
    n.x += 60; n.y += 60
    if (n.mounted) n.mounted = n.mounted.map((m) => (m && ids.has(m) ? ids.get(m) : null))
    if (n.mounted) n.params = n.params.map((text, i) => (original.mounted?.[i] && !ids.has(original.mounted[i]) ? '' : text))
    if (n.mountedTo) { const [host, slot] = splitMountedTo(n.mountedTo); n.mountedTo = ids.has(host) ? `${ids.get(host)}:${slot}` : null; if (!n.mountedTo) n.connected = false }
    if (n.type === 'ref' && ids.has(n.target)) n.target = ids.get(n.target)
    if (n.type === 'ref' && !graph[n.target] && !ids.has(original.target)) continue // its original isn't in this graph
    remapMatchNode(n, ids, state.activeFunction)
    graph[n.id] = n
    if (!n.mountedTo) state.multi.add(n.id)
  }
  // the pasted copies keep only references whose target exists
  state.selected = [...state.multi][0] || state.selected
  updateInspector(); draw()
  showToast(`Pasted ${clipboard.length} node${clipboard.length > 1 ? 's' : ''}`)
}
// --- Keyboard ---------------------------------------------------------------
function setupKeyboard() {
  window.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, select, textarea, [contenteditable]')
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key === 'Enter') { event.preventDefault(); runEntry(); return }
    if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); searchInput.select(); return }
    if (typing || document.querySelector('#function-dialog, dialog[open]') || play) return // no editing shortcuts while a game is playing
    const key = event.key.toLowerCase()
    if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
    else if (mod && key === 'y') { event.preventDefault(); redo() }
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (state.multi.size) { const ids = [...state.multi]; state.multi.clear(); ids.forEach((id) => activeNodes()[id] && deleteNode(id)) }
      else deleteNode(state.selected)
    } else if (mod && key === 'c') { event.preventDefault(); copySelection() }
    else if (mod && key === 'v') { event.preventDefault(); pasteClipboard() }
  })
}
function setupToolbar() {
  document.querySelector('#zoom-in').onclick = () => setZoom(state.zoom + .1)
  document.querySelector('#zoom-out').onclick = () => setZoom(state.zoom - .1)
  document.querySelector('#fit').onclick = () => fitToView()
  document.querySelector('#unfold-all').onclick = () => setAllFolded(false)
  document.querySelector('#fold-all').onclick = () => setAllFolded(true)
  // The canvas bitmap has to track the element's CSS size, not just the
  // window's: the element also changes size without any window resize (the
  // inspector collapsing at the breakpoint, layout settling after fonts load),
  // and a stale bitmap gets stretched by CSS — the drawn blocks come out
  // squashed and no longer line up with the DOM slots laid over them.
  new ResizeObserver(resize).observe(canvas)
  window.addEventListener('resize', resize) // devicePixelRatio changes (browser zoom) don't resize the element
}
function setupSidebarButtons() {
  document.querySelector('.add-node').addEventListener('click', createCustomFunction)
  document.querySelector('.add-type').addEventListener('click', () => openTypeEditor())
  document.querySelector('.add-class').addEventListener('click', () => openClassEditor())
  document.querySelectorAll('.open-universe').forEach((b) => b.addEventListener('click', openUniverse))
  typePanel.addEventListener('click', (event) => { if (event.target.closest('[data-universe]')) openUniverse() })
  document.querySelectorAll('#value-library .library-item[data-type]').forEach((item) => item.addEventListener('click', () => {
    if (readonlyBlocked()) return
    if (item.dataset.type === 'list') return addFunctionCall('prelude:listOf')
    if (item.dataset.type === 'lambda') return createLambda()
    const graph = activeNodes()
    if (item.dataset.type === 'text') {
      const id = `text-${Date.now()}`
      graph[id] = { id, type: 'text', label: 'text', value: 'text', color: '#e8b23c', ...freePosition(graph, CHIP_W) }
      state.selected = id
      updateInspector(); draw()
      return
    }
    if (!['number', 'boolean'].includes(item.dataset.type)) return
    const isBoolean = item.dataset.type === 'boolean'
    const id = `${item.dataset.type}-${Date.now()}`
    graph[id] = { id, type: isBoolean ? 'boolean' : 'number', typeName: isBoolean ? 'Bool' : 'Int', label: isBoolean ? 'boolean' : 'number', value: isBoolean ? 'false' : '0', color: isBoolean ? '#ed6b84' : '#4f8ef7', ...freePosition(graph, CHIP_W) }
    state.selected = id
    updateInspector()
    draw()
  }))
}
// The practice panel grades against the live project; a build exercise's
// function is created (named and with the asked parameters) or opened here.
function openExerciseFunction(exercise) {
  let fn = findExerciseFunction(nodes, exercise.name)
  if (!fn) {
    const problem = functionNameProblem(exercise.name)
    if (problem) return showToast(problem)
    const id = `custom-${Date.now()}`
    const params = [...exercise.params]
    fn = nodes[id] = { id, type: 'function', ...freePosition(nodes, 120 + params.length * SLOT_STRIDE), label: exercise.name, params, mounted: params.map(() => null), paramScopes: params.map(() => 'local'), scope: 'main', color: '#f0954a', custom: true }
    functionBodies[id] = createFunctionBody(id, params)
    delete functionBodies[id].output.source // an empty body: the learner builds it
    functionBodies[id].output.value = 'open'
    showToast(`ƒ ${exercise.name}를 만들었어요 — 시그니처를 적고 본체를 만드세요`)
  }
  state.activeFunction = null
  enterFunction(fn.id)
  // The signature is written by dragging from Types: have them in view.
  document.querySelector('#types-section').open = true
  showMobileView('canvas')
}
function setupLearningPanel() {
  exercisePanel = initExercisePanel({
    workspace: document.querySelector('.workspace'),
    project: () => ({ registry: definitions, functionBodies, userNodes: nodes, types, classes, instances }),
    schemeOf: (name) => builtinSchemes[name],
    openFunction: openExerciseFunction,
    // A declare exercise: its type in the editor, or a new one to rename.
    openType: (name) => { openTypeEditor(types[name] ? name : null); showMobileView('canvas') },
    onChange: () => updateRunLabel(),
    reveal: (name) => {
      const input = document.querySelector('.sidebar .search input')
      input.value = name
      input.dispatchEvent(new Event('input', { bubbles: true }))
      showMobileView('sidebar')
      input.focus()
    },
  })
}
// The inspector opens and closes from the top bar's Inspector button (one
// control, not one per place it could be reopened from) and its own ×.
function setupInspectorButtons() {
  const closeInspector = document.querySelector('.close-inspector')
  closeInspector.setAttribute('aria-label', '속성 패널 닫기')
  closeInspector.addEventListener('click', () => {
    toggleInspector(false)
    document.querySelector('#toggle-inspector').focus({ preventScroll: true })
  })
}
// On a phone-width screen the workspace shows one column at a time, picked
// from a tab bar at the bottom: the learning panel, the blocks, the canvas,
// or the inspector. Actions that lead to another column switch to it.
const mobileQuery = matchMedia('(max-width:680px)')
const MOBILE_VIEWS = [['examples', '연습'], ['sidebar', '블록'], ['canvas', '캔버스'], ['inspector', '속성']]
function showMobileView(view) {
  if (!mobileQuery.matches) return
  const workspace = document.querySelector('.workspace')
  workspace.dataset.view = view
  document.querySelectorAll('.mobile-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)))
  if (view === 'inspector') toggleInspector(true)
  const panel = document.querySelector('.examples-panel')
  if (view === 'examples' && panel.classList.contains('is-collapsed')) panel.querySelector('.learning-toggle').click()
}
function setupMobileTabs() {
  const bar = document.createElement('nav')
  bar.className = 'mobile-tabs'
  bar.setAttribute('role', 'tablist')
  bar.setAttribute('aria-label', '화면')
  bar.innerHTML = MOBILE_VIEWS.map(([view, label]) => `<button type="button" role="tab" data-view="${view}" aria-selected="false">${label}</button>`).join('')
  document.querySelector('.shell').append(bar)
  bar.querySelectorAll('button').forEach((b) => { b.onclick = () => showMobileView(b.dataset.view) })
  document.querySelector('.workspace').dataset.view = 'canvas'
  showMobileView('canvas')
  mobileQuery.addEventListener('change', () => showMobileView(document.querySelector('.workspace').dataset.view))
  // Adding a block from the sidebar, or opening a function, lands on the canvas.
  document.querySelector('.sidebar').addEventListener('click', (event) => {
    if (event.target.closest('.library-item, .add-call, .derived-item')) setTimeout(() => showMobileView('canvas'))
  })
  document.querySelector('#toggle-inspector').addEventListener('click', () => showMobileView('inspector'))
}
// Restore the autosaved project, if any, then start history from whatever
// is on screen.
function restoreSavedProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) loadProject(mergeBuiltins(upgradeProject(parseProject(saved)), builtinNodes, builtinBodies))
  } catch (error) {
    showToast(`Couldn't restore the saved project: ${error.message}`)
  }
  renderPreludeLibrary(); renderFunctionLibrary(); updateInspector(); resize(); fitToView()
  history.reset(currentSnapshot())
  updateHistoryButtons()
}

// --- Start ------------------------------------------------------------------
// Every piece of the page is wired by its own setup function; `main` runs
// them in order (listeners on the same event fire in this order) and then
// brings back the saved project.
function main() {
  setupShortcutHints()
  setupTopBar()
  setupSearch()
  setupTypeDrag()
  setupFunctionDrag()
  setupCanvasInput()
  setupBackButton()
  setupRunButton()
  setupPlayInput()
  setupTemplates()
  setupGameExport()
  setupProjectActions()
  setupKeyboard()
  setupToolbar()
  setupSidebarButtons()
  setupLearningPanel()
  setupInspectorButtons()
  setupMobileTabs()
  restoreSavedProject()
}
main()
