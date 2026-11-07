param(
  # 只检查、不写入
  [switch]$Check
)

# 用法：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\add-song.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\add-song.ps1 -Check
#
# 作用：把 music\*.mp3 与 music\lyric\*.lrc 目录里的新文件同步进
#       music\playlist.json 与 music\lyric\index.json，并检查一批常见的数据问题。
# 注意：本文件请保持 UTF-8 with BOM，否则 Windows PowerShell 5.1 会把中文读成乱码。

$ErrorActionPreference = 'Stop'

$siteRoot = Split-Path -Parent $PSScriptRoot
$musicDir = Join-Path $siteRoot 'music'
$lyricDir = Join-Path $musicDir 'lyric'
$playlistPath = Join-Path $musicDir 'playlist.json'
$lyricIndexPath = Join-Path $lyricDir 'index.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$minDurationSeconds = 90

foreach ($required in @($playlistPath, $lyricIndexPath)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "缺少文件：$required"
  }
}

function Read-TextFile([string]$Path) {
  return $utf8.GetString([System.IO.File]::ReadAllBytes($Path))
}

function Write-TextFile([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Get-NameList([string]$Path) {
  $text = Read-TextFile $Path
  $parsed = $text | ConvertFrom-Json
  if ($null -eq $parsed) { return @() }
  return @($parsed)
}

function Add-NameList([string]$Path, [string[]]$Names) {
  if ($Names.Count -eq 0) { return }

  $text = Read-TextFile $Path
  $eol = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
  $closing = [regex]::Match($text, '\]\s*$')
  if (-not $closing.Success) {
    throw "无法定位 $Path 中数组的结尾"
  }

  $body = $text.Substring(0, $closing.Index).TrimEnd()
  $lines = @($Names | Sort-Object | ForEach-Object {
    '  ' + (ConvertTo-Json -InputObject $_ -Compress)
  })
  $addition = $lines -join (',' + $eol)

  $separator = if ($body.EndsWith('[')) { $eol } else { ',' + $eol }
  $newText = $body + $separator + $addition + $eol + ']' + $eol
  Write-TextFile $Path $newText
}

function Get-Mp3Durations([string]$Directory) {
  $durations = @{}
  try {
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.Namespace($Directory)
    if ($null -eq $folder) { return $durations }
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter '*.mp3' -File) {
      $value = $folder.GetDetailsOf($folder.ParseName($file.Name), 27)
      if ($value -match '^(\d+):(\d{2}):(\d{2})$') {
        $durations[$file.Name] = [int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3]
      } elseif ($value -match '^(\d+):(\d{2})$') {
        $durations[$file.Name] = [int]$Matches[1] * 60 + [int]$Matches[2]
      }
    }
  } catch {
    Write-Warning "读取音频时长失败，跳过时长检查：$($_.Exception.Message)"
  }
  return $durations
}

$playlist = Get-NameList $playlistPath
$lyricIndex = Get-NameList $lyricIndexPath
$mp3Files = @(Get-ChildItem -LiteralPath $musicDir -Filter '*.mp3' -File | Select-Object -ExpandProperty Name)
$lrcFiles = @(Get-ChildItem -LiteralPath $lyricDir -Filter '*.lrc' -File | Select-Object -ExpandProperty Name)

$newSongs = @($mp3Files | Where-Object { $playlist -notcontains $_ } | Sort-Object)
$danglingSongs = @($playlist | Where-Object { $mp3Files -notcontains $_ })
$newLyrics = @($lrcFiles | Where-Object { $lyricIndex -notcontains $_ } | Sort-Object)
$danglingLyrics = @($lyricIndex | Where-Object { $lrcFiles -notcontains $_ })

$problems = New-Object System.Collections.Generic.List[string]

foreach ($name in $danglingSongs) {
  $problems.Add("歌单里有、磁盘上没有：$name")
}
foreach ($name in $danglingLyrics) {
  $problems.Add("歌词索引里有、磁盘上没有：$name")
}
foreach ($name in $lrcFiles) {
  if ($name -notmatch '-.*-歌词\.lrc$') {
    $problems.Add("歌词文件名不符合「歌名-歌手-歌词.lrc」，可能匹配不到歌曲：$name")
    continue
  }
  $text = Read-TextFile (Join-Path $lyricDir $name)
  if ($text -notmatch '\[\d{2}:\d{2}(\.\d{1,3})?\]') {
    $problems.Add("歌词没有时间轴，播放时无法滚动：$name")
  }
}

$durations = Get-Mp3Durations $musicDir
foreach ($entry in $durations.GetEnumerator()) {
  if ($entry.Value -lt $minDurationSeconds) {
    $problems.Add(("音频只有 {0} 秒，可能是试听片段：{1}" -f $entry.Value, $entry.Key))
  }
}

Write-Output "音频文件 $($mp3Files.Count) 个，歌单 $($playlist.Count) 条"
Write-Output "歌词文件 $($lrcFiles.Count) 个，歌词索引 $($lyricIndex.Count) 条"
Write-Output ""

if ($problems.Count -gt 0) {
  Write-Output "发现 $($problems.Count) 个问题："
  $problems | ForEach-Object { Write-Output "  - $_" }
  Write-Output ""
}

if ($newSongs.Count -eq 0 -and $newLyrics.Count -eq 0) {
  Write-Output "歌单与歌词索引已与目录同步。"
  exit 0
}

Write-Output "待新增到歌单：$($newSongs.Count) 首"
$newSongs | ForEach-Object { Write-Output "  + $_" }
Write-Output "待新增到歌词索引：$($newLyrics.Count) 个"
$newLyrics | ForEach-Object { Write-Output "  + $_" }

if ($Check) {
  Write-Output ""
  Write-Output "（-Check 模式，未写入任何文件）"
  exit 0
}

Add-NameList $playlistPath $newSongs
Add-NameList $lyricIndexPath $newLyrics

$afterPlaylist = Get-NameList $playlistPath
$afterLyricIndex = Get-NameList $lyricIndexPath
Write-Output ""
Write-Output "已写入：歌单 $($afterPlaylist.Count) 条，歌词索引 $($afterLyricIndex.Count) 条。"
Write-Output "提示：新增歌曲不改变静态资源版本号，无需再跑 update-site.ps1。"
