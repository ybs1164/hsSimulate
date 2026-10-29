// Grades the game courses (src/courses/) the way the app does: one project
// with the template's types and, as the reference solutions, the template's
// own functions — each written with the signature its exercise asks for.
import { ALL_EXERCISES, COURSES, EXERCISE_UNITS } from '../src/exerciseContent.js'
import { buildProject, call, n, P } from '../src/examples/build.js'
import { libraryDefs } from '../src/library.js'
import { derivedInstances, typeArities, typeKinds } from '../src/typeDecls.js'
import { setDynamicInstances } from '../src/prelude.js'
import { setUserTypeArities } from '../src/typeSystem.js'
import { registryOf } from './curriculumHarness.js'
import { BLANK_GAME_FUNCTIONS, BLANK_GAME_TYPES } from '../src/examples/blankGame.js'
import { VENDING_FUNCTIONS, VENDING_TYPES } from '../src/examples/vending.js'
import { NIM_FUNCTIONS, NIM_TYPES } from '../src/examples/nim.js'
import { DICE_FUNCTIONS, DICE_TYPES } from '../src/examples/dice.js'
import { DAMAGE_FUNCTIONS, DAMAGE_TYPES } from '../src/examples/damage.js'
import { RPS_FUNCTIONS, RPS_TYPES } from '../src/examples/rps.js'
import { SIMON_FUNCTIONS, SIMON_TYPES } from '../src/examples/simon.js'
import { HIGH_LOW_FUNCTIONS, HIGH_LOW_TYPES } from '../src/examples/highLow.js'
import { CLICK_COUNTER_FUNCTIONS, CLICK_COUNTER_TYPES } from '../src/examples/clickCounter.js'
import { BLACKJACK_FUNCTIONS, BLACKJACK_TYPES } from '../src/examples/blackjack.js'

/** Each template: its type declarations and its functions. */
export const TEMPLATES = {
  blankGame: [BLANK_GAME_TYPES, BLANK_GAME_FUNCTIONS],
  vending: [VENDING_TYPES, VENDING_FUNCTIONS],
  nim: [NIM_TYPES, NIM_FUNCTIONS],
  dice: [DICE_TYPES, DICE_FUNCTIONS],
  damage: [DAMAGE_TYPES, DAMAGE_FUNCTIONS],
  rps: [RPS_TYPES, RPS_FUNCTIONS],
  simon: [SIMON_TYPES, SIMON_FUNCTIONS],
  highLow: [HIGH_LOW_TYPES, HIGH_LOW_FUNCTIONS],
  clickCounter: [CLICK_COUNTER_TYPES, CLICK_COUNTER_FUNCTIONS],
  blackjack: [BLACKJACK_TYPES, BLACKJACK_FUNCTIONS],
}

/** Functions a course asks for that its template doesn't have (it inlines them). */
export const HELPERS = {
  blackjack: {
    handSum: [['h'], [call('cv', 'cardValue', 'cardValue', ['']), call('vals', P('map'), 'map', [n('cv'), n('h')]), call('out', P('sum'), 'sum', [n('vals')])], 'out'],
    fullDeck: [[], [call('ranks', P('enumFromTo'), 'enumFromTo', ['1', '13']), call('four', P('replicate'), 'replicate', ['4', '']), call('out', P('concatMap'), 'concatMap', [n('four'), n('ranks')])], 'out'],
  },
}

export const gameCourses = COURSES.filter((c) => c.template)
export const unitsOf = (courseId) => EXERCISE_UNITS.filter((u) => u.course === courseId)
export const exercisesOf = (courseId) => ALL_EXERCISES.filter((e) => EXERCISE_UNITS.find((u) => u.id === e.unit).course === courseId)

// Split a type at its top-level arrows.
function arrows(signature) {
  const parts = []
  let depth = 0, start = 0
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && signature.startsWith('->', i)) { parts.push(signature.slice(start, i).trim()); start = i + 2 }
  }
  return [...parts, signature.slice(start).trim()]
}

/** A build exercise's signature as annotations: one per named parameter, then the rest as the result's. */
export function annotationsOf(exercise) {
  const parts = arrows(exercise.signature)
  const k = exercise.params.length
  return [...parts.slice(0, k), parts.slice(k).join(' -> ')]
}

/** The project a course is graded in: its template's types and functions (and helpers), annotated. */
export function courseProject(courseId, { typeSource, overrides = {} } = {}) {
  const template = COURSES.find((c) => c.id === courseId).template
  const [types, functions] = TEMPLATES[template]
  const sigs = Object.fromEntries(exercisesOf(courseId).filter((e) => e.kind === 'build').map((e) => [e.name, annotationsOf(e)]))
  const fns = { ...functions, ...HELPERS[courseId], ...overrides }
  const project = buildProject(typeSource ?? types, Object.fromEntries(Object.entries(fns).map(([name, def]) => [name, [...def.slice(0, 3), sigs[name]]])))
  return { registry: { ...libraryDefs, ...registryOf(project) }, functionBodies: project.functionBodies, userNodes: project.nodes, types: project.types }
}

/** Run `fn` with the project's types in scope, as the app sets them. */
export function withTypes(types, fn) {
  setUserTypeArities(typeArities(types), typeKinds(types))
  setDynamicInstances(derivedInstances(types))
  try { return fn() } finally { setUserTypeArities({}); setDynamicInstances([]) }
}

export const failed = (r) => r.checks.filter((c) => !c.ok)
