# Project Rules

## 아키텍처 개요
- `src/main.js`: 앱 화면, 그래프 상태, 캔버스 상호작용, 실행 로직.
- `src/typeSystem.js`: 힌들리-밀너 타입 엔진.
- `src/builtinSchemes.js`: 기초 함수들의 타입 스킴 테이블.
- `src/classEnv.js`: 클래스 환경과 제약 해소 엔진(문맥 있는 인스턴스, entailment, context reduction, 디폴팅, 사용자 클래스의 증거 생성).
- `src/numericClasses.js`: 숫자 타입클래스 계층과 인스턴스 선언.
- `src/categoryClasses.js`: 카테고리 클래스(Semigroup, Monoid, PartialOrd, Lattice, VectorSpace, Functor, Foldable) 선언과 인스턴스.
- `src/prelude.js`: 모든 클래스·인스턴스 선언을 불러오고 해소 엔진을 다시 내보내는 진입점.
- `src/typeDecls.js`: 사용자 타입 선언(하스켈 `data`/`newtype`, 타입 매개변수 포함)과 그로부터 유도되는 함수·인스턴스, 직접 작성한 인스턴스 검사.
- `src/typeEdits.js`: 유도 함수 커스터마이즈(원시 함수 `f#` 위에 재정의)와 타입 편집 시 호출 노드 이전.
- `src/deriveGraphs.js`: 유도(deriving) 인스턴스를 같은 동작의 그래프(메서드별 커스텀 함수와 λ)로 펼쳐 직접 작성한 인스턴스로 바꾸기.
- `src/classMethods.js`: 직접 작성할 수 있는 내장 클래스와 그 메서드 표.
- `src/classDecls.js`: 사용자 클래스 선언(메서드·기본 구현·상위 클래스·인스턴스) 검사와 해석, 인스턴스의 사전(dictionary) 증거.
- `src/inferGraph.js`: 캔버스 그래프 연결로부터 타입을 추론하는 패스(사용자 클래스 호출의 사전 전달 elaboration, GHC식 모호성 검사·디폴팅 포함).
- `src/evaluator.js`: 그래프를 지연 평가하는 실행기.
- `src/literals.js`: 슬롯 인라인 리터럴 파서.
- `src/dataTypes.js`: 내장 유도 타입(리스트, Maybe, Char, ())의 인스턴스와 런타임 표현.
- `src/laws.js`: 클래스·함수 법칙 검사기.
- `src/runtime.js`: `Program` 값을 실행하는 게임 런타임.
- `src/haskellPrint.js`: 함수 본체 그래프를 하스켈 정의로 출력.
- `src/examples/`: 템플릿 프로젝트(클릭 카운터, 빈 게임, 주사위)와 빌더.
- `src/player.js`: 위젯 렌더러와 독립 플레이어.
- `src/exportHtml.js`: 독립 HTML 내보내기(번들러).
- `src/valueParser.js`: 하스켈 값 파서.
- `src/signature.js`: 함수 시그니처 편집(정의·본체·호출 동기화).
- `e2e/ui-only.mjs`: UI만으로 게임을 만드는 브라우저 e2e 테스트.
- `src/project.js`: 프로젝트 직렬화·불러오기·실행 취소 기록.
- `src/style.css`: 레이아웃과 반응형 스타일.

## 기초 함수
기초 함수(`zero`, `add`, `identity`, `apply`, `compose`, `isZero`, `ifThenElse`)는 수정하지 않는다.

## 카테고리 이론
이 프로젝트의 타입 구조는 카테고리 이론을 따른다.

## 타입 시스템
이 프로젝트의 타입 시스템은 inductive structure를 따른다.

## 람다 대수
이 프로젝트의 함수 구조는 람다 대수 이론을 따른다.