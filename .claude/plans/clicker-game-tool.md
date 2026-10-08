# 클릭 카운터 게임 툴 계획

## 결정 사항
- 2026-10-08: 숫자 타입클래스 계층을 **군론 기반으로 재구성**한다 (CLAUDE.md 규칙 준수). 기존 Num 계층 옆에 병렬로 두지 않는다.
- 2026-10-08: 1c 기본값 — Modifier는 가환 직곱, 지갑 수량은 `Double` (추천안으로 진행, 사용자 미응답).
- 2026-10-08: **Phase 1a 완료.** 법칙 테스트 결과 `Word`(ℤ/2⁶⁴)는 순서환이 아님 → `Ring + Ord`로 강등. `Int`는 ℤ로 모델링(오버플로는 모델 밖). 테스트는 `npm test`(node:test, 의존성 추가 없음). 덧셈 사슬에 `AddCommutativeMonoid` 추가(반환의 덧셈은 가환이어야 함).
- 2026-10-08: CLAUDE.md 규칙이 "숫자 타입클래스 = 군론" → **"타입 구조 = 카테고리 이론"**으로 변경됨. 1a(군론 숫자 계층)는 그대로 유효(모노이드·군 = 대상이 하나인 카테고리). **1b/1c는 카테고리 이론 용어로 재구성 필요**: 타입·함수 = 카테고리(`identity`/`compose`), 레코드 = 곱(product), 합 타입 = 쌍대곱(coproduct), `List`/`Bag`/`Maybe` = 함자(Functor), `End Model` = 자기사상 모노이드, 준동형 = 함자, `tick` = 모노이드 작용(함자 B(ℝ≥0) → Set).
- 2026-10-08: **Phase 0 완료.** 함수 노드 값 = 호출 대상에 채워진 슬롯(연결 노드·인라인 리터럴)을 적용한 값 — 타입 패스와 실행기가 같은 의미 사용. 지연 평가(재귀 가능), 커리 노드는 클로저 + 일반화된 스킴 저장. 인라인 리터럴은 가상의 간선처럼 검사(`settleLiterals`). 남은 제약: 노드 하나는 슬롯 하나에만 연결 가능(본체에서 매개변수를 두 번 쓸 수 없음) → 1b에서 해결 필요.

## 설계 방향: Elm 아키텍처
- `Model` 레코드 + `onClick :: Model -> Model`, `onTick :: Double -> Model -> Model`, `buy :: Int -> Model -> Model`
- 게임 로직은 전부 캔버스 그래프의 순수 함수, 런타임은 상태 보관·이벤트 전달·렌더만 담당
- 이벤트 핸들러는 연결 시 `Model -> Model`로 단일화 검사

---

## Phase 1a: 군론 기반 숫자 타입클래스 재구성 ✅ 완료

### 클래스 계층 (`src/numericClasses.js`의 `superclasses`)
덧셈/곱셈 구조를 분리한 단일 매개변수 클래스 (numeric-prelude `Algebra.*` 방식).

| 클래스 | 상위 클래스 | 연산 | 대수 구조 |
|---|---|---|---|
| AddSemigroup | — | `(+)` | 결합 법칙 |
| AddMonoid | AddSemigroup | `addZero` | + 항등원 |
| AddGroup | AddMonoid | `negate`, `(-)` | + 역원 |
| AddAbelianGroup | AddGroup | — | + 교환 법칙 (Phase 1c 범용 `AbelianGroup`과 구분) |
| MulSemigroup | — | `(*)` | 결합 법칙 |
| MulMonoid | MulSemigroup | `mulOne` | 항등원 |
| Semiring | AddMonoid, MulMonoid | 음 아닌 리터럴 | 분배 법칙 |
| Ring | Semiring, AddAbelianGroup | 음수 리터럴 | |
| OrderedRing | Ring, Ord | `toRational`, `(>=)` | 순서환 |
| EuclideanRing | OrderedRing | `div`, `mod`, `fromIntegral` 원천 | 유클리드 정역 (+순서, 단순화) |
| Field | Ring | `(/)`, `recip`, 소수 리터럴 | 체 |
| OrderedField | OrderedRing, Field | `round`, `floor` | 아르키메데스 순서체 |
| Transcendental | Field | `sqrt`, `exp`, `(**)` | 군론 밖 해석적 확장 (문서화) |
| IEEEFloat | OrderedField, Transcendental | `isNaN` | 부동소수 |

