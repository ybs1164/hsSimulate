inc :: Int -> Int
inc n = n + 1

twice :: Int -> Int
twice n = n * 2

square :: Int -> Int
square n = n * n

difference :: Int -> Int -> Int
difference x y = x - y

score :: Int -> Int -> Int
score x y = square (difference x y) + square (x + y)

transform :: Int -> Int
transform n = twice (inc n)

combine :: Int -> Int -> Int
combine a b = score (transform a) (transform b) - score a b

result :: Int
result = combine 3 5
