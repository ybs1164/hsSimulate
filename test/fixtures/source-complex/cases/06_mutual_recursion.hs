isEvenInt :: Int -> Bool
isEvenInt n = if n == 0 then True else isOddInt (n - 1)

isOddInt :: Int -> Bool
isOddInt n = if n == 0 then False else isEvenInt (n - 1)

evenWeight :: Int -> Int
evenWeight n = if isEvenInt n then n * 2 else 0

sumWeights :: Int -> Int
sumWeights n = if n <= 0 then 0 else evenWeight n + sumWeights (n - 1)

result :: Int
result = sumWeights 10
