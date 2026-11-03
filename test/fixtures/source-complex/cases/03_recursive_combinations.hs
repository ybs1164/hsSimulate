factorial :: Int -> Int
factorial n = if n <= 1 then 1 else n * factorial (n - 1)

choose :: Int -> Int -> Int
choose n k = factorial n `div` (factorial k * factorial (n - k))

paths :: Int -> Int -> Int
paths rows columns = choose (rows + columns) rows

scaledPaths :: Int -> Int -> Int -> Int
scaledPaths rows columns scale = paths rows columns * scale

adjusted :: Int -> Int -> Int
adjusted rows columns = scaledPaths rows columns 2 - choose (rows + columns) 1

result :: Int
result = adjusted 3 4
