# scripts/disable-module-2a.ps1
# Temporarily disable incomplete Module 2A files

Write-Host "Temporarily disabling Module 2A files..." -ForegroundColor Yellow

# Create backup directory
$backupDir = "src/_module_2a_backup"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# Move api directory if it exists
if (Test-Path "src/api") {
    Write-Host "Moving src/api to backup..." -ForegroundColor Cyan
    Move-Item -Path "src/api" -Destination "$backupDir/api" -Force
}

# Move integrations directory if it exists
if (Test-Path "src/integrations") {
    Write-Host "Moving src/integrations to backup..." -ForegroundColor Cyan
    Move-Item -Path "src/integrations" -Destination "$backupDir/integrations" -Force
}

Write-Host "✅ Module 2A files disabled. They are backed up in $backupDir" -ForegroundColor Green
Write-Host "We'll properly implement them when we get to Module 2A" -ForegroundColor Yellow