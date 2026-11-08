param(
  [ValidateRange(32, 320)]
  [int]$BitrateKbps = 128,

  [ValidateNotNullOrEmpty()]
  [string]$FfmpegPath,

  [switch]$Check
)

# 用法：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\import-new-songs.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\import-new-songs.ps1 -Check
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\import-new-songs.ps1 -BitrateKbps 192
#
# 把待导入歌曲（以及可选的 .lrc 歌词）放入 music\新增音乐。
# 成功导入后，原始输入会删除；压缩后的 MP3 和歌词分别保留在 music 与 music\lyric。
# 需要预先安装 FFmpeg，或通过 -FfmpegPath 指定 ffmpeg.exe。
# 安装和运行说明见 tools\安装FFmpeg与导入歌曲.md。
# 本文件请保持 UTF-8 with BOM，兼容 Windows PowerShell 5.1。

$ErrorActionPreference = 'Stop'
$siteRoot = Split-Path -Parent $PSScriptRoot
$musicDir = Join-Path $siteRoot 'music'
$incomingDir = Join-Path $musicDir '新增音乐'
$lyricDir = Join-Path $musicDir 'lyric'
$addSongScript = Join-Path $PSScriptRoot 'add-song.ps1'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$audioExtensions = @(
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus',
  '.wma', '.aiff', '.aif', '.ape', '.alac'
)

foreach ($required in @($musicDir, $lyricDir, $addSongScript)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "缺少必要文件或目录：$required"
  }
}

if (-not (Test-Path -LiteralPath $incomingDir)) {
  New-Item -ItemType Directory -Path $incomingDir | Out-Null
}

$inputFiles = @(Get-ChildItem -LiteralPath $incomingDir -File)
$audioFiles = @($inputFiles | Where-Object { $audioExtensions -contains $_.Extension.ToLowerInvariant() })
$lyricFiles = @($inputFiles | Where-Object { $_.Extension -ieq '.lrc' })
$unsupportedFiles = @($inputFiles | Where-Object {
  ($audioExtensions -notcontains $_.Extension.ToLowerInvariant()) -and ($_.Extension -ine '.lrc')
})

if ($unsupportedFiles.Count -gt 0) {
  $names = $unsupportedFiles | ForEach-Object { $_.Name }
  throw "新增音乐文件夹中有不支持的文件：$($names -join '、')"
}

if ($audioFiles.Count -eq 0 -and $lyricFiles.Count -eq 0) {
  Write-Output "新增音乐文件夹中没有待导入的音频或歌词：$incomingDir"
  exit 0
}

$destinationNames = @{}
foreach ($file in $audioFiles) {
  $destinationName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) + '.mp3'
  $key = $destinationName.ToLowerInvariant()
  if ($destinationNames.ContainsKey($key)) {
    throw "多个音频文件会生成同名 MP3：$($destinationNames[$key]) 和 $($file.Name)"
  }
  $destinationNames[$key] = $file.Name
  $destinationPath = Join-Path $musicDir $destinationName
  if (Test-Path -LiteralPath $destinationPath) {
    throw "目标歌曲已存在，为避免覆盖已停止：$destinationPath"
  }
}

foreach ($file in $lyricFiles) {
  $destinationPath = Join-Path $lyricDir $file.Name
  if (Test-Path -LiteralPath $destinationPath) {
    throw "目标歌词已存在，为避免覆盖已停止：$destinationPath"
  }
}

Write-Output "待压缩音频：$($audioFiles.Count) 首（MP3 $BitrateKbps kbps）"
Write-Output "待导入歌词：$($lyricFiles.Count) 个"
foreach ($file in $audioFiles) {
  Write-Output ("  音频：{0} -> {1}.mp3" -f $file.Name, [System.IO.Path]::GetFileNameWithoutExtension($file.Name))
}
foreach ($file in $lyricFiles) {
  Write-Output "  歌词：$($file.Name)"
}

if ($Check) {
  Write-Output '（-Check 模式，仅检查，不压缩、不移动文件）'
  exit 0
}

