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

### 테스트

```bash
npm test
```

### 프로덕션 빌드 및 미리보기

```bash
npm run build
npm run preview
```

## 사용법

1. 왼쪽 `NODES`의 함수 목록에는 `main`에 선언된 함수가 표시됩니다. `+`로 새 함수를 만들거나 함수를 선택해 본체를 엽니다.
2. 캔버스의 노드를 드래그해 배치합니다.
3. 숫자 노드를 함수 노드의 입력 포트 또는 함수 본체의 다른 함수에 드래그해 연결합니다.
4. 함수 노드를 클릭하면 선택되어 인스펙터에 표시되고, 커스텀 함수를 더블클릭하거나 인스펙터의 `Open body →`를 누르면 함수 본체 화면으로 들어갑니다. 본체에서 노드를 `Output`에 드래그하면 반환값을 지정할 수 있습니다. 왼쪽 함수 목록의 함수를 클릭하면 현재 본체에 호출 노드로 추가됩니다.
5. 함수 카드의 `▶` 아이콘이나 오른쪽 Inspector의 `Play function`으로 실행합니다. 상단 `Run graph`(또는 `Ctrl/⌘+Enter`)는 Inspector의 `ENTRY POINT`로 지정한 함수(기본값 `add`)를 실행하고, 지정된 함수가 없으면 선택한 함수를 실행합니다.
6. 상단 `Reset` 버튼으로 그래프를 초기 상태로 되돌립니다. Reset도 실행 취소할 수 있습니다.
7. 좌측 `+` 버튼으로 함수 이름과 매개변수를 입력하면 커스텀 함수가 생성됩니다. 함수 목록에서 생성한 함수를 열고, 본체의 매개변수 노드 또는 다른 함수 호출 노드를 `Output`에 연결해 동작을 정의합니다.
8. 선택한 노드는 `Delete`/`Backspace` 키 또는 Inspector의 `Delete node`로 지웁니다. 기초 함수, 함수의 `Output`·매개변수, 아직 호출되고 있는 커스텀 함수는 지울 수 없습니다.
9. `↶`/`↷`(`Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`)로 실행 취소·다시 실행합니다. 프로젝트는 브라우저(localStorage)에 자동 저장되어 새로고침해도 유지되며, `Export`/`Import`로 JSON 파일로 내보내고 불러올 수 있습니다.
10. 좌측 `TYPES`의 `+`로 하스켈 문법 그대로 타입을 선언합니다. 예: `data Model = Model { clicks :: Double, perClick :: Double } deriving (Eq, Show)`, `data Event = Click | Tick Double | Buy Int`. 선언 하나는 곱(필드)들의 쌍대곱(생성자)이며, 다음 함수가 자동으로 만들어져 타입 아래에 표시됩니다(클릭하면 캔버스에 호출 노드 추가).
    - 생성자(주입) `Model :: Double → Double → Model`, `Tick :: Double → Event`
    - 레코드 필드의 사영 `clicks :: Model → Double`과 lens식 갱신 `set clicks :: Double → Model → Model`, `over clicks :: (Double → Double) → Model → Model`
    - 분기 함수(쌍대짝) `caseEvent :: a → (Double → a) → (Int → a) → Event → a` — `maybe`/`either`/`bool`과 같은 모양
    - `deriving`은 stock `Eq`, `Ord`(사전순), `Show`를 지원하며, GHC처럼 `Ord`는 `Eq`가 필요하고 모든 필드가 그 클래스를 가져야 합니다. 생성자 필드는 하스켈처럼 지연 평가됩니다.
