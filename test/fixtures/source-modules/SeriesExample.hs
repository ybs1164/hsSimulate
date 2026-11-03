module SeriesExample where

import qualified Series

loop :: Int -> Int
loop x = loop x

result :: Int
result = Series.sumShifted 2 [1, 3] + Series.first [4, loop 0]