보조 클래스 (군론 계층 밖, 순서론): `Eq`, `Ord: [Eq]`, `Show` — 숫자 클래스 목록에는 포함하지 않음 (디폴팅 판정용).

### 기존 → 신규 매핑
Num→Ring, Real→OrderedRing, Integral→EuclideanRing, Fractional→Field, Floating→Transcendental, RealFrac→OrderedField, RealFloat→IEEEFloat

### 인스턴스 표
| 타입 | 인스턴스 |
|---|---|
| Int, Integer, Word | AddSemigroup…Ring, OrderedRing, EuclideanRing (Word는 mod 2ⁿ 이므로 Ring) |
| Natural (신규, 선택) | Semiring, Ord, EuclideanRing 아님 — **AddGroup 없음** → 클릭 수처럼 음수가 될 수 없는 재화에 사용, 차감은 `monus`/검사 필요 |
| Rational | Ring, OrderedRing, Field, OrderedField |
| Float, Double | Field, OrderedField, Transcendental, IEEEFloat (+ 결합 법칙 근사 — 주석으로 명시) |
| Bool | Eq, Ord, Show |
| 함수 타입 | 없음 (현행 유지: 즉시 ContextError) |

### 스킴 변경 (`src/builtinSchemes.js`) — 보호 대상 7개는 변경 없음
- `plus :: AddSemigroup a => a -> a -> a` (가장 일반적인 요구만)
- `negate :: AddGroup a => a -> a`
- `divide :: Field a`, `sqrt :: Transcendental a`, `toRational :: OrderedRing a`
- `fromIntegral :: (EuclideanRing a, Ring b)`, `round :: (OrderedField a, EuclideanRing b)`, `isNaN :: IEEEFloat a`
- 신규: `minus :: AddGroup a`, `times :: MulSemigroup a`, `addZero :: AddMonoid a => a`, `mulOne :: MulMonoid a => a`, `geq :: Ord a => a -> a -> Bool`, `eq :: Eq a`, `select :: a. Bool -> a -> a -> a`
  (`zero`은 보호된 Church zero이므로 항등원 이름은 `addZero` 사용)

### 리터럴 (`src/inferGraph.js:114`)
- 음 아닌 정수 → `Semiring a`, 음수 정수 → `Ring a`, 소수 → `Field a`

### 디폴팅 (`pickDefault`)
- `numericClasses` = 위 14개 중 군론 클래스, `defaultTypes = ['Integer', 'Double']` 유지
- Natural 도입 시 기본 목록에는 넣지 않음

### 검증
- Vitest 도입, 각 인스턴스에 대해 법칙 속성 테스트 (결합·항등·역원·분배, Float/Double은 허용오차)
- 엔테일먼트 회귀: `Ring a ∧ AddSemigroup a` → `Ring a`로 축약, `Rational`→`sqrt` 거부, 함수값→`plus` 거부
- README·주석의 Num/Fractional 표기 일괄 갱신, 인스펙터 DEFAULT 라벨 문구 수정

---

## Phase 1b·1c: 카테고리 이론 기반 재구성 ✅ 완료 (CLAUDE.md "타입 구조는 카테고리 이론을 따른다")

