// Pasted code: main :: IO () is performed by the IO runtime and its standard
// output is the result; strings, chars, () and (>>), (>>=), $ are understood.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileSource, evaluateSource } from '../src/sourceGraph.js'
import { SourceDocument } from '../src/sourceDocument.js'
import { formatSourceValue } from '../src/sourceValue.js'

const run = (source, name = 'main') => {
  const doc = compileSource(source)
  return evaluateSource(doc, doc.functions.find((f) => f.name === name).id)
}

test('main :: IO () prints in order through (>>)', () => {
  const r = run(String.raw`square :: Int -> Int
square x = x * x
greet :: String -> IO ()
greet name = putStrLn ("Hello, " ++ name ++ "!")
main :: IO ()
main = greet "Haskell" >> print (square 7) >> print [1, 2, 3] >> putStr "done\n"`)
  assert.equal(r.error, undefined)
  assert.equal(r.output, 'Hello, Haskell!\n49\n[1,2,3]\ndone\n')
  assert.equal(formatSourceValue(r.value), 'IO 실행 완료 · 출력 4줄')
})

test('signatures show IO, String and ()', () => {
  const doc = compileSource(String.raw`say :: String -> IO ()
say s = putStrLn s
nothing :: IO ()
nothing = return ()
letter :: Char
letter = 'x'`)
  assert.deepEqual(doc.functions.map((f) => f.signature), ['String -> IO ()', 'IO ()', 'Char'])
})

test('(>>=) passes a result on; $ applies; show of a list', () => {
  const r = run(String.raw`total :: Int
total = foldl (+) 0 [1, 2, 3, 4]
main :: IO ()
main = return total >>= print >> (putStrLn $ show [True, False])`)
  assert.equal(r.output, '10\n[True,False]\n')
})

test('an IO type error is reported at its place', () => {
  assert.throws(() => compileSource(String.raw`main :: IO ()
main = print 1 >> 2`), /IO/)
  assert.throws(() => compileSource(String.raw`main :: IO ()
main = putStrLn 5`))
  // A function has no Show instance: rejected at the print, not when it runs.
  assert.throws(() => compileSource(String.raw`f :: Int -> Int
f x = x
main :: IO ()
main = print f`), /Show/)
})

test('getLine is not read in a one-shot code run; output before it is kept', () => {
  const r = run(String.raw`main :: IO ()
main = putStrLn "name?" >> getLine >>= putStrLn`)
  assert.match(r.error.message, /getLine/)
  assert.equal(r.output, 'name?\n')
})

test('an error inside IO stops it with the output so far', () => {
  const r = run(String.raw`main :: IO ()
main = print 1 >> print (div 1 0) >> print 3`)
  assert.ok(r.error)
  assert.equal(r.output, '1\n')
})

test('a document picks main :: IO () to run first', () => {
  const d = new SourceDocument()
  d.edit(String.raw`result :: Int
result = 2
main :: IO ()
main = print result`)
  d.convert()
  assert.equal(d.document.functions.find((f) => f.id === d.selected).name, 'main')
})

test('string escapes and unsupported escapes', () => {
  assert.equal(run(String.raw`main :: IO ()
main = putStr "a\tb\\c\n"`).output, 'a\tb\\c\n')
  assert.throws(() => compileSource(String.raw`main :: IO ()
main = putStr "\q"`), /이스케이프/)
})
