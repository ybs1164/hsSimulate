# hs / simulate

Haskell 스타일의 함수 합성과 실행 흐름을 캔버스에서 시각적으로 실험하는 Vite 기반 웹 앱입니다.

## 실행 방법

### 요구 사항

- Node.js 18 이상
- npm

### 개발 서버

```bash
npm install
npm run dev
```

터미널에 표시된 로컬 URL을 브라우저에서 엽니다.

### 프로덕션 빌드 및 미리보기

```bash
npm run build
npm run preview
```

## 사용법

1. 왼쪽 `NODES`의 함수 목록에는 `main`에 선언된 함수가 표시됩니다. `+`로 새 함수를 만들거나 함수를 선택해 본체를 엽니다.
2. 캔버스의 노드를 드래그해 배치합니다.
3. 숫자 노드를 함수 노드의 입력 포트 또는 함수 본체의 다른 함수에 드래그해 연결합니다.
4. 함수 노드를 클릭하면 함수 본체 화면으로 들어갑니다. 본체에서 노드를 `Output`에 드래그하면 반환값을 지정할 수 있습니다. 왼쪽 함수 목록의 함수를 클릭하면 현재 본체에 호출 노드로 추가됩니다.
5. 함수 카드의 `▶` 아이콘, 오른쪽 Inspector의 `Play function`, 상단 `Run graph` 버튼 중 하나로 실행합니다.
6. 상단 `Reset` 버튼으로 그래프를 초기 상태로 되돌립니다.
7. 좌측 `+` 버튼으로 함수 이름과 매개변수를 입력하면 커스텀 함수가 생성됩니다. 함수 목록에서 생성한 함수를 열고, 본체의 매개변수 노드 또는 다른 함수 호출 노드를 `Output`에 연결해 동작을 정의합니다.

## 캔버스 조작

- 빈 공간 드래그: 캔버스 이동
- 마우스 휠 또는 `−`/`+`: 확대·축소
- `⌗`: 100% 배율과 기본 위치로 복원
- 입력 포트의 텍스트: 함수 매개변수 값 편집
- 입력 포트의 `−`: 매개변수 삭제
- 입력 포트 옆 `+`: 매개변수 추가

현재 실행기는 `Int`와 `Bool` 타입을 사용하며, 모든 입력이 채워지지 않은 함수는 부분 적용된(curried) 함수로 표시합니다. 기초 함수는 내부 구현이 있는 읽기 전용 함수로 제공됩니다. `zero = λf x. x`, `add = λn f x. f (n f x)`(후계자), `identity = λx. x`, `apply = λf x. f x`, `compose = λf g x. f (g x)`, `isZero = λn. n == 0`, `ifThenElse = λc a b. c ? a : b`를 제공합니다. `ifThenElse`는 `Bool` 조건에 따라 두 `Int` 값 중 하나를 반환합니다. 이 조합으로 Church 덧셈 `plus = λm n f x. m f (n f x)`를 그래프에서 구성할 수 있습니다.

타입 검증은 하스켈의 힌들리-밀너(Algorithm W) 방식을 그대로 따르는 실제 타입 추론기(`src/typeSystem.js`, `src/inferGraph.js`)가 담당합니다. `identity`, `apply`, `compose`는 콘크리트 타입이 아니라 `∀a. a → a`, `∀a b. (a → b) → a → b`, `∀a b c. (b → c) → (a → b) → a → c`로 선언된 다형 함수이며, 캔버스에 놓인 각 인스턴스는 실제로 연결된 값에 따라 독립적으로 `Int`, `Bool` 등으로 인스턴스화됩니다 — 예를 들어 `identity` 노드 하나에 숫자를 연결하면 `Int → Int`로, 다른 곳에 배치한 별도의 `identity` 콜사이트에 불리언을 연결하면 그쪽만 `Bool → Bool`로 독립적으로 표시됩니다(let-다형성). 커스텀 함수도 본체 배선에서 실제로 요구되는 만큼만 타입이 좁혀지고, 나머지는 자동으로 일반화되어 다형 함수가 됩니다. `isZero`, `ifThenElse`는 프로젝트 규칙에 따라 각각 `Int → Bool`, `Bool → Int → Int → Int`로 고정되어 있습니다. 서로 단일화(unify)할 수 없는 타입끼리는(예: `Bool` 값을 `Int` 입력 포트에) 드래그로 연결할 수 없습니다.

하스켈의 숫자 타입클래스 계층(`Num`, `Real`, `Integral`, `Fractional`, `Floating`, `RealFrac`, `RealFloat`)과 핵심 구체 타입(`Int`, `Integer`, `Word`, `Float`, `Double`, `Rational`)도 그대로 들어와 있습니다(`src/numericClasses.js`). 숫자 리터럴(`Numbers`)은 더 이상 무조건 `Int`가 아니라 `Num a ⇒ a`인 다형 값으로 시작하며(소수점이 있으면 `Fractional a ⇒ a`), 실제로 연결되는 곳에 따라 타입이 좁혀집니다 — 인스펙터의 `ANNOTATE TYPE`에서 `Int`/`Integer`/`Word`/`Float`/`Double`/`Rational` 중 하나로 직접 타입 명시(`:: Double` 같은)를 할 수도 있고, 아무 데도 안 걸려 있으면 `DEFAULT` 줄에 GHC의 실제 디폴팅 규칙(`Num`은 `Integer`, `Fractional`은 `Double`)이 뭘 고를지 안내합니다. `(+)`, `negate`, `(/)`, `sqrt`, `toRational`, `fromIntegral`, `round`, `isNaN` 8개 함수가 이 계층을 대표하며(각각 `Num`/`Num`/`Fractional`/`Floating`/`Real`/`Integral→Num`/`RealFrac→Integral`/`RealFloat`), 클래스가 요구하는 타입이 아니면(예: `Rational`을 `sqrt`에, 함수값을 `(+)`에) 연결 자체가 거부됩니다. `fromIntegral`의 결과를 `sqrt`에 연결하면 공유 타입 변수가 `Num`과 `Floating` 제약을 모두 받고, `Floating`이 `Num`을 함의하므로 중복된 `Num`은 자동으로 사라집니다(entailment/context reduction).

## 프로젝트 구조

- `src/main.js`: 앱 화면, 그래프 상태, 캔버스 상호작용 및 실행 로직
- `src/typeSystem.js`: 힌들리-밀너 타입 엔진 (타입 변수·단일화·치환·일반화/인스턴스화·프리티 프린터)
- `src/builtinSchemes.js`: 기초 함수들의 타입 스킴 테이블(다형 함수 3개 + 숫자 타입클래스 대표 함수 8개 포함)
- `src/numericClasses.js`: 숫자 타입클래스 계층·인스턴스 표와 제약 해소(entailment·context reduction·디폴팅) 엔진
- `src/inferGraph.js`: 캔버스 그래프의 연결(`mounted`/`output.source`)을 단일화 제약으로 읽어 타입(과 남은 클래스 제약)을 추론하는 패스
- `src/style.css`: 레이아웃과 반응형 스타일
- `index.html`: 앱 진입 HTML
- `dist/`: `npm run build`로 생성되는 배포 산출물
