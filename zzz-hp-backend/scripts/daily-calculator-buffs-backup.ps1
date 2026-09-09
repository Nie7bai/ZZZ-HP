# Daily calculator buffs export for ZZZ-HP
# Scheduled task: ZZZ-HP-Calculator-Buffs-Backup
# Output: E:\zzz_HP\json备份\zzz-hp-calculator-buffs.<stamp>.json
#
# Avoid raw Chinese literals in this .ps1 (Windows PowerShell may misread UTF-8).

$ErrorActionPreference = 'Stop'
$backend = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $backend '..')).Path
# json + 备份 (U+5907 U+4EFD)
$outDir = Join-Path $repoRoot ('json{0}{1}' -f [char]0x5907, [char]0x4EFD)
$logDir = Join-Path $outDir 'backup-logs'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logDir "calculator-buffs-backup-$stamp.log"
$outFile = Join-Path $outDir "zzz-hp-calculator-buffs.$stamp.json"
$latestFile = Join-Path $outDir 'zzz-hp-calculator-buffs.latest.json'

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8
  Write-Host $line
}

Set-Location -LiteralPath $backend
Write-Log "cwd=$backend"
Write-Log "out=$outFile"

Write-Log 'export:calculator-buffs start'
# Call node directly so --file path is not re-encoded by npm
$export = & node '.\scripts\export-calculator-buffs.mjs' --file $outFile 2>&1
$export | ForEach-Object { Write-Log "$_" }
if ($LASTEXITCODE -ne 0) {
  Write-Log "export FAILED exit=$LASTEXITCODE"
  exit $LASTEXITCODE
}

Copy-Item -LiteralPath $outFile -Destination $latestFile -Force
Write-Log "latest=$latestFile"
Write-Log 'export:calculator-buffs done'

# Keep last 60 dated exports (+ latest)
Get-ChildItem -LiteralPath $outDir -Filter 'zzz-hp-calculator-buffs.*.json' |
  Where-Object { $_.Name -ne 'zzz-hp-calculator-buffs.latest.json' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 60 |
  Remove-Item -Force -ErrorAction SilentlyContinue

# Keep last 30 log files
Get-ChildItem -LiteralPath $logDir -Filter 'calculator-buffs-backup-*.log' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit 0
