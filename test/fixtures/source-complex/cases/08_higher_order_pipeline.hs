isOddValue :: Int -> Bool
isOddValue n = n `mod` 2 /= 0

shiftBy :: Int -> Int -> Int
shiftBy delta x = x + delta

square :: Int -> Int
square x = x * x

accumulate :: Int -> Int -> Int
accumulate total x = total + x

pipeline :: Int -> [Int] -> Int
pipeline delta xs = foldl accumulate 0 (map square (map (shiftBy delta) (filter isOddValue xs)))

result :: Int
result = pipeline 2 [1,2,3,4,5,6,7,8]
