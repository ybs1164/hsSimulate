import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// Rock, paper, scissors (examples/rps.js): data types. Sums with one
// branch per constructor (caseHand, caseResult), a record whose unplayed
// hands are `Maybe Hand`, and a message carrying a value (`Throw Hand`).
export function rpsUnits() {
  const course = 'rps'
  const PARTS = {
    hands: { title: '손과 결과', intro: '가위바위보는 그 타입이 곧 게임이에요. Hand는 생성자 셋의 합(sum) 타입이고, 규칙은 생성자마다 갈래 하나씩인 분기 함수(caseHand, caseResult)로 써요.' },
    state: { title: '상태와 메시지', intro: '아직 내지 않은 손은 Maybe Hand의 Nothing이에요. 메시지 Throw Hand는 낸 손을 싣고 다녀요.' },
    game: { title: '게임 완성', intro: 'CPU의 손을 무작위로 정해 승부하고, 화면과 program을 만들어요.' },
  }
  const unit = unitMaker(course, 'rps-', PARTS)
  const all = ['Hand', 'Result', 'Model']
  const fresh = 'Model Nothing Nothing Nothing (mkStdGen 1) 0'
  return [
    unit('hands', 'Hand', `낼 수 있는 손 세 가지예요. ${freshProject('가위바위보')}`, [
      { id: 'rps-hand', kind: 'declare', title: 'Hand 선언', name: 'Hand', declaration: 'data Hand = Rock | Paper | Scissors deriving (Eq, Show)',
        prompt: '손 Hand를 선언하세요: Rock, Paper, Scissors — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 셋.' },
      { id: 'rps-casehand-type', kind: 'type', title: 'caseHand의 타입', expr: 'caseHand', answer: 'r -> r -> r -> Hand -> r',
        prompt: 'Hand의 분기 함수 caseHand의 타입을 쓰세요.', hint: '생성자 셋 → 결과 r 셋, 그리고 Hand.',
        explain: '합 타입의 값을 쓰는 방법은 "생성자마다 무엇을 할지"를 모두 정하는 것이에요 — 빠뜨리면 타입이 맞지 않아요.' },
    ]),
    unit('hands', 'Result', '한 판의 결과 세 가지예요.', [
      { id: 'rps-result-decl', kind: 'declare', title: 'Result 선언', name: 'Result', declaration: 'data Result = Win | Lose | Draw deriving (Eq, Show)',
        prompt: '결과 Result를 선언하세요: Win, Lose, Draw — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 셋.' },
    ]),
    unit('hands', 'beats', '손 a가 손 b를 이기는지예요: 바위는 가위를, 보는 바위를, 가위는 보를 이겨요.', [
      { id: 'rps-beats', kind: 'build', title: 'beats 만들기', name: 'beats', params: ['a', 'b'], signature: 'Hand -> Hand -> Bool', types: ['Hand'],
        prompt: 'beats a b를 만드세요: a가 무엇인지에 따라 — Rock이면 b == Scissors, Paper이면 b == Rock, Scissors이면 b == Paper.', uses: ['caseHand', '(==)', 'Rock', 'Paper', 'Scissors', '참조(Δ)'],
        hint: 'caseHand (b == Scissors) (b == Rock) (b == Paper) a.',
        tests: [{ args: ['Rock', 'Scissors'], expect: 'True' }, { args: ['Rock', 'Paper'], expect: 'False' }, { args: ['Paper', 'Rock'], expect: 'True' }, { args: ['Scissors', 'Paper'], expect: 'True' }, { args: ['Rock', 'Rock'], expect: 'False' }] },
    ]),
    unit('hands', 'result', '두 손의 승부예요: 같으면 비김, a가 이기면 Win, 아니면 Lose.', [
      { id: 'rps-result', kind: 'build', title: 'result 만들기', name: 'result', params: ['a', 'b'], signature: 'Hand -> Hand -> Result', types: ['Hand', 'Result'],
        prompt: 'result a b = select (a == b) Draw (select (beats a b) Win Lose) 를 만드세요.', uses: ['(==)', 'beats', 'select', 'Win', 'Lose', 'Draw'],
        hint: 'a와 b를 두 번씩 쓰니 참조(Δ)를 만드세요.',
        tests: [{ args: ['Rock', 'Scissors'], expect: 'Win' }, { args: ['Rock', 'Paper'], expect: 'Lose' }, { args: ['Paper', 'Paper'], expect: 'Draw' }] },
    ]),
    unit('hands', 'points', '결과의 점수예요: 이기면 1, 지면 −1, 비기면 0.', [
      { id: 'rps-points', kind: 'build', title: 'points 만들기', name: 'points', params: ['r'], signature: 'Result -> Int', types: ['Result'],
        prompt: 'points r = caseResult 1 (-1) 0 r 을 만드세요.', uses: ['caseResult'], hint: 'caseResult의 슬롯에 1, -1, 0을 차례로.',
        tests: [{ args: ['Win'], expect: '1' }, { args: ['Lose'], expect: '-1' }, { args: ['Draw'], expect: '0' }] },
    ]),
    unit('hands', 'toHand', '무작위 수 0·1·2를 손으로 바꿔요.', [
      { id: 'rps-tohand', kind: 'build', title: 'toHand 만들기', name: 'toHand', params: ['i'], signature: 'Int -> Hand', types: ['Hand'],
        prompt: 'toHand i를 만드세요: 0이면 Rock, 1이면 Paper, 그 밖에는 Scissors.', uses: ['(==)', 'select', 'Rock', 'Paper', 'Scissors'],
        hint: 'select (i == 0) Rock (select (i == 1) Paper Scissors).',
        tests: [{ args: ['0'], expect: 'Rock' }, { args: ['1'], expect: 'Paper' }, { args: ['2'], expect: 'Scissors' }] },
    ]),
    unit('state', 'Model', '내 손, CPU의 손, 결과(아직 없으면 Nothing), 생성기, 점수예요.', [
      { id: 'rps-maybe-choice', kind: 'choice', title: '아직 없는 값', prompt: '게임을 시작했을 때, 아직 아무도 손을 내지 않았어요. 내 손 필드의 타입으로 알맞은 것은?',
        options: [
          { text: 'Hand', why: '그러면 처음부터 무언가(예: Rock)를 넣어야 해서 "아직 안 냄"을 나타낼 수 없어요.' },
          { text: 'Maybe Hand', correct: true, why: 'Nothing(아직 없음) 또는 Just Rock 같은 값. "없을 수 있음"이 타입에 드러나서, 쓸 때 maybe로 두 경우를 모두 다뤄야 해요.' },
          { text: 'String', why: '"Rock" 같은 글자로는 잘못된 손("Rokc")도 들어갈 수 있어요. 타입이 손만 허락하게 해요.' },
        ] },
      { id: 'rps-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { mine :: Maybe Hand, theirs :: Maybe Hand, outcome :: Maybe Result, gen :: StdGen, score :: Int } deriving (Show)',
        prompt: '상태 Model을 선언하세요: mine, theirs :: Maybe Hand, outcome :: Maybe Result, gen :: StdGen, score :: Int — 이 순서로. Show를 유도하세요.', hint: '필드의 타입에 Maybe를 끌어다 놓고 그 안에 Hand를 넣어요.' },
    ]),
    unit('state', 'Msg', '메시지 하나가 낸 손을 싣고 와요: Throw Rock, Throw Paper, Throw Scissors.', [
      { id: 'rps-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Throw Hand deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: 필드 Hand 하나를 가진 생성자 Throw. Eq와 Show를 유도하세요.', hint: '생성자 Throw에 이름 없는 필드 Hand 하나.' },
      { id: 'rps-casemsg-type', kind: 'type', title: 'caseMsg의 타입', expr: 'caseMsg', answer: '(Hand -> r) -> Msg -> r',
        prompt: 'Throw에는 필드가 있어서 caseMsg의 갈래가 그 필드를 받는 함수가 돼요. caseMsg의 타입을 쓰세요.', hint: '갈래 하나: Hand를 받아 r. 그리고 Msg.',
        explain: 'caseMsg throw msg 는 Throw h 이면 throw h. 필드가 갈래 함수의 인자로 들어와요.' },
    ]),
    unit('game', 'throw', '한 판이에요: CPU의 손을 무작위로 정하고, 결과와 점수를 기록해요.', [
      { id: 'rps-throw', kind: 'build', title: 'throw 만들기', name: 'throw', params: ['h', 'm'], signature: 'Hand -> Model -> Model', types: all,
        prompt: 'throw h m을 만드세요: g = randomRInt (0, 2) (gen m), c = toHand (fst g), r = result h c 일 때 Model (Just h) (Just c) (Just r) (snd g) (score m + points r).', uses: ['randomRInt', '(,)', 'gen', 'fst', 'snd', 'toHand', 'result', 'Just', 'points', 'score', '(+)', 'Model', '참조(Δ)'],
        hint: 'g, c, r을 여러 번 쓰니 참조(Δ)를 만드세요.',
        tests: [{ args: ['Rock', fresh], after: ['mine'], expect: 'Just Rock' }, { args: ['Rock', fresh], after: ['theirs'], expect: 'Just Paper' }, { args: ['Rock', fresh], after: ['score'], expect: '-1' }] },
    ]),
    unit('game', 'handle', '메시지에 실린 손으로 한 판을 해요.', [
      { id: 'rps-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Model -> Model', types: [...all, 'Msg'],
        prompt: 'handle msg m = apply (caseMsg throw msg) m 을 만드세요.', uses: ['caseMsg', 'throw', 'apply'], hint: 'throw는 두 슬롯을 모두 비워서(함수 그대로) 넣어요.',
        tests: [{ args: ['Throw Paper', fresh], after: ['mine'], expect: 'Just Paper' }] },
    ]),
    unit('game', 'handText', '손을 글자로 보여 줘요. 아직 없으면 "—".', [
      { id: 'rps-maybe-type', kind: 'type', title: 'maybe의 타입', expr: 'maybe', answer: 'b -> (a -> b) -> Maybe a -> b', engine: 'maybe',
        prompt: 'maybe d f m 은 m이 Nothing이면 d, Just x이면 f x예요. maybe의 타입을 쓰세요.', hint: '기본값 b, 함수 (a -> b), 그리고 Maybe a.' },
      { id: 'rps-handtext', kind: 'build', title: 'handText 만들기', name: 'handText', params: ['mh'], signature: 'Maybe Hand -> String', types: ['Hand'],
        prompt: 'handText mh = maybe "—" show mh 를 만드세요.', uses: ['maybe', 'show'], hint: 'show는 슬롯을 비워(함수 그대로) 넣어요.',
        tests: [{ args: ['Nothing'], expect: '"—"' }, { args: ['Just Rock'], expect: '"Rock"' }] },
    ]),
    unit('game', 'view', '화면이에요: 두 손, 결과, 점수, 손 버튼 셋.', [
      { id: 'rps-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: [...all, 'Msg'],
        prompt: 'column [heading "Rock · Paper · Scissors", text ("You: " ++ handText (mine m)), text ("CPU: " ++ handText (theirs m)), text (maybe "Pick a hand." (caseResult "You win!" "You lose." "Draw.") (outcome m)), text ("Score: " ++ show (score m)), row [button "Rock" (Throw Rock), button "Paper" (Throw Paper), button "Scissors" (Throw Scissors)]]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'row', 'heading', 'text', 'button', 'handText', 'maybe', 'caseResult', 'Throw', 'show', '(++)'], hint: '버튼이 보낼 메시지는 Throw Rock처럼 생성자에 손을 넣어 만들어요.' },
    ]),
    unit('game', 'step', '시간의 흐름이에요. 아무것도 바뀌지 않아요.', [
      stepBuild('rps-', { signature: 'Double -> Model -> Model', types: all, test: { args: ['0.5', fresh], after: ['score'], expect: '0' } }),
    ]),
    unit('game', 'initial', '처음 상태예요: 손도 결과도 없고, 점수는 0.', [
      { id: 'rps-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types: all,
        prompt: 'initial = Model Nothing Nothing Nothing (mkStdGen 2026) 0 을 만드세요.', uses: ['Model', 'Nothing', 'mkStdGen'], hint: 'Nothing 블록 셋.',
        tests: [{ args: [], after: ['mine'], expect: 'Nothing' }, { args: [], after: ['score'], expect: '0' }] },
    ]),
    unit('game', 'main', '모두 묶어 가위바위보를 완성해요.', [
      mainBuild('rps-', { signature: 'Program Model Msg', types: [...all, 'Msg'] }),
    ]),
  ]
}
