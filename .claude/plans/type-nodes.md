# 타입 노드 계획 — 함수 타입부터, 그다음 커스텀 타입

타입도 결국 함수다. 타입 생성자는 타입 수준 함수(`Maybe :: * ▸ *`, `Pair :: * ▸ *`, 화살표 자체도 `(▸) :: * ▸ * ▸ *`)이고, 타입은 생성자에 타입을 적용한 항이다. 캔버스의 호출 노드(머리 + 인자마다 슬롯)와 같은 모양으로 그린다. 함수 타입은 커링된 꺽쇠 사슬 `A ▸ B ▸ C`로 그린다. 꺽쇠 하나가 인자 하나이고, 각 꺽쇠는 나머지(`A → (B → C)`)를 가리킨다. 마지막 칸이 결과다.

## 결정 사항
- 2026-10-13: **Phase T1 완료** (아래). 함수 타입을 보여주던 모든 곳이 꺽쇠 사슬이 되었다. 슬롯 위 태그의 `:: 타입`은 없앴다(그 슬롯 바로 아래 꺽쇠가 그 타입이다).
- 2026-10-13: 타입 주석 = **GHC 부분 타입 시그니처**(`f :: _ => a ▸ Int`). 적은 부분은 HM 단일화로 검사한다. `_`는 추론에 맡긴다. 이름 붙은 변수는 rigid다. 클래스 제약은 항상 추론한다(추가 제약 와일드카드 `_ =>`).
- 2026-10-13: 타입 편집기에서 deriving·직접 작성한 인스턴스·"edit as graphs"·법칙 보고를 **모두 없앴다**. 사이드바의 인스턴스 목록도 없앴다. 데이터(`deriving`, `instances`)는 그대로 둬서 기존 프로젝트와 템플릿은 그대로 동작한다.
  - `Eq`·`Ord`·`Show`는 필드가 허락하면 **자동으로 유도**한다(보이지 않음). 허락하지 않으면 조용히 뺀다.
  - 편집 때문에 불가능해진 기존 deriving·인스턴스는 편집을 거부하지 않고 빼고, 토스트로 알린다(`dropImpossibleInstances`).

---

## Phase T1: 함수 타입을 노드로 ✅ 완료

### 타입 엔진 (`src/typeExpr.js`, 테스트 `test/typeExpr.test.js`)
- `typeNode(t)` → `{ head, slots }`: 생성자 적용·리스트 `[ ]`·쌍 `( , )`·화살표 `▸`를 같은 "머리 + 슬롯" 모양으로 다룬다. 역함수는 `fromTypeNode`.
- `chainOf(t)`: 화살표 등뼈를 펼친 꺽쇠 칸들(인자들, 결과).
- 편집: `hole()`/`isHole`, `typeAt`/`replaceAt`(슬롯 경로), `firstHole`, `constructorWithHoles('Maybe')` → `Maybe _`.
- 주석 텍스트: `annotationType(text, names)`(이름 변수는 한 시그니처 안에서 공유, `_`는 각자 새 변수), `typeFromText`(구멍 보존), `typeText`(하스켈 텍스트), `annotationProblem`.
- `typePalette()`: 종류(kind)를 붙인 타입 생성자 팔레트(숫자, 기본, 구조, 게임, 사용자 타입).

### 추론 연계 (`src/inferGraph.js`)
- 본체의 `parameter`·`output` 노드에 `annotation`(하스켈 타입 텍스트)이 있으면 `annotate()`가 본체 추론 뒤에 단일화한다.
  - 함수 스킴 경로(`inferCustomFunctionScheme`)와, 본체를 직접 보는 경로(`inferGraph`의 활성 그래프)가 모두 적용한다.
- 아래 경우는 그 노드의 문제로 보고하고, 그 주석은 적용하지 않는다.
  - 불일치: "The body makes ‘x’ Int, not Bool"
  - 필요한 클래스가 없음: "needs AddSemigroup of it"
  - rigid 변수 특수화: "a must work for every type … Int"
  - 두 변수 합쳐짐: "a and b may be different types…"
- 결과값: `pass.annotations = { here, functions: { fnId: { nodeId: 문제 } } }`, `pass.brokenEdges`(검사를 통과하지 못한 간선).

### UI (`src/main.js`, `src/style.css`)
- 캔버스: 함수 블록 아래에 꺽쇠 사슬을 둔다(`drawCanvasChains`).
  - 꺽쇠 하나가 슬롯 하나 바로 아래에 오고, 결과가 마지막이다. 채워진 슬롯의 꺽쇠는 흐리게 그린다(적용으로 소비됨 = 커링).
  - 클래스 문맥은 사슬 왼쪽에 붙는다. 값 칩 아래에는 타입 노드 하나가 온다.
- 고정(pin):
  - 사용자 함수 정의, λ 호출 노드: 각 꺽쇠를 고정할 수 있다.
  - 본체 안: 매개변수·Output 칩, 그리고 Output 인스펙터의 SIGNATURE 사슬로 고정한다(슬롯에 꽂혀 숨은 매개변수도 고정 가능).
- 타입 피커(`#type-picker`):
  - 지금 타입을 노드로 보여주고, 부분을 클릭해 고른다. 생성자는 구멍을 데려오고, 구멍이 다 차면 바로 고정한다.
  - 하스켈 텍스트 입력, `Infer`(주석 제거)도 있다.
  - 고정 전에 본체 추론과 그 함수의 모든 호출(`brokenEdgesAround`)로 검사하고, 깨지면 거부한다.
