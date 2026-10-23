import { freshProject, mainBuild, stepBuild, unitMaker } from './common.js'

// The vending machine (examples/vending.js): functions and their types.
// The model is one Int, the balance, so every rule is read from its
// signature — `::` and `->`, and what partial application leaves.
export function vendingUnits() {
  const course = 'vending'
  const PARTS = {
    rules: { title: '함수와 타입', intro: '자판기의 잔액은 Int 하나예요. 규칙마다 시그니처(::)를 먼저 읽어요: 화살표(->)가 인자들과 결과를 나눠요.' },
    game: { title: '게임 완성', intro: '메시지를 선언하고, 규칙을 버튼에 연결해 게임으로 묶어요.' },
  }
  const unit = unitMaker(course, 'vd-', PARTS)
  return [
    unit('rules', 'insert', `동전을 넣으면 잔액이 그만큼 늘어요. ${freshProject('자판기')}`, [
      { id: 'vd-sig-choice', kind: 'choice', title: '시그니처 읽기', prompt: 'insert :: Int -> Int -> Int 는 무엇을 뜻할까요?',
        options: [
          { text: 'Int 두 개를 받아 Int 하나를 돌려주는 함수', correct: true, why: '마지막 화살표 뒤가 결과, 그 앞이 인자들이에요. insert coin total 은 Int예요.' },
          { text: 'Int 세 개를 받는 함수', why: 'Int가 세 번 나오지만 마지막은 결과예요.' },
          { text: 'Int 값 하나', why: '화살표가 있으면 함수예요.' },
        ] },
      { id: 'vd-partial-choice', kind: 'choice', title: '부분 적용', prompt: 'insert 100 (인자를 하나만 준 것)의 타입은?',
        options: [
          { text: 'Int', why: '인자가 하나 모자라서 아직 Int가 아니에요.' },
          { text: 'Int -> Int', correct: true, why: '인자 하나를 채우면 남은 Int -> Int, "잔액에 100을 더하는 함수"가 돼요. 버튼마다 이런 함수를 연결할 거예요.' },
          { text: 'Int -> Int -> Int', why: '인자를 하나 채웠으니 화살표가 하나 줄어요.' },
        ] },
      { id: 'vd-insert', kind: 'build', title: 'insert 만들기', name: 'insert', params: ['coin', 'total'], signature: 'Int -> Int -> Int',
        prompt: '동전 coin을 잔액 total에 더하는 insert를 만드세요.', uses: ['(+)'], hint: 'coin + total.',
        tests: [{ args: ['100', '300'], expect: '400' }, { args: ['500', '0'], expect: '500' }] },
    ]),
    unit('rules', 'refund', '돈을 돌려주면 잔액은 0이 돼요.', [
      { id: 'vd-refund', kind: 'build', title: 'refund 만들기', name: 'refund', params: ['total'], signature: 'Int -> Int',
        prompt: '잔액과 상관없이 0을 돌려주는 refund를 만드세요. 매개변수를 쓰지 않아도 돼요.', uses: ['수(#)'],
        hint: '수 블록(0)을 놓고 Output에 이으세요. total은 연결하지 않아요.',
        tests: [{ args: ['700'], expect: '0' }, { args: ['0'], expect: '0' }] },
    ]),
    unit('game', 'Msg', '버튼 세 개가 보내는 메시지예요: 100원, 500원, 반환.', [
      { id: 'vd-msg', kind: 'declare', title: 'Msg 선언', name: 'Msg', declaration: 'data Msg = Coin100 | Coin500 | Refund deriving (Eq, Show)',
        prompt: '메시지 Msg를 선언하세요: Coin100, Coin500, Refund — 이 순서로. Eq와 Show를 유도하세요.', hint: '필드 없는 생성자 셋.' },
      { id: 'vd-casemsg-type', kind: 'type', title: 'caseMsg의 타입', expr: 'caseMsg', answer: 'r -> r -> r -> Msg -> r',
        prompt: 'Msg의 분기 함수 caseMsg의 타입을 쓰세요. 생성자마다 결과 하나씩, 마지막에 Msg.', hint: '생성자 셋 → 결과 r 셋, 그리고 Msg.',
        explain: 'caseMsg a b c msg 는 Coin100이면 a, Coin500이면 b, Refund이면 c. r이 Int -> Int 함수일 수도 있어요.' },
    ]),
    unit('game', 'handle', '메시지마다 규칙 하나를 골라 잔액에 적용해요.', [
      { id: 'vd-handle', kind: 'build', title: 'handle 만들기', name: 'handle', params: ['msg', 'm'], signature: 'Msg -> Int -> Int', types: ['Msg'],
        prompt: 'handle msg m을 만드세요: Coin100 → insert 100, Coin500 → insert 500, Refund → refund.', uses: ['caseMsg', 'insert', 'refund', 'apply'],
        hint: 'apply (caseMsg (insert 100) (insert 500) refund msg) m. insert는 첫 슬롯만 채우고, refund는 슬롯을 비워요.',
        tests: [{ args: ['Coin100', '300'], expect: '400' }, { args: ['Coin500', '0'], expect: '500' }, { args: ['Refund', '700'], expect: '0' }] },
    ]),
    unit('game', 'view', '화면이에요: 제목, 잔액, 버튼 셋.', [
      { id: 'vd-view', kind: 'build', title: 'view 만들기', name: 'view', params: ['total'], signature: 'Int -> Widget Msg', types: ['Msg'],
        prompt: '화면 view를 만드세요: column [heading "Vending machine", text ("Balance: " ++ show total ++ " won"), row [button "+100" Coin100, button "+500" Coin500, button "Refund" Refund]]. 타입만 채점해요 — 실행해서 확인하세요.',
        uses: ['column', 'row', 'heading', 'text', 'button', 'show', '(++)', '[ , , ]'], hint: 'show total 이 Int를 글자로 바꿔요.' },
    ]),
    unit('game', 'step', '시간의 흐름이에요. 자판기는 가만히 있어요.', [
      stepBuild('vd-', { signature: 'Double -> Int -> Int', types: [], test: { args: ['0.5', '300'], expect: '300' } }),
    ]),
    unit('game', 'initial', '처음 잔액은 0원이에요.', [
      { id: 'vd-initial', kind: 'build', title: 'initial 만들기', name: 'initial', params: [], signature: 'Int',
        prompt: '처음 상태 initial을 만드세요: 0.', uses: ['수(#)'], hint: '수 블록 0을 Output에 이으세요.', tests: [{ args: [], expect: '0' }] },
    ]),
    unit('game', 'main', '모두 묶어 자판기를 완성해요.', [
      mainBuild('vd-', { signature: 'Program Int Msg', types: ['Msg'] }),
    ]),
  ]
}