### 0. 기준 카테고리 𝒞
| 카테고리 개념 | 이 프로젝트에서 | 상태 |
|---|---|---|
| 대상 (object) | 타입 (`Int`, `Model`, `List a` …) | 있음 |
| 사상 (morphism) | 함수 노드 / 커스텀 함수 | 있음 |
| 항등 사상 · 합성 | 보호 기초 함수 `identity`, `compose` (법칙 테스트 있음) | 있음 |
| 전역 원소 1 → A | 리터럴 노드, 인자 없는 함수 (`zero`, `addZero`) | 있음 |
| 종대상 1 | `Unit` (필드 없는 곱) | 1b |
| 곱 A × B, 사영 πᵢ, 짝 ⟨f, g⟩ | 레코드 타입, 필드 getter, 생성자 `mkT` | 1b |
| 쌍대곱 A + B, 주입 ιⱼ, 쌍대짝 [f, g] | 합 타입, 생성자, `caseT` | 1b |
| 대각 사상 Δ : A → A × A | 같은 값을 여러 슬롯에 쓰기 (참조 노드) | 1b |
| 함자 F : 𝒞 → 𝒞 | `List`, `Maybe` (+ `fmap`) | 1b·1c |
| 모노이드 대상 (M, μ, η) | `Semigroup`/`Monoid` 클래스 (`<>`, `mempty`) | 1c |
| 자유 모노이드 함자와 보편 성질 | `List a`와 `foldMap` (유일한 준동형) | 1c |
| 자기사상 모노이드 End(A) | `End a` (`<>` = `compose`, `mempty` = `identity`) | 1c |
| 모노이드 준동형 = 대상이 하나인 카테고리 사이의 함자 | 생산량 계산, 이벤트 재생 | 1c |
| 모노이드 작용 = 함자 B(M) → 𝒞 | `tick : Sum Double → End Model` | 1c |
| 순서 집합 = thin 카테고리, 격자 = 곱·쌍대곱을 가진 thin 카테고리 | `Lattice` (`leq`, `join`, `meet`) — 구매 가능 여부, 업적 | 1c |
| 대수 이론(Lawvere)의 모델은 곱에 닫힘 | 레코드 인스턴스 자동 유도 규칙 | 1c |

Bool = 1 + 1 이므로 `select`는 Bool에 대한 쌍대짝이다 (`select c a b = [const a, const b] c`). 이 관점을 문서와 인스펙터 설명에 쓴다.

---

### Phase 1b: 카테고리 골격 — 타입 생성자·곱·쌍대곱·복사

**1b-1. 종류(kind)와 타입 적용** — `src/typeSystem.js`
- 타입에 `{ kind: 'app', fn, arg }` 추가 (THIH의 `TAp`, 커링된 적용 → `f a`처럼 생성자 자리에 변수 허용)
- `unify`·`applySubst`·`ftv`·`instantiate`·`showType`(`List (Maybe a)`) 확장
- 생성자 종류 표: `List, Maybe, End, Sum, Product :: * → *`, 나머지 `*`. 내장 스킴은 로드 시 종류 검사 (테스트)
- `fun`은 별도 유지 (`Functor ((->) r)`는 범위 밖)

**1b-2. 클래스 환경 일반화** — 파일 재편 (결정 ①)
- `src/classEnv.js`: 상위 클래스 그래프, **문맥 있는 인스턴스** `{ cls, head, context }` + 일방향 매칭, entail/reduce/default (numericClasses에서 이동)
- `src/numericClasses.js`: 숫자 클래스·인스턴스 **선언만**
- `src/categoryClasses.js`: Semigroup/Monoid/Lattice/VectorSpace/Functor/Foldable 선언·인스턴스 (1c)
- 생성자 클래스(종류 `* → *`에 대한 술어, 예: `Functor List`) 지원
- 사용자 타입 선언이 바뀌면 유도 인스턴스를 다시 등록 (동적 레지스트리)

**1b-3. 사용자 타입 선언 (곱·쌍대곱)** — 사이드바 "TYPES" 패널, 새 `src/typeDecls.js`
- 프로젝트 데이터에 `types` 추가 → 직렬화 v2 (v1 파일은 `types: {}`로 마이그레이션)
- 곱 `Model = { clicks :: Double, perClick :: Double }`에서 자동 생성되는 사상:
  - `mkModel :: Double → Double → Model` (짝), `clicks :: Model → Double` (사영)
  - `setClicks :: Double → Model → Model`, `overClicks :: (Double → Double) → Model → Model` (렌즈 — get-set/set-get/set-set 법칙 테스트)