11. 좌측 `PRELUDE`에는 리스트·Maybe·텍스트 함수가 하스켈 이름 그대로 있습니다: `[ , , ]`(슬롯 수만큼의 리스트, `+`로 추가), `[]`, `(:)`, `foldr`(리스트의 재귀자), `map`, `length`, `(++)`, `(!?)`, `Nothing`, `Just`, `maybe`(Maybe = 1 + a의 쌍대짝), `show`. 리스트는 하스켈처럼 지연 평가되는 유도 타입(`[] | x : xs`)이라 무한 리스트도 필요한 만큼만 계산됩니다. `String = [Char]`이며, `Text` 노드나 슬롯의 `"글자"`·`'c'` 리터럴로 만들 수 있습니다. `Eq a ⇒ Eq [a]`처럼 문맥 있는 인스턴스로 리스트·Maybe의 비교·출력이 타입 검사됩니다.
12. 카테고리 이론의 대수 구조도 하스켈 클래스 이름 그대로 있습니다(`src/categoryClasses.js`). `Semigroup`/`Monoid`(`(<>)`, `mempty`, `mconcat`) — 리스트는 자유 모노이드, `Endo a`는 합성·항등의 자기사상 모노이드, 한 대상에 구조가 여럿일 때는 `Sum`/`Product`로 고릅니다. `Functor`·`Foldable`(`fmap`, `foldMap` — 자유 모노이드에서 나가는 유일한 준동형), `PartialOrd`·`Lattice`(`leq`, `(\/)`, `(/\)` — 순서 집합은 thin 카테고리), `VectorSpace`(`(*^)`). 곱 타입은 등식만으로 정의되는 구조를 점별로 가질 수 있습니다(Lawvere 이론): `deriving anyclass (AddSemigroup, AddMonoid, AddGroup, VectorSpace, PartialOrd, Lattice …)`, `deriving (Semigroup, Monoid) via Generically T`. `Field`나 `Ord`처럼 곱에서 살아남지 않는 구조는 이유와 함께 거부됩니다. 숫자 리터럴은 곱을 따라 대각선으로 퍼지고(ℤ → R×S), `mempty`는 관찰될 때 맞는 모양(`[]`, `Nothing`, `Sum 0`, 항등 함수, 필드별 `mempty`)이 됩니다.
13. 법칙 검사(`src/laws.js`): 타입 선언을 열면 그 타입이 가진 모든 대수 인스턴스의 법칙(결합·항등·역원·교환·분배·격자·벡터 공간)을 표본으로 실제 실행해 확인한 결과가 표시됩니다. 커스텀 함수의 인스펙터 `LAWS`에서는 그 함수가 모노이드 준동형(예: 생산량 `Owned → Wallet`), 모노이드 작용(예: `tick :: Double → Model → Model` — 통과하면 방치 보상을 한 번에 계산할 수 있음), 팽창적(예: 업적은 되돌아가지 않음)인지 검사하고, 실패하면 반례를 보여 줍니다. 다형 함수는 GHC 디폴팅 규칙으로 구체 타입을 정해 검사합니다.
14. 게임 만들기(`src/runtime.js`): PRELUDE의 `Game` 그룹에 하스켈 gloss의 `play`와 같은 모양의 `program :: m → (m → Widget e) → (e → m → m) → (Double → m → m) → Program m e`와 위젯(`text`, `button 라벨 메시지`, `column`, `row`, `progress`)이 있습니다. 진입 함수(`ENTRY POINT`)가 `Program` 값이면 `Run graph`가 게임을 실행합니다: 캔버스 위 패널에 `view`가 그려지고, 버튼은 메시지를 `handle`로 보내며, 시간은 0.1초 단위로 `step`을 거칩니다. 일시정지·`+1s`·배속·게임 리셋, 현재 모델과 메시지 기록이 함께 표시됩니다. 게임 상태는 시각과 함께 저장되어, 다시 열면 지나간 시간이 적용됩니다 — `step`이 (ℝ≥0, +)의 모노이드 작용 법칙을 통과하면 한 번의 호출로, 아니면 잘게 나눠 시뮬레이션합니다. 상단 `Example`은 그래프만으로 만든 클릭 카운터 예제(`src/examples/clickCounter.js`)를 불러옵니다(실행 취소 가능).
15. 슬롯 안에 들어간 식은 칩 왼쪽 위의 `⤢`로 캔버스에 펼칠 수 있습니다(슬롯에 연결된 채로, 연결선과 함께 표시되며 그 노드의 슬롯도 편집 가능). 확대/축소 컨트롤의 `⤢`/`⤡`는 현재 그래프의 모든 식을 트리 모양(인자가 왼쪽)으로 펼치거나 다시 접습니다. 커스텀 함수를 선택하거나 함수 본체에서 Output을 선택하면 인스펙터의 `DEFINITION`에 그 함수가 하스켈 정의로 표시됩니다(`src/haskellPrint.js` — 중위 연산자와 섹션, 여러 번 쓰인 값은 `where`로 공유, 중간 슬롯이 빈 부분 적용은 람다). 게임 실행 중 메시지 기록의 항목을 누르면 그 메시지 직후의 상태로 되감깁니다(시간 여행).

## 캔버스 조작

- 빈 공간 드래그: 캔버스 이동
- 마우스 휠 또는 `−`/`+`: 확대·축소
- `⌗`: 100% 배율과 기본 위치로 복원
- 입력 포트의 텍스트: 인라인 리터럴(`3`, `-1.5`, `true`) 입력 — 그 슬롯에 리터럴 노드를 연결한 것과 같이 타입 검사되며, 맞지 않으면 빨갛게 표시되고 실행이 거부됩니다
- 입력 포트의 `−`: 매개변수 삭제
- 입력 포트 옆 `+`: 매개변수 추가

