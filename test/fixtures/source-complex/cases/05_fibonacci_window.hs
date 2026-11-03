fib :: Int -> Int
fib n = if n <= 1 then n else fib (n - 1) + fib (n - 2)

sumFib :: Int -> Int
sumFib n = if n < 0 then 0 else fib n + sumFib (n - 1)

window :: Int -> Int -> Int
window lo hi = sumFib hi - sumFib (lo - 1)

weighted :: Int -> Int -> Int -> Int
weighted lo hi factor = window lo hi * factor

result :: Int
result = weighted 3 8 2
