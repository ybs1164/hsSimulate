import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pred, tapp, tcon, tfun, tvar } from '../src/typeSystem.js'
import { classClosure, entails, instancesOf, listInstances, literalClass, numericTypes, pickDefault, reduce, setDynamicInstances, superclassesOf } from '../src/prelude.js'

const a = tvar('a')
const has = (type, cls) => instancesOf(type).includes(cls)

test('instance table is closed under superclasses', () => {
  for (const type of [...numericTypes, 'Bool']) {
    for (const cls of instancesOf(type)) {
      for (const sup of classClosure(cls)) assert.ok(has(type, sup), `${type} has ${cls} but not its superclass ${sup}`)
    }
  }
})

test('each type sits at the expected place in the hierarchy', () => {
  assert.ok(has('Int', 'EuclideanRing') && has('Int', 'Ord') && !has('Int', 'Field'))
  assert.ok(has('Word', 'Ring') && has('Word', 'Ord'), 'Word wraps mod 2ⁿ, so it is a ring')
  assert.ok(!has('Word', 'OrderedRing'), 'wrapping breaks a ≤ b ⇒ a + c ≤ b + c')
  assert.ok(has('Natural', 'Semiring') && !has('Natural', 'AddGroup') && !has('Natural', 'Ring'))
  assert.ok(has('Rational', 'OrderedField') && !has('Rational', 'Transcendental'))
  assert.ok(has('Double', 'IEEEFloat') && has('Double', 'Transcendental') && !has('Double', 'EuclideanRing'))
  assert.ok(has('Bool', 'Ord') && !has('Bool', 'AddSemigroup'))
})

test('literal text demands the weakest structure it needs', () => {
  assert.equal(literalClass('5'), 'Semiring')
  assert.equal(literalClass('-5'), 'Ring')
  assert.equal(literalClass('1.5'), 'Field')
  assert.equal(literalClass('-1.5'), 'Field')
})

test('context reduction drops entailed predicates', () => {
  assert.deepEqual(reduce([pred('Ring', a), pred('AddSemigroup', a)]), [pred('Ring', a)])
  assert.deepEqual(reduce([pred('Transcendental', a), pred('Semiring', a)]), [pred('Transcendental', a)])
  assert.deepEqual(reduce([pred('OrderedRing', a), pred('Eq', a)]), [pred('OrderedRing', a)])
  assert.deepEqual(reduce([pred('Field', tcon('Rational'))]), [])
})

test('context reduction rejects missing structure', () => {
  assert.throws(() => reduce([pred('Transcendental', tcon('Rational'))]))
  assert.throws(() => reduce([pred('AddGroup', tcon('Natural'))]))
  assert.throws(() => reduce([pred('AddSemigroup', tcon('Bool'))]))
  assert.throws(() => reduce([pred('Ring', tfun(a, a))]))
})

test('defaulting picks Integer, then Double', () => {
  assert.equal(pickDefault([pred('Semiring', a)], 'a'), 'Integer')
  assert.equal(pickDefault([pred('Field', a)], 'a'), 'Double')
  assert.equal(pickDefault([pred('Transcendental', a), pred('Ord', a)], 'a'), 'Double')
  assert.equal(pickDefault([pred('Ord', a)], 'a'), null, 'auxiliary classes alone never default')
  assert.equal(pickDefault([pred('EuclideanRing', a), pred('Field', a)], 'a'), null)
})

// ---- Algebraic laws -------------------------------------------------------
// An exact (or, for IEEE types, tolerance-based) model of each type's
// arithmetic. Every class a type claims in the instance table must have its
// laws hold on that model — so e.g. granting Natural `AddGroup` fails here,
// because ℕ has no additive inverses to supply.

const big = (xs) => xs.map(BigInt)
const wrap = (f) => ({ add: (x, y) => f(x + y), mul: (x, y) => f(x * y), neg: (x) => f(-x), zero: 0n, one: 1n, eq: (x, y) => x === y, le: (x, y) => x <= y, divMod: (x, y) => [x / y, x % y] })
const gcd = (x, y) => (y === 0n ? (x < 0n ? -x : x) : gcd(y, x % y))
const frac = (n, d) => { if (d < 0n) { n = -n; d = -d } const g = gcd(n, d) || 1n; return [n / g, d / g] }
const approx = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))
const ieee = { samples: [-2.5, -1, 0, 0.5, 1, 3, 7.25], add: (x, y) => x + y, mul: (x, y) => x * y, neg: (x) => -x, recip: (x) => 1 / x, zero: 0, one: 1, eq: approx, le: (x, y) => x <= y }

