# V3.5 Performance Dashboard
while ($true) {
    Clear-Host
    Write-Host "🚀 MEMECOIN SCANNER V3.5 DASHBOARD" -ForegroundColor Cyan
    Write-Host "=================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Category distribution
    Write-Host "📊 CATEGORY DISTRIBUTION:" -ForegroundColor Yellow
    psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -t -c @"
    SELECT 
      '  ' || RPAD(category, 8) || 
      LPAD(COUNT(*)::text, 6) || ' tokens | ' ||
      LPAD(COUNT(CASE WHEN last_scan_at > NOW() - INTERVAL '5 minutes' THEN 1 END)::text, 4) || ' active'
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

    Write-Host ""
    Write-Host "🔥 HOT TOKENS (Last 10 min):" -ForegroundColor Yellow
    psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -t -c @"
    SELECT 
      '  ' || RPAD(t.symbol, 10) || ' ' ||
      RPAD(ct.from_category, 6) || ' → ' || 
      RPAD(ct.to_category, 7) || ' $' ||
      ROUND(ct.market_cap_at_transition)
    FROM category_transitions ct
    JOIN tokens t ON t.address = ct.token_address
    WHERE ct.created_at > NOW() - INTERVAL '10 minutes'
      AND ct.from_category != ct.to_category
      AND ct.to_category IN ('HIGH', 'AIM')
    ORDER BY ct.market_cap_at_transition DESC
    LIMIT 5
"@

    Write-Host ""
    Write-Host "📈 SCAN PERFORMANCE (5 min):" -ForegroundColor Yellow
    psql -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -t -c @"
    SELECT 
      '  ' || RPAD(category, 8) || 
      LPAD(COUNT(DISTINCT token_address)::text, 4) || ' tokens | ' ||
      LPAD(COUNT(*)::text, 4) || ' scans'
    FROM scan_logs
    WHERE created_at > NOW() - INTERVAL '5 minutes'
    GROUP BY category
    ORDER BY COUNT(*) DESC
"@

    Start-Sleep -Seconds 10
}