- 합 `Event = Click | Tick Double | Buy Int`에서 자동 생성:
  - 주입 `Click :: Event`, `Tick :: Double → Event`, `Buy :: Int → Event`
  - 쌍대짝 `caseEvent :: r → (Double → r) → (Int → r) → Event → r`
- 런타임 값: `{ kind: 'record', type, fields }`, `{ kind: 'variant', type, tag, args }` (JSON 안전 → 저장·커리 노드에 그대로 사용)
- 유도 사상은 `nodes`에 저장하지 않고 `types`에서 매번 계산 (`derivedNodes(types)`), 함수 목록에 "Types" 그룹으로 표시, 읽기 전용
- 범위 제한: 재귀 타입·매개변수 있는 사용자 타입은 이후 (리스트는 내장 `List` 사용)

**1b-4. 내장 함자 `List`, `Maybe`**
- `nil`, `cons`, `nothing`, `just`, `maybe :: b → (a → b) → Maybe a → b` (Maybe = 1 + a의 쌍대짝), `index :: Int → List a → Maybe a`, `length`
- 리스트 노드 (`Lists` 라이브러리 버튼 구현): 슬롯을 `+`로 늘리는 `[ , , ]` 노드, 모든 원소를 같은 `a`로 단일화 → `List a`
- `fmap`은 1c의 Functor 클래스로 제공

**1b-5. 복사 = 대각 사상 Δ (참조 노드)** — Phase 0에서 남은 "노드 하나는 슬롯 하나" 제약 해결
- 새 노드 종류 `ref` (`target: id`): 원본과 같은 값·타입 (타입 패스·평가기에서 같은 memo 항목 공유)
- 만들기: 인스펙터 "Use again" 버튼, 본체의 매개변수 노드는 클릭 한 번으로 참조 생성
- 원본 삭제 시 참조도 함께 정리, 캔버스에 원본과 가는 점선으로 연결 표시

**1b-6. `String`** — `Text` 라이브러리 노드, `show :: Show a ⇒ a → String`, `String`은 1c에서 Monoid (자유 모노이드)

---

### Phase 1c: 카테고리 안의 대수 — 게임 오브젝트

**1c-1. 클래스** (`src/categoryClasses.js`)

| 클래스 | 연산 | 법칙 | 인스턴스 |
|---|---|---|---|
| Semigroup | `(<>)` | 결합 | 아래 Monoid 전부 |
| Monoid | `mempty` | 항등 | `List a`, `String`, `End a`, `Sum a`(AddMonoid a ⇒), `Product a`(MulMonoid a ⇒), `Maybe a`(Semigroup a ⇒), 유도된 곱 |
| Lattice | `leq`, `join`, `meet` | thin 카테고리 + 곱/쌍대곱: 흡수·멱등·교환·결합, `leq`와 일치 | `Bool`(∨, ∧, ⇒), 숫자 타입(max, min, ≤), 유도된 곱(점별 → 부분 순서) |
| VectorSpace | `scale :: Double → v → v` | 분배·결합·`scale 1 = id` | `Double`, `Float`, 유도된 곱 |
| Functor (`* → *`) | `fmap` | `fmap id = id`, `fmap (g∘f) = fmap g ∘ fmap f` | `List`, `Maybe` |
| Foldable (`* → *`) | `foldMap :: Monoid m ⇒ (a → m) → t a → m` | `List`의 foldMap = 자유 모노이드의 보편 준동형 | `List`, `Maybe` |

- `Sum`/`Product` 뉴타입: 같은 대상에 모노이드 구조가 여럿일 때 **구조를 고르는** 장치 (모노이드 대상 = 대상 + 구조)
- `End a`: `endo :: (a → a) → End a`, `appEndo :: End a → a → a` — 런타임의 `<>`/`mempty`는 보호 기초 함수 `compose`/`identity`를 그대로 호출