실행기(`src/evaluator.js`)는 함수 노드를 "호출 대상 함수에 채워진 슬롯(연결된 노드 또는 인라인 리터럴)을 적용한 값"으로 계산합니다. 타입 추론도 같은 의미를 쓰므로, 예를 들어 `(+)`의 `x`만 채운 노드는 값으로서 `a → a` 타입을 갖고, 모든 슬롯을 채운 `add` 노드는 `Int`를 기대하는 다른 슬롯에 그대로 연결할 수 있습니다(중첩 호출). 연결된 노드는 실행할 때마다 다시 계산되며, 평가는 지연(call-by-need) 방식이라 `select`/`ifThenElse`는 선택된 분기만 계산합니다. 따라서 기저 사례가 있는 재귀 커스텀 함수도 끝납니다. 슬롯이 남은 함수를 실행하면 부분 적용된(curried) 노드가 생기고, 이 노드는 클로저와 남은 타입(제약 포함)을 함께 저장하므로 다른 함수에 연결해 다시 실행할 수 있습니다. 기초 함수는 내부 구현이 있는 읽기 전용 함수로 제공됩니다. `zero = λf x. x`, `add = λn f x. f (n f x)`(후계자), `identity = λx. x`, `apply = λf x. f x`, `compose = λf g x. f (g x)`, `isZero = λn. n == 0`, `ifThenElse = λc a b. c ? a : b`를 제공합니다. `ifThenElse`는 `Bool` 조건에 따라 두 `Int` 값 중 하나를 반환합니다. 이 조합으로 Church 덧셈 `plus = λm n f x. m f (n f x)`를 그래프에서 구성할 수 있습니다.

타입 검증은 하스켈의 힌들리-밀너(Algorithm W) 방식을 그대로 따르는 실제 타입 추론기(`src/typeSystem.js`, `src/inferGraph.js`)가 담당합니다. `identity`, `apply`, `compose`는 콘크리트 타입이 아니라 `∀a. a → a`, `∀a b. (a → b) → a → b`, `∀a b c. (b → c) → (a → b) → a → c`로 선언된 다형 함수이며, 캔버스에 놓인 각 인스턴스는 실제로 연결된 값에 따라 독립적으로 `Int`, `Bool` 등으로 인스턴스화됩니다 — 예를 들어 `identity` 노드 하나에 숫자를 연결하면 `Int → Int`로, 다른 곳에 배치한 별도의 `identity` 콜사이트에 불리언을 연결하면 그쪽만 `Bool → Bool`로 독립적으로 표시됩니다(let-다형성). 커스텀 함수도 본체 배선에서 실제로 요구되는 만큼만 타입이 좁혀지고, 나머지는 자동으로 일반화되어 다형 함수가 됩니다. `isZero`, `ifThenElse`는 프로젝트 규칙에 따라 각각 `Int → Bool`, `Bool → Int → Int → Int`로 고정되어 있습니다. 서로 단일화(unify)할 수 없는 타입끼리는(예: `Bool` 값을 `Int` 입력 포트에) 드래그로 연결할 수 없습니다.

