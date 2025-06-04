# V3.5 Performance Dashboard - No Password Version
# Set PGPASSWORD environment variable to avoid prompts
$env:PGPASSWORD = "Bhaal1313!#!#"  # Replace with your actual password

# Database connection parameters
$dbParams = @{
    h = "localhost"
    p = 5433
    U = "memecoin_user"
    d = "memecoin_discovery"
}

# Convert to connection string
$connString = ($dbParams.GetEnumerator() | ForEach-Object { "-$($_.Key) $($_.Value)" }) -join " "

while ($true) {
    Clear-Host
    Write-Host "🚀 MEMECOIN SCANNER V3.5 DASHBOARD" -ForegroundColor Cyan
    Write-Host "=================================" -ForegroundColor Cyan
    Write-Host "Last Update: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
    Write-Host ""
    
    # Category distribution
    Write-Host "📊 CATEGORY DISTRIBUTION:" -ForegroundColor Yellow
    $categoryQuery = @"
SELECT 
  RPAD(category, 8) || 
  LPAD(COUNT(*)::text, 6) || ' tokens | ' ||
  LPAD(COUNT(CASE WHEN last_scan_at > NOW() - INTERVAL '5 minutes' THEN 1 END)::text, 4) || ' active | ' ||
  'MC: $' || LPAD(ROUND(AVG(market_cap))::text, 7)
FROM tokens
WHERE category != 'BIN'
GROUP BY category
ORDER BY 
  CASE category
    WHEN 'AIM' THEN 1
    WHEN 'HIGH' THEN 2
    WHEN 'MEDIUM' THEN 3
    WHEN 'NEW' THEN 4
    WHEN 'LOW' THEN 5
    ELSE 6
  END
"@
    
    & psql $connString -t -c $categoryQuery
    
    Write-Host ""
    Write-Host "🔥 HOT MOVEMENTS (10 min):" -ForegroundColor Yellow
    $hotQuery = @"
SELECT 
  RPAD(t.symbol, 10) || ' ' ||
  RPAD(ct.from_category, 6) || ' -> ' || 
  RPAD(ct.to_category, 7) || ' $' ||
  LPAD(ROUND(ct.market_cap_at_transition)::text, 8)
FROM category_transitions ct
JOIN tokens t ON t.address = ct.token_address
WHERE ct.created_at > NOW() - INTERVAL '10 minutes'
  AND ct.from_category != ct.to_category
  AND ct.to_category IN ('HIGH', 'AIM', 'ARCHIVE')
ORDER BY ct.created_at DESC
LIMIT 8
"@
    
    & psql $connString -t -c $hotQuery
    
    Write-Host ""
    Write-Host "⚡ SCAN ACTIVITY (5 min):" -ForegroundColor Yellow
    $scanQuery = @"
SELECT 
  RPAD(category, 8) || 
  LPAD(COUNT(DISTINCT token_address)::text, 4) || ' tokens | ' ||
  LPAD(COUNT(*)::text, 5) || ' scans | ' ||
  'Rate: ' || LPAD(ROUND(COUNT(*) / 5.0, 1)::text, 4) || '/min'
FROM scan_logs
WHERE created_at > NOW() - INTERVAL '5 minutes'
GROUP BY category
ORDER BY COUNT(*) DESC
"@
    
    & psql $connString -t -c $scanQuery
    
    Write-Host ""
    Write-Host "📈 NEW TOKEN DISCOVERY (10 min):" -ForegroundColor Yellow
    $discoveryQuery = @"
SELECT 
  'Rate: ' || COUNT(*) || ' tokens (' || 
  ROUND(COUNT(*) / 10.0, 1) || ' per minute)'
FROM tokens
WHERE created_at > NOW() - INTERVAL '10 minutes'
"@
    
    & psql $connString -t -c $discoveryQuery
    
    Start-Sleep -Seconds 10
}