# Daily guestbook backup + image integrity check for ZZZ-HP
# Installed as Windows Scheduled Task: ZZZ-HP-Guestbook-Backup

$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot '..'
$logDir = Join-Path $backend '..\packages\backup-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logDir "guestbook-backup-$stamp.log"

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}

Set-Location $backend
Write-Log "cwd=$backend"

Write-Log 'export:guestbook start'
$export = & npm run export:guestbook 2>&1
$export | ForEach-Object { Write-Log $_ }
if ($LASTEXITCODE -ne 0) {
  Write-Log "export FAILED exit=$LASTEXITCODE"
  exit $LASTEXITCODE
}
Write-Log 'export:guestbook done'

Write-Log 'check:guestbook-images start'
$check = & npm run check:guestbook-images 2>&1
$check | ForEach-Object { Write-Log $_ }
$checkCode = $LASTEXITCODE
Write-Log "check exit=$checkCode"

# Keep only last 30 log files
Get-ChildItem $logDir -Filter 'guestbook-backup-*.log' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit $checkCode
