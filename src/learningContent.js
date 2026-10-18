// Standalone Haskell lessons. These examples do not depend on graph runtime support.
export const syntaxLessons = [
  {
    id: 'functions', title: '함수 정의와 호출',
    description: '함수 이름 뒤에 매개변수를 쓰고, = 오른쪽에 결과를 정의합니다. 호출할 때는 함수와 인자를 공백으로 구분합니다.',
    code: 'double :: Int -> Int\ndouble x = x * 2\n\nanswer = double 4 -- 8',
    explanation: 'double 4는 x에 4를 전달합니다. 함수 호출에 쉼표나 괄호가 필수는 아닙니다. double (2 + 3)처럼 인자 식을 묶을 때 괄호를 씁니다.',
  },
  {
    id: 'types', title: '타입 선언과 화살표(::, ->)',
    description: '::는 이름이나 식의 타입을 나타냅니다. ->는 함수의 입력과 결과를 연결하며, 오른쪽으로 묶어 읽습니다.',
    code: 'sumTwo :: Int -> Int -> Int\nsumTwo x y = x + y\n\nanswer = sumTwo 2 3 -- 5',
    explanation: 'Int -> Int -> Int는 Int -> (Int -> Int)입니다. 정수 하나를 받으면, 다음 정수를 받아 정수를 반환하는 함수가 됩니다.',
  },
  {
    id: 'integers', title: 'Int와 Integer',
    description: '둘 다 정수 타입입니다. Int는 표현 범위가 제한되고, Integer는 필요한 만큼 자릿수가 늘어나는 임의 정밀도 정수입니다.',
    code: 'small :: Int\nsmall = 42\n\nlarge :: Integer\nlarge = 10 ^ 30',
    explanation: 'Int의 범위는 구현에 따라 달라집니다. Integer는 고정된 정수 범위를 넘는 계산에 쓸 수 있지만, 사용 가능한 메모리의 제한은 받습니다.',
  },
  {
    id: 'conditions', title: 'Bool과 조건식(if / then / else)',
    description: 'Bool 값은 True 또는 False입니다. if는 조건에 따라 값을 고르는 식이므로 then과 else가 모두 필요하고, 두 결과의 타입이 같아야 합니다.',
    code: 'choose :: Bool -> Int -> Int -> Int\nchoose condition x y =\n  if condition then x else y\n\nanswer = choose True 10 20 -- 10',
    explanation: '조건이 True이면 x, False이면 y를 반환합니다. 위 예제에서는 두 선택지가 모두 Int입니다.',
  },
  {
    id: 'currying', title: '커링과 부분 적용',
    description: 'Haskell 함수는 인자를 하나씩 받습니다. 필요한 인자 중 일부만 주면, 나머지 인자를 기다리는 새 함수를 얻습니다.',
    code: 'sumTwo :: Int -> Int -> Int\nsumTwo x y = x + y\n\naddFive :: Int -> Int\naddFive = sumTwo 5\n\nanswer = addFive 3 -- 8',
    explanation: 'sumTwo 5는 첫 번째 인자를 5로 정한 함수입니다. addFive 3을 호출하면 남은 인자에 3이 들어가 8이 됩니다.',
  },
  {
    id: 'composition', title: '함수 합성(.)',
    description: 'f . g는 g의 결과를 f에 전달하는 함수입니다. (f . g) x는 f (g x)와 같으므로 오른쪽 함수가 먼저 적용됩니다.',
    code: 'double :: Int -> Int\ndouble x = x * 2\n\nnext :: Int -> Int\nnext x = x + 1\n\nanswer = (double . next) 3 -- 8',
    explanation: '먼저 next 3이 4가 되고, double 4가 8이 됩니다. 안쪽 함수의 결과 타입과 바깥 함수의 입력 타입이 맞아야 합니다.',
  },
  {
    id: 'lists', title: '리스트 기초',
    description: '리스트는 같은 타입의 값을 순서대로 담습니다. [ ]로 감싸고 쉼표로 구분하며, 빈 리스트는 []입니다. :는 리스트 앞에 원소 하나를 붙입니다.',
    code: 'numbers :: [Int]\nnumbers = [1, 2, 3]\n\nmore = 0 : numbers -- [0, 1, 2, 3]\ncount = length numbers -- 3',
    explanation: '[Int]는 Int 원소를 담는 리스트 타입입니다. 0 : numbers는 0을 맨 앞에 붙인 새 리스트를 만들고, length는 원소 개수를 반환합니다.',
  },
  {
    id: 'patterns', title: '패턴 매칭',
    description: '값의 모양에 따라 함수의 정의를 나눌 수 있습니다. 위에서부터 처음 맞는 패턴을 사용합니다. 빈 경우와 나머지 경우를 모두 다루는 것이 좋습니다.',
    code: 'firstOrZero :: [Int] -> Int\nfirstOrZero [] = 0\nfirstOrZero (x:_) = x\n\nanswer = firstOrZero [7, 8] -- 7',
    explanation: '[]는 빈 리스트와 맞습니다. (x:_)는 비어 있지 않은 리스트에서 첫 원소를 x에 담고, _로 나머지를 사용하지 않음을 나타냅니다.',
  },
]

export const exampleProblems = [
  { id: 'sum', title: '두 수 더하기' },
  { id: 'zero', title: '0인지 판별하기' },
  { id: 'choose', title: '조건에 따라 값 선택하기' },
  { id: 'partial', title: '부분 적용 함수 만들기' },
  { id: 'compose', title: '함수 합성하기' },
]
