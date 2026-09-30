$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

python -m uv sync --package api --group scanner-build --frozen
python -m uv run --package api --group scanner-build pyinstaller `
  --name StencilScanner `
  --onefile `
  --windowed `
  --clean `
  --noconfirm `
  --version-file apps/api/scanner-version.txt `
  --paths apps/api/src `
  --collect-all cv2 `
  apps/api/src/sheet_scanner/companion.py

Write-Host "Scanner executable: $repo\dist\StencilScanner.exe"