**1c-2. 곱에 대한 인스턴스 유도 규칙 (Lawvere 이론)**
- 등식만으로 정의되는 클래스는 곱으로 올라간다 → 모든 필드가 C이면 레코드도 C (점별)
  - 올라가는 것: Add*/Mul* 사슬, Semiring, Ring, Semigroup, Monoid, Lattice, VectorSpace, Eq, Show
  - 올라가지 않는 것: Field(0이 아닌 원소만 역원 — 등식이 아님), Ord(전순서), OrderedRing, EuclideanRing, OrderedField, Transcendental, IEEEFloat
- 합 타입: Eq, Show만 유도
- 인스펙터 타입 카드 예: "Wallet: AddAbelianGroup ✓ VectorSpace ✓ Lattice ✓ · Ord ✗ (곱의 순서는 부분 순서 — `leq` 사용)"

**1c-3. 게임 오브젝트 구성** (엔진에 하드코딩하지 않고 1b 타입 선언 + 템플릿으로 제공)

| 오브젝트 | 선언 | 카테고리 구조 | 얻는 것 |
|---|---|---|---|
| 지갑 | `Wallet = { clicks :: Double, gems :: Double }` | 곱 → 점별 AddAbelianGroup·VectorSpace·Lattice | 구매 = `w - cost`, 구매 가능 = `leq cost w` (thin 카테고리에서 사상이 있는가), 가격 상승 = `scale 1.15` |
| 보유 건물 | `Owned = { cursor :: Natural, grandma :: Natural }` | ℕ의 곱 → 점별 AddCommutativeMonoid | 음수 보유 불가가 타입으로 보장 |
| 생산 | `produce :: Owned → Wallet` | 모노이드 준동형 (법칙 검사) | 건물별 기여를 따로 계산·표시 |
| 업그레이드 효과 | `Modifier = { bonus :: Sum Double, mult :: Product Double }` | 모노이드 대상의 곱 | 적용 순서 무관 |
| 보유 업그레이드 → 효과 | `foldMap effect :: List Upgrade → Modifier` | 자유 모노이드의 보편 준동형 | 업그레이드 해제 = 목록에서 빼고 다시 계산 → 역원(Group) 불필요 |
| 이벤트 | `Event = Click \| Tick Double \| Buy Int` | 쌍대곱 | `handle = caseEvent onClick onTick onBuy :: Event → End Model` |
| 이벤트 기록 | `List Event` | 자유 모노이드 | 재생 `foldMap handle`이 유일한 준동형 → 기록 이어붙이기 = 재생 합성 (저장 = 스냅샷 + 기록이 건전) |
| 시간 | `tick :: Sum Double → End Model` | 모노이드 작용 (함자 B(ℝ≥0, +) → 𝒞) | 법칙 통과 시 방치 보상을 한 번에 계산 |
| 업적 | `Achieved = { firstClick :: Bool, … }` | Bool의 곱 → 점별 Lattice | 상태 갱신이 업적에 대해 팽창적(x ≤ f x)인지 검사 → 업적은 되돌릴 수 없음 |
| 전체 상태 | `Model ≅ Run × Meta` | 곱 | 프레스티지 = `id_Meta × const mempty_Run` |

**1c-4. 법칙 검사기** (`src/laws.js`, 평가기 기반)
- 타입 구조에서 표본 생성기 유도: 곱 = 필드별, 합 = 변형 선택, 숫자·Bool 표본, `List` = 짧은 목록 (1차 타입만)
- 값 비교: 구조적 동등 + 부동소수 허용오차, `End`는 표본 상태에 적용해 외연적으로 비교
- 클래스 법칙 (위 표) + 사용자가 함수에 다는 법칙: "모노이드 준동형", "모노이드 작용", "팽창적"
- 위반 시 반례를 인스펙터에 표시. Phase 2 런타임은 통과한 법칙만 활용

