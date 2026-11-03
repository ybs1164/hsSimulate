positive :: [Int] -> [Int]
positive [] = []
positive (x:xs) = if x > 0 then x : positive xs else positive xs

square :: Int -> Int
square x = x * x

squareList :: [Int] -> [Int]
squareList [] = []
squareList (x:xs) = square x : squareList xs

sumList :: [Int] -> Int
sumList [] = 0
sumList (x:xs) = x + sumList xs

score :: [Int] -> Int
score xs = sumList (squareList (positive xs))

result :: Int
result = score [-3,0,2,5,-1,4]
