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
npm test          # 단위 테스트
npm run test:e2e  # UI만으로 게임을 만들어 보는 브라우저 테스트(로컬 Chrome 필요, CHROME=경로로 지정 가능)
```

### 프로덕션 빌드 및 미리보기

```bash
npm run build
npm run preview
```

## 사용법

1. 왼쪽 `NODES`에는 프로젝트의 함수가 표시됩니다. 새 프로젝트는 `START · main`의 빈 본체에서 시작합니다. `+`로 새 함수를 만들거나, 최상위 화면의 함수 목록에서 함수를 선택해 본체를 엽니다.
2. 캔버스의 노드를 드래그해 배치합니다.
3. 숫자 노드를 함수 노드의 입력 포트 또는 함수 본체의 다른 함수에 드래그해 연결합니다.
4. 함수 노드를 클릭하면 선택되어 인스펙터에 표시되고, 커스텀 함수를 더블클릭하거나 인스펙터의 `Open body →`를 누르면 함수 본체 화면으로 들어갑니다. 본체에서 노드를 `Output`에 드래그하면 반환값을 지정할 수 있습니다. 왼쪽 함수 목록의 함수를 클릭하면 현재 본체에 호출 노드로 추가됩니다.
5. 함수 카드의 `▶` 아이콘이나 오른쪽 Inspector의 `Play function`은 선택한 함수만 개별 테스트합니다. 상단 `Run graph`(또는 `Ctrl/⌘+Enter`)는 새 프로젝트의 `main` 전체를 실행합니다. 기존 프로젝트는 저장된 `ENTRY POINT`를 사용하며, 진입점이 없으면 기존처럼 선택한 함수를 실행합니다. 함수 본체 안에서도 `Run graph`는 전체 실행, 각 노드의 `Play function`은 개별 테스트입니다.
6. 상단 `Reset`은 현재 함수만이 아니라 **프로젝트 전체**를 초기화하고 빈 기본 `main`을 엽니다. 실행 취소할 수 있습니다. Output의 `Disconnect`, 유도 정의의 Reset, 플레이어의 `Reset game`은 각각 기존의 연결·정의·게임 상태만 바꿉니다.
7. 좌측 `+` 버튼으로 함수 이름과 매개변수를 입력하면 커스텀 함수가 생성됩니다. 함수 목록에서 생성한 함수를 열고, 본체의 매개변수 노드 또는 다른 함수 호출 노드를 `Output`에 연결해 동작을 정의합니다.
8. 선택한 노드는 `Delete`/`Backspace` 키 또는 Inspector의 `Delete node`로 지웁니다. 기초 함수, 함수의 `Output`·매개변수, 아직 호출되고 있는 커스텀 함수는 지울 수 없습니다.
9. `↶`/`↷`(`Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`)로 실행 취소·다시 실행합니다. 프로젝트는 브라우저(localStorage)에 자동 저장되어 새로고침해도 유지되며, `Export`/`Import`로 JSON 파일로 내보내고 불러올 수 있습니다.
10. 좌측 `TYPES`의 `+`로 타입을 만들면 **타입 편집기**가 열립니다. 타입은 그것을 이루는 생성자 함수들로 표시됩니다: 생성자마다 함수 블록이 있고, 필드는 블록 안에 `이름 :: 타입`으로 적습니다(모두 이름을 붙이면 레코드). 필드·생성자 추가/삭제, `data`/`newtype`, `deriving`(stock · 점별 anyclass · via Generically · newtype)을 고르면 생성자 시그니처와 유도 함수가 바로 갱신되고, 유효한 편집은 즉시 적용됩니다(실행 취소 가능). 다음 함수가 만들어져 타입 아래에 표시됩니다(클릭하면 캔버스에 호출 노드 추가).
    - 생성자(주입) `Model :: Double → Double → Model`, `Tick :: Double → Event`
    - 레코드 필드의 사영 `clicks :: Model → Double`과 lens식 갱신 `set clicks :: Double → Model → Model`, `over clicks :: (Double → Double) → Model → Model`
    - 분기 함수(쌍대짝) `caseEvent :: a → (Double → a) → (Int → a) → Event → a` — `maybe`/`either`/`bool`과 같은 모양
    - `deriving`은 stock `Eq`, `Ord`(사전순), `Show`를 지원하며, GHC처럼 `Ord`는 `Eq`가 필요하고 모든 필드가 그 클래스를 가져야 합니다. 생성자 필드는 하스켈처럼 지연 평가됩니다.
11. 좌측 `PRELUDE`에는 리스트·Maybe·텍스트 함수가 하스켈 이름 그대로 있습니다: `[ , , ]`(슬롯 수만큼의 리스트, `+`로 추가), `[]`, `(:)`, `foldr`(리스트의 재귀자), `map`, `length`, `(++)`, `(!?)`, `Nothing`, `Just`, `maybe`(Maybe = 1 + a의 쌍대짝), `show`. 리스트는 하스켈처럼 지연 평가되는 유도 타입(`[] | x : xs`)이라 무한 리스트도 필요한 만큼만 계산됩니다. `String = [Char]`이며, `Text` 노드나 슬롯의 `"글자"`·`'c'` 리터럴로 만들 수 있습니다. `Eq a ⇒ Eq [a]`처럼 문맥 있는 인스턴스로 리스트·Maybe의 비교·출력이 타입 검사됩니다.
12. 카테고리 이론의 대수 구조도 하스켈 클래스 이름 그대로 있습니다(`src/categoryClasses.js`). `Semigroup`/`Monoid`(`(<>)`, `mempty`) — 리스트는 자유 모노이드입니다. 한 대상에 구조가 여럿인 `Double`(+와 *)은 `Monoid`가 아니며, 필요하면 `newtype`을 선언해 고릅니다. `Functor`·`Foldable`(`fmap`, `foldMap` — 자유 모노이드에서 나가는 유일한 준동형), `PartialOrd`·`Lattice`(`leq`, `(\/)`, `(/\)` — 순서 집합은 thin 카테고리), `VectorSpace`(`(*^)`). 곱 타입은 등식만으로 정의되는 구조를 점별로 가질 수 있습니다(Lawvere 이론): `deriving anyclass (AddSemigroup, AddMonoid, AddGroup, VectorSpace, PartialOrd, Lattice …)`, `deriving (Semigroup, Monoid) via Generically T`. `Field`나 `Ord`처럼 곱에서 살아남지 않는 구조는 이유와 함께 거부됩니다. 숫자 리터럴은 곱을 따라 대각선으로 퍼지고(ℤ → R×S), `mempty`는 관찰될 때 맞는 모양(`[]`, `Nothing`, 필드별 `mempty`)이 됩니다.
13. 법칙 검사(`src/laws.js`): 타입 선언을 열면 그 타입이 가진 모든 대수 인스턴스의 법칙(결합·항등·역원·교환·분배·격자·벡터 공간)을 표본으로 실제 실행해 확인한 결과가 표시됩니다. 커스텀 함수의 인스펙터 `LAWS`에서는 그 함수가 모노이드 준동형(예: 생산량 `Owned → Wallet`), 모노이드 작용(예: `tick :: Double → Model → Model` — 통과하면 방치 보상을 한 번에 계산할 수 있음), 팽창적(예: 업적은 되돌아가지 않음)인지 검사하고, 실패하면 반례를 보여 줍니다. 다형 함수는 GHC 디폴팅 규칙으로 구체 타입을 정해 검사합니다.
14. 게임 만들기(`src/runtime.js`): PRELUDE의 `Game` 그룹에 하스켈 gloss의 `play`와 같은 모양의 `program :: m → (m → Widget e) → (e → m → m) → (Double → m → m) → Program m e`와 위젯(`text`, `button 라벨 메시지`, `column`, `row`, `progress`)이 있습니다. 진입 함수(`ENTRY POINT`)가 `Program` 값이면 `Run graph`가 게임을 실행합니다: 캔버스 위 패널에 `view`가 그려지고, 버튼은 메시지를 `handle`로 보내며, 시간은 0.1초 단위로 `step`을 거칩니다. 일시정지·`+1s`·배속·게임 리셋, 현재 모델과 메시지 기록이 함께 표시됩니다. 게임 상태는 시각과 함께 저장되어, 다시 열면 지나간 시간이 적용됩니다 — `step`이 (ℝ≥0, +)의 모노이드 작용 법칙을 통과하면 한 번의 호출로, 아니면 잘게 나눠 시뮬레이션합니다. 상단 `Templates…`에서 그래프만으로 만든 클릭 카운터 예제(모델의 수는 모두 `Int` — `step`이 받는 `Double` 시간은 `round`로 밀리초가 되어 경과 시간에 쌓이고 지난 정수 초마다 `rate`만큼 벌며, `progress`·`showCompact`에는 `fromIntegral`로 건넵니다)나 가장 작은 빈 게임을 불러와 시작할 수 있습니다(실행 취소 가능).
15. 슬롯 안에 들어간 식은 칩 왼쪽 위의 `⤢`로 캔버스에 펼칠 수 있습니다(슬롯에 연결된 채로, 연결선과 함께 표시되며 그 노드의 슬롯도 편집 가능). 확대/축소 컨트롤의 `⤢`/`⤡`는 현재 그래프의 모든 식을 트리 모양(인자가 왼쪽)으로 펼치거나 다시 접습니다. 커스텀 함수를 선택하거나 함수 본체에서 Output을 선택하면 인스펙터의 `DEFINITION`에 그 함수가 하스켈 정의로 표시됩니다(`src/haskellPrint.js` — 중위 연산자와 섹션, 여러 번 쓰인 값은 `where`로 공유, 중간 슬롯이 빈 부분 적용은 람다). 게임 실행 중 메시지 기록의 항목을 누르면 그 메시지 직후의 상태로 되감깁니다(시간 여행).
16. 상단 `⬇ Game`은 진입 함수의 게임을 **HTML 파일 하나**로 내보냅니다(`src/exportHtml.js`, `src/player.js`). 편집기 없이 어느 브라우저에서나 열어 플레이할 수 있고, 게임 상태 저장과 방치 보상도 그대로 동작합니다. 게임 실행 중 MODEL의 `Edit`으로 모델을 하스켈 문법(`show`가 출력하는 그대로, 예: `Model {wallet = Wallet {clicks = 1500}, perClick = 1, rate = 0}`)으로 직접 고칠 수 있으며, 모델 타입에 맞는지 검사하고 틀린 위치를 알려 줍니다(`src/valueParser.js`). 큰 수는 `showCompact`(`1.2K`, `3.4M` …)로 표시할 수 있습니다.
17. 프로그램 설정과 입력도 그래프로 정합니다. `program`의 설정은 레코드 갱신처럼 `set stepsPerSecond 20 (program …)`, `set maxOffline 3600 …`으로 바꿉니다. 바깥 입력은 Elm의 구독처럼 `set subscriptions subs …`로 연결하며, `subs :: Model → Sub Msg`는 `every 1 Tick`(타이머)과 `onKey (\k -> …)`(키보드)를 `<>`로 합칩니다(`Sub`는 모노이드이자 함자). 클릭 카운터 템플릿에서는 Space로도 클릭됩니다.
18. **λ 노드**(사이드바 `Lambda`): 이름 없는 함수를 그 자리에서 만들고, 더블클릭으로 본체를 편집합니다(경로에 `ƒ 함수 / ƒ λ`로 표시, Back으로 복귀). 람다 리프팅으로 구현되어 있어, λ의 슬롯에 바깥 값을 꽂으면 그 값을 포획하고 비워 둔 슬롯이 λ의 매개변수가 됩니다. 하스켈로는 `(\c x -> x + c) c`처럼 출력됩니다.
19. 함수 정의 노드의 `+`/`−`와 인스펙터의 매개변수 이름 칸은 함수의 **시그니처**를 바꾸며, 본체의 매개변수 노드와 모든 호출 노드에 함께 반영됩니다. 이름이 바뀌거나 슬롯 수가 맞지 않게 된 호출 노드는 빨간 테두리로 표시되고, 인스펙터에서 슬롯을 맞출 수 있습니다.
20. **정의는 그래프다.** 인스펙터의 `DEFINITION` 텍스트는 그래프를 그대로 읽은 것입니다(`src/haskellPrint.js`). 토큰에 마우스를 올리면 캔버스의 해당 노드(슬롯에 접혀 있으면 그 슬롯)가 강조되고, 클릭하면 그 노드로 이동합니다(필요하면 본체를 엽니다). 함수 본체 안에서는 무엇을 선택하든 그 본체의 정의가 함께 보이고, 선택한 노드의 토큰이 표시됩니다. 커스텀 함수의 매개변수는 인스펙터의 `↑`로 순서를 바꿀 수 있습니다(본체·정의·모든 호출이 따라감).
    - 기초·Prelude·타입에서 유도된 함수는 호출 노드를 더블클릭하거나 `Open definition →`으로 **정의 그래프**를 엽니다(`src/definitionViews.js`, 읽기 전용 — 노드를 옮겨 볼 수만 있음). 더 기본적인 함수로 쓸 수 있는 것은 실제 정의가 그려집니다: `map`·`length`·`(++)`·`(!?)`은 `foldr`로, `(&&)`·`(||)`·`not`은 Bool의 분기 함수 `select`로, 필드 사영·갱신은 `caseT`로, 재귀자 `foldT`는 `caseT`와 재귀로, `red = rgb 1 0 0`, 리스트 리터럴 `[x1, x2, x3] = x1 : x2 : x3 : []`(호출의 슬롯 수만큼), 숫자 형변환은 클래스 메서드로. Prelude 타입(`src/library.js`가 하스켈로 선언한 Maybe, Color, Picture, Widget, Sub, Program — 사이드바 PRELUDE 아래에 생성자·분기 함수가 있음)의 함수는 그 생성자·분기 함수로 씁니다: `text s = Text s`, `maybe d f m = caseMaybe d f m`, `program i v h s = Program i v h s 10 604800 (\model -> mempty)`, `set stepsPerSecond`는 `caseProgram`으로. 나머지는 생성자·분기 함수·클래스 메서드·런타임 원시 함수임을 밝힌 원시 노드로 그려집니다.
    - 그래프로 정의된 **Prelude 함수는 넘겨받아 고칠 수 있습니다.** 정의 그래프의 Output에서 `Edit definition`을 누르면 그 그래프가 같은 id의 내 함수가 되어, 그 함수를 부르는 모든 곳이 내장 구현 대신 이 그래프를 실행합니다(경로에 `· taken over`, 사이드바에 `✎`). 타입은 Prelude의 것 그대로입니다 — 본체의 매개변수와 Output에 Prelude 타입이 고정되어, 본체가 그 타입을 벗어나면 표시되므로 부르는 쪽이 깨지지 않습니다. `↺ Back to the Prelude's definition`으로 돌아갑니다(실행 취소 가능). 런타임 원시 함수(`foldr`, `showFFloat`, `randomR` …)도 같은 방식으로 넘겨받으며, 본체는 원시 함수 자신(`showFFloat digits x = showFFloat# digits x`)에서 시작해 감싸거나 바꿀 수 있습니다. 클래스 메서드(`show`, `(<>)`, `fmap` …)는 함수 단위가 아니라 타입마다 인스턴스로 고치고, `fromInteger`/`fromRational`은 대상 타입의 `Ring`이 정하는 유일한 사상이라 고칠 것이 없습니다. CLAUDE.md가 보호하는 기초 함수는 넘겨받을 수 없습니다. `Just`/`Nothing`과 곱 타입 `(a, b)`의 `(,)`·`fst`·`snd`도 선언된 타입(`data (a, b) = (,) a b`, 제거자 `uncurry`)의 생성자와 제거자로 쓴 그래프입니다.
    - **Prelude 타입도 고칠 수 있습니다.** PRELUDE의 타입(`Maybe`, `Color`, `Picture`, `Widget`, `Sub`, `Program`, `(a, b)`)의 생성자와 제거자는 `✎`로 타입에서 유도된 함수처럼 커스터마이즈합니다(`Text s = Text# s`에서 시작). `text`, `red`, `program` 같은 Prelude 함수는 그 커스터마이즈를 그대로 실행합니다. 타입 머리의 `✎`로 선언 자체(`Maybe`, `Color`, `Picture`, `Widget`, `Program`)를 넘겨받으면 TYPES에 내 선언으로 들어와 타입 편집기에서 필드 이름(레코드 문법 — 사영과 갱신이 유도됨), deriving, 인스턴스를 고칠 수 있습니다. 런타임이 읽는 생성자(이름·순서·필드 타입)는 그대로 유지됩니다. `↺ Prelude's …`로 되돌립니다.
    - **Prelude 타입의 인스턴스도 바꿀 수 있습니다.** CLASSES에서 내장 클래스를 열어 Prelude가 선언한 타입(`Color`, `Picture`, `Maybe` …)의 인스턴스를 직접 쓰면, 그 타입에 대해서는 Prelude의 인스턴스 대신 그것이 쓰입니다(예: `instance Show Color`). 넘겨받은 Prelude 타입에서 deriving으로 생긴 인스턴스도 마찬가지로 Prelude의 것을 대신합니다.
