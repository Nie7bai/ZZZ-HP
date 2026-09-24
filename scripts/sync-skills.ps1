#Requires -Version 5.1
<#
.SYNOPSIS
  把 .cursor/skills 下的 skill 同步到其他 agent 工具的技能目录。

.DESCRIPTION
  唯一事实来源是仓库内被 Git 跟踪的 .cursor/skills/<skill>/；本脚本把它镜像到
  其他 agent 工具的技能目录，使三处内容保持一致。

  同步时会把 skill 里指向「仓库根」的相对链接（形如 ../../docs/...）归一化成
  从目标位置出发的正确层级。为什么需要归一化：技能文件位于 <点目录>/skills/<skill>/，
  从该目录回到仓库根需要 3 层 ../，而不是 2 层；历史上 .cursor 与 .workbuddy 两处
  都写成 ../../，解析结果落在 <点目录>/docs/（不存在），属于断链。

  层级按目标目录相对仓库根的段数**动态计算**，因此目标位置变了也不会算错。
  归一化规则：链接前缀为 1 层或 0 层的（同目录文件、同级技能目录）保持不动，
  2 层及以上的视为「仓库根相对」并重写为目标所需的层数。

  脚本只读源、只写目标；重复执行是幂等的（内容一致则不改动、不改写）。

.PARAMETER RepoRoot
  仓库根。默认取本脚本所在目录的父目录。

.PARAMETER SourceRoot
  源技能根目录，相对仓库根。默认 .cursor/skills。

.PARAMETER TargetRoots
  目标技能根目录，相对仓库根。默认 .workbuddy/skills 与 .dsh/skills。

.PARAMETER Skills
  要同步的技能名（即源下的子目录名）。默认 zzz-hp-git-workflow 与 zzz-hp-release。

.EXAMPLE
  .\scripts\sync-skills.ps1
  同步全部默认技能到全部默认目标。

.EXAMPLE
  .\scripts\sync-skills.ps1 -WhatIf
  只报告将要做什么，不落盘。

.EXAMPLE
  .\scripts\sync-skills.ps1 -Skills zzz-hp-release -TargetRoots .dsh/skills
  只同步一个技能到一个目标。
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$RepoRoot = '',
  [string]$SourceRoot = '.cursor/skills',
  [string[]]$TargetRoots = @('.workbuddy/skills', '.dsh/skills'),
  [string[]]$Skills = @('zzz-hp-git-workflow', 'zzz-hp-release')
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot 在 param() 的默认值里取不到（PS 5.1），因此在这里解析仓库根
if (-not $RepoRoot) {
  $RepoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
}
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# 链接前缀为 2 层及以上的，视为「仓库根相对」
$RepoRootLinkPattern = '\]\(((?:\.\./){2,})([^)]*)\)'

