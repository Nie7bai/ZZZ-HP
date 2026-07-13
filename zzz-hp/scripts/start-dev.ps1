$ErrorActionPreference = "Stop"

$FrontendRoot = Split-Path -Parent $PSScriptRoot
$BackendRoot = Join-Path (Split-Path -Parent $FrontendRoot) "zzz-hp-backend"

if (-not (Test-Path $BackendRoot)) {
  Write-Error "Backend directory not found: $BackendRoot"
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm not found. Please install Node.js first."
  exit 1
}

$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }

Write-Host ""
Write-Host "Starting ZZZ-HP dev servers..." -ForegroundColor Yellow
Write-Host "  Backend:  $BackendRoot"
Write-Host "  Frontend: $FrontendRoot"
Write-Host ""

$backendCmd = "Set-Location '$BackendRoot'; Write-Host '=== ZZZ-HP Backend (http://localhost:3010) ===' -ForegroundColor Cyan; npm run dev"
$frontendCmd = "Set-Location '$FrontendRoot'; Write-Host '=== ZZZ-HP Frontend (http://localhost:5173) ===' -ForegroundColor Green; npm run dev"

Start-Process $shell -ArgumentList "-NoExit", "-Command", $backendCmd
Start-Sleep -Seconds 1
Start-Process $shell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host "Started backend and frontend in two new terminal windows." -ForegroundColor Green
Write-Host "  Backend API: http://localhost:3010"
Write-Host "  Frontend UI: http://localhost:5173"
Write-Host ""
