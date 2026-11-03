smaller :: Int -> [Int] -> [Int]
smaller pivot xs = filter (< pivot) xs

notSmaller :: Int -> [Int] -> [Int]
notSmaller pivot xs = filter (>= pivot) xs

quickSort :: [Int] -> [Int]
quickSort [] = []
quickSort (pivot:xs) = quickSort (smaller pivot xs) ++ [pivot] ++ quickSort (notSmaller pivot xs)

dedup :: [Int] -> [Int]
dedup [] = []
dedup [x] = [x]
dedup (x:y:xs) = if x == y then dedup (y:xs) else x : dedup (y:xs)

checksum :: [Int] -> Int
checksum [] = 0
checksum (x:xs) = x + 10 * checksum xs

result :: Int
result = checksum (dedup (quickSort [5,1,3,5,2,1,4]))
