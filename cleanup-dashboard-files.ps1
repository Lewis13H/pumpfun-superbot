# cleanup-dashboard-files.ps1
# Script to remove unused dashboard files created during troubleshooting

Write-Host "🧹 Cleaning up unused dashboard files..." -ForegroundColor Yellow
Write-Host ""

# List of files to remove (created during troubleshooting)
$filesToRemove = @(
    "src/dashboard/start-dashboard.ts",           # Original dashboard startup (has issues)
    "src/dashboard/start-dashboard-fixed.ts",     # Attempted fix (didn't work)
    "src/utils/dashboard-logger.ts",              # Logger config (not needed)
    "src/dashboard/simple-dashboard.ts",          # Simple dashboard (if not using)
    "src/dashboard/monitor.ts",                   # Ultra-simple monitor (if not using)
    "monitor.ps1",                                # PowerShell monitor (if exists)
    "install-dashboard.ps1"                       # Installation script (no longer needed)
)

# Keep these files (they work)
$filesToKeep = @(
    "src/dashboard/standalone-dashboard.ts",      # ✅ Keep - works in separate terminal
    "src/dashboard/terminal-dashboard.ts",        # ✅ Keep - in case you fix console conflicts later
    "src/grpc/grpc-stream-manager.ts"            # ✅ Keep - this is your fixed main file
)

Write-Host "Files to remove:" -ForegroundColor Red
foreach ($file in $filesToRemove) {
    if (Test-Path $file) {
        Write-Host "  - $file" -ForegroundColor Gray
        Remove-Item $file -Force
        Write-Host "    ✓ Removed" -ForegroundColor Green
    } else {
        Write-Host "  - $file (not found)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "Files kept:" -ForegroundColor Green
foreach ($file in $filesToKeep) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "🧹 Cleanup complete!" -ForegroundColor Green
Write-Host ""

# Optional: Clean up node_modules for blessed if not using
$removeBlessed = Read-Host "Remove blessed and blessed-contrib packages? (y/n)"
if ($removeBlessed -eq 'y') {
    Write-Host "Removing blessed packages..." -ForegroundColor Yellow
    npm uninstall blessed blessed-contrib @types/blessed
    Write-Host "✓ Packages removed" -ForegroundColor Green
}

# Clean up any log files
$cleanLogs = Read-Host "Clean up log files? (y/n)"
if ($cleanLogs -eq 'y') {
    if (Test-Path "logs") {
        Remove-Item "logs/dashboard-*.log" -Force -ErrorAction SilentlyContinue
        Write-Host "✓ Log files cleaned" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "📝 Remember to update your package.json scripts!" -ForegroundColor Yellow
Write-Host "Keep only the scripts you're using:" -ForegroundColor Gray
Write-Host '  "bot": "ts-node src/grpc/grpc-stream-app.ts"' -ForegroundColor Gray
Write-Host '  "dashboard:standalone": "ts-node src/dashboard/standalone-dashboard.ts"' -ForegroundColor Gray