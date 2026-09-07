# Project Rules

## 아키텍처 개요
- `src/main.js`: 앱 화면, 그래프 상태, 캔버스 상호작용, 실행 로직.
- `src/typeSystem.js`: 힌들리-밀너 타입 엔진.
- `src/builtinSchemes.js`: 기초 함수들의 타입 스킴 테이블.
- `src/numericClasses.js`: 숫자 타입클래스 계층과 제약 해소 엔진.
- `src/inferGraph.js`: 캔버스 그래프 연결로부터 타입을 추론하는 패스.
- `src/style.css`: 레이아웃과 반응형 스타일.

## 기초 함수
기초 함수(`zero`, `add`, `identity`, `apply`, `compose`, `isZero`, `ifThenElse`)는 수정하지 않는다.

## 타입클래스
숫자 타입클래스 계층은 군론을 따른다.