21. 그 밖에: 검색창(입력하면 사이드바를 거르고 Enter로 추가, `Ctrl/⌘+K`), Shift+클릭 다중 선택(함께 끌기·삭제), `Ctrl/⌘+C`/`V` 복사·붙여넣기(꽂힌 하위 식까지), 튜플 `(a, b)`와 `fst`/`snd`, 순수 난수(`mkStdGen`, `randomR`, `randomRInt` — 생성기를 모델에 보관), gloss식 그림(`circle`, `rectangleSolid`, `translate`, `color`, `<>`로 겹치기)과 `drawing`/`heading`/`spacer`/`withColor` 위젯, 함수 옆에 고정하는 법칙 노드(📌, 편집할 때마다 ✓/✗ 재검사). 템플릿에 주사위 예제(난수·그림)가 추가되었습니다.

## 새 프로젝트의 main

새 프로젝트와 전체 `Reset`에는 매개변수 없는 사용자 함수 `main` 하나와 빈 `Output`만 준비됩니다. 기존 기초 함수·Prelude는 그대로 사용할 수 있습니다. `main` 본체에서 노드를 추가해 입력을 채우고 결과 포트를 `Output`에 연결한 뒤 `Run graph`로 실행하세요. 예를 들어 `double x = x * 2`를 만들고 main에서 `double`에 `4`를 연결하면 결과는 `8`입니다. 빈 Output이나 입력이 남아 있는 main은 안내 메시지를 보여 줍니다.