### 구현 순서와 검증 지점
1. 1b-1 종류·`app` → 테스트: 단일화·출력·종류 검사
2. 1b-2 classEnv 이동 (동작 변경 없음 — 기존 39개 테스트 그대로 통과) → 문맥 있는 인스턴스
3. 1b-5 참조 노드 (지금 가장 불편한 제약)
4. 1b-3 타입 선언 + 직렬화 v2 → 테스트: 사영·주입·쌍대짝 평가, 렌즈 법칙, v1 마이그레이션
5. 1b-4 `List`/`Maybe`, 1b-6 `String`
6. 1c-1·1c-2 클래스와 유도 → 테스트: 클래스 법칙, 유도 규칙(Field는 안 올라감 등)
7. 1c-4 법칙 검사기 → 1c-3 템플릿 타입으로 시나리오 테스트 (클릭·구매·틱·재생)

각 단계마다 브라우저로 실제 조작을 확인하고 단계별로 커밋한다.

### Phase 2 연결 (미리보기)
게임 = (`Model`, 초기 상태 `1 → Model`, `handle : Event → End Model`, `view : Model → Widgets`). 런타임은 이벤트를 `handle`로 보내 `End Model`을 합성하는 모노이드 작용 실행기.

### 결정 (2026-10-08, "최대한 하스켈 참고")
- ① 재편 진행 (GHC base의 모듈 분리 참고), CLAUDE.md 아키텍처 목록 갱신
- ② ℕ 필드 레코드 (`Bag`은 base에 없음)
- ③ 자동 유도 대신 타입별 **`deriving` 절**: stock `Eq`/`Ord`(사전순)/`Show`, `Semigroup`/`Monoid`는 `deriving via Generically`(곱 전용), 숫자·`VectorSpace`·`Lattice`는 generic default(DeriveAnyClass) 방식 — 단 Lawvere 규칙으로 유도 가능 여부 검사
- ④ `foldMap` 재계산 (base에 `Group` 없음)
- 이름: `Endo`/`appEndo`, `[a]`/`[]`/`(:)`/`(!?)`, 쌍대짝 = `caseT` (`maybe`/`either`/`bool`과 같은 모양이지만, 소문자 타입명은 `wallet :: Wallet` 같은 필드 이름과 충돌해서 `case` 접두사 사용), `String = [Char]`, 생성자 = 타입명, 갱신 = lens식 `set f`/`over f`, 격자 = lattices 패키지 `PartialOrd(leq)`·`(\/)`·`(/\)`, 벡터 = vector-space 패키지 `(*^)`, 단위 타입 `()`

### 진행 기록
- 1b-1·1b-2 완료 (`f3c9625`), 1b-5 참조 노드 완료 (`34edc77`)
- 1b-3 타입 선언 완료: 하스켈 문법 입력, 생성자·사영·`set`/`over`·`caseT`, 재귀 타입은 재귀자 `foldT` (CLAUDE.md 새 규칙 "타입 시스템은 inductive structure"), stock deriving Eq/Ord/Show, 저장 형식 v2
- 1b-4·1b-6 완료 (`b47d787`): [a]/Maybe/Char/String, Prelude 함수, 지연 리스트
- 1c-1·1c-2 완료 (`6d75210`): 카테고리 클래스, 점별 구조(Lawvere 규칙), deriving stock/anyclass/via Generically/newtype. 런타임: 숫자는 곱을 따라 대각선 broadcast, mempty는 형식적 항등원
- 1c-3·1c-4 완료 (`411920d`): 법칙 검사기(클래스 법칙 + 준동형·작용·팽창), 클릭 카운터 전 과정 시나리오 테스트(플레이·재생·작용 법칙·타입 추론)
- UX 변경: 함수 클릭 = 선택, 더블클릭/Open body = 본체 진입
- Phase 2 완료: gloss `play` 모양의 `program`, `Widget e`, runtime.js(메시지·고정 틱·로그·저장·방치 보상: 작용 법칙 통과 시 1회 호출), Play 패널, 클릭 카운터 예제(Example 버튼), `showFFloat`
- Phase 3 완료: 슬롯 식 펼치기/접기(연결선, 트리 자동 배치), 하스켈 정의 보기(haskellPrint.js), 게임 로그 되감기(시간 여행), 인스펙터 정리
- Phase 4 완료: 독립 HTML 내보내기(번들러 + player.js), 템플릿 선택(클릭 카운터·빈 게임), showCompact, 하스켈 값 파서로 모델 직접 편집, show가 Bool을 True/False로
- 남은 아이디어: 위젯 미리보기 편집, 매개변수 있는 사용자 타입, 런타임 숫자 타입 구분
- CLAUDE.md 새 규칙: "함수 구조는 람다 대수" — 커링·부분 적용·클로저·지연 β-축약·참조(=let 공유)로 이미 부합

