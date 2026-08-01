#Requires -Version 5.1
<#
.SYNOPSIS
  One-command ZZZ-HP release pack (export + build + zip).

.EXAMPLE
  .\pack-update.ps1
  Full pack: export calculator buffs, build frontend dist, create zip.

.EXAMPLE
  .\pack-update.ps1 -Quick
  Quick pack without export/build (smaller zip; build on server).

.EXAMPLE
  .\pack-update.ps1 -SkipImages
  Full pack but omit boss/buff/calculator_image folders (smaller zip).
#>
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$OutputDir = '',
  [switch]$Quick,
  [switch]$SkipExport,
  [switch]$SkipImages,
  [switch]$IncludeImages,
  [switch]$NoOpen,
  # 兼容旧参数：以前需手动 -IncludeDist，现默认已包含 dist
  [switch]$IncludeDist
)

$ErrorActionPreference = 'Stop'

function Get-RepoVersion {
  param(
    [string]$Root,
    [string]$Hint
  )

  if ($Hint) { return $Hint.Trim() }

  try {
    $branch = & git -C $Root branch --show-current 2>$null
    if ($branch -match '^\d+\.\d+\.\d+$') { return $branch.Trim() }
  }
  catch {
    # ignore
  }

  foreach ($rel in @('zzz-hp\package.json', 'zzz-hp-backend\package.json')) {
    $pkgPath = Join-Path $Root $rel
    if (-not (Test-Path -LiteralPath $pkgPath)) { continue }
    $json = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($json.version) { return [string]$json.version }
  }

  return 'update'
}

function Invoke-NpmIn {
  param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Write-Host ">> $Label"
  Push-Location $Dir
  try {
    npm run $Script
    if ($LASTEXITCODE -ne 0) {
      throw "npm run $Script failed in $Dir (exit $LASTEXITCODE)"
    }
  }
  finally {
    Pop-Location
  }
}

function Test-FrontendDistReady {
  param([string]$FrontDir)

  $index = Join-Path $FrontDir 'dist\index.html'
  if (-not (Test-Path -LiteralPath $index)) {
    throw "Frontend dist missing: $index`nRun without -Quick, or fix npm run build first."
  }

  $assetCount = (Get-ChildItem -LiteralPath (Join-Path $FrontDir 'dist') -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object).Count
  if ($assetCount -lt 5) {
    throw "Frontend dist looks incomplete ($assetCount files). Re-run build before packing."
  }
}

$Root = $PSScriptRoot
$Front = Join-Path $Root 'zzz-hp'
$Back = Join-Path $Root 'zzz-hp-backend'

if (-not (Test-Path -LiteralPath $Front) -or -not (Test-Path -LiteralPath $Back)) {
  throw "Put this script next to zzz-hp and zzz-hp-backend. Current: $Root"
}

# 默认完整打包；-IncludeDist 保留兼容（旧脚本显式传参时仍走完整流程）
$FullPack = -not $Quick
if ($IncludeDist) { $FullPack = $true }

# 完整包默认带上 boss/buff/calculator 图片；Quick 默认不带，可用 -IncludeImages 强制带上
$ShipImages = if ($FullPack) { -not $SkipImages } else { $IncludeImages.IsPresent }

