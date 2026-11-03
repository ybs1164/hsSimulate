# Project Rules

## 프로젝트 방향

Haskell 코드의 구조·함수 관계·계산 과정과 오류를 시각적으로 분석·디버깅하는 도구를 지향한다. 현재는 수동 그래프 편집과 제한된 Int/Bool/리스트·고차 함수 코드 붙여넣기·로컬 .hs 모듈 선택 → 읽기 전용 그래프 → Graph JS 평가·실행 기록을 제공한다. 외부 라이브러리와 완전한 Haskell 분석은 후속 목표다. 연습문제·문법 설명 패널은 제거했으며 기존 프로젝트·실행 UI와 저장 형식은 유지한다.

## 아키텍처 개요
- `src/sourceParser.js`, `sourceAnalysis.js`: 위치를 가진 토큰·AST 파서와 이름 해석·명시적 구체 Int/Bool/리스트/함수 타입 검사(기존 unify/instantiate 재사용)·조건식·자기/상호 재귀 이름 해석. 외부 코드 실행이나 정규식 치환 변환이 아니다.
- `src/sourceBuiltins.js`: 코드 입력의 연산/내장 함수와 기존 타입 스킴. 사용자 이름/지역 변수가 우선한다.
- `src/sourceValue.js`: 제한된 표시 요청. 전체 리스트나 클로저 인자를 추적/직렬화 때문에 강제하지 않는다.
- `src/sourceGraph.js`: AST → 기존 노드 모델, 기존 타입 엔진의 추가 검사, 분리된 레지스트리의 평가. 패턴 방정식은 유한한 순서 테이블과 타입 검사된 별도 본문 그래프로 내린다. 기존 지연 인자/클로저/리스트로 매칭하고 선택 본문만 실행한다. 코드 경로는 lazy foldl이며 수동 strict fold는 유지한다. 수동 프로젝트의 동적 클래스/인스턴스를 잠시 격리하고 복원한다. evaluator의 선택적 validateNodeValue 훅은 이미 계산된 숫자만 범위 검사하고 지연 값을 강제하지 않는다.
- `src/sourceWorker.js`, `sourceRunner.js`: 기존 평가기를 별도 Worker에서 한 번 실행하고 실제 계산 중단·4초 강제 종료를 담당한다. 기록 재생 중단과 구분하며 오래된 응답은 버린다. 코드 경로의 한도는 sourceGraph의 SOURCE_LIMITS(호출 깊이 48·평가 깊이 128·호출/노드/리스트 검사 각 6,000·1.5초·노드 기록 20,000)이며 수동 그래프 한도는 바꾸지 않는다. div/mod의 안전 정수용 정확한 나눗셈도 이 경로에서만 적용한다. 추적은 인자를 추가 강제하지 않고 호출·부모 ID를 보존한다.
- `src/sourceTrace.js`, `sourceHistory.js`, `sourceDebuggerPanel.js`: thunk 완료를 수동 관찰해 탐색 기록을 수집한다. 값 참조 10,000개와 4,000단계를 저장하며 재생은 상태 변경을 되돌릴 수 있다. 사용자 함수와 방정식 본문의 호출 관계를 표시하고 값 표시 자체로 thunk를 강제하지 않는다.
- `src/sourceDocument.js`, `sourcePanel.js`: 성공 때만 교체하는 버전 문서·저장과 Workspace 코드/함수 탭, 기존 Graph/Inspector 안의 읽기 전용 표시·원문 범위 대응·취소 가능한 기록 재생. 수동 프로젝트 상태·기본 main·자동 저장과 분리한다.
- `src/sourceFiles.js`: 선택된 UTF-8 .hs 파일만 읽고 줄바꿈·크기를 처리한다. 파서는 한 줄 모듈 선언과 import를 구분한다. 분석기는 의존 관계 순서대로 모듈의 공개 이름과 참조를 해석하고 순환을 거부한다. 그래프·추적 위치는 파일 식별자와 버전을 포함한다. 파일 보기와 평가 대상은 독립이며 파일 문서는 붙여넣기 저장소와 분리한다.
- `src/main.js`: 앱 화면, 그래프 상태, 캔버스 상호작용, 실행 로직, 타입·클래스 선언 그래프 편집(카드의 내용과 편집 → 선언 검사·적용·호출 이전), 타입 우주.
- `src/typeSystem.js`: 힌들리-밀너 타입 엔진과 kind(`*`, `k₁ -> k₂`) 검사.
- `src/typeExpr.js`: 타입을 노드로 다루기(타입 생성자 = 타입 수준 함수, 함수 타입 = 커링된 꺽쇠 사슬 `A ▸ B ▸ C`, 구멍 `_`)와 본체 매개변수·Output의 타입 주석(부분 타입 시그니처) 해석, 클래스 노드(작업 공간의 CLASSES에서 타입 변수로 끌어와 고정하는 제약 `Ord a =>`, Output의 `context`).
- `src/builtinSchemes.js`: 기초 함수들의 타입 스킴 테이블.
- `src/classEnv.js`: 클래스 환경과 제약 해소 엔진(문맥 있는 인스턴스, entailment, context reduction, 디폴팅, 인스턴스 키 `Cls@Head`와 모든 클래스의 사전 증거 생성).
- `src/numericClasses.js`: 숫자 타입클래스 계층과 인스턴스 선언.
- `src/categoryClasses.js`: 카테고리 클래스(Semigroup, Monoid, PartialOrd, Lattice, VectorSpace, Functor, Foldable, Traversable, Applicative, Monad) 선언과 인스턴스, Data.Monoid 래퍼(`Sum`, `Product`, `Min`, `Max`, `First`, `Last`, `Any`, `All`, `Endo` — 타입은 library.js)와 `State s` 모나드의 인스턴스, 쌍 `(a, b)`의 성분별 벡터 구조, `Functor Widget`(메시지 바꾸기).
- `src/classGroups.js`: 클래스를 보여주는 방식(작업별 그룹, 숫자 계층의 하스켈 이름 별칭 `Ring`→`Num` 등 — 표시 전용, 엔진은 구조적 이름 유지).
- `src/prelude.js`: 모든 클래스·인스턴스 선언을 불러오고 해소 엔진을 다시 내보내는 진입점.
- `src/typeDecls.js`: 사용자 타입 선언(하스켈 `data`/`newtype`, 타입 매개변수 포함, 매개변수의 kind 추론)과 그로부터 유도되는 함수·인스턴스.
- `src/typeEdits.js`: 유도 함수 커스터마이즈(원시 함수 `f#` 위에 재정의), 타입 편집 시 호출 노드 이전, Prelude 타입 넘겨받기(런타임이 읽는 생성자는 유지).
- `src/declGraph.js`: 타입·클래스 선언을 그래프로(그리고 다시 선언으로, 손실 없이): 타입 = 생성자(곱)들이 주입되는 쌍대곱(`ιᵢ`, 위→아래가 합의 순서), 매개변수 → 그것을 쓰는 필드, 재귀 필드 ← 타입, 유도 함수(π·set/over·case·fold) → 밖으로; 클래스 = 상위 클래스·메서드·인스턴스(메서드마다 구현 함수를 적용한 사전, 함수 노드가 구현하는 자리로 연결); 타입 우주(모든 타입·클래스, 필드 사용·상위 클래스·인스턴스 간선). 열 배치와 프로젝트에 저장되는 위치(`layouts`).
- `src/declCanvas.js`: 선언 그래프 캔버스(DOM 카드 + SVG 간선, 이동·확대·카드 끌기, 카드 안의 특정 행으로 가는 간선 포트).
- `src/deriveGraphs.js`: 유도(deriving) 인스턴스를 같은 동작의 그래프(메서드별 커스텀 함수와 λ)로 펼쳐 직접 작성한 인스턴스로 바꾸기.
- `src/classMethods.js`: 내장 클래스의 선언(메서드와 최소 완전 정의 MINIMAL).
- `src/classDecls.js`: 사용자 클래스 선언(메서드·기본 구현·상위 클래스·인스턴스)과, 내장 클래스에 직접 작성한 인스턴스(프로젝트의 `instances`, 같은 `{ head, context, methods }` 모양 — Prelude가 선언한 타입이면 내장 인스턴스를 대신함)의 검사와 해석.
- `src/instanceTable.js`: 모든 인스턴스의 런타임 사전 표(prim·stock·pointwise·newtype·written, 상위 클래스 증거).
- `src/inferGraph.js`: 캔버스 그래프 연결로부터 타입을 추론하는 패스(모든 클래스 제약·리터럴의 사전 전달 elaboration, GHC식 모호성 검사·디폴팅 포함).
- `src/evaluator.js`: 그래프를 지연 평가하는 실행기(메서드는 값 모양이 아니라 사전으로 고른다).
- `src/typedEvaluator.js`: 실행할 그래프를 스스로 타입 검사해 elaboration을 만드는 실행기(테스트·스크립트용).
- `src/literals.js`: 리터럴 파서(리터럴 노드의 값, 예전 프로젝트의 슬롯 인라인 텍스트).
- `src/dataTypes.js`: 내장 유도 타입(리스트, Maybe, Either, Ordering, Char, ())의 인스턴스와 런타임 표현.
- `src/exerciseContent.js`: 앱에서 로드하지 않는 과거 연습 과정(기록·검증용)(`COURSES`): 기초(산술 연산자 → 논리 연산자 → 리스트), 그리고 템플릿 게임마다 하나씩(빈 게임 → 자판기 → 님 → 주사위 → 데미지 → 가위바위보 → 사이먼 → 하이로우 → 클릭 카운터 → 블랙잭). 문제 종류는 타입 쓰기(`type`), 고르기(`choice`), 캔버스에서 함수 만들기(`build`: 시그니처·테스트, 함수를 돌려주는 함수는 `params`가 화살표보다 적고, 테스트의 `after`로 결과의 일부 보기), 타입 선언하기(`declare`).
- `src/courses/`: 게임 과정(템플릿 하나당 파일 하나): 함수·타입 하나당 단원 하나 — 그 함수로 이끄는 문제들과 만들기 — 를 파트로 묶음, 템플릿과 같은 이름·타입이라 다 만들면 같은 게임. `common.js`는 단원·step·main 공통 조각.
- `src/grader.js`: 연습 문제 채점. 타입 답은 문자열이 아니라 타입으로 비교(변수 이름 바꾸기, 제약은 entailment — `Num`과 엔진의 `Ring`이 같음), 만들기 문제는 시그니처 → 본체 타입 검사 → 추론 타입이 요구 타입을 포섭(subsumption) → 테스트 순(테스트 값은 리터럴·리스트·쌍·생성자/함수 적용), 선언 문제는 생성자 순서·필드·deriving.
- 과거 학습 UI 모듈(`learningPanel.js`, `exercisePanel.js`)은 제거했다. 학습·과정 데이터와 채점 모듈은 보존하며 기존 localStorage 진행 기록을 삭제하거나 변환하지 않는다.
- `src/laws.js`: 클래스·함수 법칙 검사기.
- `src/runtime.js`: `Program` 값을 실행하는 게임 런타임.
- `src/haskellPrint.js`: 함수 본체 그래프를 하스켈 정의로 출력(토큰마다 원래 노드를 가리킴, λ로 이어진 `>>=` 사슬은 `do { x <- m; … }`).
- `src/definitionViews.js`: 기초·Prelude·유도 함수의 읽기 전용 정의 그래프와, Prelude 함수를 같은 id의 사용자 함수로 넘겨받기(원시 함수는 `f#`에서 시작, 클래스 메서드는 인스턴스로).
- `src/library.js`: Prelude 함수 표와 하스켈로 선언한 Prelude 타입(생성자·분기 함수, 곱 `(a, b)`와 `uncurry`), 그 원시 함수(`prim:`).
- `src/examples/`: 템플릿 프로젝트(빈 게임, 클릭 카운터, 자판기, 님, 주사위, 데미지, 가위바위보, 사이먼, 하이로우, 블랙잭 — 함수 표 `*_FUNCTIONS`는 게임 과정의 참조 답)와 빌더.
- `src/player.js`: 위젯 렌더러와 독립 플레이어.
- `src/exportHtml.js`: 독립 HTML 내보내기(번들러).
- `src/valueParser.js`: 하스켈 값 파서.
- `src/signature.js`: 함수 시그니처 편집(정의·본체·호출 동기화).
- `e2e/ui-only.mjs`: UI만으로 게임을 만드는 브라우저 e2e 테스트.
- `src/project.js`: 프로젝트 직렬화(선언 그래프 배치 `layouts` 포함)·불러오기·실행 취소 기록.
- `src/style.css`: 레이아웃과 반응형 스타일.

## 기초 함수
기초 함수(`zero`, `add`, `identity`, `apply`, `compose`, `isZero`, `ifThenElse`)는 수정하지 않는다.

## 카테고리 이론
이 프로젝트의 타입 구조는 카테고리 이론을 따른다.

## 타입 시스템
이 프로젝트의 타입 시스템은 inductive structure를 따른다.

## 람다 대수
이 프로젝트의 함수 구조는 람다 대수 이론을 따른다.
