import { freshProject, mainBuild, unitMaker } from './common.js'

// The click counter (examples/clickCounter.js): algebra from deriving.
// Wallet gets addition, subtraction and an order from `deriving anyclass`,
// so wallets are added and compared directly; time pays out a rate per
// whole second, and a subscription turns the space key into a click.
export function clickCounterUnits() {
  const course = 'clickCounter'
  const PARTS = {
    wallet: { title: '지갑과 상태', intro: 'Wallet은 클릭 수를 감싼 타입이에요. deriving anyclass로 덧셈·뺄셈(AddGroup)과 크기 비교(PartialOrd)를 얻어서, 지갑끼리 바로 더하고 비교할 수 있어요.' },
    actions: { title: '동작', intro: '클릭으로 벌고, 강화를 사고, 시간이 지나면 자동으로 벌어요. 모두 Model -> Model 함수예요.' },
    game: { title: '게임 완성', intro: '메시지 처리와 화면을 만들고, 구독(subscriptions)으로 스페이스 키도 받아요.' },
  }
  const unit = unitMaker(course, 'cc-', PARTS)
  const types = ['Wallet', 'Model']
  const model = (clicks, perClick = 1, rate = 0, elapsed = 0) => `Model (Wallet ${clicks}) ${perClick} ${rate} ${elapsed}`
  const clicks = ['wallet', 'clicks']
  return [
    unit('wallet', 'Wallet', `클릭 수 clicks 하나를 담은 지갑이에요. ${freshProject('클릭 카운터')}`, [
      { id: 'cc-wallet', kind: 'declare', title: 'Wallet 선언', name: 'Wallet',
        declaration: 'data Wallet = Wallet { clicks :: Int } deriving (Eq, Show) deriving anyclass (AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, PartialOrd, Lattice)',
        prompt: '지갑 Wallet을 선언하세요: 필드 clicks :: Int 하나. Eq와 Show, 그리고 anyclass로 AddSemigroup, AddMonoid, AddCommutativeMonoid, AddGroup, AddAbelianGroup, PartialOrd, Lattice를 유도하세요.',
        hint: '필드 하나뿐인 레코드는 필드가 가진 구조(덧셈, 순서)를 그대로 물려받을 수 있어요 — 그것이 anyclass 유도예요.' },
      { id: 'cc-add-choice', kind: 'choice', title: '지갑 더하기', prompt: 'Wallet이 AddGroup을 유도했을 때 Wallet 3 + Wallet 4 는?',
        options: [
          { text: 'Wallet 7', correct: true, why: '필드끼리 더해요. 0은 Wallet 0, 빼기도 필드끼리예요. 지갑이 "수처럼" 행동해요.' },
          { text: '7', why: '결과도 Wallet이에요. (+) :: a -> a -> a 라서 결과 타입이 인자와 같아요.' },
          { text: '타입 오류', why: '유도한 AddGroup 인스턴스가 (+)를 줘요.' },
        ] },
    ]),
    unit('wallet', 'Model', '지갑, 클릭당 수입, 초당 수입, 지난 시간(밀리초)이에요.', [
      { id: 'cc-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { wallet :: Wallet, perClick :: Int, rate :: Int, elapsed :: Int } deriving (Show)',
        prompt: '상태 Model을 선언하세요: wallet :: Wallet, perClick :: Int, rate :: Int, elapsed :: Int — 이 순서로. Show를 유도하세요.', hint: '생성자 Model 하나에 필드 넷.' },
    ]),
    unit('wallet', 'Msg', '버튼 셋: 클릭, 클릭 강화 사기, 자동 수입 사기.', [
      { id: 'cc-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Click | Buy | BuyAuto deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: Click, Buy, BuyAuto — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 셋.' },
    ]),
    unit('actions', 'onClick', '클릭하면 지갑에 클릭당 수입만큼 더해요.', [
      { id: 'cc-onclick', kind: 'build', title: 'onClick 만들기', name: 'onClick', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'onClick m = over wallet (+ Wallet (perClick m)) m 을 만드세요.', uses: ['over wallet', '(+)', 'Wallet', 'perClick'],
        hint: '(+)의 첫 슬롯에 Wallet (perClick m), 둘째 슬롯은 비워요 — 지갑에 더하는 함수가 돼요.',
        tests: [{ args: [model(12)], after: clicks, expect: '13' }, { args: [model(0, 3)], after: clicks, expect: '3' }] },
    ]),
    unit('actions', 'purchase', '살 수 있으면(값 ≤ 지갑) 값을 내고 강화를 적용해요. 아니면 그대로.', [
      { id: 'cc-leq-type', kind: 'type', title: 'leq의 타입', expr: 'leq', answer: 'PartialOrd a => a -> a -> Bool', engine: 'leq',
        prompt: 'leq a b 는 a가 b 이하인지예요(부분 순서). leq의 타입을 쓰세요.', hint: 'PartialOrd 타입의 두 값을 받아 Bool.',
        explain: 'Wallet이 PartialOrd를 유도해서 leq cost (wallet m) 로 "살 수 있나?"를 물을 수 있어요.' },
      { id: 'cc-purchase', kind: 'build', title: 'purchase 만들기', name: 'purchase', params: ['cost', 'upgrade', 'm'], signature: 'Wallet -> (Model -> Model) -> Model -> Model', types,
        prompt: 'purchase cost upgrade m을 만드세요: leq cost (wallet m) 이면 apply upgrade (over wallet (subtract cost) m), 아니면 m.', uses: ['leq', 'wallet', 'over wallet', '(-)', 'apply', 'select', '참조(Δ)'],
        hint: '(-)의 첫 슬롯은 비우고 둘째 슬롯에 cost — 지갑에서 cost를 빼는 함수.',
        tests: [{ args: ['Wallet 10', 'onClick', model(12)], after: clicks, expect: '3' }, { args: ['Wallet 15', 'onClick', model(12)], after: clicks, expect: '12' }] },
    ]),
    unit('actions', 'buyClick', '10클릭으로 클릭당 수입 +1을 사요.', [
      { id: 'cc-buyclick', kind: 'build', title: 'buyClick 만들기', name: 'buyClick', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'buyClick m = purchase (Wallet 10) (over perClick (+ 1)) m 을 만드세요.', uses: ['purchase', 'Wallet', 'over perClick', '(+)'], hint: 'over perClick의 둘째 슬롯은 비워 함수로 넘겨요.',
        tests: [{ args: [model(12)], after: ['perClick'], expect: '2' }, { args: [model(12)], after: clicks, expect: '2' }, { args: [model(5)], after: ['perClick'], expect: '1' }] },
    ]),
    unit('actions', 'buyAuto', '25클릭으로 초당 수입 +1을 사요.', [
      { id: 'cc-buyauto', kind: 'build', title: 'buyAuto 만들기', name: 'buyAuto', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'buyAuto m = purchase (Wallet 25) (over rate (+ 1)) m 을 만드세요.', uses: ['purchase', 'Wallet', 'over rate', '(+)'], hint: 'buyClick과 같은 모양이에요.',
        tests: [{ args: [model(30)], after: ['rate'], expect: '1' }, { args: [model(30)], after: clicks, expect: '5' }] },
    ]),
    unit('actions', 'onTick', '시간이 흐르면, 새로 지난 "온전한 1초"마다 초당 수입을 받아요.', [
      { id: 'cc-ontick', kind: 'build', title: 'onTick 만들기', name: 'onTick', params: ['dt', 'm'], signature: 'Double -> Model -> Model', types,
        prompt: 'onTick dt m을 만드세요: e = elapsed m, t = e + round (dt * 1000) 일 때 set elapsed t (over wallet (+ Wallet (rate m * (div t 1000 - div e 1000))) m).', uses: ['elapsed', 'round', '(*)', '(+)', 'div', '(-)', 'rate', 'Wallet', 'over wallet', 'set elapsed', '참조(Δ)'],
        hint: 'dt는 초 단위 Double이에요. 밀리초 Int로 바꾸려면 1000을 곱하고 round.',
        tests: [{ args: ['1.5', model(0, 1, 2)], after: ['elapsed'], expect: '1500' }, { args: ['1.5', model(0, 1, 2)], after: clicks, expect: '2' }, { args: ['0.4', model(0, 1, 2)], after: clicks, expect: '0' }] },
    ]),
    unit('game', 'handle', '메시지마다 동작 하나를 골라요. 결과가 Model -> Model 함수라서 매개변수는 msg 하나예요.', [
      { id: 'cc-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg'], signature: 'Msg -> Model -> Model', types: [...types, 'Msg'],
        prompt: 'handle msg = caseMsg onClick buyClick buyAuto msg 를 만드세요. 매개변수는 msg 하나, 시그니처의 결과 자리에는 Model -> Model.', uses: ['caseMsg', 'onClick', 'buyClick', 'buyAuto'],
        hint: 'caseMsg가 고른 함수가 그대로 결과예요 — apply가 필요 없어요.',
        tests: [{ args: ['Click', model(12)], after: clicks, expect: '13' }, { args: ['Buy', model(12)], after: ['perClick'], expect: '2' }] },
    ]),
    unit('game', 'initial', '처음 상태예요: 빈 지갑, 클릭당 1.', [
      { id: 'cc-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types,
        prompt: 'initial = Model (Wallet 0) 1 0 0 을 만드세요.', uses: ['Model', 'Wallet'], hint: '첫 슬롯에 Wallet 0.',
        tests: [{ args: [], after: clicks, expect: '0' }, { args: [], after: ['perClick'], expect: '1' }] },
    ]),
    unit('game', 'view', '화면이에요: 클릭 수, 수입, 버튼 셋, 다음 강화까지의 막대.', [
      { id: 'cc-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: [...types, 'Msg'],
        prompt: 'column [text ("Clicks: " ++ showCompact (fromIntegral (clicks (wallet m)))), text ("Per click: " ++ show (perClick m)), text ("Per second: " ++ show (rate m)), button "Click!" Click, button "+1 per click (10)" Buy, button "+1 per second (25)" BuyAuto, progress (fromIntegral (clicks (wallet m)) / 25)]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'text', 'button', 'progress', 'showCompact', 'fromIntegral', 'clicks', 'wallet', 'perClick', 'rate', 'show', '(/)', '(++)'], hint: 'progress는 0~1의 Double을 받아요.' },
    ]),
    unit('game', 'keys', '키 하나를 메시지로 바꿔요: 스페이스면 Click, 아니면 없음.', [
      { id: 'cc-keys', kind: 'build', title: 'keys 만들기', name: 'keys', params: ['k'], signature: 'String -> Maybe Msg', types: ['Msg'],
        prompt: 'keys k = select (k == " ") (Just Click) Nothing 을 만드세요.', uses: ['(==)', 'select', 'Just', 'Nothing', 'Click'], hint: '눌린 키는 글자(String)로 와요. 스페이스는 " ".',
        tests: [{ args: ['" "'], expect: 'Just Click' }, { args: ['"a"'], expect: 'Nothing' }] },
    ]),
    unit('game', 'subs', '구독: 이 게임이 바깥에서 무엇을 듣는지예요. 키보드를 keys로 들어요.', [
      { id: 'cc-onkey-type', kind: 'type', title: 'onKey의 타입', expr: 'onKey', answer: '(String -> Maybe e) -> Sub e', engine: 'onKey',
        prompt: 'onKey는 키를 메시지로 바꾸는 함수를 받아 구독(Sub)을 만들어요. onKey의 타입을 쓰세요.', hint: '(String -> Maybe e)를 받아 Sub e.',
        explain: 'Nothing을 돌려주면 그 키는 무시돼요.' },
      { id: 'cc-subs', kind: 'build', title: 'subs 만들기', name: 'subs', params: ['m'], signature: 'Model -> Sub Msg', types: [...types, 'Msg'],
        prompt: 'subs m = onKey keys 를 만드세요. 타입만 채점해요.', uses: ['onKey', 'keys'], hint: 'keys는 슬롯을 비워 함수 그대로 넣어요.' },
    ]),
    unit('game', 'main', '모두 묶어요: 1초에 20번 onTick을 부르고, subs를 구독해요.', [
      mainBuild('cc-', { signature: 'Program Model Msg', types: [...types, 'Msg'], step: 'onTick',
        hint: 'set subscriptions subs (set stepsPerSecond 20 (program initial view handle onTick)).' }),
    ]),
  ]
}
