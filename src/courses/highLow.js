import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// High-Low (examples/highLow.js): type classes. Rank's order and names come
// from `deriving (Eq, Ord, Show)` — compare ranks the cards in constructor
// order and show names them, with no code of our own.
export function highLowUnits() {
  const course = 'highLow'
  const RANKS = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace']
  const PARTS = {
    rank: { title: '카드의 순서', intro: 'deriving (Eq, Ord, Show)만으로 Rank는 생성자 순서대로 비교되고(compare), 이름으로 보여져요(show). 직접 쓴 코드는 없어요 — 타입 클래스의 인스턴스가 해 줘요.' },
    state: { title: '상태와 메시지', intro: '지금 카드, 생성기, 연속 기록과 최고 기록, 안내 문구가 상태예요.' },
    game: { title: '게임 완성', intro: '다음 카드가 높을지 낮을지 맞히는 한 차례를 만들고 program으로 묶어요. 같은 카드가 나오면 기록을 지켜요.' },
  }
  const unit = unitMaker(course, 'hl-', PARTS)
  const types = ['Rank', 'Model']
  const model = (current, streak, best) => `Model ${current} (mkStdGen 1) ${streak} ${best} ""`
  return [
    unit('rank', 'Rank', `카드의 계급 13개예요: Two가 가장 낮고 Ace가 가장 높아요. ${freshProject('하이로우')}`, [
      { id: 'hl-rank', kind: 'declare', title: 'Rank 선언', name: 'Rank', declaration: `data Rank = ${RANKS.join(' | ')} deriving (Eq, Ord, Show)`,
        prompt: `계급 Rank를 선언하세요: ${RANKS.join(', ')} — 이 순서로. Eq, Ord, Show를 유도하세요.`, hint: '필드 없는 생성자 13개. 순서가 곧 크기 순서가 돼요.' },
      { id: 'hl-compare-type', kind: 'type', title: 'compare의 타입', expr: 'compare', answer: 'Ord a => a -> a -> Ordering', engine: 'compare',
        prompt: '두 값을 비교해 LT, EQ, GT 중 하나를 돌려주는 compare의 타입을 쓰세요.', hint: '순서가 있는 타입(Ord)의 두 값을 받아 Ordering.',
        explain: 'Ord a => 는 "a가 Ord의 인스턴스일 때만"이에요. deriving Ord가 Rank를 그런 타입으로 만들어요.' },
      { id: 'hl-order-choice', kind: 'choice', title: '유도된 순서', prompt: 'deriving Ord를 한 Rank에서 compare Ace Two 는?',
        options: [
          { text: 'LT', why: '유도된 Ord는 생성자를 선언한 순서로 비교해요. Ace는 마지막이라 가장 커요.' },
          { text: 'GT', correct: true, why: 'Ace가 Two보다 뒤에 선언되었으니 더 커요. 순서를 바꾸고 싶으면 instance Ord Rank를 직접 써요(예: Ace를 가장 낮게).' },
          { text: '타입 오류', why: 'Rank가 Ord를 유도했으니 compare를 쓸 수 있어요.' },
        ] },
    ]),
    unit('rank', 'ranks', '모든 계급의 리스트예요.', [
      { id: 'hl-ranks', kind: 'build', title: 'ranks 만들기', name: 'ranks', params: [], signature: '[Rank]', types: ['Rank'],
        prompt: 'ranks = [Two, Three, …, Ace] 를 만드세요 (13개, 순서대로).', uses: ['[ , , ]'], hint: '리스트 블록에 생성자 13개.',
        tests: [{ args: [], after: ['length'], expect: '13' }, { args: [], after: ['take 3'], expect: '[Two, Three, Four]' }] },
    ]),
    unit('rank', 'rankOf', '무작위 수 0~12를 계급으로 바꿔요.', [
      { id: 'hl-rankof', kind: 'build', title: 'rankOf 만들기', name: 'rankOf', params: ['i'], signature: 'Int -> Rank', types: ['Rank'],
        prompt: 'rankOf i = maybe Two identity (ranks !? i) 를 만드세요.', uses: ['ranks', '(!?)', 'maybe', 'identity', 'Two'], hint: '범위 밖이면 Two예요.',
        tests: [{ args: ['0'], expect: 'Two' }, { args: ['12'], expect: 'Ace' }, { args: ['13'], expect: 'Two' }] },
    ]),
    unit('state', 'Model', '지금 카드 current, 생성기 gen, 연속 streak, 최고 best, 안내 message.', [
      { id: 'hl-model', kind: 'declare', title: 'Model 선언', name: 'Model', declaration: 'data Model = Model { current :: Rank, gen :: StdGen, streak :: Int, best :: Int, message :: String } deriving (Show)',
        prompt: '상태 Model을 선언하세요: current :: Rank, gen :: StdGen, streak :: Int, best :: Int, message :: String — 이 순서로. Show를 유도하세요.', hint: '생성자 Model 하나에 필드 다섯.' },
    ]),
    unit('state', 'Msg', '버튼 둘: 높다(Hi), 낮다(Lo).', [
      { id: 'hl-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Hi | Lo deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: Hi, Lo — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 둘.' },
    ]),
    unit('game', 'guess', '한 차례예요: 다음 카드를 뽑아 지금 카드와 비교하고, 맞혔는지에 따라 기록을 바꿔요.', [
      { id: 'hl-caseordering-type', kind: 'type', title: 'caseOrdering의 타입', expr: 'caseOrdering', answer: 'r -> r -> r -> Ordering -> r',
        prompt: 'Prelude의 Ordering = LT | EQ | GT 에도 분기 함수 caseOrdering이 있어요. 그 타입을 쓰세요.', hint: '생성자 셋 → 결과 r 셋, 그리고 Ordering.',
        explain: 'caseOrdering (not up) True up (compare next cur): 낮으면 "낮다"를 골랐을 때, 같으면 언제나, 높으면 "높다"를 골랐을 때 맞혀요.' },
      { id: 'hl-guess', kind: 'build', title: 'guess 만들기', name: 'guess', params: ['up', 'm'], signature: 'Bool -> Model -> Model', types,
        prompt: 'guess up m을 만드세요: r = randomRInt (0, 12) (gen m), next = rankOf (fst r), ok = caseOrdering (not up) True up (compare next (current m)), s = select ok (streak m + 1) 0. 결과는 Model next (snd r) s (max (best m) s) (show (current m) ++ " → " ++ show next ++ select ok "  ✓" "  ✗").',
        uses: ['randomRInt', 'gen', 'fst', 'snd', 'rankOf', 'compare', 'current', 'caseOrdering', 'not', 'streak', 'best', 'max', 'select', 'show', '(++)', 'Model', '참조(Δ)'],
        hint: 'next, ok, s, r을 여러 번 쓰니 참조(Δ)를 만드세요.',
        tests: [{ args: ['True', model('Seven', 2, 5)], after: ['current'], expect: 'Ten' }, { args: ['True', model('Seven', 2, 5)], after: ['streak'], expect: '3' }, { args: ['True', model('Seven', 2, 5)], after: ['message'], expect: '"Seven → Ten  ✓"' }] },
    ]),
    unit('game', 'handle', '메시지마다: Hi → guess True, Lo → guess False.', [
      { id: 'hl-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Model -> Model', types: [...types, 'Msg'],
        prompt: 'handle msg m = apply (caseMsg (guess True) (guess False) msg) m 을 만드세요.', uses: ['caseMsg', 'guess', 'apply'], hint: 'guess는 첫 슬롯만 채워요.',
        tests: [{ args: ['Lo', model('Seven', 2, 5)], after: ['current'], expect: 'Ten' }, { args: ['Lo', model('Seven', 2, 5)], after: ['streak'], expect: '0' }, { args: ['Lo', model('Seven', 2, 5)], after: ['best'], expect: '5' }] },
    ]),
    unit('game', 'view', '화면이에요: 지금 카드, 안내, 기록, 버튼 둘.', [
      { id: 'hl-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['m'], signature: 'Model -> Widget Msg', types: [...types, 'Msg'],
        prompt: 'column [heading "High · Low", text ("Card: " ++ show (current m)), text (message m), text ("Streak " ++ show (streak m) ++ "  ·  Best " ++ show (best m)), row [button "Higher" Hi, button "Lower" Lo]]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'row', 'heading', 'text', 'button', 'show', 'current', 'message', 'streak', 'best', '(++)'], hint: 'show (current m) 은 유도된 Show가 만든 이름이에요.' },
    ]),
    unit('game', 'step', '시간의 흐름이에요. 아무것도 바뀌지 않아요.', [
      stepBuild('hl-', { signature: 'Double -> Model -> Model', types, test: { args: ['0.5', model('Ten', 1, 1)], after: ['current'], expect: 'Ten' } }),
    ]),
    unit('game', 'initial', '처음 상태예요: Seven부터, 기록 0.', [
      { id: 'hl-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Model', types,
        prompt: 'initial = Model Seven (mkStdGen 2026) 0 0 "Higher or lower?" 를 만드세요.', uses: ['Model', 'Seven', 'mkStdGen'], hint: '문자열 블록에 안내 문구.',
        tests: [{ args: [], after: ['current'], expect: 'Seven' }, { args: [], after: ['message'], expect: '"Higher or lower?"' }] },
    ]),
    unit('game', 'main', '모두 묶어 하이로우를 완성해요.', [
      mainBuild('hl-', { signature: 'Program Model Msg', types: [...types, 'Msg'] }),
    ]),
  ]
}
