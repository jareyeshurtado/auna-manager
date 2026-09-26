<#
    Starts a complete local copy of AUNA with FAKE data. Nothing touches production:
    no real patients and no real push notifications.

      Admin panel:  http://localhost:5500/admin.html
      TV board:     http://localhost:5500/index.html
      Database UI:  http://localhost:4000

    Test logins (password: prueba123)
      doctor1@auna.test    doctor with appointments today
      doctor2@auna.test    shared account (two doctors in one login)
      recepcion@auna.test  reception: manages every doctor

    Close the two windows it opens to stop. Data is kept in .emulator-data between runs;
    delete that folder to start fresh.
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

foreach ($tool in 'node', 'firebase', 'java', 'python') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "Missing tool: $tool" -ForegroundColor Red
        exit 1
    }
}
if (-not (Test-Path 'functions/node_modules')) { npm ci --prefix functions --no-audit --no-fund }
node tools/sync-locales.js

$dataDir = Join-Path $Root '.emulator-data'
$fresh = -not (Test-Path $dataDir)
$emulatorArgs = "firebase emulators:start --project demo-auna --export-on-exit `"$dataDir`""
if (-not $fresh) { $emulatorArgs += " --import `"$dataDir`"" }

Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', "Set-Location '$Root'; $emulatorArgs"
Start-Process python -ArgumentList '-m', 'http.server', '5500', '--bind', '127.0.0.1', '--directory', "`"$Root`""

Write-Host 'Waiting for the emulators to start...'
$deadline = (Get-Date).AddMinutes(2)
while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4000' -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 2 }
}

if ($fresh) {
    Write-Host 'Loading test data...'
    node tools/seed-emulator.js
}

Start-Process 'http://localhost:5500/admin.html'
Start-Process 'http://localhost:5500/index.html'
Write-Host 'Ready. Logins: doctor1@auna.test / doctor2@auna.test / recepcion@auna.test  (password: prueba123)' -ForegroundColor Green
