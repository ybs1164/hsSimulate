gcdInt :: Int -> Int -> Int
gcdInt a b = if b == 0 then abs a else gcdInt b (a `mod` b)

lcmInt :: Int -> Int -> Int
lcmInt a b = if a == 0 || b == 0 then 0 else abs (a * b) `div` gcdInt a b

coprime :: Int -> Int -> Bool
coprime a b = gcdInt a b == 1

pairScore :: Int -> Int -> Int
pairScore a b = if coprime a b then lcmInt a b else gcdInt a b + lcmInt a b

combinedScore :: Int -> Int -> Int -> Int -> Int
combinedScore a b c d = pairScore a b + pairScore c d

result :: Int
result = combinedScore 12 18 7 9
