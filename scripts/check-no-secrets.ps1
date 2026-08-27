#Requires -Version 5.1
<#
.SYNOPSIS
  Fail if plaintext admin passwords or common credential files leak into commit/pack.

  This scanner does not classify business DB data (character / w-engine /
  drive_disc / bangboo / boss / buff / boss_info / date / changelog /
  site_info_section, etc.); that content still requires policy review.
  The content gate only blocks plaintext admin passwords.

.EXAMPLE
  .\scripts\check-no-secrets.ps1
.EXAMPLE
  .\scripts\check-no-secrets.ps1 -Path .\packages\stage
.EXAMPLE
  .\scripts\check-no-secrets.ps1 -StagedOnly
.PARAMETER StagedOnly
  Scan ACMR entries from the Git index, not their working-tree versions.
#>
[CmdletBinding()]
param(
  [string]$Path = '',
  [switch]$StagedOnly
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ExplicitPath = $PSBoundParameters.ContainsKey('Path')
if (-not $Path) { $Path = $RepoRoot }
$Path = (Resolve-Path -LiteralPath $Path).Path

$skipDirectories = @(
  'node_modules', '.git'
)

# The default workspace scan skips generated and large resource directories.
# An explicit -Path (used for the assembled package stage) scans them so copied
# or built text files cannot bypass the content gate. StagedOnly reads every
# staged path directly.
if (-not $ExplicitPath) {
  $skipDirectories += @(
    'dist', 'dist-ssr', 'coverage', 'packages',
    'guestbook_image', 'boss_image', 'buff_image', 'calculator_image',
    'uploads', 'character', 'wengine', 'drive_disc', 'bangboo',
    '.cursor', '.idea', '.vscode', '__screenshots__'
  )
}

$SkipDirNames = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]$skipDirectories,
  [StringComparer]::OrdinalIgnoreCase
)

$TextExt = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@(
    '.sql', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.json', '.md',
    '.txt', '.env', '.yml', '.yaml', '.ps1', '.bat', '.cmd', '.sh', '.csv',
    '.html', '.css', '.example', '.toml', '.ini', '.conf'
  ),
  [StringComparer]::OrdinalIgnoreCase
)

function Test-IsBcryptOrPlaceholder {
  param([string]$Password)
  if ([string]::IsNullOrWhiteSpace($Password)) { return $true }
  if ($Password -eq 'REDACTED_ADMIN_PASSWORD') { return $true }
  if ($Password -eq 'CHANGE_ME') { return $true }
  if ($Password -match '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$') { return $true }
  return $false
}

$findings = New-Object System.Collections.Generic.List[string]

function Add-Finding {
  param([string]$Message)
  [void]$findings.Add($Message)
}

function Invoke-GitText {
  param([string]$Arguments)

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = 'git'
  $startInfo.Arguments = $Arguments
  $startInfo.WorkingDirectory = $RepoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    [void]$process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw "git command failed (exit $($process.ExitCode))"
    }
    return $stdout
  }
  finally {
    $process.Dispose()
  }
}

function Get-StagedBlobId {
  param([string]$Rel)

  Push-Location $RepoRoot
  try {
    $blobId = & git rev-parse --verify ":$Rel" 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "cannot resolve staged blob for: $Rel"
    }
    $blobId = ([string]$blobId).Trim()
    if ($blobId -notmatch '^[0-9a-fA-F]{40,64}$') {
      throw "invalid staged blob id for: $Rel"
    }
    return $blobId
  }
  finally {
    Pop-Location
  }
}

