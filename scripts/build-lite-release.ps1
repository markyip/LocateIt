# Build LocateIt-Lite release zip (source only — no venv).
param(
    [string]$Version = "1.1.1"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Name = "LocateIt-Lite-v$Version"
$Stage = Join-Path $Root "dist\$Name"
$Zip = Join-Path $Root "dist\$Name.zip"

function Convert-ToLf {
    param([string]$Path)
    $content = [System.IO.File]::ReadAllText($Path)
    $content = $content -replace "`r`n", "`n"
    if (-not $content.EndsWith("`n")) {
        $content += "`n"
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
}

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

foreach ($f in @("run-lite.sh", "stop.sh")) {
    Convert-ToLf (Join-Path $Stage $f)
}

$PyModules = @(
    "__init__.py",
    "formats.py",
    "photo_metadata.py",
    "geotag_exiv.py",
    "scanner.py",
    "lite_http.py"
)
foreach ($m in $PyModules) {
    Copy-Item (Join-Path $Root "gps_cluster_map\$m") (Join-Path $Stage "gps_cluster_map\$m")
}

Copy-Item -Recurse (Join-Path $Root "web-lite") (Join-Path $Stage "web-lite")

New-Item -ItemType Directory -Force -Path (Join-Path $Root "dist") | Out-Null

# Prefer tar (Unix paths + LF-friendly) over Compress-Archive (backslash paths).
$tar = Get-Command tar -ErrorAction SilentlyContinue
if ($tar) {
    Push-Location (Join-Path $Root "dist")
    try {
        & tar -a -c -f $Zip $Name
    } finally {
        Pop-Location
    }
} else {
    Compress-Archive -Path $Stage -DestinationPath $Zip -Force
    Write-Warning "tar not found — zip may use Windows path separators. Build on macOS/Linux when possible."
}

$zipSize = (Get-Item $Zip).Length / 1MB
Write-Host "Created $Zip ($([math]::Round($zipSize, 2)) MB)"
