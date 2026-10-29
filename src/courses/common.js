// Shared pieces of the game courses (one file per template game in this
// folder, listed in exerciseContent.js). A game course rebuilds its
// template one function (or declared type) per unit — the questions that
// lead to it, then building it — grouped in parts, under the template's
// names and types, so the finished project plays the same game.

/** `unit(part, name, intro, exercises)` for a course whose exercise ids start with `prefix`. */
export const unitMaker = (course, prefix, parts) => (part, name, intro, exercises) => ({
  id: `${prefix}fn-${name}`, course, part: { id: part, ...parts[part] }, title: name, intro, exercises,
})

// The parts every game ends with, and the exercises they repeat.

/** step: a game where time changes nothing — the model as it is. */
export const stepBuild = (prefix, { signature, types, test }) => ({
  id: `${prefix}step`, kind: 'build', title: 'step 만들기', name: 'step', params: ['dt', 'm'], signature, types,
  prompt: '이 게임은 시간이 흘러도 변하는 것이 없어요. 상태를 그대로 돌려주는 step을 만드세요.', uses: [],
  hint: 'm 매개변수를 바로 Output에 이으세요. dt는 쓰지 않아요.', tests: [test],
})

/** main: program initial view handle step — graded by its type only. */
export const mainBuild = (prefix, { signature, types, step = 'step', hint = '' }) => ({
  id: `${prefix}main`, kind: 'build', title: 'main 만들기', name: 'main', params: [], signature, types,
  prompt: `모두 묶어 main = program initial view handle ${step} 을 만드세요. 그다음 main을 시작 함수로 정하고 실행하면 게임 완성이에요!`, uses: ['program', 'initial', 'view', 'handle', step],
  hint: hint || `view, handle, ${step}은 슬롯을 비운 채(함수 그 자체로) program의 슬롯에 넣어요.`,
})

/** The intro every game course's first unit shares: start from an empty project. */
export const freshProject = (game) => `새 프로젝트에서 시작하세요(다른 게임 과정과 함수 이름이 겹쳐요). 다 만들면 템플릿의 ${game}과 같은 게임이 돼요.`