기본 main은 시작점이 없어지지 않도록 삭제·이름 변경·매개변수 추가를 막으며 Inspector에서 이유를 설명합니다. 계산과 Output 타입은 바꿀 수 있습니다. 일반 함수와 과거 파일·템플릿의 main에는 이 제한을 적용하지 않습니다. JSON/자동 저장에는 일반 함수 데이터와 `programEntry` 표시를 함께 저장합니다. 불러오기 때 기본 main을 덧붙이거나 기존 본체를 덮어쓰지 않습니다. 새 main이 없는 예전 프로젝트도 저장된 진입점/선택 실행을 그대로 쓰며, 게임 템플릿의 Program 구조도 유지합니다.

개별 노드를 함수 본체 안에서 테스트할 때 다형 숫자의 타입이 열려 있으면 기존 실행기가 구체 타입을 요구할 수 있습니다. 이 경우 TYPES의 `Int` 등을 캔버스의 `Output` 바로 아래 타입 블록에 끌어 놓아 지정하고 다시 `Play function`을 실행하세요. 전체 main 실행은 실제 함수 호출의 타입·사전 전달을 사용합니다.

이 앱은 **JavaScript 그래프 실행기**로 값을 계산합니다. Inspector의 Haskell 정의는 순수 계산을 읽어 보여 주는 참고용이며, `.hs` 실행 프로그램 내보내기나 GHC 실행 래퍼는 없습니다. 따라서 화면의 `main :: Int`를 `module Main`의 실행 진입점으로 내보내지 않습니다. 실제 Haskell로 옮길 때는, 예를 들어 그래프 정의를 별도 모듈에 두고 IO 시작 함수에서 출력할 수 있습니다. 아래는 **외부 Haskell 환경용 예시**이며 앱이 생성·실행하는 래퍼가 아닙니다.