const models = {
  // Int is modeled as ℤ (overflow is outside the model), so samples stay well inside 64 bits.
  Int: { samples: big([-4000000000n, -7, -1, 0, 1, 3, 4000000000n]), ...wrap((x) => x) },
  Integer: { samples: big([-1000000000000n, -7, -1, 0, 1, 3, 12]), ...wrap((x) => x) },
  Word: { samples: big([0, 1, 3, 7, 18446744073709551615n]), ...wrap((x) => BigInt.asUintN(64, x)) },
  Natural: { samples: big([0, 1, 2, 5, 40]), add: (x, y) => x + y, mul: (x, y) => x * y, zero: 0n, one: 1n, eq: (x, y) => x === y, le: (x, y) => x <= y },
  Rational: {
    samples: [frac(-3n, 2n), frac(-1n, 1n), frac(0n, 1n), frac(1n, 3n), frac(2n, 1n), frac(7n, 4n)],
    add: ([n1, d1], [n2, d2]) => frac(n1 * d2 + n2 * d1, d1 * d2),
    mul: ([n1, d1], [n2, d2]) => frac(n1 * n2, d1 * d2),
    neg: ([n, d]) => [-n, d],
    recip: ([n, d]) => frac(d, n),
    zero: [0n, 1n], one: [1n, 1n],
    eq: ([n1, d1], [n2, d2]) => n1 === n2 && d1 === d2,
    le: ([n1, d1], [n2, d2]) => n1 * d2 <= n2 * d1,
  },
  Float: ieee,
  Double: ieee,
}

const laws = {
  AddSemigroup: (m, x, y, z) => m.eq(m.add(m.add(x, y), z), m.add(x, m.add(y, z))),
  AddMonoid: (m, x) => m.eq(m.add(x, m.zero), x) && m.eq(m.add(m.zero, x), x),
  AddCommutativeMonoid: (m, x, y) => m.eq(m.add(x, y), m.add(y, x)),
  AddGroup: (m, x) => typeof m.neg === 'function' && m.eq(m.add(x, m.neg(x)), m.zero),
  AddAbelianGroup: (m, x, y) => m.eq(m.add(x, y), m.add(y, x)),
  MulSemigroup: (m, x, y, z) => m.eq(m.mul(m.mul(x, y), z), m.mul(x, m.mul(y, z))),
  MulMonoid: (m, x) => m.eq(m.mul(x, m.one), x) && m.eq(m.mul(m.one, x), x),
  Semiring: (m, x, y, z) => m.eq(m.mul(x, m.add(y, z)), m.add(m.mul(x, y), m.mul(x, z))) && m.eq(m.mul(m.zero, x), m.zero),
  Ring: () => true, // nothing beyond its superclasses
  Field: (m, x) => typeof m.recip === 'function' && (m.eq(x, m.zero) || m.eq(m.mul(x, m.recip(x)), m.one)),
  Eq: (m, x, y) => m.eq(x, x) && m.eq(x, y) === m.eq(y, x),
  Ord: (m, x, y) => m.le(x, y) || m.le(y, x),
  OrderedRing: (m, x, y, z) => !m.le(x, y) || m.le(m.add(x, z), m.add(y, z)),
  EuclideanRing: (m, x, y) => typeof m.divMod === 'function' && (m.eq(y, m.zero) || (([q, r]) => m.eq(m.add(m.mul(q, y), r), x))(m.divMod(x, y))),
  OrderedField: () => true,
}

for (const [type, m] of Object.entries(models)) {
  test(`${type} satisfies the laws of every class it claims`, () => {
    for (const cls of instancesOf(type).filter((c) => laws[c])) {
      for (const x of m.samples) for (const y of m.samples) for (const z of m.samples) {
        assert.ok(laws[cls](m, x, y, z), `${type} breaks ${cls} at ${[x, y, z].join(', ')}`)
      }
    }
  })
}

// ---- Instances with contexts (THIH): `instance Show a => Show (Maybe a)`.



test('an instance context becomes new obligations', () => {
  const Maybe = (t) => tapp(tcon('Maybe'), t)
  setDynamicInstances([{ cls: 'Show', head: Maybe(tvar('$a')), context: [pred('Show', tvar('$a'))] }])
  try {
    assert.ok(entails([], pred('Show', Maybe(tcon('Int')))))
    assert.ok(entails([], pred('Show', Maybe(Maybe(tcon('Bool'))))))
    assert.ok(!entails([], pred('Show', Maybe(tfun(a, a)))))
    assert.deepEqual(reduce([pred('Show', Maybe(a))]), [pred('Show', a)])
    assert.throws(() => reduce([pred('Show', Maybe(tfun(a, a)))]))
  } finally {
    setDynamicInstances([])
  }
})

test('every instance also satisfies its class\'s superclasses (given its context)', () => {
  for (const inst of listInstances()) {
    for (const sup of superclassesOf(inst.cls)) assert.ok(entails(inst.context, pred(sup, inst.head)), `${inst.cls} instance lacks ${sup}`)
  }
})
