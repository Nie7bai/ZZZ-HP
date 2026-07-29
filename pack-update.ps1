#Requires -Version 5.1
<#
.SYNOPSIS
  Pack ZZZ-HP update zip without secrets.

.EXAMPLE
  .\pack-update.ps1

.EXAMPLE
  .\pack-update.ps1 -Version 3.0.1 -IncludeDist
#>
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$OutputDir = '',
  [switch]$IncludeDist,
  [switch]$IncludeImages
)

$ErrorActionPreference = 'Stop'

function Get-PackageVersion {
  param([string]$Hint)
  if ($Hint) { return $Hint.Trim() }
  $pkgPath = Join-Path $PSScriptRoot 'zzz-hp\package.json'
  if (Test-Path -LiteralPath $pkgPath) {
    $json = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($json.version) { return [string]$json.version }
  }
  return 'update'
}

$Root = $PSScriptRoot
$Front = Join-Path $Root 'zzz-hp'
$Back = Join-Path $Root 'zzz-hp-backend'

if (-not (Test-Path -LiteralPath $Front) -or -not (Test-Path -LiteralPath $Back)) {
  throw "Put this script next to zzz-hp and zzz-hp-backend. Current: $Root"
}

$Ver = Get-PackageVersion -Hint $Version
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $OutputDir) {
  $OutputDir = Join-Path $Root 'packages'
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$ZipName = "ZZZ-HP-$Ver-update-$Stamp.zip"
$ZipPath = Join-Path $OutputDir $ZipName
$Stage = Join-Path $env:TEMP ('zzz-hp-pack-' + [guid]::NewGuid().ToString('N'))
$StageRoot = Join-Path $Stage 'ZZZ-HP'

Write-Host "Version: $Ver"
Write-Host "Stage:   $Stage"
Write-Host "Output:  $ZipPath"

if ($IncludeDist) {
  Write-Host 'Building frontend dist...'
  Push-Location $Front
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build failed (exit $LASTEXITCODE)"
    }
  }
  finally {
    Pop-Location
  }
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
if (-not $IncludeDist) {
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

Write-Host 'Copy frontend...'
Invoke-RobocopySafe -Source $Front -Dest (Join-Path $StageRoot 'zzz-hp')

Write-Host 'Copy backend...'
# Optional game assets via -IncludeImages (guestbook uploads always stripped below)
$backExtra = @()
if (-not $IncludeImages) {
  $backExtra = @('boss_image', 'buff_image', 'calculator_image')
}
Invoke-RobocopySafe -Source $Back -Dest (Join-Path $StageRoot 'zzz-hp-backend') -ExtraExcludeDirs $backExtra

# Hard-remove runtime / local-only dirs even if robocopy /XD missed them
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
# Keep empty guestbook_image placeholder on server extract (do not ship local user images)
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

$imgLine = if ($IncludeImages) { '- Includes image folders' } else { '- Excludes image folders (pass -IncludeImages to add)' }
$distLine = if ($IncludeDist) { '- Includes frontend dist' } else { '- Excludes frontend dist (build on server or pass -IncludeDist)' }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("ZZZ-HP update package $Ver")
[void]$sb.AppendLine("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('[Excluded]')
[void]$sb.AppendLine('- .env and secret files')
[void]$sb.AppendLine('- node_modules, .git')
[void]$sb.AppendLine('- backend data/*.json')
[void]$sb.AppendLine($imgLine)
[void]$sb.AppendLine($distLine)
[void]$sb.AppendLine('')
[void]$sb.AppendLine('[Server steps]')
[void]$sb.AppendLine('1. Extract over install dir; KEEP cloud .env')
[void]$sb.AppendLine('2. Fill OCR keys only in server .env (see .env.example)')
[void]$sb.AppendLine('3. cd zzz-hp-backend')
[void]$sb.AppendLine('4. npm install')
[void]$sb.AppendLine('5. Import create_changelog.sql then: node scripts\seed_changelog.mjs')
[void]$sb.AppendLine('6. cd ..\zzz-hp ; npm install ; npm run build')
[void]$sb.AppendLine('7. Restart backend: cd ..\zzz-hp-backend ; npm start')
[void]$sb.AppendLine('8. Hard refresh; admin login again; check OCR quota')

[System.IO.File]::WriteAllText(
  (Join-Path $StageRoot 'UPDATE-README.txt'),
  $sb.ToString(),
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host 'Scan for leaked secrets...'
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

if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

Write-Host 'Compressing...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $StageRoot,
  $ZipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue

$sizeMb = [math]::Round((Get-Item -LiteralPath $ZipPath).Length / 1MB, 2)
Write-Host ''
Write-Host "Done: $ZipPath ($sizeMb MB)" -ForegroundColor Green
Write-Host 'Upload this zip only. Do not copy local .env over the cloud .env.'

try {
  Start-Process explorer.exe -ArgumentList "/select,`"$ZipPath`""
}
catch {
  # ignore
}
