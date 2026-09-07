param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"
$hostName = "com.florence2.detections"
$hostDirectory = Join-Path $PSScriptRoot "native_host"
$manifestPath = Join-Path $hostDirectory "$hostName.json"
$launcherPath = Join-Path $hostDirectory "launch-host.cmd"

if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python was not found. Install Python for Windows, then run this setup again."
}
if (-not (Test-Path -LiteralPath $launcherPath)) {
  throw "Native host launcher not found: $launcherPath"
}

$manifest = [ordered]@{
  name = $hostName
  description = "Florence-2 detection JSON writer"
  path = $launcherPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/*")
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding ascii

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Path $registryPath -Force | Out-Null
New-ItemProperty -Path $registryPath -Name '(default)' -Value $manifestPath -PropertyType String -Force | Out-Null

Write-Host "Registered $hostName for extension $ExtensionId"
Write-Host "Host manifest: $manifestPath"
Write-Host "Output file: $([Environment]::GetFolderPath('UserProfile'))\Downloads\detectionsflorence.json"