$Ver = Get-RepoVersion -Root $Root -Hint $Version
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $OutputDir) {
  $OutputDir = Join-Path $Root 'packages'
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$ZipName = "ZZZ-HP-$Ver-update-$Stamp.zip"
$ZipPath = Join-Path $OutputDir $ZipName
$Stage = Join-Path $env:TEMP ('zzz-hp-pack-' + [guid]::NewGuid().ToString('N'))
$StageRoot = Join-Path $Stage 'ZZZ-HP'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host "ZZZ-HP pack  mode=$(if ($FullPack) { 'full' } else { 'quick' })  version=$Ver  images=$(if ($ShipImages) { 'yes' } else { 'no' })"
Write-Host "Output: $ZipPath"
Write-Host '========================================' -ForegroundColor Cyan

if ($FullPack) {
  if (-not $SkipExport) {
    Invoke-NpmIn -Dir $Back -Script 'export:calculator-buffs' -Label 'Export calculator buffs'
    Invoke-NpmIn -Dir $Back -Script 'sync:calculator-avatars' -Label 'Sync calculator avatars to public'
  }
  else {
    Write-Host '>> Skip export (-SkipExport)'
  }

  Invoke-NpmIn -Dir $Front -Script 'build' -Label 'Build frontend dist'
  Test-FrontendDistReady -FrontDir $Front
}
else {
  Write-Host '>> Quick pack: skipping export and frontend build'
}

New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null

$ExcludeDirs = @(
  'node_modules',
  '.git',
  'dist-ssr',
  'coverage',
  '.idea',
  '.vscode',
  '.cursor',
  '.cursor-search',
  'packages',
  'uploads',
  'guestbook_image',
  '__screenshots__'
)
if (-not $FullPack) {
  $ExcludeDirs += 'dist'
}

$ExcludeFiles = @(
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'SecretKey.csv',
  'zzz_full_dump.sql',
  '.DS_Store',
  'Thumbs.db'
)

function Invoke-RobocopySafe {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Dest,
    [string[]]$ExtraExcludeDirs = @()
  )

  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  $argsList = @(
    $Source,
    $Dest,
    '/E',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP'
  )

  $argsList += '/XD'
  foreach ($d in ($ExcludeDirs + $ExtraExcludeDirs)) {
    $argsList += $d
  }

  $argsList += '/XF'
  foreach ($f in $ExcludeFiles) {
    $argsList += $f
  }
  $argsList += @('*.pem', '*.key', '*.log')

  & robocopy @argsList | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed: $Source -> $Dest (code=$LASTEXITCODE)"
  }
}

Write-Host '>> Copy frontend'
Invoke-RobocopySafe -Source $Front -Dest (Join-Path $StageRoot 'zzz-hp')

Write-Host '>> Copy backend'
$backExtra = @()
if (-not $ShipImages) {
  $backExtra = @('boss_image', 'buff_image', 'calculator_image')
}
Invoke-RobocopySafe -Source $Back -Dest (Join-Path $StageRoot 'zzz-hp-backend') -ExtraExcludeDirs $backExtra

foreach ($drop in @(
  (Join-Path $StageRoot 'zzz-hp-backend\guestbook_image'),
  (Join-Path $StageRoot 'zzz-hp-backend\uploads'),
  (Join-Path $StageRoot 'zzz-hp\.cursor-search'),
  (Join-Path $StageRoot 'zzz-hp\.cursor')
)) {
  if (Test-Path -LiteralPath $drop) {
    Remove-Item -LiteralPath $drop -Recurse -Force
  }
}

$gbKeep = Join-Path $StageRoot 'zzz-hp-backend\guestbook_image'
New-Item -ItemType Directory -Force -Path $gbKeep | Out-Null
[System.IO.File]::WriteAllText((Join-Path $gbKeep '.gitkeep'), '', [System.Text.UTF8Encoding]::new($false))

$dataStage = Join-Path $StageRoot 'zzz-hp-backend\data'
New-Item -ItemType Directory -Force -Path $dataStage | Out-Null
Get-ChildItem -LiteralPath $dataStage -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -ieq '.json' } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
[System.IO.File]::WriteAllText((Join-Path $dataStage '.gitkeep'), '', [System.Text.UTF8Encoding]::new($false))

$readmeSrc = Join-Path $Root 'README.md'
if (Test-Path -LiteralPath $readmeSrc) {
  Copy-Item -LiteralPath $readmeSrc -Destination (Join-Path $StageRoot 'README.md') -Force
}

$imgLine = if ($ShipImages) {
  '- Includes boss_image, buff_image, calculator_image (default for full pack)'
}
else {
  '- Excludes boss_image / buff_image / calculator_image (use full pack without -SkipImages to include)'
}
$distLine = if ($FullPack) {
  '- Includes frontend dist (already built locally)'
}
else {
  '- Excludes frontend dist — run npm run build on server after deploy'
}
$exportLine = if ($FullPack -and -not $SkipExport) {
  '- Includes fresh scripts/data/zzz-hp-calculator-buffs.json export'
}
else {
  '- Calculator buffs JSON from repo working tree (no export in this pack)'
}