function Get-ScanFiles {
  if ($StagedOnly) {
    # NUL delimiters preserve staged paths containing spaces and other special characters.
    [string]$rawNames = Invoke-GitText '-c core.quotepath=false diff --cached --name-only --no-ext-diff --diff-filter=ACMR -z --'
    $names = $rawNames.Split(
      [char[]]@([char]0),
      [System.StringSplitOptions]::RemoveEmptyEntries
    )
    foreach ($rel in $names) {
      # Resolve the stage-0 blob so unstaged working-tree edits cannot affect the scan.
      $blobId = Get-StagedBlobId -Rel $rel
      $objectType = (Invoke-GitText "cat-file -t $blobId").Trim()
      if ($objectType -ne 'blob') { continue }
      $lengthText = (Invoke-GitText "cat-file -s $blobId").Trim()
      $length = 0L
      if (-not [long]::TryParse($lengthText, [ref]$length)) {
        throw "cannot determine staged blob size for: $rel"
      }

      [pscustomobject]@{
        Name      = ($rel -split '/')[-1]
        Extension = [System.IO.Path]::GetExtension($rel)
        Rel       = $rel
        FullName  = $null
        Length    = $length
        BlobId    = $blobId
        FromIndex = $true
      }
    }
    return
  }

  Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object {
      $suffix = $_.FullName.Substring($Path.Length).TrimStart('\')
      $parts = $suffix.Split('\')
      if ($parts.Length -gt 1) {
        foreach ($p in $parts[0..($parts.Length - 2)]) {
          if ($SkipDirNames.Contains($p)) { return $false }
        }
      }
      return $true
    }
}

function Get-StagedBlobText {
  param([string]$BlobId)
  return Invoke-GitText "cat-file blob $BlobId"
}

function Test-IsGitIgnored {
  param([string]$FullPath)
  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) { return $false }
  Push-Location $RepoRoot
  try {
    & git check-ignore -q -- $FullPath 2>$null
    return ($LASTEXITCODE -eq 0)
  }
  finally {
    Pop-Location
  }
}

$adminInsertLinePattern = 'INSERT\s+INTO\s+[`'']?admin[`'']?\s+VALUES'
$adminInsertValuePattern = 'INSERT\s+INTO\s+[`'']?admin[`'']?\s+VALUES\s*\(\s*\d+\s*,\s*''([^'']*)'''

function Test-FileForPlainAdminPassword {
  param(
    [System.IO.FileInfo]$File,
    [string]$Rel
  )

  $hits = Select-String -LiteralPath $File.FullName -Pattern $adminInsertLinePattern -AllMatches -ErrorAction SilentlyContinue
  foreach ($hit in $hits) {
    $m = [regex]::Match(
      $hit.Line,
      $adminInsertValuePattern,
      [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($m.Success -and -not (Test-IsBcryptOrPlaceholder $m.Groups[1].Value)) {
      Add-Finding "plaintext admin password in $Rel (value redacted in report)"
    }
  }
}

function Test-TextForPlainAdminPassword {
  param(
    [string]$Text,
    [string]$Rel
  )

  foreach ($line in ($Text -split '\r?\n')) {
    if ($line -notmatch $adminInsertLinePattern) { continue }
    $m = [regex]::Match(
      $line,
      $adminInsertValuePattern,
      [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($m.Success -and -not (Test-IsBcryptOrPlaceholder $m.Groups[1].Value)) {
      Add-Finding "plaintext admin password in $Rel (value redacted in report)"
    }
  }
}

$adminPasswordLinePattern = '(?m)^[\t ]*ADMIN_PASSWORD[\t ]*=[\t ]*([^\r\n]*?)[\t ]*\r?$'

Write-Host ">> check-no-secrets  path=$Path  stagedOnly=$StagedOnly  (admin-password only)"

foreach ($file in Get-ScanFiles) {
  $name = $file.Name
  if ($file.FromIndex) {
    $rel = $file.Rel
  }
  elseif ($file.FullName.StartsWith($Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    $rel = $file.FullName.Substring($Path.Length).TrimStart('\')
  }
  else {
    $rel = $file.FullName
  }

  $isEnvName = ($name -ieq '.env') -or ($name.StartsWith('.env.') -and $name -ine '.env.example')

  # An ignored local .env inside the working tree is expected. Staged files and
  # assembled package paths outside the repository still fail this gate.
  if (-not $file.FromIndex -and $isEnvName -and (Test-IsGitIgnored $file.FullName)) {
    continue
  }

  if ($isEnvName) {
    Add-Finding "secret env file: $rel"
    continue
  }
  if ($name -match '(?i)SecretKey' -or $name -match '(?i)\.(pem|key|pfx)$') {
    Add-Finding "credential/key file: $rel"
    continue
  }

  $ext = $file.Extension
  $scanText = $TextExt.Contains($ext) -or $name -ieq '.env.example'
  if (-not $scanText) { continue }

  # SQL content gate: inspect admin INSERT lines; business-data policy remains a manual review.
  if ($ext -ieq '.sql') {
    if ($file.FromIndex) {
      $text = Get-StagedBlobText -BlobId $file.BlobId
      if ($text) {
        Test-TextForPlainAdminPassword -Text $text -Rel $rel
      }
    }
    else {
      Test-FileForPlainAdminPassword -File $file -Rel $rel
    }
    continue
  }

  if ($file.Length -gt 8MB) { continue }

  $text = $null
  try {
    if ($file.FromIndex) {
      $text = Get-StagedBlobText -BlobId $file.BlobId
    }
    else {
      $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 -ErrorAction Stop
    }
  }
  catch {
    if ($file.FromIndex) { throw }
    continue
  }
  if (-not $text) { continue }

  if ($file.FromIndex) {
    Test-TextForPlainAdminPassword -Text $text -Rel $rel
  }
  else {
    Test-FileForPlainAdminPassword -File $file -Rel $rel
  }

  $envMatches = [regex]::Matches($text, $adminPasswordLinePattern)
  foreach ($m in $envMatches) {
    $val = $m.Groups[1].Value.Trim().Trim('"').Trim("'")
    if ($val -and -not (Test-IsBcryptOrPlaceholder $val) -and $val -notmatch '^(your-|<.*>|xxx)$') {
      Add-Finding "ADMIN_PASSWORD assignment in $rel"
    }
  }
}

if ($findings.Count -gt 0) {
  Write-Host ''
  Write-Host 'SECRET SCAN FAILED - refuse commit/pack until cleaned:' -ForegroundColor Red
  foreach ($f in $findings) {
    Write-Host "  - $f" -ForegroundColor Red
  }
  Write-Host ''
  Write-Host 'Scanner scope: block plaintext admin passwords; business data still requires policy review.' -ForegroundColor Yellow
  Write-Host 'Admin password belongs in cloud .env + set-admin-password.mjs (bcrypt in DB).' -ForegroundColor Yellow
  exit 1
}

Write-Host '>> check-no-secrets OK' -ForegroundColor Green
exit 0
