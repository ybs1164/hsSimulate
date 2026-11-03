basePrice :: Int -> Int
basePrice quantity = quantity * 120

optionPrice :: Int -> Int
optionPrice extras = extras * 35

subtotal :: Int -> Int -> Int
subtotal quantity extras = basePrice quantity + optionPrice extras

discountValue :: Int -> Int
discountValue vouchers = vouchers * 25

delivery :: Int -> Int
delivery parcels = parcels * 40

finalBill :: Int -> Int -> Int -> Int -> Int
finalBill quantity extras vouchers parcels = subtotal quantity extras - discountValue vouchers + delivery parcels

result :: Int
result = finalBill 4 3 2 1
