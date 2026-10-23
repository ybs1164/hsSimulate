import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// Nim (examples/nim.js): conditions. Every rule is a Bool from isZero
// picking a value — a number with ifThenElse, anything else with select.
export function nimUnits() {
  const course = 'nim'
  const PARTS = {
    state: { title: '상태와 메시지', intro: '돌 더미에서 번갈아 1개나 2개를 가져가고, 마지막 돌을 가져간 쪽이 이겨요. 상태는 남은 돌의 수와 CPU가 방금 가져간 수뿐이에요.' },
    rules: { title: '조건', intro: '규칙은 모두 조건이에요: isZero가 Bool을 만들고, ifThenElse(Int 중에서)나 select(어떤 타입이든)가 그 Bool로 하나를 골라요.' },
    game: { title: '게임 완성', intro: '처음 상태와 다시 시작, 메시지 처리, 화면을 만들고 program으로 묶어요.' },
  }
  const unit = unitMaker(course, 'nim-', PARTS)
  const types = ['Model']
  const model = (left, cpu) => `Model ${left} ${cpu}`
  return [
    unit('state', 'Model', `남은 돌 left와 CPU가 방금 가져간 수 cpuLast(아직 없으면 0)예요. ${freshProject('님')}`, [
      { id: 'nim-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { left :: Int, cpuLast :: Int } deriving (Show)',
        prompt: '상태 Model을 레코드로 선언하세요: left :: Int, cpuLast :: Int — 이 순서로. Show를 유도하세요.', hint: '생성자 Model 하나에 필드 둘.' },
    ]),
    unit('state', 'Msg', '버튼 셋: 1개 가져가기, 2개 가져가기, 새 게임.', [
      { id: 'nim-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Take1 | Take2 | Restart deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: Take1, Take2, Restart — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 셋.' },
    ]),
    unit('rules', 'yourTake', '내가 가져갈 수예요. 돌이 한 개만 남았으면 2개를 눌러도 1개만 가져가요.', [
      { id: 'nim-iszero-type', kind: 'type', title: 'isZero의 타입', expr: 'isZero', answer: 'Int -> Bool', engine: 'isZero',
        prompt: 'isZero n 은 n이 0인지 알려 줘요. isZero의 타입을 쓰세요.', hint: 'Int 하나를 받아 Bool.',
        explain: 'isZero (left m - 1) 은 "한 개 남았나?"예요. 비교를 0과의 비교로 바꿔 쓰는 것이 이 과정의 요령이에요.' },
      { id: 'nim-ite-type', kind: 'type', title: 'ifThenElse의 타입', expr: 'ifThenElse', answer: 'Bool -> Int -> Int -> Int', engine: 'ifThenElse',
        prompt: 'ifThenElse c x y 는 c가 True이면 x, 아니면 y예요. 이 앱의 기초 함수 ifThenElse의 타입을 쓰세요 (두 갈래는 Int예요).', hint: '조건 Bool, 두 갈래 Int, 결과 Int.',
        explain: 'ifThenElse는 Int만 고를 수 있어요. 글자나 Model을 고르려면 어떤 타입이든 되는 select를 써요.' },
      { id: 'nim-yourtake', kind: 'build', title: 'yourTake 만들기', name: 'yourTake', params: ['k', 'm'], signature: 'Int -> Model -> Int', types,
        prompt: '내가 고른 수 k와 상태 m으로 실제로 가져갈 수를 정하는 yourTake를 만드세요: 돌이 한 개 남았으면 1, 아니면 k.', uses: ['left', '(-)', 'isZero', 'ifThenElse'],
        hint: 'ifThenElse (isZero (left m - 1)) 1 k.',
        tests: [{ args: ['2', model(1, 0)], expect: '1' }, { args: ['2', model(5, 0)], expect: '2' }, { args: ['1', model(5, 0)], expect: '1' }] },
    ]),
    unit('rules', 'cpuTake', 'CPU의 전략이에요: 남은 돌을 3의 배수로 만들 수 있으면 그렇게 가져가요.', [
      { id: 'nim-cputake', kind: 'build', title: 'cpuTake 만들기', name: 'cpuTake', params: ['l'], signature: 'Int -> Int',
        prompt: '남은 돌 l에서 CPU가 가져갈 수 cpuTake를 만드세요: r = mod l 3 이 0이면(3의 배수라 이길 수 없으면) 1, 아니면 r.', uses: ['mod', 'isZero', 'ifThenElse', '참조(Δ)'],
        hint: 'ifThenElse (isZero r) 1 r, 여기서 r = mod l 3. r을 두 번 쓰니 참조(Δ)를 만드세요.',
        tests: [{ args: ['5'], expect: '2' }, { args: ['4'], expect: '1' }, { args: ['3'], expect: '1' }, { args: ['19'], expect: '1' }] },
    ]),
    unit('rules', 'move', '한 차례예요: 내가 가져가고, 돌이 남았으면 CPU가 가져가요. 게임이 끝났으면 아무것도 하지 않아요.', [
      { id: 'nim-select-choice', kind: 'choice', title: 'ifThenElse와 select', prompt: '게임이 끝났으면(left m이 0이면) m을, 아니면 새 Model을 고르려고 해요. 어떤 함수를 써야 할까요?',
        options: [
          { text: 'ifThenElse', why: 'ifThenElse의 두 갈래는 Int여야 해요. Model을 고를 수 없어요.' },
          { text: 'select', correct: true, why: 'select :: Bool -> a -> a -> a 는 a가 무엇이든 돼요. 여기서 a는 Model이에요.' },
        ] },
      { id: 'nim-move', kind: 'build', title: 'move 만들기', name: 'move', params: ['k', 'm'], signature: 'Int -> Model -> Model', types,
        prompt: 'move k m을 만드세요: t = yourTake k m, l = left m - t, CPU가 가져갈 수 c는 l이 0이면 0, 아니면 cpuTake l. 결과는 Model (l - c) c. 단 left m이 이미 0이면 m 그대로.', uses: ['yourTake', 'left', '(-)', 'isZero', 'cpuTake', 'ifThenElse', 'Model', 'select', '참조(Δ)'],
        hint: 'select (isZero (left m)) m (Model (l - c) c).',
        tests: [{ args: ['1', model(20, 0)], after: ['left'], expect: '18' }, { args: ['1', model(20, 0)], after: ['cpuLast'], expect: '1' },
          { args: ['2', model(2, 1)], after: ['left'], expect: '0' }, { args: ['2', model(2, 1)], after: ['cpuLast'], expect: '0' }, { args: ['1', model(0, 1)], after: ['cpuLast'], expect: '1' }] },
    ]),
    unit('rules', 'status', '지금 상황을 알려 주는 문구예요. 끝났는지, 누가 마지막에 가져갔는지로 갈려요.', [
      { id: 'nim-status', kind: 'build', title: 'status 만들기', name: 'status', params: ['m'], signature: 'Model -> String', types,
        prompt: 'status를 만드세요. left가 0이면 — cpuLast가 0이면 "You took the last stone — you win!", 아니면 "The CPU took the last stone — you lose.". 아직 진행 중이면 — cpuLast가 0이면 "Take 1 or 2. Whoever takes the last stone wins.", 아니면 "The CPU took " ++ show (cpuLast m) ++ ". Your move."',
        uses: ['left', 'cpuLast', 'isZero', 'select', 'show', '(++)'],
        hint: 'select (isZero (left m)) (select (isZero (cpuLast m)) 이김 짐) (select (isZero (cpuLast m)) 시작 문구 ("The CPU took " ++ …)).',
        tests: [{ args: [model(0, 0)], expect: '"You took the last stone — you win!"' }, { args: [model(0, 2)], expect: '"The CPU took the last stone — you lose."' },
          { args: [model(20, 0)], expect: '"Take 1 or 2. Whoever takes the last stone wins."' }, { args: [model(17, 2)], expect: '"The CPU took 2. Your move."' }] },
    ]),
    unit('game', 'initial', '처음 상태예요: 돌 20개, CPU는 아직 가져가지 않았어요.', [
      { id: 'nim-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types,
        prompt: '처음 상태 initial을 만드세요: Model 20 0.', uses: ['Model'], hint: '생성자 Model의 두 슬롯에 20과 0.',
        tests: [{ args: [], after: ['left'], expect: '20' }, { args: [], after: ['cpuLast'], expect: '0' }] },
    ]),
    unit('game', 'restart', '"New game" 버튼: 지금 상태와 상관없이 처음으로 돌아가요.', [
      { id: 'nim-restart', kind: 'build', title: 'restart 만들기', name: 'restart', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'm을 쓰지 않고 initial을 돌려주는 restart를 만드세요.', uses: ['initial'], hint: 'initial 블록을 Output에 이으세요.',
        tests: [{ args: [model(3, 1)], after: ['left'], expect: '20' }] },
    ]),
    unit('game', 'handle', '메시지마다 동작을 골라요: Take1 → move 1, Take2 → move 2, Restart → restart.', [
      { id: 'nim-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Model -> Model', types: ['Model', 'Msg'],
        prompt: 'handle msg m을 만드세요.', uses: ['caseMsg', 'move', 'restart', 'apply'],
        hint: 'apply (caseMsg (move 1) (move 2) restart msg) m.',
        tests: [{ args: ['Take1', model(20, 0)], after: ['left'], expect: '18' }, { args: ['Take2', model(20, 0)], after: ['left'], expect: '17' }, { args: ['Restart', model(3, 1)], after: ['left'], expect: '20' }] },
    ]),
    unit('game', 'view', '화면이에요: 남은 돌의 수, 돌 그림(● ● …), 상황 문구, 버튼 셋.', [
      { id: 'nim-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: ['Model', 'Msg'],
        prompt: 'column [heading "Nim", text ("Stones left: " ++ show (left m)), text (concat (replicate (left m) "● ")), text (status m), row [button "Take 1" Take1, button "Take 2" Take2, button "New game" Restart]]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'row', 'heading', 'text', 'button', 'replicate', 'concat', 'status', 'show', '(++)', '[ , , ]'], hint: 'replicate 3 "● " 은 ["● ", "● ", "● "], concat이 이어 붙여요.' },
    ]),
    unit('game', 'step', '시간의 흐름이에요. 님은 차례로만 진행돼요.', [
      stepBuild('nim-', { signature: 'Double -> Model -> Model', types, test: { args: ['0.5', model(7, 1)], after: ['left'], expect: '7' } }),
    ]),
    unit('game', 'main', '모두 묶어 님을 완성해요. 첫 수로 무엇을 가져가야 CPU를 이길 수 있을까요?', [
      mainBuild('nim-', { signature: 'Program Model Msg', types: ['Model', 'Msg'] }),
    ]),
  ]
}
