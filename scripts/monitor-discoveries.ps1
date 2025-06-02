Write-Host "=== Token Discovery Monitor ===" -ForegroundColor Cyan

while ($true) {
    Clear-Host
    Write-Host "=== Token Discovery Monitor ===" -ForegroundColor Cyan
    Write-Host "Time: $(Get-Date -Format 'HH:mm:ss')`n" -ForegroundColor Gray
    
    # Get recent discoveries
    $recent = psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -t -c @"
SELECT 
    symbol,
    category,
    market_cap,
    current_price,
    to_char(discovered_at, 'HH24:MI:SS') as time
FROM tokens 
WHERE discovered_at > NOW() - INTERVAL '10 minutes'
ORDER BY discovered_at DESC 
LIMIT 10
"@
    
    if ($recent) {
        Write-Host "Recent Discoveries:" -ForegroundColor Yellow
        Write-Host $recent
    } else {
        Write-Host "No recent discoveries in last 10 minutes" -ForegroundColor Red
    }
    
    # Get category counts
    Write-Host "`nCategory Distribution:" -ForegroundColor Yellow
    psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -c @"
SELECT category, COUNT(*) as count 
FROM tokens 
GROUP BY category 
ORDER BY count DESC
"@
    
    Start-Sleep -Seconds 5
}