### (이전) 결정 필요
① 파일 재편 (`classEnv.js`·`categoryClasses.js`·`typeDecls.js`·`laws.js` 신설) — CLAUDE.md 아키텍처 목록 갱신 포함
② 보유 건물: ℕ 레코드 (추천, 단순) vs 자유 가환 모노이드 함자 `Bag a`
③ 레코드에 `Ord` 유도 안 함 (추천, `leq` 사용) vs 하스켈식 사전순 `Ord`
④ 업그레이드 해제는 `foldMap` 재계산 (추천, Group 불필요) vs `Modifier`에 Group 구조

---

## Phase 0: 실행기 기반 보강 ✅ 완료
1. `src/evaluator.js`: mounted/output.source 재귀 평가, 부분 적용 클로저, 기초 함수 동작 불변
2. 진입점 지정 (`Run graph`의 `add` 하드코딩 제거)
3. 노드 삭제, Undo/Redo, Reset 정리
4. `src/project.js`: JSON 저장/불러오기, localStorage 자동 저장

## Phase 2: 게임 런타임 (`src/runtime.js`) ✅ 완료
상태 저장소, 이벤트 바인딩(Click/Tick/Buy), rAF 고정 틱 루프, 일시정지/스텝/배속, 평가 노드 하이라이트

## Phase 3: 게임 툴 UI
Edit/Play 토글, 위젯 편집기(Button/Label/ProgressBar/Shop), 업그레이드 데이터 테이블(`List Upgrade`), 디버그 인스펙터

## Phase 4: 템플릿·내보내기 ✅ 완료
"Click Counter" 예제 프로젝트(커스텀 함수로), 가격 공식·큰 수 표기·오프라인 수익 템플릿, Integer→BigInt, 독립 HTML 내보내기

## 완료 기준 (MVP)
1. 클릭 → `clicks += perClick`
2. 구매: `clicks ≥ cost`면 차감, `perClick += 1`, 가격 ×1.15
3. 자동 클릭: Tick마다 `clicks += autoRate × Δt`
4. 저장/새로고침 유지, 독립 HTML 실행
5. 잘못된 연결은 연결 시점에 거부

---

## Phase 5: 게임 전체를 그래프에서 제어 (2026-10-08 점검 결과)

### 점검 방법과 결과
템플릿·JSON 없이 **UI 조작만으로** 게임 하나(타입 2개 + 함수 5개)를 브라우저 자동화로 만들어 봄.
- 처음엔 실패 → 원인은 앱 버그 2개 (고침, 미커밋):
  1. 새 노드가 같은 자리에 겹쳐 생성됨 — 본체를 확대해 보고 있으면 화면 안 빈자리 후보가 없어 화면 중앙으로 되돌아감 → 화면 밖까지 넓혀 겹치지 않는 자리를 찾고 화면을 맞춤
  2. 새 커스텀 함수가 항상 (300, 190) — 기초 함수 `add` 위 — 에 생성됨 → 빈 자리에 생성
- 고친 뒤: 타입 선언 → initial/handle/step/view/main 작성 → `main :: Program Model Msg` → 진입점 지정 → 실행 → `+1` 3번 → `Count: 3` ✅ (콘솔 오류 없음)
- 즉 **게임 로직은 그래프로 만들 수 있지만, "전부 그래프로 제어"는 아님.** 그래프 밖에 남은 것:

| 그래프 밖에 있는 것 | 현재 | 
|---|---|
| 타입 선언 | 하스켈 텍스트 대화상자 (노드 아님) |
| 틱 간격 0.1초, 방치 보상 상한 7일, 되감기 500개 | 코드에 하드코딩 |
| 입력 | 버튼 메시지 + 시간만 (키보드·타이머·난수 없음) |
| 저장·리셋·방치 보상 정책 | Play 패널 버튼 / 고정 |
| 법칙 주장 | 인스펙터에서만 |
| 화면 | 위젯 5종, 스타일·그림 없음 |
| 함수 시그니처 변경 | 정의 노드 `+`/`−`가 본체 매개변수와 불일치 (버그) |
| 검색 | 검색창이 장식뿐 (버그) |
| 익명 함수(λ) | 별도 커스텀 함수나 빈 슬롯(부분 적용)으로만 |

### 계획 (하스켈·카테고리 이론·람다 대수 규칙 기준)

**P1 — 그래프 편집 결함과 핵심 공백**
- 5-1 시그니처 편집 동기화: 정의 노드 `+`/`−`/이름 변경이 본체 매개변수 노드와 기존 호출 노드에 함께 반영
- 5-2 검색: 함수·타입 유도 함수·Prelude·노드 검색, Enter로 현재 그래프에 추가
- 5-3 설정을 값으로 (gloss `play`는 fps를 인자로 받음): `Game m e = Game { initial, view, update, step, stepsPerSecond, maxOffline }` 레코드를 내장 타입으로 → 설정을 `set stepsPerSecond 30` 같은 그래프 노드로 조작, `program`은 이 레코드를 받음 (기존 `program` 유지·호환)
- 5-4 입력을 메시지로 (Elm subscriptions): `subscriptions :: m → Sub e`, `Sub e`는 모노이드(`<>` = batch)이자 함자(`fmap`); `onKey :: (Key → Maybe e) → Sub e`, `every :: Double → e → Sub e`
- 5-5 λ 노드 (람다 대수의 추상화): 노드 안에 작은 본체를 가진 익명 함수, 캔버스에서 바로 펼쳐 편집; haskellPrint는 `\x -> …`로 출력

**P2 — 표현력**
- 5-6 타입 선언을 노드로: 곱 노드(필드 행), 합 노드(생성자 행), 필드 타입은 타입 수준 슬롯(`Maybe` 슬롯에 `Int` 꽂기, 종류 검사) — 텍스트 대화상자는 같은 선언의 다른 보기로 유지(양방향)
- 5-7 튜플 `(a, b)` (카테고리의 곱: `fst`, `snd`, `(,)`) + 순수 난수 (`mkStdGen`, `randomR :: (Double, Double) → StdGen → (Double, StdGen)` — 하스켈 random 방식, 모델에 생성기 보관)
- 5-8 법칙 노드: 함수 옆에 붙이는 주장 노드(준동형/작용/팽창), 캔버스에 ✓/✗ 표시
- 5-9 화면 확장: `Color`, `styled`, `spacer`, gloss식 `Picture`(모노이드: `<>` = 겹치기) 그리기 위젯

**P3 — 다듬기**
- 5-10 경로 표시 구분(최상위 `main` vs 함수 `main`), 리스트 노드 기본 빈칸, "슬롯에 넣어도 펼쳐 두기" 설정, 복사/붙여넣기·다중 선택, 타입 선언 변경 시 깨진 호출 노드 표시
- 5-11 이번 UI 전용 빌드 스크립트를 `e2e/`에 넣어 회귀 테스트로 (`npm run test:e2e`, 로컬 Chrome 사용)

### 결정 필요
- 진행 범위: P1만 / P1+P2 / 전부
- 5-3: 설정 레코드를 새 `play`(gloss식)로 둘지, 기존 `program`을 확장할지
- 5-6: 타입 노드를 텍스트 대화상자를 대체할지, 병행할지
