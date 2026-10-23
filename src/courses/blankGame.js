import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// The blank game (examples/blankGame.js): the smallest whole game — a
// state, one message, and the four functions program ties together. Every
// later course has this shape.
export function blankGameUnits() {
  const course = 'blankGame'
  const PARTS = {
    types: { title: '상태와 메시지', intro: '게임은 상태(Model)와, 버튼이 보내는 메시지(Msg)로 시작해요. 둘 다 타입으로 선언해요.' },
    program: { title: '프로그램', intro: '처음 상태(initial), 메시지 처리(handle), 화면(view), 시간 흐름(step) — 이 네 함수를 program으로 묶으면 게임이 돼요.' },
  }
  const unit = unitMaker(course, 'bg-', PARTS)
  return [
    unit('types', 'Model', `게임의 상태예요: 센 수 count 하나를 담은 레코드. ${freshProject('빈 게임')}`, [
      { id: 'bg-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { count :: Double } deriving (Eq, Show)',
        prompt: '게임의 상태 Model을 레코드로 선언하세요: 필드 count :: Double 하나. Eq와 Show를 유도하세요.',
        hint: '생성자 Model 하나, 그 안에 필드 count :: Double.',
        explain: '레코드를 선언하면 필드 읽기(count), 바꾸기(set count), 고치기(over count) 함수가 저절로 생겨요.' },
      { id: 'bg-count-type', kind: 'type', title: '필드 읽기의 타입', expr: 'count', answer: 'Model -> Double',
        prompt: 'Model을 선언하면 생기는 필드 읽기 함수 count의 타입을 쓰세요.', hint: 'Model 하나를 받아 필드의 값을 돌려줘요.',
        explain: 'count m 은 m에 담긴 수예요. 필드 이름이 그대로 함수가 돼요.' },
    ]),
    unit('types', 'Msg', '버튼이 보내는 메시지예요. 이 게임에는 하나뿐이에요: Increment.', [
      { id: 'bg-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Increment deriving (Eq, Show)',
        prompt: '메시지 타입 Msg를 선언하세요: 필드 없는 생성자 Increment 하나. Eq와 Show를 유도하세요.', hint: '생성자 Increment 하나, 필드 없음.' },
      { id: 'bg-casemsg-type', kind: 'type', title: 'caseMsg의 타입', expr: 'caseMsg', answer: 'r -> Msg -> r',
        prompt: 'Msg를 선언하면 분기 함수 caseMsg가 생겨요. 생성자마다 결과 하나씩, 마지막에 Msg를 받아요. caseMsg의 타입을 쓰세요.', hint: '생성자가 하나이고 필드가 없으니 결과 r 하나, 그리고 Msg.',
        explain: 'case msg of { Increment -> … } 를 함수로 쓴 것이에요. 생성자가 늘면 인자도 늘어요.' },
    ]),
    unit('program', 'initial', '처음 상태예요: count가 0인 Model.', [
      { id: 'bg-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types: ['Model'],
        prompt: '처음 상태 initial을 만드세요: Model 0.', uses: ['Model'], hint: '생성자 Model 블록의 슬롯에 0을 넣고 Output에 이으세요.',
        tests: [{ args: [], after: ['count'], expect: '0.0' }] },
    ]),
    unit('program', 'handle', '메시지를 받아 상태를 바꿔요. Increment면 count에 1을 더해요.', [
      { id: 'bg-apply-type', kind: 'type', title: 'apply의 타입', expr: 'apply', answer: '(a -> b) -> a -> b', engine: 'apply',
        prompt: 'apply f x 는 함수 f를 x에 적용해요. apply의 타입을 쓰세요.', hint: '첫 인자는 함수 (a -> b), 둘째는 그 함수가 받는 a.',
        explain: 'caseMsg가 고른 Model -> Model 함수를 apply로 m에 적용해요.' },
      { id: 'bg-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Model -> Model', types: ['Model', 'Msg'],
        prompt: 'handle msg m을 만드세요: Increment이면 count에 1을 더한 Model.', uses: ['caseMsg', 'over count', '(+)', 'apply'],
        hint: 'apply (caseMsg (over count (1 +)) msg) m. (+)의 첫 슬롯에만 1을 넣으면 (1 +) 함수가 돼요.',
        tests: [{ args: ['Increment', 'Model 2'], after: ['count'], expect: '3.0' }, { args: ['Increment', 'Model 0'], after: ['count'], expect: '1.0' }] },
    ]),
    unit('program', 'view', '화면이에요: 센 수를 보여 주는 글과 +1 버튼.', [
      { id: 'bg-button-type', kind: 'type', title: 'button의 타입', expr: 'button', answer: 'String -> e -> Widget e', engine: 'wButton',
        prompt: 'button은 글자와, 눌렸을 때 보낼 메시지를 받아 화면 조각(Widget)을 만들어요. button의 타입을 쓰세요 (메시지 타입 e).', hint: 'String, 메시지 e를 받아 Widget e.',
        explain: '화면 조각의 타입이 보낼 메시지의 타입을 기억해요: button "+1" Increment :: Widget Msg.' },
      { id: 'bg-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: ['Model', 'Msg'],
        prompt: '화면 view를 만드세요: column [text ("Count: " ++ showFFloat 0 (count m)), button "+1" Increment]. 이 문제는 타입만 채점해요 — 실행해서 화면을 확인하세요.',
        uses: ['column', 'text', 'button', 'showFFloat', 'count', '(++)', '[ , , ]'],
        hint: 'showFFloat 0 x 는 Double x를 소수점 없이 글자로 바꿔요.' },
    ]),
    unit('program', 'step', '시간의 흐름이에요. 이 게임에서는 아무것도 바뀌지 않아요.', [
      stepBuild('bg-', { signature: 'Double -> Model -> Model', types: ['Model'], test: { args: ['0.5', 'Model 2'], after: ['count'], expect: '2.0' } }),
    ]),
    unit('program', 'main', '네 함수를 program으로 묶어 게임으로 만들어요.', [
      { id: 'bg-program-type', kind: 'type', title: 'program의 타입', expr: 'program', answer: 'm -> (m -> Widget e) -> (e -> m -> m) -> (Double -> m -> m) -> Program m e', engine: 'program',
        prompt: 'program은 처음 상태, 화면, 메시지 처리, 시간 흐름을 받아 게임을 만들어요. program의 타입을 쓰세요 (상태 m, 메시지 e).', hint: 'm, (m -> Widget e), (e -> m -> m), (Double -> m -> m)를 받아 Program m e.',
        explain: '이 앱의 게임은 모두 이 모양이에요(Elm 아키텍처): 상태 → 화면, 메시지 → 상태 바꾸기, 시간 → 상태 바꾸기.' },
      mainBuild('bg-', { signature: 'Program Model Msg', types: ['Model', 'Msg'] }),
    ]),
  ]
}
