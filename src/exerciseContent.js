// The basic practice course: arithmetic, then logic, then lists. Each unit
// mixes three kinds of exercise (graded by grader.js), all about types:
//
//   type   — "what is the type of `expr`?" `answer` is the Haskell
//            Prelude's type; `accept` lists other right answers; `engine`
//            names a builtin whose scheme in this app (builtinSchemes.js,
//            with its finer numeric classes) also counts.
//   choice — pick one option; `correct` marks the right one, `why` is the
//            feedback shown for each.
//   build  — define `name :: signature` on the canvas: write the signature
//            on its parameters and Output, build the body, and pass `tests`
//            (arguments as Haskell values, the expected result as `show` prints it).
//            `uses` are the blocks it takes, as a hint. `params` are the
//            ones the definition names (fewer than the type's arrows when
//            it returns a function); a test's arguments past them go to
//            what it returns, and its `after` looks at part of the result
//            (`after: ['player']` checks player (f m)). With no `tests`,
//            only the types are graded; `types` are the project's own
//            types the signature needs.
//   declare — declare a type (`name`) as `declaration` reads: the same
//            constructors in order, the same fields, at least its deriving.
//
// Units belong to a course (COURSES): the basics, then one course per
// template game (src/courses/), each rebuilding it one function per unit.
import { blankGameUnits } from './courses/blankGame.js'
import { vendingUnits } from './courses/vending.js'
import { nimUnits } from './courses/nim.js'
import { diceUnits } from './courses/dice.js'
import { damageUnits } from './courses/damage.js'
import { rpsUnits } from './courses/rps.js'
import { simonUnits } from './courses/simon.js'
import { highLowUnits } from './courses/highLow.js'
import { clickCounterUnits } from './courses/clickCounter.js'
import { blackjackUnits } from './courses/blackjack.js'

