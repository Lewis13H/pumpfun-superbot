SELECT 
    symbol,
    market_cap::INT as mc,
    liquidity::INT as liq,
    holders,
    ROUND((market_cap - 145000)::NUMERIC, 0) as above_limit,
    ROUND((market_cap / 145000)::NUMERIC, 2) || 'x' as multiple,
    CASE 
        WHEN market_cap > 1000000 THEN 'MOON'
        WHEN market_cap > 500000 THEN 'ROCKET' 
        WHEN market_cap > 250000 THEN 'STAR'
        WHEN market_cap > 145000 THEN 'GRADUATED'
        ELSE 'AIM'
    END as status,
    updated_at
FROM tokens 
WHERE category = 'AIM'
ORDER BY market_cap DESC;