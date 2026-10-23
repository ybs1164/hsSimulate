import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// Simon (examples/simon.js): lists and recursion. The pattern and what
// you've entered are both `[Pad]`; a round is list work — append a random
// pad, compare a prefix with take, count with length, draw with map.
export function simonUnits() {
  const course = 'simon'
  const PARTS = {
    pads: { title: '패드', intro: '색 패드 네 개가 게임의 알파벳이에요. 패턴도, 내가 누른 것도 모두 패드의 리스트 [Pad]예요.' },
    state: { title: '상태와 메시지', intro: '패턴, 지금까지 누른 것, 생성기, 최고 기록, 틀렸는지를 담아요. 메시지 Press Pad는 누른 패드를 싣고 와요.' },
    rounds: { title: '라운드', intro: '라운드는 리스트 작업이에요: 패턴 끝에 무작위 패드 붙이기(++), 누른 것과 패턴의 앞부분 비교(take), 길이 세기(length).' },
    screen: { title: '화면', intro: '패턴을 글로 보여 주고, 패드마다 색 버튼을 map으로 만들어요.' },
    game: { title: '게임 완성', intro: '처음 상태를 만들고 program으로 묶어요.' },
  }
  const unit = unitMaker(course, 'sm-', PARTS)
  const types = ['Pad', 'Model']
  const model = (pattern, entered, best = 0, failed = 'False') => `Model ${pattern} ${entered} (mkStdGen 7) ${best} ${failed}`
  return [
    unit('pads', 'Pad', `색 패드 네 개예요. ${freshProject('사이먼')}`, [
      { id: 'sm-pad', kind: 'declare', title: 'Pad 선언', name: 'Pad', declaration: 'data Pad = Red | Green | Blue | Yellow deriving (Eq, Show)',
        prompt: '패드 Pad를 선언하세요: Red, Green, Blue, Yellow — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 넷.' },
    ]),
    unit('pads', 'pads', '모든 패드의 리스트예요. 화면의 버튼 줄과 무작위 고르기에 써요.', [
      { id: 'sm-pads', kind: 'build', title: 'pads 만들기', name: 'pads', params: [], signature: '[Pad]', types: ['Pad'],
        prompt: 'pads = [Red, Green, Blue, Yellow] 를 만드세요.', uses: ['[ , , ]', 'Red', 'Green', 'Blue', 'Yellow'], hint: '리스트 블록에 생성자 넷.',
        tests: [{ args: [], expect: '[Red, Green, Blue, Yellow]' }, { args: [], after: ['length'], expect: '4' }] },
    ]),
    unit('pads', 'toPad', '무작위 수 0~3을 패드로 바꿔요.', [
      { id: 'sm-topad', kind: 'build', title: 'toPad 만들기', name: 'toPad', params: ['i'], signature: 'Int -> Pad', types: ['Pad'],
        prompt: 'toPad i = maybe Red identity (pads !? i) 를 만드세요. 범위 밖이면 Red예요.', uses: ['pads', '(!?)', 'maybe', 'identity', 'Red'],
        hint: '(!?)는 Maybe Pad를 돌려줘요. maybe로 Nothing일 때의 값(Red)을 정해요.',
        tests: [{ args: ['0'], expect: 'Red' }, { args: ['3'], expect: 'Yellow' }, { args: ['9'], expect: 'Red' }] },
    ]),
    unit('state', 'Model', '패턴과 누른 것은 [Pad], 그리고 생성기·최고 기록·틀림 여부.', [
      { id: 'sm-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { pattern :: [Pad], entered :: [Pad], gen :: StdGen, best :: Int, failed :: Bool } deriving (Show)',
        prompt: '상태 Model을 선언하세요: pattern, entered :: [Pad], gen :: StdGen, best :: Int, failed :: Bool — 이 순서로. Show를 유도하세요.', hint: '필드 타입에 리스트 [ ]를 끌어다 놓고 그 안에 Pad.' },
    ]),
    unit('state', 'Msg', '패드를 눌렀다(Press Pad), 새 게임(Start).', [
      { id: 'sm-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Press Pad | Start deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: 필드 Pad 하나를 가진 Press, 필드 없는 Start — 이 순서로. Eq와 Show를 유도하세요.', hint: 'Press에 이름 없는 필드 Pad.' },
    ]),
    unit('rounds', 'grow', '라운드를 하나 늘려요: 패턴 끝에 무작위 패드를 붙이고, 누른 것은 비워요.', [
      { id: 'sm-append-choice', kind: 'choice', title: '끝에 붙이기', prompt: '패턴 ps의 끝에 패드 p를 붙인 리스트는?',
        options: [
          { text: 'p : ps', why: '(:)는 앞에 붙여요.' },
          { text: 'ps ++ [p]', correct: true, why: '(++)는 리스트 두 개를 이어요. p 하나를 [p]로 감싸 리스트로 만들어요.' },
          { text: 'ps ++ p', why: 'p는 리스트가 아니라 Pad라서 타입이 맞지 않아요.' },
        ] },
      { id: 'sm-grow', kind: 'build', title: 'grow 만들기', name: 'grow', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'grow m을 만드세요: r = randomRInt (0, 3) (gen m) 일 때 Model (pattern m ++ [toPad (fst r)]) [] (snd r) (max (best m) (length (pattern m))) False.', uses: ['randomRInt', 'gen', 'fst', 'snd', 'toPad', '[ , , ]', '(++)', 'pattern', '[]', 'max', 'best', 'length', 'Model', '참조(Δ)'],
        hint: '최고 기록은 지금까지 완성한 패턴의 길이와 비교해 큰 쪽이에요.',
        tests: [{ args: [model('[Red, Green]', '[Red]')], after: ['pattern', 'length'], expect: '3' }, { args: [model('[Red, Green]', '[Red]')], after: ['pattern', 'take 2'], expect: '[Red, Green]' },
          { args: [model('[Red, Green]', '[Red]')], after: ['entered'], expect: '[]' }, { args: [model('[Red, Green]', '[Red]')], after: ['best'], expect: '2' }] },
    ]),
    unit('rounds', 'check', '누른 것을 확인해요: 패턴의 앞부분과 같으면 계속, 다 맞혔으면 다음 라운드, 틀리면 실패.', [
      { id: 'sm-take-type', kind: 'type', title: 'take의 타입', expr: 'take', answer: 'Int -> [a] -> [a]', engine: 'take',
        prompt: '리스트의 앞 n개를 꺼내는 take의 타입을 쓰세요.', hint: '개수 Int와 리스트를 받아 같은 타입의 리스트.',
        explain: 'take (length e) p 는 패턴 p에서 누른 개수만큼의 앞부분이에요. 그것이 e와 같으면 지금까지 맞게 누른 거예요.' },
      { id: 'sm-check', kind: 'build', title: 'check 만들기', name: 'check', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'check m을 만드세요: p = pattern m, e = entered m. take (length e) p == e 이면 — length e == length p 이면 grow m, 아니면 m. 같지 않으면 set failed True m.', uses: ['pattern', 'entered', 'take', 'length', '(==)', 'grow', 'select', 'set failed', '참조(Δ)'],
        hint: 'select (take (length e) p == e) (select (length e == length p) (grow m) m) (set failed True m).',
        tests: [{ args: [model('[Red, Green]', '[Red]')], after: ['entered'], expect: '[Red]' }, { args: [model('[Red, Green]', '[Blue]')], after: ['failed'], expect: 'True' },
          { args: [model('[Red, Green]', '[Red, Green]')], after: ['pattern', 'length'], expect: '3' }] },
    ]),
    unit('rounds', 'press', '패드를 누르면 누른 것 끝에 붙이고 확인해요. 이미 틀렸으면 무시해요.', [
      { id: 'sm-press', kind: 'build', title: 'press 만들기', name: 'press', params: ['p', 'm'], signature: 'Pad -> Model -> Model', types,
        prompt: 'press p m = select (failed m) m (check (over entered (++ [p]) m)) 를 만드세요.', uses: ['failed', 'over entered', '(++)', '[ , , ]', 'check', 'select'],
        hint: '(++)의 둘째 슬롯에만 [p]를 넣으면 "끝에 p 붙이기" 함수가 돼요.',
        tests: [{ args: ['Red', model('[Red, Green]', '[]')], after: ['entered'], expect: '[Red]' }, { args: ['Red', model('[Red, Green]', '[]', 0, 'True')], after: ['entered'], expect: '[]' }] },
    ]),
    unit('rounds', 'start', '새 게임이에요: 패턴을 비우고(최고 기록과 생성기는 그대로) 첫 패드를 붙여요.', [
      { id: 'sm-start', kind: 'build', title: 'start 만들기', name: 'start', params: ['m'], signature: 'Model -> Model', types,
        prompt: 'start m = grow (Model [] [] (gen m) (best m) False) 를 만드세요.', uses: ['grow', 'Model', '[]', 'gen', 'best'], hint: '빈 리스트 블록 둘.',
        tests: [{ args: [model('[Red, Green]', '[Red]', 4, 'True')], after: ['pattern', 'length'], expect: '1' }, { args: [model('[Red, Green]', '[Red]', 4, 'True')], after: ['best'], expect: '4' },
          { args: [model('[Red, Green]', '[Red]', 4, 'True')], after: ['failed'], expect: 'False' }] },
    ]),
    unit('rounds', 'handle', '메시지마다 동작을 골라요: Press p → press p, Start → start.', [
      { id: 'sm-casemsg-type', kind: 'type', title: 'caseMsg의 타입', expr: 'caseMsg', answer: '(Pad -> r) -> r -> Msg -> r',
        prompt: 'Msg의 분기 함수 caseMsg의 타입을 쓰세요. Press의 갈래는 필드 Pad를 받는 함수예요.', hint: 'Press 갈래 (Pad -> r), Start 갈래 r, 그리고 Msg.' },
      { id: 'sm-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Model -> Model', types: [...types, 'Msg'],
        prompt: 'handle msg m = apply (caseMsg press start msg) m 을 만드세요.', uses: ['caseMsg', 'press', 'start', 'apply'], hint: 'press, start는 슬롯을 비워 함수 그대로 넣어요.',
        tests: [{ args: ['Press Red', model('[Red, Green]', '[]')], after: ['entered'], expect: '[Red]' }, { args: ['Start', model('[Red, Green]', '[Red]')], after: ['pattern', 'length'], expect: '1' }] },
    ]),
    unit('screen', 'padLabel', '패드 이름 뒤에 공백을 붙여요.', [
      { id: 'sm-padlabel', kind: 'build', title: 'padLabel 만들기', name: 'padLabel', params: ['p'], signature: 'Pad -> String', types: ['Pad'],
        prompt: 'padLabel p = show p ++ " " 를 만드세요. Pad가 Show를 유도해서 show를 쓸 수 있어요.', uses: ['show', '(++)'], hint: 'show p 는 "Red" 같은 생성자 이름이에요.',
        tests: [{ args: ['Red'], expect: '"Red "' }, { args: ['Yellow'], expect: '"Yellow "' }] },
    ]),
    unit('screen', 'padButton', '패드 하나의 색 버튼이에요. 누르면 Press p를 보내요.', [
      { id: 'sm-padbutton', kind: 'build', title: 'padButton 만들기', name: 'padButton', params: ['p'], signature: 'Pad -> Widget Msg', types: ['Pad', 'Msg'],
        prompt: 'padButton p = withColor (casePad red green blue yellow p) (button (show p) (Press p)) 를 만드세요. 타입만 채점해요.', uses: ['withColor', 'casePad', 'red', 'green', 'blue', 'yellow', 'button', 'show', 'Press', '참조(Δ)'],
        hint: 'casePad가 패드마다 색 하나를 골라요.' },
    ]),
    unit('screen', 'hint', '안내 문구예요: 틀렸으면 기록, 아직 안 눌렀으면 외울 패턴, 누르는 중이면 누른 것.', [
      { id: 'sm-hint', kind: 'build', title: 'hint 만들기', name: 'hint', params: ['m'], signature: 'Model -> String', types,
        prompt: 'hint m을 만드세요: failed m이면 "Wrong! Best: " ++ show (best m) ++ " rounds", 아니면 — entered m이 비었으면(null) "Remember: " ++ concatMap padLabel (pattern m), 아니면 "Now repeat it: " ++ concatMap padLabel (entered m).', uses: ['failed', 'best', 'show', 'null', 'entered', 'pattern', 'concatMap', 'padLabel', 'select', '(++)'],
        hint: 'select (failed m) 틀림 (select (null (entered m)) 외우기 따라하기).',
        tests: [{ args: [model('[Red]', '[]', 3, 'True')], expect: '"Wrong! Best: 3 rounds"' }, { args: [model('[Red, Green]', '[]')], expect: '"Remember: Red Green "' }, { args: [model('[Red, Green]', '[Red]')], expect: '"Now repeat it: Red "' }] },
    ]),
    unit('screen', 'view', '화면이에요: 라운드 수, 안내, 패드 버튼 줄, 새 게임 버튼.', [
      { id: 'sm-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: [...types, 'Msg'],
        prompt: 'column [heading "Simon", text ("Round " ++ show (length (pattern m))), text (hint m), row (map padButton pads), button "New game" Start]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'row', 'heading', 'text', 'button', 'map', 'padButton', 'pads', 'hint', 'length', 'show', '(++)'], hint: 'map padButton pads 는 버튼 네 개의 리스트 [Widget Msg]예요.' },
    ]),
    unit('game', 'step', '시간의 흐름이에요. 아무것도 바뀌지 않아요.', [
      stepBuild('sm-', { signature: 'Double -> Model -> Model', types, test: { args: ['0.5', model('[Red]', '[]')], after: ['pattern'], expect: '[Red]' } }),
    ]),
    unit('game', 'initial', '처음 상태예요: 빈 Model에서 start로 첫 라운드를 시작해요.', [
      { id: 'sm-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types,
        prompt: 'initial = start (Model [] [] (mkStdGen 7) 0 False) 를 만드세요.', uses: ['start', 'Model', '[]', 'mkStdGen'], hint: '씨앗은 7이에요.',
        tests: [{ args: [], after: ['pattern', 'length'], expect: '1' }, { args: [], after: ['best'], expect: '0' }] },
    ]),
    unit('game', 'main', '모두 묶어 사이먼을 완성해요.', [
      mainBuild('sm-', { signature: 'Program Model Msg', types: [...types, 'Msg'] }),
    ]),
  ]
}
