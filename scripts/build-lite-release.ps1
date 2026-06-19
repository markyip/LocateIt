# Build LocateIt-Lite release zip (source only — no venv).
param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Name = "LocateIt-Lite-v$Version"
$Stage = Join-Path $Root "dist\$Name"
$Zip = Join-Path $Root "dist\$Name.zip"

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
if (Test-Path $Zip) { Remove-Item -Force $Zip }

New-Item -ItemType Directory -Force -Path (Join-Path $Stage "gps_cluster_map") | Out-Null

$RootFiles = @(
    "lite.py",
    "run-lite.bat",
    "run-lite.sh",
    "stop.bat",
    "stop.sh",
    "requirements-lite.txt",
    "README-LITE.md"
)
foreach ($f in $RootFiles) {
    Copy-Item (Join-Path $Root $f) (Join-Path $Stage $f)
}

$PyModules = @(
    "__init__.py",
    "formats.py",
    "photo_metadata.py",
    "geotag_exiv.py",
    "scanner.py",
    "lite_server.py"
)
foreach ($m in $PyModules) {
    Copy-Item (Join-Path $Root "gps_cluster_map\$m") (Join-Path $Stage "gps_cluster_map\$m")
}

Copy-Item -Recurse (Join-Path $Root "web-lite") (Join-Path $Stage "web-lite")

New-Item -ItemType Directory -Force -Path (Join-Path $Root "dist") | Out-Null
Compress-Archive -Path $Stage -DestinationPath $Zip -Force

$zipSize = (Get-Item $Zip).Length / 1MB
Write-Host "Created $Zip ($([math]::Round($zipSize, 2)) MB)"
