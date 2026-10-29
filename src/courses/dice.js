import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// The dice roller (examples/dice.js): randomness as a value. The generator
// lives in the model, randomRInt hands back a pair — the number and the
// next generator — taken apart with fst and snd.
export function diceUnits() {
  const course = 'dice'
  const PARTS = {
    state: { title: '상태', intro: '주사위 눈과 난수 생성기(StdGen)를 상태에 담아요. 같은 생성기는 언제나 같은 수를 내므로, 쓸 때마다 다음 생성기로 바꿔 둬야 해요.' },
    roll: { title: '굴리기', intro: 'randomRInt (1, 6) g 는 (수, 다음 생성기) 쌍을 돌려줘요. 쌍은 fst(첫째)와 snd(둘째)로 나눠요.' },
    game: { title: '게임 완성', intro: '메시지 처리와 그림이 있는 화면을 만들고 program으로 묶어요.' },
  }
  const unit = unitMaker(course, 'dc-', PARTS)
  const types = ['Model']
  return [
    unit('state', 'Model', `주사위 눈 face와 생성기 gen이에요. ${freshProject('주사위')}`, [
      { id: 'dc-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { face :: Int, gen :: StdGen } deriving (Show)',
        prompt: '상태 Model을 레코드로 선언하세요: face :: Int, gen :: StdGen — 이 순서로. Show를 유도하세요.', hint: 'StdGen은 내장 타입 목록에 있어요.' },
      { id: 'dc-pure-choice', kind: 'choice', title: '같은 생성기', prompt: 'g가 같은 생성기라면 randomRInt (1, 6) g 를 두 번 계산한 결과는?',
        options: [
          { text: '매번 다르다', why: 'Haskell의 함수는 같은 인자에 언제나 같은 결과를 내요(순수 함수). 무작위도 예외가 아니에요.' },
          { text: '언제나 같다', correct: true, why: '그래서 결과와 함께 받은 "다음 생성기"를 상태에 저장해 두고, 다음에는 그것을 써요.' },
        ] },
    ]),
    unit('state', 'Msg', '버튼 하나: 굴리기.', [
      { id: 'dc-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Roll deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: 생성자 Roll 하나. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 하나.' },
    ]),
    unit('state', 'initial', '처음 상태예요: 눈 1, 씨앗 2026으로 만든 생성기.', [
      { id: 'dc-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types,
        prompt: '처음 상태 initial을 만드세요: Model 1 (mkStdGen 2026).', uses: ['Model', 'mkStdGen'], hint: 'mkStdGen은 수(씨앗)로 생성기를 만들어요.',
        tests: [{ args: [], after: ['face'], expect: '1' }] },
    ]),
    unit('roll', 'roll', '주사위를 굴려요: 1~6의 수 하나와 다음 생성기를 얻어 새 Model로.', [
      { id: 'dc-random-type', kind: 'type', title: 'randomRInt의 타입', expr: 'randomRInt', answer: '(Int, Int) -> StdGen -> (Int, StdGen)', engine: 'randomRInt',
        prompt: 'randomRInt (lo, hi) g 는 lo~hi 사이의 수와 다음 생성기를 쌍으로 돌려줘요. randomRInt의 타입을 쓰세요.', hint: '범위 쌍 (Int, Int)와 StdGen을 받아 쌍 (Int, StdGen).',
        explain: '결과가 쌍이라는 것이 "무작위 수를 쓰면 생성기도 바뀐다"는 사실을 타입에 드러내요.' },
      { id: 'dc-fst-type', kind: 'type', title: 'fst의 타입', expr: 'fst', answer: '(a, b) -> a', engine: 'fst',
        prompt: '쌍의 첫째 성분을 꺼내는 fst의 타입을 쓰세요.', hint: '쌍 (a, b)를 받아 a.', explain: 'snd :: (a, b) -> b 는 둘째 성분이에요.' },
      { id: 'dc-roll', kind: 'build', title: 'roll 만들기', name: 'roll', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'roll을 만드세요: r = randomRInt (1, 6) (gen m) 일 때 Model (fst r) (snd r).', uses: ['(,)', 'gen', 'randomRInt', 'fst', 'snd', 'Model', '참조(Δ)'],
        hint: 'r을 두 번(fst, snd) 쓰므로 참조(Δ)를 만드세요.',
        tests: [{ args: ['Model 1 (mkStdGen 2026)'], after: ['face'], expect: '3' }, { args: ['Model 1 (mkStdGen 7)'], after: ['face'], expect: '1' }, { args: ['Model 1 (mkStdGen 7)'], after: ['roll', 'face'], expect: '1' }] },
    ]),
    unit('game', 'handle', 'Roll 메시지를 받으면 굴려요.', [
      { id: 'dc-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Model -> Model', types: ['Model', 'Msg'],
        prompt: 'handle msg m을 만드세요: Roll → roll.', uses: ['caseMsg', 'roll', 'apply'], hint: 'apply (caseMsg roll msg) m.',
        tests: [{ args: ['Roll', 'Model 1 (mkStdGen 2026)'], after: ['face'], expect: '3' }] },
    ]),
    unit('game', 'view', '화면이에요: 제목, 주사위 그림, 나온 눈, 굴리기 버튼.', [
      { id: 'dc-picture-choice', kind: 'choice', title: '그림 겹치기', prompt: 'color red (rectangleSolid 120 120) <> color white (circleSolid 8) 은 어떻게 그려질까요?',
        options: [
          { text: '빨간 사각형 위에 흰 원', correct: true, why: '그림(Picture)은 (<>)로 겹쳐요. 오른쪽이 위에 그려져요. 그림도 Monoid라서 이렇게 합칠 수 있어요.' },
          { text: '흰 원 위에 빨간 사각형', why: '(<>)의 오른쪽이 나중에, 위에 그려져요.' },
          { text: '타입 오류', why: '두 그림 모두 Picture라서 (<>)로 합칠 수 있어요.' },
        ] },
      { id: 'dc-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: ['Model', 'Msg'],
        prompt: 'column [heading "Dice", drawing 160 160 (color red (rectangleSolid 120 120) <> color white (circleSolid (fromIntegral (face m) * 8))), text ("You rolled " ++ show (face m)), button "Roll" Roll]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'heading', 'drawing', 'color', 'rectangleSolid', 'circleSolid', '(<>)', 'fromIntegral', 'text', 'button', 'show', '(++)'],
        hint: 'circleSolid는 Double을 받아요. Int인 face m은 fromIntegral로 바꿔요.' },
    ]),
    unit('game', 'step', '시간의 흐름이에요. 주사위는 굴릴 때만 바뀌어요.', [
      stepBuild('dc-', { signature: 'Double -> Model -> Model', types, test: { args: ['0.5', 'Model 4 (mkStdGen 1)'], after: ['face'], expect: '4' } }),
    ]),
    unit('game', 'main', '모두 묶어 주사위를 완성해요.', [
      mainBuild('dc-', { signature: 'Program Model Msg', types: ['Model', 'Msg'] }),
    ]),
  ]
}