```haskell
-- Graph.hs
module Graph where
main :: Int
main = (4 + 7) * 3
```

```haskell
-- Main.hs
module Main where
import qualified Graph
main :: IO ()
main = print Graph.main
```

두 main은 서로 다른 모듈에 있으므로 이름이 충돌하지 않습니다. `Program`은 앱의 게임 런타임 값이며 Haskell의 `IO`로 변환하지 않습니다. 앱 고유 타입클래스·게임 함수 등을 포함한 모든 정의가 그대로 GHC에서 실행된다는 뜻은 아닙니다.

## 노드 실행 표시

함수 카드의 `▶` 또는 Inspector의 `Play function`으로 실행하면 실제로 요구된 노드의 계산 기록을 180ms 간격으로 재생합니다. 주황색 점선과 `계산 중`, 초록색 테두리와 `완료`, 빨간색 이중 테두리와 `오류`로 구분하며, 캔버스 아래에 현재 상태가 표시됩니다. 기존 선택·타입 오류 표시와 별도의 화면 레이어이므로 노드 크기와 포트 위치는 바뀌지 않습니다.

- 계산은 기존 방식으로 한 번 수행하고, 결과 노드는 즉시 생성합니다. 재생이 끝나면 해당 결과에 `→ 결과` 표시가 붙습니다. 재생은 계산을 다시 실행하지 않습니다.
- 조건식은 실제로 계산한 분기만 기록합니다. 화면 순서로 강조하지 않으며, 현재 그래프의 최초 호출 프레임만 보여 줍니다. 다른 함수 본체·재귀·map 내부를 펼쳐 보여 주거나, 슬롯 안에 숨겨진 노드를 다른 노드로 대신 강조하지 않습니다. 필요하면 실행 전에 `⤢`로 식을 펼치세요.
- `완료`는 실행기가 해당 노드의 값을 만든 지점을 뜻합니다. 리스트·생성자의 내부 값까지 모두 강제한 GHC 평가 단계의 시각화는 아닙니다. 오류가 상위 호출로 전파되면 그 호출도 오류 상태로 표시됩니다. 실행 전 타입 검사 실패는 `실행 전 검사 오류`로 구분합니다.
- 다시 실행하거나 그래프를 편집·초기화·불러오기·전환하면 이전 표시와 예약된 재생을 취소합니다. 선택·Pan/Zoom·패널 너비 변경만으로는 그래프를 초기화하지 않습니다. 실행 표시는 저장·실행 취소 데이터에 포함되지 않아 새로고침하면 사라집니다.
- 게임 플레이어의 메시지·시간 업데이트에는 이 표시를 적용하지 않습니다. 입자 효과, 재생 속도 설정, 일시정지는 제공하지 않습니다.

## Haskell 학습 패널

화면은 왼쪽부터 **예제 문제(Practice) → 문법(Haskell) → Workspace/함수 목록 → 그래프 캔버스(Graph) → Inspector** 순서로 배치됩니다. 문법과 예제 문제는 각각 가용 높이를 사용하는 독립 패널이며, 목록 안에서 스크롤할 수 있습니다.

