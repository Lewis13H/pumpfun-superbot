Write-Host "=== Section 5 Complete Verification ===" -ForegroundColor Green

# 1. Check discovery service is running
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "✅ Node processes running" -ForegroundColor Green
} else {
    Write-Host "❌ No node processes found - start discovery service first!" -ForegroundColor Red
    exit
}

# 2. Check recent discoveries
Write-Host "`n📊 Recent Token Discoveries (last 5 minutes):" -ForegroundColor Yellow
psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -c "
SELECT 
  symbol,
  category,
  market_cap,
  current_price,
  platform,
  to_char(discovered_at, 'HH24:MI:SS') as time
FROM tokens 
WHERE discovered_at > NOW() - INTERVAL '5 minutes'
  AND address NOT LIKE 'TEST%'
ORDER BY discovered_at DESC 
LIMIT 10;"

# 3. Check category distribution
Write-Host "`n📈 Category Distribution:" -ForegroundColor Yellow
psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -c "
SELECT 
  category,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE current_price > 0) as with_price
FROM tokens 
WHERE address NOT LIKE 'TEST%'
GROUP BY category 
ORDER BY category;"

# 4. Check state transitions
Write-Host "`n🔄 Recent State Transitions:" -ForegroundColor Yellow
psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -c "
SELECT 
  t.symbol,
  ct.from_category || ' → ' || ct.to_category as transition,
  ct.market_cap_at_transition,
  to_char(ct.created_at, 'HH24:MI:SS') as time
FROM category_transitions ct
JOIN tokens t ON ct.token_address = t.address
WHERE ct.created_at > NOW() - INTERVAL '10 minutes'
ORDER BY ct.created_at DESC
LIMIT 5;"

Write-Host "`n✅ Verification complete!" -ForegroundColor Green