export const EXERCISE_UNITS = [
  {
    id: 'arith', title: '산술 연산자',
    intro: '+, -, *는 Num 타입이면 무엇이든, /는 Fractional(실수), div·mod는 Integral(정수)에서 씁니다. 같은 연산자라도 타입이 무엇을 허락하는지가 중요해요.',
    exercises: [
      { id: 'arith-plus-type', kind: 'type', title: '(+)의 타입', expr: '(+)', answer: 'Num a => a -> a -> a', engine: 'plus',
        prompt: '더하기 연산자 (+)의 타입을 쓰세요. 두 인자와 결과가 모두 같은 숫자 타입이에요.',
        hint: 'Num a => 로 시작하고, 인자 두 개와 결과 하나가 모두 a예요.',
        explain: 'a는 어떤 숫자 타입이든 될 수 있지만, 한 번 정하면 세 자리가 모두 같아야 해요. 그래서 Int와 Double을 바로 더할 수는 없어요.' },
      { id: 'arith-divide-type', kind: 'type', title: '(/)의 타입', expr: '(/)', answer: 'Fractional a => a -> a -> a', engine: 'divide',
        prompt: '나누기 연산자 (/)의 타입을 쓰세요.',
        hint: '소수점이 있는 결과를 낼 수 있는 타입만 됩니다: Fractional.',
        explain: '(/)는 Fractional 타입(Double, Float, Rational)만 받아요. Int를 / 로 나누면 타입 오류가 납니다.' },
      { id: 'arith-div-type', kind: 'type', title: 'div의 타입', expr: 'div', answer: 'Integral a => a -> a -> a', engine: 'div',
        prompt: '정수 나눗셈 div의 타입을 쓰세요.',
        hint: '정수 타입의 클래스는 Integral이에요.',
        explain: 'div 7 2 는 3이에요. 몫만 남기므로 Integral(Int, Integer) 타입에서만 쓸 수 있어요.' },
      { id: 'arith-int-expr', kind: 'type', title: '구체적인 식의 타입', expr: '(3 :: Int) * 4 + 1', answer: 'Int',
        prompt: '식 (3 :: Int) * 4 + 1 의 타입을 쓰세요.',
        hint: '3이 Int로 정해지면, 같이 계산되는 4와 1도 같은 타입이 돼요.',
        explain: '(*)와 (+)는 인자와 결과 타입이 같으므로, 하나가 Int이면 식 전체가 Int예요.' },
      { id: 'arith-error', kind: 'choice', title: '타입 오류 찾기', prompt: '다음 중 타입 검사를 통과하지 못하는 식은?',
        options: [
          { text: '7 / 2', why: '7 / 2 는 숫자 리터럴이 Fractional로 정해져 3.5가 돼요. 오류가 아니에요.' },
          { text: 'div 7 2', why: 'div 7 2 는 정수 나눗셈으로 3이에요. 오류가 아니에요.' },
          { text: '(7 :: Int) / 2', correct: true, why: 'Int는 Fractional의 인스턴스가 아니어서 (/)를 쓸 수 없어요. 정수 나눗셈은 div를, 실수 결과가 필요하면 fromIntegral로 바꾸세요.' },
          { text: 'fromIntegral (7 :: Int) / 2', why: 'fromIntegral이 Int를 Fractional 타입으로 바꿔 주므로 통과해요.' },
        ] },
      { id: 'arith-double', kind: 'build', title: 'double 만들기', name: 'double', params: ['x'], signature: 'Int -> Int',
        prompt: '수를 두 배로 만드는 함수 double을 만드세요.', uses: ['(*)'],
        hint: '(*) 블록을 놓고 첫 슬롯에 x, 둘째 슬롯에 2를 연결한 뒤 Output에 이으세요.',
        tests: [{ args: ['4'], expect: '8' }, { args: ['0'], expect: '0' }, { args: ['-3'], expect: '-6' }] },
      { id: 'arith-square', kind: 'build', title: 'square 만들기', name: 'square', params: ['x'], signature: 'Int -> Int',
        prompt: '수를 제곱하는 함수 square를 만드세요. x를 두 번 써야 해요.', uses: ['(*)', '참조(Δ)'],
        hint: 'x를 한 번 더 쓰려면 매개변수를 선택하고 "use again"(Δ)으로 참조를 만드세요.',
        tests: [{ args: ['5'], expect: '25' }, { args: ['-4'], expect: '16' }, { args: ['0'], expect: '0' }] },
      { id: 'arith-average', kind: 'build', title: 'average 만들기', name: 'average', params: ['x', 'y'], signature: 'Double -> Double -> Double',
        prompt: '두 실수의 평균을 구하는 함수 average를 만드세요. 결과는 Double이므로 /를 쓸 수 있어요.', uses: ['(+)', '(/)'],
        hint: '(+)로 x와 y를 더하고, 그 결과를 (/)의 첫 슬롯에, 2를 둘째 슬롯에 넣으세요.',
        tests: [{ args: ['3', '4'], expect: '3.5' }, { args: ['10', '20'], expect: '15.0' }, { args: ['-1', '1'], expect: '0.0' }] },
      { id: 'arith-lastdigit', kind: 'build', title: 'lastDigit 만들기', name: 'lastDigit', params: ['n'], signature: 'Int -> Int',
        prompt: '자연수의 마지막 자릿수를 구하는 함수 lastDigit을 만드세요. (/)는 Int에 쓸 수 없다는 점을 기억하세요.', uses: ['mod'],
        hint: 'mod n 10 은 n을 10으로 나눈 나머지예요.',
        tests: [{ args: ['1234'], expect: '4' }, { args: ['7'], expect: '7' }, { args: ['50'], expect: '0' }] },
    ],
  },
  {
    id: 'logic', title: '논리 연산자',
    intro: 'Bool 값은 True와 False 둘뿐이에요. &&, ||, not은 Bool을 받아 Bool을 돌려주고, ==, <, >= 같은 비교는 Eq·Ord 타입의 두 값을 받아 Bool을 돌려줘요.',
    exercises: [
      { id: 'logic-not-type', kind: 'type', title: 'not의 타입', expr: 'not', answer: 'Bool -> Bool',
        prompt: 'not의 타입을 쓰세요.', hint: 'Bool 하나를 받아 Bool 하나를 돌려줘요.',
        explain: 'not True == False, not False == True.' },
      { id: 'logic-and-type', kind: 'type', title: '(&&)의 타입', expr: '(&&)', answer: 'Bool -> Bool -> Bool',
        prompt: '논리곱 (&&)의 타입을 쓰세요.', hint: 'Bool 두 개를 받아요.',
        explain: '(&&)는 두 인자가 모두 True일 때만 True예요. 첫 인자가 False이면 둘째 인자는 계산하지도 않아요(지연 평가).' },
      { id: 'logic-eq-type', kind: 'type', title: '(==)의 타입', expr: '(==)', answer: 'Eq a => a -> a -> Bool', engine: 'eq',
        prompt: '같음 비교 (==)의 타입을 쓰세요. 비교할 두 값은 같은 타입이어야 해요.',
        hint: '같은지 비교할 수 있는 타입의 클래스는 Eq예요. 결과는 Bool이에요.',
        explain: '인자는 a, 결과는 Bool이에요. 결과까지 a로 쓰면 틀려요. 1 == True 처럼 다른 타입끼리는 비교할 수 없어요.' },
      { id: 'logic-lt-type', kind: 'type', title: '(<)의 타입', expr: '(<)', answer: 'Ord a => a -> a -> Bool', engine: 'lt',
        prompt: '작다 비교 (<)의 타입을 쓰세요.', hint: '순서가 있는 타입의 클래스는 Ord예요.',
        explain: 'Ord는 Eq의 하위 클래스예요. 순서를 비교할 수 있으면 같음도 비교할 수 있어요.' },
      { id: 'logic-expr-type', kind: 'type', title: '조건식의 타입', expr: '3 > 2 && not False', answer: 'Bool',
        prompt: '식 3 > 2 && not False 의 타입을 쓰세요.', hint: '비교의 결과도, not의 결과도 Bool이에요.',
        explain: '3 > 2 는 Bool, not False 도 Bool이므로 (&&)를 적용할 수 있고 결과도 Bool이에요.' },
      { id: 'logic-error', kind: 'choice', title: '타입 오류 찾기', prompt: '다음 중 타입 검사를 통과하지 못하는 식은?',
        options: [
          { text: "'a' < 'b'", why: 'Char는 Ord의 인스턴스라서 비교할 수 있어요(True).' },
          { text: 'not 1', correct: true, why: 'not은 Bool만 받아요. 1은 숫자이고 Bool은 Num의 인스턴스가 아니어서 오류예요. Haskell은 0/1을 참·거짓으로 취급하지 않아요.' },
          { text: '1 == 1 || False', why: '1 == 1 은 Bool이라서 || False와 함께 쓸 수 있어요.' },
          { text: 'True /= False', why: 'Bool도 Eq의 인스턴스예요(True).' },
        ] },
      { id: 'logic-if-error', kind: 'choice', title: 'if 식의 타입', prompt: '다음 중 타입이 맞지 않는 식은?',
        options: [
          { text: 'if 3 > 2 then "yes" else "no"', why: '두 갈래가 모두 String이에요.' },
          { text: 'if True then 1 else "one"', correct: true, why: 'if는 식이라서 then과 else의 결과 타입이 같아야 해요. 1은 숫자, "one"은 String이에요.' },
          { text: 'if not False then 1 else 0', why: '조건은 Bool, 두 갈래는 숫자예요.' },
        ] },
      { id: 'logic-nand', kind: 'build', title: 'nand 만들기', name: 'nand', params: ['p', 'q'], signature: 'Bool -> Bool -> Bool',
        prompt: 'p와 q가 둘 다 True일 때만 False인 함수 nand를 만드세요.', uses: ['(&&)', 'not'],
        hint: 'not (p && q): (&&)의 결과를 not의 슬롯에 넣으세요.',
        tests: [{ args: ['True', 'True'], expect: 'False' }, { args: ['True', 'False'], expect: 'True' }, { args: ['False', 'True'], expect: 'True' }, { args: ['False', 'False'], expect: 'True' }] },
      { id: 'logic-xor', kind: 'build', title: 'xor 만들기', name: 'xor', params: ['p', 'q'], signature: 'Bool -> Bool -> Bool',
        prompt: 'p와 q 중 정확히 하나만 True일 때 True인 함수 xor를 만드세요.', uses: ['(/=)'],
        hint: '두 Bool이 서로 다르면 True: p /= q.',
        tests: [{ args: ['True', 'True'], expect: 'False' }, { args: ['True', 'False'], expect: 'True' }, { args: ['False', 'True'], expect: 'True' }, { args: ['False', 'False'], expect: 'False' }] },
      { id: 'logic-inrange', kind: 'build', title: 'inRange 만들기', name: 'inRange', params: ['x'], signature: 'Int -> Bool',
        prompt: 'x가 1 이상 10 이하인지 판별하는 함수 inRange를 만드세요.', uses: ['(>=)', '(<=)', '(&&)'],
        hint: '(x >= 1) && (x <= 10). x를 두 번 쓰므로 참조(Δ)가 필요해요.',
        tests: [{ args: ['1'], expect: 'True' }, { args: ['10'], expect: 'True' }, { args: ['0'], expect: 'False' }, { args: ['11'], expect: 'False' }, { args: ['5'], expect: 'True' }] },
    ],
  },
  {
    id: 'lists', title: '리스트',
    intro: '리스트 [a]는 같은 타입 a의 값들을 순서대로 담아요. (:)는 원소 하나를 앞에 붙이고, (++)는 두 리스트를 잇고, map·filter·length·sum이 리스트를 다뤄요.',
    exercises: [
      { id: 'lists-bool-type', kind: 'type', title: '리스트 값의 타입', expr: '[True, False, True]', answer: '[Bool]',
        prompt: '[True, False, True] 의 타입을 쓰세요.', hint: '원소의 타입을 대괄호로 감싸요.',
        explain: '[Bool]은 "Bool의 리스트"예요. 원소 개수는 타입에 나타나지 않아요.' },
      { id: 'lists-string-type', kind: 'type', title: '문자열의 타입', expr: '"hello"', answer: 'String', accept: ['[Char]'],
        prompt: '"hello" 의 타입을 쓰세요.', hint: '문자열은 문자(Char)의 리스트예요.',
        explain: 'String은 [Char]의 다른 이름이에요. 그래서 리스트 함수(length, reverse, ++)를 문자열에도 쓸 수 있어요.' },
      { id: 'lists-cons-type', kind: 'type', title: '(:)의 타입', expr: '(:)', answer: 'a -> [a] -> [a]', engine: 'cons',
        prompt: '원소를 리스트 앞에 붙이는 (:)의 타입을 쓰세요.', hint: '원소 a 하나와 [a]를 받아 [a]를 돌려줘요.',
        explain: '1 : [2, 3] == [1, 2, 3]. 원소와 리스트의 원소 타입이 같아야 해서 True : [1] 은 오류예요.' },
      { id: 'lists-map-type', kind: 'type', title: 'map의 타입', expr: 'map', answer: '(a -> b) -> [a] -> [b]', engine: 'map',
        prompt: 'map의 타입을 쓰세요. 함수 하나와 리스트 하나를 받아요.', hint: '첫 인자는 함수라서 괄호로 묶어요: (a -> b).',
        explain: 'map show [1, 2] == ["1", "2"]: a가 숫자, b가 String이 돼요. 괄호가 없으면 a -> b -> [a] -> [b], 인자 세 개짜리 함수가 돼 버려요.' },
      { id: 'lists-length-type', kind: 'type', title: 'length의 타입', expr: 'length', answer: '[a] -> Int', accept: ['Foldable t => t a -> Int'], engine: 'length',
        prompt: '리스트의 길이를 구하는 length의 타입을 쓰세요 (리스트에 대한 타입으로 써도 돼요).', hint: '원소가 무엇이든 상관없고, 결과는 Int예요.',
        explain: '원소의 타입은 아무래도 좋으니 변수 a예요. 실제 Prelude는 리스트뿐 아니라 모든 Foldable에 대해 Foldable t => t a -> Int로 일반화되어 있어요.' },
      { id: 'lists-error', kind: 'choice', title: '타입 오류 찾기', prompt: '다음 중 타입 검사를 통과하지 못하는 식은?',
        options: [
          { text: "'h' : \"ello\"", why: "'h'는 Char, \"ello\"는 [Char]이므로 (:)가 맞아요." },
          { text: '[1, True]', correct: true, why: '리스트의 원소는 모두 같은 타입이어야 해요. 1은 숫자, True는 Bool이에요.' },
          { text: '[] ++ [1, 2]', why: '[]는 어떤 원소 타입의 리스트도 될 수 있어서 [1, 2]와 이을 수 있어요.' },
          { text: 'length "abc"', why: 'String은 [Char]이므로 length를 쓸 수 있어요(3).' },
        ] },
      { id: 'lists-concat-choice', kind: 'choice', title: '(:)와 (++)', prompt: '[1, 2]와 3으로 [1, 2, 3]을 만드는, 타입이 맞는 식은?',
        options: [
          { text: '[1, 2] : 3', why: '(:)의 왼쪽은 원소, 오른쪽은 리스트예요. 순서가 거꾸로예요.' },
          { text: '[1, 2] ++ 3', why: '(++)는 리스트 두 개를 받아요. 3은 리스트가 아니에요.' },
          { text: '[1, 2] ++ [3]', correct: true, why: '두 리스트 [1, 2]와 [3]을 이어 [1, 2, 3]이 돼요.' },
          { text: '3 : [1, 2]', why: '타입은 맞지만 결과가 [3, 1, 2]예요.' },
        ] },
      { id: 'lists-prepend', kind: 'build', title: 'prependZero 만들기', name: 'prependZero', params: ['xs'], signature: '[Int] -> [Int]',
        prompt: '리스트 맨 앞에 0을 붙이는 함수 prependZero를 만드세요.', uses: ['(:)'],
        hint: '(:)의 첫 슬롯에 0, 둘째 슬롯에 xs.',
        tests: [{ args: ['[1, 2]'], expect: '[0, 1, 2]' }, { args: ['[]'], expect: '[0]' }] },
      { id: 'lists-total', kind: 'build', title: 'total 만들기', name: 'total', params: ['xs'], signature: '[Int] -> Int',
        prompt: '정수 리스트의 합을 구하는 함수 total을 만드세요.', uses: ['sum'],
        hint: 'sum xs. 결과 타입이 [Int]가 아니라 Int인 점에 주의하세요.',
        tests: [{ args: ['[1, 2, 3]'], expect: '6' }, { args: ['[]'], expect: '0' }, { args: ['[-5, 5, 10]'], expect: '10' }] },
      { id: 'lists-doubleall', kind: 'build', title: 'doubleAll 만들기', name: 'doubleAll', params: ['xs'], signature: '[Int] -> [Int]',
        prompt: '리스트의 모든 원소를 두 배로 만드는 함수 doubleAll을 만드세요.', uses: ['map', '(*)'],
        hint: 'map의 첫 슬롯에 둘째 슬롯만 2로 채운 (*)(즉 (* 2), 첫 슬롯은 비워 둠)를, 둘째 슬롯에 xs를 넣으세요.',
        tests: [{ args: ['[1, 2, 3]'], expect: '[2, 4, 6]' }, { args: ['[]'], expect: '[]' }] },
      { id: 'lists-countpos', kind: 'build', title: 'countPositive 만들기', name: 'countPositive', params: ['xs'], signature: '[Int] -> Int',
        prompt: '리스트에서 0보다 큰 원소의 개수를 세는 함수 countPositive를 만드세요.', uses: ['filter', '(>)', 'length'],
        hint: 'length (filter (> 0) xs). (>)의 둘째 슬롯에만 0을 넣으면 (> 0) 함수가 돼요.',
        tests: [{ args: ['[3, -1, 0, 5]'], expect: '2' }, { args: ['[]'], expect: '0' }, { args: ['[-2, -3]'], expect: '0' }] },
      { id: 'lists-palindrome', kind: 'build', title: 'isPalindrome 만들기', name: 'isPalindrome', params: ['s'], signature: 'String -> Bool',
        prompt: '문자열이 앞뒤로 같은지 판별하는 함수 isPalindrome을 만드세요.', uses: ['reverse', '(==)', '참조(Δ)'],
        hint: 's == reverse s. String은 [Char]라서 reverse를 쓸 수 있어요.',
        tests: [{ args: ['"level"'], expect: 'True' }, { args: ['"haskell"'], expect: 'False' }, { args: ['""'], expect: 'True' }] },
    ],
  },
  ...blankGameUnits(),
  ...vendingUnits(),
  ...nimUnits(),
  ...diceUnits(),
  ...damageUnits(),
  ...rpsUnits(),
  ...simonUnits(),
  ...highLowUnits(),
  ...clickCounterUnits(),
  ...blackjackUnits(),
]