- 사이드바(함수·Prelude·타입에서 만든 함수·클래스 메서드), 인스펙터 TYPE, 타입 편집기의 생성자·MADE FROM IT, 클래스 편집기의 메서드 타입이 모두 사슬이다. 사슬의 `title`은 하스켈 표기 전체다.
- 타입 이름을 바꾸면 주석도 따라 바뀐다. 타입 삭제는 그 타입을 쓰는 시그니처가 있으면 막는다.

### 남은 한계 (T1 범위 밖)
- 숫자 리터럴의 주석은 아직 인스펙터 select(`ANNOTATE TYPE`)로 단다. 피커로 합칠 수 있다(숫자 타입만 허용).
- 클래스 메서드 시그니처는 아직 텍스트 입력이다. 표시만 사슬이다.
- 제약(`Ord a =>`)은 고정할 수 없다. 항상 추론한다.

---

## Phase T2: 생성자를 꺽쇠 사슬로 편집 (커스텀 타입 적용의 핵심)
하스켈에서 생성자는 함수다. `data Model = Model { clicks :: Double, rate :: Double }`의 `Model`은 `Double ▸ Double ▸ Model`이다. 그러니 생성자 행이 곧 사슬이어야 한다.

```
 ƒ Model     clicks      rate
            [Double ▸][Double ▸][ Model ]      ← 마지막 칸은 고정(타입 자신)
```
- 필드 하나 = 꺽쇠 하나.
  - 필드 이름은 함수 슬롯 태그처럼 꺽쇠 위 알약에 둔다(레코드가 아니면 이름 없음).
  - 필드 타입은 꺽쇠 안 타입 노드이고, 클릭하면 T1의 피커로 고른다. 지금의 `name :: Type` 텍스트 입력을 대체한다.
- 결과 꺽쇠는 `Model`/`Pair a`로, 편집할 수 없다. 합 타입(`data Shape = Circle Double | Rect Double Double`)은 같은 결과 꺽쇠로 끝나는 사슬을 쌓아 그린다. 쌍대곱의 주입들이다.
- `+`(사슬 끝)로 필드를 추가하고 `−`(꺽쇠 위)로 지운다. 끌어서 순서를 바꾼다. 호출 이전은 이미 있는 `draftKeyMap`/`migrateTypeEdit`가 키로 처리한다.
- 피커 일반화: `openTypePicker({ initial, variables, allowHoles, validate, commit })`.
  - 시그니처 주석: 구멍 허용, 검증은 `inferGraph`.
  - 필드: 구멍 불허(하스켈 필드는 완전한 타입), 변수는 선언된 매개변수만, 검증은 `checkTypeDraft`.
- `newtype`은 꺽쇠가 하나뿐인 사슬이다(필드 추가 버튼 없음).
- 테스트: `typeDecls`·`typeEdits` 단위 테스트 + e2e의 `declareRecordType`를 피커 조작으로 바꾼다.

## Phase T3: 타입 매개변수 = 타입 수준 λ
- 머리줄은 `Pair` + 매개변수 노드 `a`, `b`다. 함수 매개변수처럼 이름을 바꾸면 필드 안의 변수도 따라간다(`signature.js`의 `renameParameter`와 같은 방식). 매개변수 추가·삭제도 같은 방식이다.
- 종류(kind)를 사슬로 보인다: `Pair :: * ▸ *`. 매개변수 하나가 꺽쇠 하나다. 팔레트의 "Yours" 항목은 이미 `Pair _`처럼 슬롯을 가진다.
- 매개변수를 지우면 그 변수를 쓰던 필드 꺽쇠가 구멍이 되고, 그 구멍이 채워질 때까지 적용을 보류한다.

## Phase T4: "MADE FROM IT"을 그래프로 읽히게
- 접근자 `clicks :: Model ▸ Double`, `set`/`over`, `caseT`, `foldT`는 이미 사슬로 보인다.
- `caseT`의 갈래 인자(생성자마다 `A ▸ … ▸ r`)는 생성자 행과 같은 색으로 짝을 지어 보인다.
- "Customize ✎"(본체 재정의)는 그대로 둔다.

## Phase T5: 클래스 인스턴스를 그래프로 (deriving의 자리)
- 타입 편집기에서 인스턴스 목록을 없앤 대신, 인스턴스는 **클래스 쪽**에서 만든다(클래스 라이브러리 / 클래스 편집기 "+ instance for…").
  - 대수 클래스(`AddSemigroup`, `Monoid`, `VectorSpace` …)를 사용자 타입에 줄 때는, `deriveGraphs.js`의 `instanceGraphs`가 만드는 "유도와 같은 동작의 그래프"를 메서드 함수의 기본 본체로 깐다. 바로 편집할 수 있는 그래프다.
  - 그래서 `deriving anyclass`/`via`는 UI에서 보이는 개념이 아니게 된다.
- 법칙 검사(`laws.js`의 `checkClassLaws`)는 인스턴스 메서드 함수의 법칙 패널(`functionLawsPanel`)에서 필요할 때만 돌린다.
- 데이터 모델은 바꾸지 않는다(`instances[].methods`). 템플릿의 `deriving anyclass (...)`는 계속 동작한다.

## 열린 질문
- 자동 `Eq`/`Ord`/`Show`를 어딘가에 보여야 하는가? (지금은 보이지 않음. `show`, `(==)`가 그냥 된다.)
- 시그니처에 제약을 고정할 수 있어야 하는가(`Ord a => a ▸ a ▸ a`)? 아니면 지금처럼 항상 추론하는가?
- `type` 동의어(`type Pos = (Double, Double)`): 이름 붙은 타입 노드 그래프로 추가할 것인가?
