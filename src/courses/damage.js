import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// The damage pipeline (examples/damage.js): currying and composition.
// Each upgrade is a partially applied operator, switched on or off with
// `select b f identity`; the hit is their composition applied to 10.
export function damageUnits() {
  const course = 'damage'
  const PARTS = {
    state: { title: '상태와 메시지', intro: '강화 세 가지(날 세우기 +5, 치명타 ×2, 방어구 −3)를 켜고 끄는 Bool과, 적용 순서를 바꾸는 Bool이 상태예요.' },
    upgrades: { title: '강화 함수', intro: '강화는 모두 Int -> Int 함수예요. (+ 5)처럼 연산자의 슬롯 하나를 비워 두면 바로 그런 함수가 되고(부분 적용), select b f identity 로 켜고 끌 수 있어요.' },
    pipeline: { title: '합성', intro: 'compose f g 는 g를 먼저, f를 나중에 적용하는 함수예요(f . g). 순서를 바꾸면 결과가 달라질 수 있어요.' },
    game: { title: '게임 완성', intro: '버튼으로 강화를 켜고 끄며, 식과 결과를 화면에 보여 줘요.' },
  }
  const unit = unitMaker(course, 'dm-', PARTS)
  const types = ['Model']
  return [
    unit('state', 'Model', `강화마다 켜짐(True)/꺼짐(False), 그리고 치명타를 먼저 적용할지(critFirst). ${freshProject('데미지 계산기')}`, [
      { id: 'dm-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { sharp :: Bool, crit :: Bool, armor :: Bool, critFirst :: Bool } deriving (Show)',
        prompt: '상태 Model을 레코드로 선언하세요: sharp, crit, armor, critFirst — 모두 Bool, 이 순서로. Show를 유도하세요.', hint: '생성자 Model 하나에 Bool 필드 넷.' },
    ]),
    unit('state', 'Msg', '버튼 넷: 강화 셋을 하나씩 켜고 끄기, 순서 바꾸기.', [
      { id: 'dm-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Sharpen | Crit | Armor | Swap deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: Sharpen, Crit, Armor, Swap — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 넷.' },
    ]),
    unit('upgrades', 'weapon', '날 세우기: 켜져 있으면 +5, 꺼져 있으면 그대로(identity).', [
      { id: 'dm-section-choice', kind: 'choice', title: '슬롯을 비운 연산자', prompt: '(+)의 둘째 슬롯에만 5를 넣고 첫 슬롯을 비워 둔 블록, (+ 5)의 타입은?',
        options: [
          { text: 'Int', why: '슬롯 하나가 비어 있어서 아직 수가 아니에요.' },
          { text: 'Int -> Int', correct: true, why: '빈 슬롯 하나를 받는 함수예요: (+ 5) 10 == 15. 함수도 값이라서 다른 함수에 넘기거나 고를 수 있어요.' },
          { text: 'Int -> Int -> Int', why: '슬롯 하나를 채웠으니 인자가 하나 줄었어요.' },
        ] },
      { id: 'dm-identity-type', kind: 'type', title: 'identity의 타입', expr: 'identity', answer: 'a -> a', engine: 'identity',
        prompt: '받은 것을 그대로 돌려주는 기초 함수 identity의 타입을 쓰세요.', hint: '무엇이든 받아 같은 것을.', explain: '"아무것도 하지 않는 강화"예요. 합성해도 결과를 바꾸지 않아요(항등원).' },
      { id: 'dm-weapon', kind: 'build', title: 'weapon 만들기', name: 'weapon', params: ['b'], signature: 'Bool -> Int -> Int', types,
        prompt: 'weapon b를 만드세요: b가 True이면 (+ 5), 아니면 identity. 매개변수는 b 하나뿐이고 결과가 함수 Int -> Int예요 — 시그니처의 결과 자리에 Int -> Int를 적어요.', uses: ['select', '(+)', 'identity'],
        hint: 'select b (+ 5) identity. (+)는 둘째 슬롯에만 5, identity는 슬롯을 비워요.',
        tests: [{ args: ['True', '10'], expect: '15' }, { args: ['False', '10'], expect: '10' }] },
    ]),
    unit('upgrades', 'critical', '치명타: 켜져 있으면 ×2.', [
      { id: 'dm-critical', kind: 'build', title: 'critical 만들기', name: 'critical', params: ['b'], signature: 'Bool -> Int -> Int', types,
        prompt: 'critical b를 만드세요: b가 True이면 (* 2), 아니면 identity.', uses: ['select', '(*)', 'identity'], hint: 'weapon과 같은 모양이에요.',
        tests: [{ args: ['True', '10'], expect: '20' }, { args: ['False', '7'], expect: '7' }] },
    ]),
    unit('upgrades', 'shield', '방어구: 켜져 있으면 −3.', [
      { id: 'dm-minus-choice', kind: 'choice', title: '빼기의 빈 슬롯', prompt: '(-)의 첫 슬롯을 비우고 둘째 슬롯에 3을 넣은 함수에 x를 주면?',
        options: [
          { text: 'x - 3', correct: true, why: '빈 첫 슬롯에 x가 들어가요: (subtract 3) x. 하스켈에서 (- 3)이라고 쓰면 음수 −3이 되므로 subtract 3이라고 써요.' },
          { text: '3 - x', why: '그것은 첫 슬롯에 3을 넣은 (3 -)예요.' },
        ] },
      { id: 'dm-shield', kind: 'build', title: 'shield 만들기', name: 'shield', params: ['b'], signature: 'Bool -> Int -> Int', types,
        prompt: 'shield b를 만드세요: b가 True이면 3을 빼는 함수, 아니면 identity.', uses: ['select', '(-)', 'identity'], hint: '(-)의 둘째 슬롯에만 3.',
        tests: [{ args: ['True', '10'], expect: '7' }, { args: ['False', '10'], expect: '10' }] },
    ]),
    unit('pipeline', 'pipeline', '강화를 합성해 하나의 함수로: 방어구는 언제나 마지막, 날과 치명타는 critFirst가 정한 순서로.', [
      { id: 'dm-compose-type', kind: 'type', title: 'compose의 타입', expr: 'compose', answer: '(b -> c) -> (a -> b) -> a -> c', engine: 'compose',
        prompt: 'compose f g x = f (g x). 기초 함수 compose의 타입을 쓰세요.', hint: 'g :: a -> b 의 결과를 f :: b -> c 가 받아요.',
        explain: '하스켈에서는 f . g 라고 써요. 오른쪽(g)이 먼저예요.' },
      { id: 'dm-order-choice', kind: 'choice', title: '합성의 순서', prompt: 'compose (* 2) (+ 5) 를 10에 적용하면?',
        options: [
          { text: '30', correct: true, why: '(+ 5)가 먼저: 15, 그다음 (* 2): 30.' },
          { text: '25', why: '그것은 compose (+ 5) (* 2) — 곱하기가 먼저일 때예요.' },
        ] },
      { id: 'dm-pipeline', kind: 'build', title: 'pipeline 만들기', name: 'pipeline', params: ['m'], signature: 'Model -> Int -> Int', types,
        prompt: 'pipeline m을 만드세요: w = weapon (sharp m), c = critical (crit m) 일 때 compose (shield (armor m)) (select (critFirst m) (compose w c) (compose c w)).', uses: ['weapon', 'critical', 'shield', 'compose', 'select', 'sharp', 'crit', 'armor', 'critFirst', '참조(Δ)'],
        hint: 'compose의 셋째 슬롯(x)은 비워 두면 합성된 함수가 돼요. w와 c는 두 번씩 쓰니 참조(Δ)를 만드세요.',
        tests: [{ args: ['Model True True False False', '10'], expect: '30' }, { args: ['Model True True False True', '10'], expect: '25' }, { args: ['Model False False True False', '10'], expect: '7' }] },
    ]),
    unit('pipeline', 'damage', '기본 피해 10에 합성된 함수를 적용해요.', [
      { id: 'dm-damage', kind: 'build', title: 'damage 만들기', name: 'damage', params: ['m'], signature: 'Model -> Int', types,
        prompt: 'damage m = apply (pipeline m) 10 을 만드세요.', uses: ['pipeline', 'apply'], hint: 'pipeline m 은 함수예요. apply로 10에 적용해요.',
        tests: [{ args: ['Model True True True False'], expect: '27' }, { args: ['Model False False False False'], expect: '10' }] },
    ]),
    unit('pipeline', 'label', '강화 하나의 이름표예요: 켜져 있으면 그 이름, 꺼져 있으면 "id".', [
      { id: 'dm-label', kind: 'build', title: 'label 만들기', name: 'label', params: ['b', 's'], signature: 'Bool -> String -> String',
        prompt: 'label b s를 만드세요: b가 True이면 s, 아니면 "id".', uses: ['select'], hint: 'select b s "id".',
        tests: [{ args: ['True', '"(+5)"'], expect: '"(+5)"' }, { args: ['False', '"(+5)"'], expect: '"id"' }] },
    ]),
    unit('pipeline', 'formula', '합성된 함수를 식으로 보여 줘요: "(-3) . (*2) . (+5) $ 10".', [
      { id: 'dm-formula', kind: 'build', title: 'formula 만들기', name: 'formula', params: ['m'], signature: 'Model -> String', types,
        prompt: 'formula m을 만드세요: label (armor m) "(-3)" ++ " . " ++ 가운데 ++ " $ 10". 가운데는 critFirst m이면 w ++ " . " ++ c, 아니면 c ++ " . " ++ w (w = label (sharp m) "(+5)", c = label (crit m) "(*2)").', uses: ['label', 'armor', 'sharp', 'crit', 'critFirst', 'select', '(++)', '참조(Δ)'],
        hint: 'pipeline과 같은 모양을 글자로 쓴 것이에요.',
        tests: [{ args: ['Model False False False False'], expect: '"id . id . id $ 10"' }, { args: ['Model True True True False'], expect: '"(-3) . (*2) . (+5) $ 10"' }, { args: ['Model True True False True'], expect: '"id . (+5) . (*2) $ 10"' }] },
    ]),
    unit('game', 'handle', '버튼마다 Bool 필드 하나를 뒤집어요(not).', [
      { id: 'dm-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Model -> Model', types: ['Model', 'Msg'],
        prompt: 'handle msg m을 만드세요: Sharpen → over sharp not, Crit → over crit not, Armor → over armor not, Swap → over critFirst not.', uses: ['caseMsg', 'over sharp', 'over crit', 'over armor', 'over critFirst', 'not', 'apply'],
        hint: 'apply (caseMsg (over sharp not) (over crit not) (over armor not) (over critFirst not) msg) m.',
        tests: [{ args: ['Swap', 'Model True False False False'], after: ['critFirst'], expect: 'True' }, { args: ['Sharpen', 'Model True False False False'], after: ['sharp'], expect: 'False' }, { args: ['Armor', 'Model True False False False'], after: ['armor'], expect: 'True' }] },
    ]),
    unit('game', 'view', '화면이에요: 식, 피해, 피해만큼 긴 막대, 버튼 넷.', [
      { id: 'dm-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: ['Model', 'Msg'],
        prompt: 'column [heading "Damage pipeline", text (formula m), text ("Damage: " ++ show (damage m)), drawing 260 30 (color red (rectangleSolid (fromIntegral (damage m) * 8) 20)), row [button "Sharpen (+5)" Sharpen, button "Critical (*2)" Crit, button "Armor (-3)" Armor, button "Swap order" Swap]]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'row', 'heading', 'text', 'button', 'drawing', 'color', 'rectangleSolid', 'formula', 'damage', 'fromIntegral', 'show', '(++)'], hint: '막대의 길이는 Double이라 fromIntegral로 바꿔요.' },
    ]),
    unit('game', 'step', '시간의 흐름이에요. 아무것도 바뀌지 않아요.', [
      stepBuild('dm-', { signature: 'Double -> Model -> Model', types, test: { args: ['0.5', 'Model True False False False'], after: ['sharp'], expect: 'True' } }),
    ]),
    unit('game', 'initial', '처음에는 강화가 모두 꺼져 있어요.', [
      { id: 'dm-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types,
        prompt: '처음 상태 initial을 만드세요: Model False False False False.', uses: ['Model'], hint: '네 슬롯 모두 False.',
        tests: [{ args: [], after: ['damage'], expect: '10' }, { args: [], after: ['critFirst'], expect: 'False' }] },
    ]),
    unit('game', 'main', '모두 묶어 데미지 계산기를 완성해요. 순서를 바꾸면 피해가 달라지는지 확인해 보세요.', [
      mainBuild('dm-', { signature: 'Program Model Msg', types: ['Model', 'Msg'] }),
    ]),
  ]
}
