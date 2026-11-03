data Tree = Empty | Node Int Tree Tree deriving (Eq, Show)

insertValue :: Int -> Tree -> Tree
insertValue x Empty = Node x Empty Empty
insertValue x (Node value left right)
  | x < value = Node value (insertValue x left) right
  | x > value = Node value left (insertValue x right)
  | otherwise = Node value left right

fromValues :: [Int] -> Tree
fromValues xs = foldl (flip insertValue) Empty xs

treeSize :: Tree -> Int
treeSize Empty = 0
treeSize (Node value left right) = 1 + treeSize left + treeSize right

treeHeight :: Tree -> Int
treeHeight Empty = 0
treeHeight (Node value left right) = 1 + max (treeHeight left) (treeHeight right)

sumTree :: Tree -> Int
sumTree Empty = 0
sumTree (Node value left right) = value + sumTree left + sumTree right

summary :: [Int] -> (Int, Int, Int)
summary xs = let tree = fromValues xs in (treeSize tree, treeHeight tree, sumTree tree)

result :: (Int, Int, Int)
result = summary [5,3,7,2,4,6,8,3]
