// Every game course (src/courses/): well-formed, one unit per function of
// its template, and graded against the template itself — each build passes
// with the template's function, each declaration with its type.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptedTypes, gradeBuild, gradeDeclare, parseQualType } from '../src/grader.js'
import { builtinSchemes } from '../src/builtinSchemes.js'
import { declareTypes } from '../src/typeDecls.js'
import { TEMPLATES, courseProject, exercisesOf, failed, gameCourses, unitsOf, withTypes } from './courseHarness.js'

test('every exercise id is unique across the courses', () => {
  const ids = gameCourses.flatMap((c) => exercisesOf(c.id).map((e) => e.id))
  assert.equal(new Set(ids).size, ids.length)
})

for (const course of gameCourses) {
  const [typeSource, functions] = TEMPLATES[course.template]
  const exercises = exercisesOf(course.id)

  test(`${course.id}: every exercise is well-formed`, () => {
    withTypes(declareTypes({}, typeSource), () => {
      for (const e of exercises) {
        if (e.kind === 'type') assert.ok(acceptedTypes(e, (name) => builtinSchemes[name]).length >= 1, e.id)
        if (e.kind === 'build') { parseQualType(e.signature); assert.ok(Array.isArray(e.params), e.id) }
        if (e.kind === 'choice') assert.equal(e.options.filter((o) => o.correct).length, 1, e.id)
        if (e.kind === 'declare') assert.ok(e.declaration.startsWith('data '), e.id)
      }
    })
  })

  test(`${course.id}: one unit per function of the template, each building it last`, () => {
    const units = unitsOf(course.id)
    for (const u of units) {
      const made = u.exercises.filter((e) => e.kind === 'build' || e.kind === 'declare')
      assert.deepEqual(made.map((e) => e.name), [u.title], u.id)
      // (a declared type may be followed by questions about what it derives — they need it declared)
      if (made[0].kind === 'build') assert.equal(u.exercises.at(-1).name, u.title, `${u.id} ends with ${u.title}`)
      assert.ok(u.part?.title && u.part.intro && u.intro, u.id)
    }
    const names = units.map((u) => u.title)
    const declared = Object.keys(declareTypes({}, typeSource))
    for (const name of [...Object.keys(functions), ...declared]) assert.ok(names.includes(name), `${course.id} has a unit for ${name}`)
    // Each function is built after everything it calls.
    const order = new Map(names.map((name, i) => [name, i]))
    for (const [name, [, nodes]] of Object.entries(functions)) {
      for (const callee of nodes.map((x) => x.sourceFunctionId).filter((id) => functions[id] && id !== name)) {
        assert.ok(order.get(callee) < order.get(name), `${course.id}: ${callee} comes before ${name}`)
      }
    }
  })

  test(`${course.id}: every build passes with the template's function`, () => {
    const project = courseProject(course.id)
    withTypes(project.types, () => {
      for (const e of exercises.filter((x) => x.kind === 'build')) {
        const r = gradeBuild(e, project)
        assert.deepEqual(failed(r), [], `${e.name}: ${JSON.stringify(failed(r))}`)
      }
    })
  })

  test(`${course.id}: the template's declarations pass every declare exercise`, () => {
    const types = declareTypes({}, typeSource)
    for (const e of exercises.filter((x) => x.kind === 'declare')) {
      const r = gradeDeclare(e, types)
      assert.deepEqual(failed(r), [], `${e.name}: ${JSON.stringify(failed(r))}`)
    }
  })
}