if ($audioFiles.Count -gt 0) {
  if ($FfmpegPath) {
    if (-not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf)) {
      throw "找不到 FFmpeg：$FfmpegPath"
    }
    $ffmpeg = (Resolve-Path -LiteralPath $FfmpegPath).Path
  } else {
    $ffmpegCommand = Get-Command 'ffmpeg.exe' -ErrorAction SilentlyContinue
    if (-not $ffmpegCommand) {
      $ffmpegCommand = Get-Command 'ffmpeg' -ErrorAction SilentlyContinue
    }
    if (-not $ffmpegCommand) {
      $persistedPaths = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path
      ) -join ';'
      $env:Path = (($persistedPaths -split ';' | Where-Object { $_ } | Select-Object -Unique) -join ';')
      $ffmpegCommand = Get-Command 'ffmpeg.exe' -ErrorAction SilentlyContinue
    }
    if ($ffmpegCommand) {
      $ffmpeg = $ffmpegCommand.Source
    } else {
      throw '未找到 FFmpeg。请确认已安装并加入 Windows 用户 PATH；如果 VS Code 是安装 FFmpeg 前打开的，请重启 VS Code 后重试。也可使用 -FfmpegPath 指定 ffmpeg.exe。'
    }
  }

  $encoderOutput = @(& $ffmpeg -hide_banner -encoders 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "无法运行 FFmpeg（退出代码 $LASTEXITCODE）：$ffmpeg"
  }
  if (($encoderOutput -join "`n") -notmatch '\blibmp3lame\b') {
    throw '当前 FFmpeg 不包含 libmp3lame 编码器。请安装包含 libmp3lame 的完整 Windows build，或按 tools\安装FFmpeg与导入歌曲.md 配置其他 FFmpeg。'
  }
}

$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) ('202410-song-import-' + [guid]::NewGuid().ToString('N'))
$stagedFiles = New-Object System.Collections.Generic.List[object]
$committedPaths = New-Object System.Collections.Generic.List[string]
$syncAttempted = $false

try {
  New-Item -ItemType Directory -Path $stageDir | Out-Null

  foreach ($file in $audioFiles) {
    $outputName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) + '.mp3'
    $stagedPath = Join-Path $stageDir $outputName
    & $ffmpeg -hide_banner -loglevel error -nostdin -y -i $file.FullName -map '0:a:0' -vn -codec:a libmp3lame -b:a "${BitrateKbps}k" -map_metadata 0 -id3v2_version 3 -f mp3 $stagedPath
    if ($LASTEXITCODE -ne 0) {
      throw "FFmpeg 压缩失败（退出代码 $LASTEXITCODE）：$($file.Name)"
    }
    if (-not (Test-Path -LiteralPath $stagedPath) -or (Get-Item -LiteralPath $stagedPath).Length -eq 0) {
      throw "FFmpeg 没有生成有效音频文件：$($file.Name)"
    }
    $stagedFiles.Add([pscustomobject]@{
      SourcePath = $file.FullName
      StagedPath = $stagedPath
      DestinationPath = Join-Path $musicDir $outputName
    })
  }

  foreach ($file in $lyricFiles) {
    $stagedPath = Join-Path $stageDir $file.Name
    Copy-Item -LiteralPath $file.FullName -Destination $stagedPath
    $stagedFiles.Add([pscustomobject]@{
      SourcePath = $file.FullName
      StagedPath = $stagedPath
      DestinationPath = Join-Path $lyricDir $file.Name
    })
  }

  foreach ($item in $stagedFiles) {
    if (Test-Path -LiteralPath $item.DestinationPath) {
      throw "导入过程中发现目标文件已存在，为避免覆盖已停止：$($item.DestinationPath)"
    }
    Move-Item -LiteralPath $item.StagedPath -Destination $item.DestinationPath
    $committedPaths.Add($item.DestinationPath)
  }

  $syncAttempted = $true
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $addSongScript
  if ($LASTEXITCODE -ne 0) {
    throw "同步歌单和歌词索引失败（退出代码 $LASTEXITCODE）。已生成的音频保留在 music 目录中，请检查后重新运行 tools\add-song.ps1。"
  }
  foreach ($file in $inputFiles) {
    if ($file.Extension -ieq '.lrc') {
      $destinationPath = Join-Path $lyricDir $file.Name
    } else {
      $destinationName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) + '.mp3'
      $destinationPath = Join-Path $musicDir $destinationName
    }
    if (-not (Test-Path -LiteralPath $destinationPath -PathType Leaf)) {
      throw "导入目标不存在，已保留原始文件：$destinationPath"
    }
  }
  foreach ($file in $inputFiles) {
    Remove-Item -LiteralPath $file.FullName
  }

  Write-Output "导入完成：压缩 $($audioFiles.Count) 首，导入歌词 $($lyricFiles.Count) 个。"
  Write-Output '原始输入文件已删除；压缩后的歌曲和歌词保留在 music 目录中。'
} catch {
  if (-not $syncAttempted) {
    foreach ($path in $committedPaths) {
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path
      }
    }
  }
  throw
} finally {
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
}