$serverSteps = if ($FullPack) {
  @(
    '1. Extract over install dir; KEEP cloud .env (do not copy local .env)',
    '2. In server .env set ADMIN_PASSWORD, keep DB/OCR keys',
    '3. cd zzz-hp-backend && npm install',
    '4. node scripts/set-admin-password.mjs',
    '5. node scripts/seed_changelog.mjs',
    '6. node scripts/import-calculator-buffs.mjs',
    '7. (optional) node scripts/check-remiel.mjs',
    '8. Restart backend: npm start (dist already in zip — skip frontend build)',
    '9. Hard refresh browser; admin login; spot-check calculator + OCR'
  )
}
else {
  @(
    '1. Extract over install dir; KEEP cloud .env',
    '2. In server .env set ADMIN_PASSWORD, keep DB/OCR keys',
    '3. cd zzz-hp-backend && npm install',
    '4. node scripts/set-admin-password.mjs',
    '5. node scripts/seed_changelog.mjs',
    '6. node scripts/import-calculator-buffs.mjs',
    '7. cd ../zzz-hp && npm install && npm run build',
    '8. cd ../zzz-hp-backend && npm start',
    '9. Hard refresh browser; admin login'
  )
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("ZZZ-HP update package $Ver")
[void]$sb.AppendLine("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$sb.AppendLine("Pack mode: $(if ($FullPack) { 'full' } else { 'quick' })")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('[Included / excluded]')
[void]$sb.AppendLine('- .env and secrets excluded')
[void]$sb.AppendLine('- node_modules, .git excluded')
[void]$sb.AppendLine('- backend data/*.json runtime files excluded')
[void]$sb.AppendLine($exportLine)
[void]$sb.AppendLine($distLine)
[void]$sb.AppendLine($imgLine)
[void]$sb.AppendLine('')
[void]$sb.AppendLine('[Server steps]')
foreach ($step in $serverSteps) {
  [void]$sb.AppendLine($step)
}

[System.IO.File]::WriteAllText(
  (Join-Path $StageRoot 'UPDATE-README.txt'),
  $sb.ToString(),
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host '>> Scan for leaked secrets'
Get-ChildItem -LiteralPath $StageRoot -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
  $n = $_.Name
  $bad = $false
  if ($n -ieq '.env.example') { return }
  if ($n -ieq '.env') { $bad = $true }
  elseif ($n.StartsWith('.env.')) { $bad = $true }
  elseif ($n -match 'SecretKey') { $bad = $true }
  elseif ($n -match '\.(pem|key)$') { $bad = $true }

  if ($bad) {
    $rel = $_.FullName.Substring($StageRoot.Length)
    Write-Warning "Removed secret from package: $rel"
    Remove-Item -LiteralPath $_.FullName -Force
  }
}

if ($FullPack) {
  $stageDistIndex = Join-Path $StageRoot 'zzz-hp\dist\index.html'
  if (-not (Test-Path -LiteralPath $stageDistIndex)) {
    throw "Pack validation failed: dist not staged at $stageDistIndex"
  }
}

if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

Write-Host '>> Compressing'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $StageRoot,
  $ZipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue

$sizeMb = [math]::Round((Get-Item -LiteralPath $ZipPath).Length / 1MB, 2)
$distInZip = 0
if ($FullPack) {
  $distInZip = (tar -tf $ZipPath 2>$null | Select-String 'zzz-hp/dist/' | Measure-Object).Count
}

Write-Host ''
Write-Host "Done: $ZipPath ($sizeMb MB)" -ForegroundColor Green
if ($FullPack) {
  Write-Host "Validated: dist files in zip = $distInZip" -ForegroundColor Green
}
else {
  Write-Host 'Quick pack — no dist inside; build on server.' -ForegroundColor Yellow
}
Write-Host 'Upload zip only. Do not copy local .env over cloud .env.'

if (-not $NoOpen) {
  try {
    Start-Process explorer.exe -ArgumentList "/select,`"$ZipPath`""
  }
  catch {
    # ignore
  }
}
