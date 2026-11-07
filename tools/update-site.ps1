param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Update
)

# Run before publishing: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\update-site.ps1 -Update "update summary"
$siteRoot = Split-Path -Parent $PSScriptRoot
$siteGatePath = Join-Path $siteRoot "js\site-gate.js"
$dailyMusicPath = Join-Path $siteRoot "js\daily-music.js"
$versionPattern = [regex]'(?<prefix>(?:href|src)="(?<url>[^"]+?)\?v=)[^"]+(?<suffix>")'
$badgePattern = [regex]'<div class="badge">\u4eca\u65e5\u66f4\u65b0\uff1a.*?</div>'
$htmlFiles = @(Get-ChildItem -LiteralPath $siteRoot -Filter "*.html" -File -Recurse)
$indexFile = Join-Path $siteRoot "index.html"

foreach ($requiredFile in @($indexFile, $siteGatePath, $dailyMusicPath)) {
  if (-not (Test-Path -LiteralPath $requiredFile)) {
    throw "Required file not found: $requiredFile"
  }
}

$indexContent = [System.IO.File]::ReadAllText($indexFile)
if (-not $badgePattern.IsMatch($indexContent)) {
  throw "Could not find the update badge in index.html."
}

$siteGateContent = [System.IO.File]::ReadAllText($siteGatePath)
$musicVersionPattern = [regex]'const dailyMusicAssetVersion = \x22[^\x22]*\x22;'
if (-not $musicVersionPattern.IsMatch($siteGateContent)) {
  throw "Could not find dailyMusicAssetVersion in site-gate.js."
}

$dailyMusicVersion = (Get-FileHash -LiteralPath $dailyMusicPath -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
$siteGateContent = $musicVersionPattern.Replace(
  $siteGateContent,
  "const dailyMusicAssetVersion = `"$dailyMusicVersion`";",
  1
)
$utf8WithoutBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($siteGatePath, $siteGateContent, $utf8WithoutBom)

$assetVersionByName = @{
  "style.css" = (Get-FileHash -LiteralPath (Join-Path $siteRoot "css\style.css") -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
  "site-gate.js" = (Get-FileHash -LiteralPath $siteGatePath -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
  "image-viewer.js" = (Get-FileHash -LiteralPath (Join-Path $siteRoot "js\image-viewer.js") -Algorithm SHA256).Hash.Substring(0, 12).ToLowerInvariant()
  "daily-music.js" = $dailyMusicVersion
}
$encodedUpdate = [System.Net.WebUtility]::HtmlEncode($Update)
# 替换串会按正则替换模式解析，$ 是特殊字符，需要转义成字面量
$encodedUpdate = $encodedUpdate.Replace('$', '$$')
$badgeLabel = ([char]0x4eca).ToString() + ([char]0x65e5) + ([char]0x66f4) + ([char]0x65b0) + ([char]0xff1a)
$badgeReplacement = '<div class="badge">' + $badgeLabel + $encodedUpdate + '</div>'

foreach ($file in $htmlFiles) {
  $content = [System.IO.File]::ReadAllText($file.FullName)
  $original = $content
  $content = $versionPattern.Replace($content, {
    param($match)
    $assetName = [System.IO.Path]::GetFileName($match.Groups["url"].Value)
    if ($assetVersionByName.ContainsKey($assetName)) {
      return $match.Groups["prefix"].Value + $assetVersionByName[$assetName] + $match.Groups["suffix"].Value
    }
    return $match.Value
  })
  if ($file.FullName -eq $indexFile) {
    $content = $badgePattern.Replace($content, $badgeReplacement, 1)
  }
  if ($content -ne $original) {
    [System.IO.File]::WriteAllText($file.FullName, $content, $utf8WithoutBom)
  }
}

Write-Output "Updated the homepage notice and static-asset hashes; unchanged assets keep their cache."