숫자 타입클래스 계층은 하스켈 Report의 `Num`/`Real`/`Integral`… 대신 **군론 구조**를 따릅니다(`src/numericClasses.js`). 덧셈과 곱셈을 각각의 사슬로 분리해 `AddSemigroup → AddMonoid → AddCommutativeMonoid`, `AddGroup → AddAbelianGroup`, `MulSemigroup → MulMonoid`를 두고, 이들을 합쳐 `Semiring → Ring`을 만듭니다. 그 위에 `OrderedRing → EuclideanRing`, `Field`, `OrderedField`, `Transcendental`, `IEEEFloat`가 있습니다(대략 Num→Ring, Real→OrderedRing, Integral→EuclideanRing, Fractional→Field, Floating→Transcendental, RealFrac→OrderedField, RealFloat→IEEEFloat). `Eq`/`Ord`/`Show`는 군론 계층 밖의 보조 클래스입니다. 구체 타입은 `Int`, `Integer`(유클리드 환), `Word`(ℤ/2⁶⁴ — 환이지만 덧셈과 순서가 호환되지 않아 순서환이 아님), `Natural`(ℕ — 덧셈 역원이 없는 반환), `Rational`(순서체), `Float`, `Double`(IEEE)입니다. 숫자 리터럴은 텍스트가 요구하는 최소 구조만 가집니다: `5`는 `Semiring a ⇒ a`, `-5`는 `Ring a ⇒ a`, `1.5`는 `Field a ⇒ a`. 인스펙터의 `ANNOTATE TYPE`에서는 그 구조를 가진 타입만 고를 수 있고(예: `-5`에는 `Natural`이 나오지 않음), 아무 데도 연결되지 않은 값에는 `DEFAULT` 줄에 디폴팅 결과(`Integer`, 안 되면 `Double`)가 표시됩니다. 각 기초 함수는 실제로 필요한 가장 약한 구조만 요구합니다: `(+)`는 `AddSemigroup`, `negate`/`(-)`는 `AddGroup`, `(*)`는 `MulSemigroup`, `addZero`/`mulOne`은 두 모노이드 항등원, `(/)`는 `Field`, `sqrt`는 `Transcendental`, `toRational`은 `OrderedRing`, `fromIntegral`은 `EuclideanRing → Ring`, `round`는 `OrderedField → EuclideanRing`, `isNaN`은 `IEEEFloat`, `(>=)`/`(==)`는 `Ord`/`Eq`입니다. `select :: Bool → a → a → a`는 `Int`로 고정된 `ifThenElse`의 다형 버전입니다. 구조가 없는 타입은 연결이 거부됩니다(예: `Natural`을 `negate`에, `Rational`을 `sqrt`에, 함수값을 `(+)`에). 리터럴을 `(+)`와 `sqrt`에 함께 연결하면 `Semiring`과 `Transcendental` 제약이 모이고, `Transcendental`이 `Semiring`을 함의하므로 중복 제약은 자동으로 사라집니다(context reduction). 각 타입이 선언한 클래스의 법칙(결합·항등·역원·교환·분배·순서 호환 등)은 `npm test`로 검증합니다.

## 프로젝트 구조

- `src/main.js`: 앱 화면, 그래프 상태, 캔버스 상호작용 및 실행 로직
- `src/typeSystem.js`: 힌들리-밀너 타입 엔진 (타입 변수·단일화·치환·일반화/인스턴스화·프리티 프린터)
- `src/builtinSchemes.js`: 기초 함수들의 타입 스킴 테이블(다형 함수, 군론 숫자 계층 함수, 비교·`select` 포함)
- `src/numericClasses.js`: 군론 기반 숫자 타입클래스 계층과 인스턴스 선언
- `test/`: `npm test`(Node 내장 테스트 러너) — 타입클래스 법칙·제약 해소·그래프 추론 테스트
- `src/inferGraph.js`: 캔버스 그래프의 연결(`mounted`/`output.source`)과 인라인 리터럴을 단일화 제약으로 읽어 타입(과 남은 클래스 제약)을 추론하는 패스
- `src/evaluator.js`: 같은 그래프를 지연 평가하는 실행기(클로저·부분 적용·재귀)
- `src/literals.js`: 슬롯 인라인 리터럴 파서(타입 패스와 실행기가 공유)
- `src/categoryClasses.js`: Semigroup/Monoid/PartialOrd/Lattice/VectorSpace/Functor/Foldable 선언과 인스턴스, 곱으로 올라가는 클래스 목록
- `src/dataTypes.js`: 내장 유도 타입(`[a]`, `Maybe a`, `Char`, `()`)의 인스턴스와 런타임 표현
- `src/typeDecls.js`: 하스켈 `data`/`newtype` 선언 파서·검사기와, 선언에서 유도되는 생성자·사영·갱신·분기 함수와 `deriving` 인스턴스
- `src/classEnv.js`: 클래스 환경과 제약 해소기(문맥 있는 인스턴스, entailment, context reduction, 디폴팅)
- `src/prelude.js`: 모든 클래스·인스턴스 선언을 불러오고 해소기를 다시 내보내는 진입점(하스켈 Prelude처럼)
- `src/laws.js`: 클래스 법칙과 함수 법칙(준동형·작용·팽창)을 표본으로 검사하는 법칙 검사기
- `src/runtime.js`: `Program` 값을 실행하는 게임 런타임(메시지·시간·방치 보상·되감기)
- `src/haskellPrint.js`: 함수 본체 그래프를 하스켈 정의로 출력하는 프린터
- `src/examples/clickCounter.js`: 그래프로 만든 클릭 카운터 예제 프로젝트
- `src/project.js`: 프로젝트 직렬화·불러오기 검증·기초 함수 병합·실행 취소 기록
- `src/style.css`: 레이아웃과 반응형 스타일
- `index.html`: 앱 진입 HTML
- `dist/`: `npm run build`로 생성되는 배포 산출물