- 두 학습 패널은 처음에 모두 펼쳐집니다. 각 패널 위쪽 화살표로 독립적으로 접고 펼치며, 접으면 캔버스가 넓어집니다. 노드 위치·연결·선택·확대·이동 상태와 예제 선택은 유지됩니다.
- 예제와 문법 패널은 제목 오른쪽의 `‹`로 접으면 각각 좁은 바만 남고, Workspace와 나머지 영역이 왼쪽으로 당겨집니다. 바의 `›`로 다시 펼치면 원래 너비로 돌아옵니다. 두 패널을 모두 접으면 예제·문법 순서의 두 바 바로 오른쪽에 Workspace가 표시됩니다.
- 좌측에서 접을 수 있는 패널은 예제와 문법 두 개뿐입니다. Workspace에는 접기 버튼이 없으며 항상 표시되고, 화면 너비에 따른 기존 너비와 검색·함수 선택 상태를 유지합니다. 오른쪽 끝에는 Inspector가 위치합니다.
- Inspector의 `×`로 Inspector만 닫을 수 있습니다. 캔버스 도구 모음의 `Inspector` 버튼으로 다시 열며, 예제 문제 패널은 계속 사용할 수 있습니다.
- 문법 항목을 선택하면 한국어 설명, Haskell 코드 예제, 해설이 열립니다. `×`, `Esc`, 바깥 배경 클릭으로 닫으며, 포커스는 선택했던 문법 항목으로 돌아갑니다.
- 문법 창이 열린 동안 배경 조작은 차단됩니다. 작은 화면에서는 창 안에서 스크롤할 수 있습니다.
- 예제 문제는 현재 선택 표시만 제공합니다. 문제 풀이·그래프 생성·실행·채점 기능은 포함하지 않습니다.
- 문법 설명은 개념·기본 문법·짧은 예제와 예상 결과·프로그램에서 따라하기·값을 바꿔보기·주의할 점으로 구성됩니다. 기본 연산, 비교·논리, 함수 정의, 조건식, 타입, 리스트·튜플, 부분 적용·합성, map, 재귀를 현재 그래프의 실제 함수와 연결해 연습합니다.
- 설명의 예상 결과는 실시간 실행 결과가 아닙니다. 설명 창을 닫고 안내대로 노드를 만든 뒤 Inspector의 `Play function`을 실행하면 새 `result` 노드에 실제 결과가 나옵니다. 공통 조작·작업 보관 안내는 설명 안에서 펼쳐 볼 수 있습니다.
- 패턴 매칭·가드·let/where의 직접 작성은 외부 Haskell 환경용 개념으로 구분하고 같은 동작의 그래프 실습을 안내합니다. Integer 타입이 있어도 JavaScript Number 기반 계산은 실제 Haskell의 임의 정밀도를 보장하지 않습니다.
- 문법 창은 프로젝트를 변경하거나 템플릿을 자동으로 불러오지 않습니다. `Templates…`는 기존 게임 프로젝트로 즉시 교체하는 기능이므로 먼저 `Export`로 작업을 보관하세요(교체는 `↶`로 실행 취소 가능).