function Get-RepoRootUpPrefix {
  <# 计算从 $Directory 回到仓库根所需的 ../ 前缀（按实际路径段数动态得出）。 #>
  param([string]$RepoRootPath, [string]$Directory)

  $root = [System.IO.Path]::GetFullPath($RepoRootPath).TrimEnd('\', '/')
  $abs = [System.IO.Path]::GetFullPath($Directory)

  if (-not $abs.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "目标目录不在仓库根之下，无法计算层级：$abs"
  }

  $relative = $abs.Substring($root.Length).TrimStart('\', '/')
  $segments = @($relative -split '[\\/]' | Where-Object { $_ -ne '' })
  if ($segments.Count -eq 0) {
    throw "目标目录就是仓库根，无法计算层级：$abs"
  }

  return ('../' * $segments.Count)
}

function Copy-SkillTree {
  <# 镜像复制：补齐/更新源里有的文件，删除目标里多出来的文件。返回改动计数。 #>
  param([string]$Source, [string]$Destination)

  $copied = 0
  $removed = 0

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  foreach ($file in Get-ChildItem -LiteralPath $Source -Recurse -File) {
    $relative = $file.FullName.Substring($Source.Length).TrimStart('\', '/')
    $target = Join-Path $Destination $relative
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $parent | Out-Null

    $identical = (Test-Path -LiteralPath $target) -and
      ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -eq
       (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)

    if (-not $identical) {
      Copy-Item -LiteralPath $file.FullName -Destination $target -Force
      $copied++
    }
  }

  foreach ($file in Get-ChildItem -LiteralPath $Destination -Recurse -File) {
    $relative = $file.FullName.Substring($Destination.Length).TrimStart('\', '/')
    if (-not (Test-Path -LiteralPath (Join-Path $Source $relative))) {
      Remove-Item -LiteralPath $file.FullName -Force
      $removed++
    }
  }

  return [pscustomobject]@{ Copied = $copied; Removed = $removed }
}

function Set-SkillLinkDepth {
  <# 把目录下所有 .md 里「仓库根相对」的链接重写为目标所需的层级。 #>
  param([string]$Directory, [string]$UpPrefix)

  $rewritten = 0
  $replacement = '](' + $UpPrefix + '$2)'

  foreach ($file in Get-ChildItem -LiteralPath $Directory -Recurse -File -Filter '*.md') {
    $text = [System.IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
    $updated = [regex]::Replace($text, $RepoRootLinkPattern, $replacement)
    if ($updated -ne $text) {
      [System.IO.File]::WriteAllText($file.FullName, $updated, $Utf8NoBom)
      $rewritten++
    }
  }

  return $rewritten
}

function Test-SkillLinks {
  <# 校验目录下所有 .md 的相对链接能否解析；返回断链描述数组。 #>
  param([string]$Directory)

  $broken = @()
  foreach ($file in Get-ChildItem -LiteralPath $Directory -Recurse -File -Filter '*.md') {
    $text = [System.IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
    foreach ($match in [regex]::Matches($text, '\]\(([^)]+)\)')) {
      $link = $match.Groups[1].Value
      if ($link -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') { continue }   # 绝对 URL / mailto
      $pathOnly = ($link -split '#')[0]
      if ($pathOnly -eq '') { continue }
      $resolved = [System.IO.Path]::GetFullPath((Join-Path $Directory $pathOnly))
      if (-not (Test-Path -LiteralPath $resolved)) {
        $broken += ('{0}: {1}' -f $file.FullName.Substring($Directory.Length).TrimStart('\', '/'), $link)
      }
    }
  }

  return $broken
}

# ── 主流程 ────────────────────────────────────────────────────────────────────

$rootFull = [System.IO.Path]::GetFullPath($RepoRoot)
$sourceFull = Join-Path $rootFull $SourceRoot

Write-Host "仓库根 : $rootFull"
Write-Host "源     : $sourceFull"
Write-Host "目标   : $($TargetRoots -join ', ')"
Write-Host ''

if (-not (Test-Path -LiteralPath $sourceFull)) {
  throw "源技能根不存在：$sourceFull"
}

$allBroken = @()

foreach ($skill in $Skills) {
  $skillSource = Join-Path $sourceFull $skill

  if (-not (Test-Path -LiteralPath (Join-Path $skillSource 'SKILL.md'))) {
    Write-Warning "跳过 $skill：源下没有 SKILL.md（$skillSource）"
    continue
  }

  Write-Host "── $skill"

  foreach ($targetRoot in $TargetRoots) {
    $skillTarget = Join-Path (Join-Path $rootFull $targetRoot) $skill
    $upPrefix = Get-RepoRootUpPrefix -RepoRootPath $rootFull -Directory $skillTarget

    $label = "$targetRoot/$skill"
    if (-not $PSCmdlet.ShouldProcess($label, '同步并归一化链接层级')) {
      Write-Host ("   {0,-42} 跳过（-WhatIf）  需要前缀 {1}" -f $label, $upPrefix)
      continue
    }

    $copy = Copy-SkillTree -Source $skillSource -Destination $skillTarget
    $rewritten = Set-SkillLinkDepth -Directory $skillTarget -UpPrefix $upPrefix
    $broken = Test-SkillLinks -Directory $skillTarget

    Write-Host ("   {0,-42} 复制/更新={1,-3} 删除={2,-3} 改写链接={3,-3} 前缀={4} {5}" -f `
      $label, $copy.Copied, $copy.Removed, $rewritten, $upPrefix, $(if ($broken.Count -eq 0) { '链接 OK' } else { "★断链 $($broken.Count)" }))

    $allBroken += $broken
  }
}

Write-Host ''

if ($allBroken.Count -gt 0) {
  Write-Host '断链明细：' -ForegroundColor Red
  $allBroken | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}

Write-Host '全部目标链接校验通过。' -ForegroundColor Green
