module Series (sumShifted, first) where

import MathOps (add)

sumShifted :: Int -> [Int] -> Int
sumShifted delta xs = total (map (add delta) xs)

total :: [Int] -> Int
total [] = 0
total (x:xs) = x + total xs

first :: [Int] -> Int
first (x:xs) = x