// The courses, in order: each unit names its own (`course`, the basics when
// absent). A game course names its template (examples/), whose functions are
// the reference solutions its tests check.
const GAME = '템플릿 게임을 함수 하나씩 직접 만들어요. 앞에서 만든 함수와 타입을 뒤에서 그대로 쓰므로, 새 프로젝트 하나에서 순서대로 푸세요.'
export const COURSES = [
  { id: 'basics', title: '기초', intro: '연산자와 리스트의 타입부터 시작해요.' },
  { id: 'blankGame', template: 'blankGame', title: '빈 게임 — 게임의 뼈대', intro: `상태, 메시지, 화면, 시간 — 모든 게임이 가진 모양을 가장 작은 게임으로 익혀요. ${GAME}` },
  { id: 'vending', template: 'vending', title: '자판기 — 함수와 타입', intro: `시그니처를 읽고, 인자를 하나만 준 함수(부분 적용)를 버튼에 연결해요. ${GAME}` },
  { id: 'nim', template: 'nim', title: '님 — 조건', intro: `isZero와 ifThenElse·select로 규칙을 조건으로 써요. ${GAME}` },
  { id: 'dice', template: 'dice', title: '주사위 — 난수와 쌍', intro: `생성기를 상태에 담아 무작위 수를 순수하게 다뤄요. ${GAME}` },
  { id: 'damage', template: 'damage', title: '데미지 — 커링과 합성', intro: `슬롯을 비운 연산자로 함수를 만들고, compose로 합성해요. ${GAME}` },
  { id: 'rps', template: 'rps', title: '가위바위보 — 데이터 타입', intro: `합 타입과 분기 함수, Maybe, 값을 싣는 메시지를 다뤄요. ${GAME}` },
  { id: 'simon', template: 'simon', title: '사이먼 — 리스트와 재귀', intro: `패턴을 리스트로 다루며 붙이고, 자르고, 세고, 그려요. ${GAME}` },
  { id: 'highLow', template: 'highLow', title: '하이로우 — 타입 클래스', intro: `deriving으로 얻은 Eq·Ord·Show로 카드를 비교하고 보여 줘요. ${GAME}` },
  { id: 'clickCounter', template: 'clickCounter', title: '클릭 카운터 — 대수 구조와 구독', intro: `anyclass로 지갑에 덧셈과 순서를 주고, 시간과 키보드에 반응해요. ${GAME}` },
  { id: 'blackjack', template: 'blackjack', title: '블랙잭 — 모두 합쳐서', intro: `리스트, 재귀, 레코드, 난수를 모두 써서 카드 게임을 만들어요. ${GAME}` },
]
export const courseOf = (unit) => unit.course || 'basics'


/** Every exercise, in course order, with its unit's id. */
export const ALL_EXERCISES = EXERCISE_UNITS.flatMap((u) => u.exercises.map((e) => ({ ...e, unit: u.id })))