학습 콘텐츠는 Miran Lipovača의 [Learn You a Haskell for Great Good! 및 커뮤니티 유지판](https://learnyouahaskell.github.io/chapters.html)의 기초 관련 장을 참고해 한국어로 재구성하고, hsSimulate용 예제와 조작 안내를 새로 작성했습니다. 각 설명에 참고 장과 라이선스 링크가 있습니다. `src/learningContent.js`의 학습 설명은 원자료와 같은 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/)으로 제공합니다. 이 표기는 앱 코드 전체의 라이선스를 변경하지 않습니다.

문법과 예제 목록은 `src/learningContent.js`에서 수정할 수 있습니다. 화면이 좁아지면 패널 너비를 줄이고, 다섯 영역이 들어가지 않는 화면에서는 작업 영역을 가로로 스크롤할 수 있습니다. 캔버스의 최소 너비를 확보하며, 접기·펼치기 버튼은 각 패널의 좁은 바에 남습니다.

Workspace의 오른쪽 경계(8px 영역)를 좌우로 드래그하면 제목·검색·함수 목록을 포함한 Workspace 전체 너비가 실시간으로 바뀝니다. 초기값은 기존 반응형 너비(200/180/160px)이며, 최소 160px, 최대 520px 안에서 다른 패널과 캔버스의 최소 공간(360px)을 고려해 상한을 제한합니다. 좁은 화면에서는 기존 가로 스크롤을 유지합니다. 너비는 그래프와 별도인 브라우저 설정(`hs-simulate:workspace-width`)으로 저장하고 새로고침·창 크기 변경 시 유효 범위로 보정합니다. 경계에 키보드 포커스를 두고 ←/→(16px, Shift와 함께 32px), Home/End로도 조절할 수 있습니다. 드래그 취소·Esc·창 포커스 이탈 시에는 드래그 시작 전 너비로 복원합니다.

### 리스트 함수 확장

기존 PRELUDE Lists와 Search nodes에서 다음 함수를 추가합니다. 입력 점에 리터럴을 넣거나 다른 노드 출력을 연결하고, main의 Output에 연결해 `Run graph`로 실행합니다. 선택 함수만 시험하려면 `Play function`을 사용합니다. 함수 설명은 목록의 툴팁과 Inspector의 **사용 방법**에 표시됩니다.

| 함수 | 타입 | Haskell 표기와 예상 결과 |
| --- | --- | --- |
| `filter` | `(a -> Bool) -> [a] -> [a]` | `filter ((==) 2) [1,2,3,2]` → `[2,2]` |
| `take` | `Int -> [a] -> [a]` | `take 2 [1,2,3]` → `[1,2]` |
| `drop` | `Int -> [a] -> [a]` | `drop 2 [1,2,3]` → `[3]` |

`filter`의 `p`에는 Bool을 반환하는 사용자 함수나 부분 적용한 비교 함수를 연결합니다. `(==)`의 `x`에 2만 넣고 `y`는 비우면 위 예제를 만들 수 있습니다. `take`·`drop`은 `n`에 개수, `xs`에 리스트를 받습니다. 리스트는 Lists의 `+`로 입력을 늘려 원소를 하나씩 넣습니다. `[1,2,3]` 식 전체를 슬롯에 입력하는 기능은 없습니다. String은 `[Char]`이므로 `take 2 "하스켈"` → `"하스"`, `drop 2 "하스켈"` → `"켈"`, `filter ((==) 'a') "banana"` → `"aaa"`도 같은 함수로 계산합니다.

세 함수 모두 원본을 변경하지 않으며 부분 적용할 수 있습니다. 같은 리스트를 두 계산에서 쓰려면 Inspector의 `Use again`으로 참조를 만듭니다. `n <= 0`이면 take는 빈 리스트, drop은 원래 리스트를 반환하고, 길이보다 큰 개수면 각각 전체 리스트와 빈 리스트를 반환합니다. 이 앱은 개수로 JavaScript의 안전한 정수 범위(±9007199254740991)만 허용하며 Haskell Int의 모든 범위·오버플로 동작을 재현하지 않습니다. 함수 노드의 호출·오류는 기존 실행 추적에 표시하고, filter 내부 반복은 별도로 시각화하지 않습니다. 결과 표시는 유한한 리스트를 끝까지 읽으므로 무한한 결과 자체를 출력할 수는 없습니다. 기존 result의 Show 표시에서는 한글이 숫자 이스케이프로 보이고, 빈 String은 같은 내부 표현인 `[]`로 표시될 수 있습니다(실제 Haskell의 `show ""`는 `"\"\""`입니다).

`length`, `(++)`, `mod`, `abs`, `not`은 이미 지원하므로 중복 추가하지 않았습니다. `(++)` 양쪽의 원소 타입은 같아야 하고, `mod`는 기존 정수 타입클래스 연산으로 음수에서도 나누는 수의 부호를 따릅니다(`mod (-7) 3` → `2`, 0으로 나누면 오류). 기존 문법 15개 중 **리스트와 기본 리스트 연산**, **map: 리스트의 각 값 바꾸기** 안에 새 실습을 보강했습니다. [Scratch 연산 블록](https://scratch.mit.edu/help/studio/tips/home/)은 기능 분류 참고이며, 계산·타입·불변 리스트의 의미는 Haskell을 따릅니다. 이벤트·게임·반복문 체계 확장은 포함하지 않습니다.

### 반복 적용과 조건 검사

`App helpers`의 **repeatN**은 앱 전용 보조 함수이며 Haskell Prelude 표준 함수가 아닙니다. **any/all**은 기존 PRELUDE Lists에서 찾습니다. 세 함수 모두 Search nodes, 호출 노드·부분 적용·사용자 함수 전달·main 전체 실행·기존 실행 추적을 사용합니다.

| 함수 | 타입 | 예제와 예상 결과 |
| --- | --- | --- |
| repeatN | `Int -> (a -> a) -> a -> a` | `repeatN 3 ((+) 2) 0` → `6`, `repeatN 4 ((*) 2) 1` → `16` |
| any | `(a -> Bool) -> [a] -> Bool` | `any ((==) 2) [1,2,3]` → `True`, 빈 리스트 → `False` |
| all | `(a -> Bool) -> [a] -> Bool` | `all ((==) 2) [2,3]` → `False`, 빈 리스트 → `True` |

repeatN의 포트는 `n`(횟수), `f`(변환 함수), `x`(시작값)입니다. (+)의 x에 2만 넣고 y는 비운 출력을 f에 연결한 다음, n=3·x=0을 채워 main의 Output에 연결하고 Run graph를 누르면 6입니다. n을 4로 바꾸면 8입니다. 개별 Play function이 열린 숫자 타입을 요구하면 캔버스의 Output 바로 아래 타입 블록에 TYPES의 Int를 드래그한 뒤 repeatN을 선택해 실행하세요. 이 제한을 전체 실행 실패와 구분합니다.

repeatN은 숫자 전용이 아니며 `Model -> Model` 같은 상태 변환에도 적용됩니다. 0·음수는 f를 실행하지 않고 시작값을 반환합니다. 횟수는 take/drop과 같은 안전한 정수 Int 범위만 허용하며, **한 호출에서 양수 최대 100회**입니다. 초과하면 f를 실행하기 전에 반복 한도 오류를 냅니다. 학습용 상한은 지연 레코드 필드가 큰 연쇄로 쌓이는 것도 제한합니다. 반복 자체는 JS 재귀가 아닌 루프이며 각 결과의 바깥 값만 평가합니다. 함수 내부의 복잡한 계산에는 기존 1,000,000단계 평가 한도와 재귀 오류 처리가 별도로 적용됩니다. 결과 애니메이션은 기록 재생이며 계산을 반복하지 않습니다. 실제 클릭 이벤트 발생·시간 대기·프레임별 상태 갱신은 하지 않습니다.

any/all의 `p`에는 Bool을 돌려주는 함수, `xs`에는 같은 원소 타입의 리스트 또는 문자열을 연결합니다. (==)의 x에 2만 넣고 y를 비워 둔 함수를 p에 연결할 수 있습니다. any는 처음 True, all은 처음 False에서 멈추며 이후 원소에 p를 적용하지 않습니다. **빈 리스트의 all은 조건을 어기는 원소가 없어서 True**입니다. 이는 이 함수의 단락 평가이며 상위 계산이나 모든 리스트 생성 방식을 바꾸지 않습니다. 새 무한 리스트 생성 기능을 추가하지 않았습니다. 숫자를 JS 진릿값으로 바꾸지 않고 기존 타입 검사·Bool 검사를 사용합니다.

기존 문법 15개 중 리스트 항목에 any/all, 재귀 항목에 repeatN 실습을 보강했습니다. 클리커 템플릿 원본은 바꾸지 않았습니다. 테스트용으로 `repeatN 3 onClick initial`을 계산하면 초기 perClick 1에서는 재화 3, perClick 3에서는 9가 되며 다른 상태 필드는 유지됩니다. 이 계산은 게임 입력 로그를 3번 발생시키는 동작이 아닙니다. 독립 HTML은 같은 실행기 소스를 포함하므로 세 함수도 기존 내보내기 경로를 사용합니다.

## 캔버스 조작

- 빈 공간 드래그: 캔버스 이동
- 마우스 휠 또는 `−`/`+`: 확대·축소
- `⌗`: 100% 배율과 기본 위치로 복원
- 입력 포트의 텍스트: 인라인 리터럴(`3`, `-1.5`, `true`) 입력 — 그 슬롯에 리터럴 노드를 연결한 것과 같이 타입 검사되며, 맞지 않으면 빨갛게 표시되고 실행이 거부됩니다
- 입력 포트의 `−`: 매개변수 삭제
- 입력 포트 옆 `+`: 매개변수 추가

실행기(`src/evaluator.js`)는 함수 노드를 "호출 대상 함수에 채워진 슬롯(연결된 노드 또는 인라인 리터럴)을 적용한 값"으로 계산합니다. 타입 추론도 같은 의미를 쓰므로, 예를 들어 `(+)`의 `x`만 채운 노드는 값으로서 `a → a` 타입을 갖고, 모든 슬롯을 채운 `add` 노드는 `Int`를 기대하는 다른 슬롯에 그대로 연결할 수 있습니다(중첩 호출). 연결된 노드는 실행할 때마다 다시 계산되며, 평가는 지연(call-by-need) 방식이라 `select`/`ifThenElse`는 선택된 분기만 계산합니다. 따라서 기저 사례가 있는 재귀 커스텀 함수도 끝납니다. 슬롯이 남은 함수를 실행하면 부분 적용된(curried) 노드가 생기고, 이 노드는 클로저와 남은 타입(제약 포함)을 함께 저장하므로 다른 함수에 연결해 다시 실행할 수 있습니다. 기초 함수는 내부 구현이 있는 읽기 전용 함수로 제공됩니다. `zero = λf x. x`, `add = λn f x. f (n f x)`(후계자), `identity = λx. x`, `apply = λf x. f x`, `compose = λf g x. f (g x)`, `isZero = λn. n == 0`, `ifThenElse = λc a b. c ? a : b`를 제공합니다. `ifThenElse`는 `Bool` 조건에 따라 두 `Int` 값 중 하나를 반환합니다. 이 조합으로 Church 덧셈 `plus = λm n f x. m f (n f x)`를 그래프에서 구성할 수 있습니다.

타입 검증은 하스켈의 힌들리-밀너(Algorithm W) 방식을 그대로 따르는 실제 타입 추론기(`src/typeSystem.js`, `src/inferGraph.js`)가 담당합니다. `identity`, `apply`, `compose`는 콘크리트 타입이 아니라 `∀a. a → a`, `∀a b. (a → b) → a → b`, `∀a b c. (b → c) → (a → b) → a → c`로 선언된 다형 함수이며, 캔버스에 놓인 각 인스턴스는 실제로 연결된 값에 따라 독립적으로 `Int`, `Bool` 등으로 인스턴스화됩니다 — 예를 들어 `identity` 노드 하나에 숫자를 연결하면 `Int → Int`로, 다른 곳에 배치한 별도의 `identity` 콜사이트에 불리언을 연결하면 그쪽만 `Bool → Bool`로 독립적으로 표시됩니다(let-다형성). 커스텀 함수도 본체 배선에서 실제로 요구되는 만큼만 타입이 좁혀지고, 나머지는 자동으로 일반화되어 다형 함수가 됩니다. `isZero`, `ifThenElse`는 프로젝트 규칙에 따라 각각 `Int → Bool`, `Bool → Int → Int → Int`로 고정되어 있습니다. 서로 단일화(unify)할 수 없는 타입끼리는(예: `Bool` 값을 `Int` 입력 포트에) 드래그로 연결할 수 없습니다.

숫자 타입클래스 계층은 하스켈 Report의 `Num`/`Real`/`Integral`… 대신 **군론 구조**를 따릅니다(`src/numericClasses.js`). 덧셈과 곱셈을 각각의 사슬로 분리해 `AddSemigroup → AddMonoid → AddCommutativeMonoid`, `AddGroup → AddAbelianGroup`, `MulSemigroup → MulMonoid`를 두고, 이들을 합쳐 `Semiring → Ring`을 만듭니다. 그 위에 `OrderedRing → EuclideanRing`, `Field`, `OrderedField`, `Transcendental`, `IEEEFloat`가 있습니다(대략 Num→Ring, Real→OrderedRing, Integral→EuclideanRing, Fractional→Field, Floating→Transcendental, RealFrac→OrderedField, RealFloat→IEEEFloat). `Eq`/`Ord`/`Show`는 군론 계층 밖의 보조 클래스입니다. 구체 타입은 `Int`, `Integer`(유클리드 환), `Word`(ℤ/2⁶⁴ — 환이지만 덧셈과 순서가 호환되지 않아 순서환이 아님), `Natural`(ℕ — 덧셈 역원이 없는 반환), `Rational`(순서체), `Float`, `Double`(IEEE)입니다. 숫자 리터럴은 텍스트가 요구하는 최소 구조만 가집니다: `5`는 `Semiring a ⇒ a`, `-5`는 `Ring a ⇒ a`, `1.5`는 `Field a ⇒ a`. 인스펙터의 `ANNOTATE TYPE`에서는 그 구조를 가진 타입만 고를 수 있고(예: `-5`에는 `Natural`이 나오지 않음), 아무 데도 연결되지 않은 값에는 `DEFAULT` 줄에 디폴팅 결과(`Integer`, 안 되면 `Double`)가 표시됩니다. 각 기초 함수는 실제로 필요한 가장 약한 구조만 요구합니다: `(+)`는 `AddSemigroup`, `negate`/`(-)`는 `AddGroup`, `(*)`는 `MulSemigroup`, `addZero`/`mulOne`은 두 모노이드 항등원, `(/)`는 `Field`, `sqrt`는 `Transcendental`, `toRational`은 `OrderedRing`, `(>=)`/`(==)`는 `Ord`/`Eq`입니다. 숫자 형변환은 PRELUDE의 `Numeric` 그룹에 하스켈 Report 방식으로 있습니다: `toInteger`·`div`·`mod`(`EuclideanRing`), `toRational`(`OrderedRing`), `properFraction`(`OrderedField`)은 클래스 메서드라 사용자 타입에 직접 작성한 인스턴스로 구현할 수 있고(newtype은 필드의 것을 씁니다), `fromInteger`(`Ring`)와 `fromRational`(`Field`)은 메서드가 아닙니다 — ℤ가 환의 시작 대상이라 `fromInteger`는 그 타입의 `Ring` 인스턴스가 정하는 유일한 환 사상(`n · mulOne`)이고, 결과 타입이 사용자 타입이면 타입 패스가 그 타입을 알려 실행기가 그 값을 만듭니다. `fromIntegral x = fromInteger (toInteger x)`, `realToFrac x = fromRational (toRational x)`, `truncate`·`floor`·`ceiling`·`round`(반올림은 짝수 쪽으로)·`abs`는 그것들로 쓴 그래프라 열어 보고 넘겨받아 고칠 수 있습니다. `select :: Bool → a → a → a`는 `Int`로 고정된 `ifThenElse`의 다형 버전입니다. 구조가 없는 타입은 연결이 거부됩니다(예: `Natural`을 `negate`에, `Rational`을 `sqrt`에, 함수값을 `(+)`에). 리터럴을 `(+)`와 `sqrt`에 함께 연결하면 `Semiring`과 `Transcendental` 제약이 모이고, `Transcendental`이 `Semiring`을 함의하므로 중복 제약은 자동으로 사라집니다(context reduction). 각 타입이 선언한 클래스의 법칙(결합·항등·역원·교환·분배·순서 호환 등)은 `npm test`로 검증합니다.

## 프로젝트 구조

- `src/main.js`: 앱 화면, 그래프 상태, 캔버스 상호작용 및 실행 로직
- `src/learningContent.js`: Haskell 문법 설명·코드 예제와 예제 문제 목록 데이터
- `src/learningPanel.js`: 학습 패널 접기·펼치기, 예제 선택, 접근성을 적용한 문법 모달
- `src/typeSystem.js`: 힌들리-밀너 타입 엔진 (타입 변수·단일화·치환·일반화/인스턴스화·프리티 프린터)
- `src/builtinSchemes.js`: 기초 함수들의 타입 스킴 테이블(다형 함수, 군론 숫자 계층 함수, 비교·`select` 포함)
- `src/numericClasses.js`: 군론 기반 숫자 타입클래스 계층과 인스턴스 선언
- `test/`: `npm test`(Node 내장 테스트 러너) — 타입클래스 법칙·제약 해소·그래프 추론 테스트
- `src/inferGraph.js`: 캔버스 그래프의 연결(`mounted`/`output.source`)과 인라인 리터럴을 단일화 제약으로 읽어 타입(과 남은 클래스 제약)을 추론하는 패스
- `src/evaluator.js`: 같은 그래프를 지연 평가하는 실행기(클로저·부분 적용·재귀)
- `src/executionTrace.js`: 실제 노드 실행 기록의 현재 프레임 필터와 취소 가능한 화면 재생
- `src/programEntry.js`: 새 프로젝트의 기본 main, 기존 진입점과의 구분, 실행 대상과 게임 타입 판별
- `src/literals.js`: 슬롯 인라인 리터럴 파서(타입 패스와 실행기가 공유)
- `src/categoryClasses.js`: Semigroup/Monoid/PartialOrd/Lattice/VectorSpace/Functor/Foldable 선언과 인스턴스, 곱으로 올라가는 클래스 목록
- `src/dataTypes.js`: 내장 유도 타입(`[a]`, `Maybe a`, `Char`, `()`)의 인스턴스와 런타임 표현
- `src/typeDecls.js`: 하스켈 `data`/`newtype` 선언 파서·검사기와, 선언에서 유도되는 생성자·사영·갱신·분기 함수와 `deriving` 인스턴스
- `src/classEnv.js`: 클래스 환경과 제약 해소기(문맥 있는 인스턴스, entailment, context reduction, 디폴팅)
- `src/prelude.js`: 모든 클래스·인스턴스 선언을 불러오고 해소기를 다시 내보내는 진입점(하스켈 Prelude처럼)
- `src/laws.js`: 클래스 법칙과 함수 법칙(준동형·작용·팽창)을 표본으로 검사하는 법칙 검사기
- `src/runtime.js`: `Program` 값을 실행하는 게임 런타임(메시지·시간·방치 보상·되감기)
- `src/haskellPrint.js`: 함수 본체 그래프를 하스켈 정의로 출력하는 프린터(토큰마다 원래 노드를 기억)
- `src/definitionViews.js`: 기초·Prelude·유도 함수의 읽기 전용 정의 그래프와, Prelude 함수를 내 그래프로 넘겨받기(원시 함수는 `f#`에서 시작)
- `src/library.js`: Prelude 함수 표와, 하스켈로 선언한 Prelude 타입(Maybe, Color, Picture, Widget, Sub, Program)의 생성자·분기 함수
- `src/examples/`: 템플릿 프로젝트(클릭 카운터, 빈 게임, 주사위)와 그 빌더
- `src/player.js`: 위젯 렌더러와 내보낸 게임의 독립 플레이어
- `src/exportHtml.js`: 플레이어 모듈 번들러와 독립 HTML 생성
- `src/valueParser.js`: 하스켈 값 문법을 타입에 맞춰 읽는 파서(모델 편집)
- `src/signature.js`: 함수 시그니처 편집(정의·본체·호출 노드 동기화)
- `e2e/ui-only.mjs`: UI 조작만으로 게임을 만들고 실행하는 브라우저 e2e 테스트
- `src/project.js`: 프로젝트 직렬화·불러오기 검증·기초 함수 병합·실행 취소 기록
- `src/style.css`: 레이아웃과 반응형 스타일
- `index.html`: 앱 진입 HTML
- `dist/`: `npm run build`로 생성되는 배포 산출물
