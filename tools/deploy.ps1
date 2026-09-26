<#
    AUNA deploy script.

    Easiest: double-click deploy.bat in the project folder and pick an option.

    Non-interactive (used by Claude after an update):
        powershell -ExecutionPolicy Bypass -File tools\deploy.ps1 -Target site -Message "Describe the change" -Yes

    Targets:
        site       Website (admin panel + TV board) -> commit + push to GitHub Pages
        functions  Cloud Functions (notifications, calendar feed, TV board sync) + database indexes
        rules      Firestore security rules
        all        functions, then website (rules stay a separate step)
#>
param(
    [ValidateSet('menu', 'site', 'functions', 'rules', 'all')]
    [string]$Target = 'menu',
    [string]$Message = '',
    [switch]$Yes
)

# 'Continue': native tools (git, firebase, npm) print progress on stderr, which Windows
# PowerShell would otherwise treat as a fatal error. Every step checks $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$ProjectId = 'auna-board'
$SiteUrl = 'https://aunaconsultorios.online'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Stop-Deploy([string]$Text) { Write-Host ''; Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }
function Confirm-Step([string]$Question) {
    if ($Yes) { return $true }
    $answer = Read-Host "$Question [s/N]"
    return $answer -match '^(s|si|sí|y|yes)$'
}

# ---------------------------------------------------------------------------------------------
function Test-Code {
    Write-Step 'Checking the code for errors'
    foreach ($file in 'admin.js', 'display.js', 'i18n.js', 'sw.js', 'firebase-messaging-sw.js', 'functions/index.js') {
        node --check $file
        if ($LASTEXITCODE -ne 0) { Stop-Deploy "Syntax error in $file" }
    }
    foreach ($file in 'locales/es.json', 'locales/en.json', 'manifest.json', 'promos/playlist.json', 'firebase.json', 'firestore.indexes.json', 'functions/package.json') {
        node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" $file
        if ($LASTEXITCODE -ne 0) { Stop-Deploy "Invalid JSON in $file" }
    }
    Write-Ok 'All files are valid'

    Write-Step 'Checking translations (Spanish / English)'
    node tools/sync-locales.js | Out-Null
    node tools/check-i18n.js
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'A text is missing in one of the languages (see above).' }
}

function Assert-Firebase {
    if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
        Stop-Deploy 'The Firebase CLI is not installed. Run:  npm install -g firebase-tools'
    }
    firebase projects:list *> $null
    if ($LASTEXITCODE -ne 0) {
        if ($Yes) { Stop-Deploy 'Not logged in to Firebase. Double-click deploy.bat once to log in.' }
        Write-Step 'Logging in to Firebase (a browser window will open)'
        firebase login
        if ($LASTEXITCODE -ne 0) { Stop-Deploy 'Firebase login failed' }
    }
}

# Functions that are live in Firebase but no longer in the code are deleted by the deploy.
# Show them and ask once, instead of the Firebase CLI's own prompt.
function Confirm-RemovedFunctions {
    $inCode = (node -e "console.log(Object.keys(require('./functions/index.js')).join(','))").Trim().Split(',')
    $listing = firebase functions:list --project $ProjectId --json 2>$null | Out-String | ConvertFrom-Json
    $removed = @($listing.result | ForEach-Object { $_.id } | Where-Object { $inCode -notcontains $_ })
    if ($removed.Count -eq 0) { return }

    Write-Host ''
    Write-Host '    These functions are no longer in the code and will be DELETED from Firebase:' -ForegroundColor Yellow
    $removed | ForEach-Object { Write-Host "      - $_" -ForegroundColor Yellow }
    if (-not (Confirm-Step 'Delete them as part of this deploy?')) { Stop-Deploy 'Cancelled' }
}

# ---------------------------------------------------------------------------------------------
function Publish-Site {
    Write-Step 'Publishing the website (GitHub Pages)'
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($branch -ne 'main') { Stop-Deploy "You are on branch '$branch'. The live site is published from 'main'." }

    git add -A
    $changes = git status --porcelain
    if (-not $changes) {
        Write-Ok 'Nothing new to publish'
    } else {
        git status --short
        if (-not (Confirm-Step 'Publish these changes to the live website?')) {
            git reset -q
            Stop-Deploy 'Cancelled'
        }
        if (-not $Message -and -not $Yes) { $script:Message = Read-Host 'Short description of the change (Enter = automatic)' }
        if (-not $Message) { $script:Message = "Update $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
        git commit -q -m $Message
        if ($LASTEXITCODE -ne 0) { Stop-Deploy 'git commit failed' }
    }

    git pull --rebase -q origin main
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'Could not sync with GitHub (someone else changed the same files). Ask for help before retrying.' }
    git push -q origin main
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'git push failed (check your GitHub login).' }
    Write-Ok "Published. Live at $SiteUrl within 1-10 minutes."
}

function Publish-Functions {
    Assert-Firebase
    Write-Step 'Installing function dependencies'
    npm ci --prefix functions --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'npm ci failed' }

    # Indexes first: the functions and the admin panel query them.
    Write-Step 'Deploying database indexes'
    firebase deploy --only firestore:indexes --project $ProjectId --non-interactive
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'Index deploy failed' }

    Confirm-RemovedFunctions

    Write-Step 'Deploying Cloud Functions (takes 2-5 minutes)'
    firebase deploy --only functions --project $ProjectId --force
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'Functions deploy failed' }
    Write-Ok 'Functions deployed'
}

function Publish-Rules {
    Assert-Firebase
    Write-Host ''
    Write-Host '    After this, the TV reads only the "board" collection. Every TV must already be running' -ForegroundColor Yellow
    Write-Host '    the new version (reload each TV once after publishing the website).' -ForegroundColor Yellow
    if (-not (Confirm-Step 'Deploy the security rules now?')) { Stop-Deploy 'Cancelled' }

    Write-Step 'Deploying security rules'
    firebase deploy --only firestore:rules --project $ProjectId
    if ($LASTEXITCODE -ne 0) { Stop-Deploy 'Rules deploy failed' }
    Write-Ok 'Security rules deployed'
}

# ---------------------------------------------------------------------------------------------
if ($Target -eq 'menu') {
    Write-Host ''
    Write-Host '  AUNA - Publish changes' -ForegroundColor Cyan
    Write-Host '  ----------------------'
    Write-Host '  1) Website only       (admin panel + TV board)'
    Write-Host '  2) Cloud Functions    (notifications, calendar feed, TV sync) + database indexes'
    Write-Host '  3) Security rules     (only after every TV runs the new version)'
    Write-Host '  4) Functions + website'
    Write-Host '  Q) Quit'
    $choice = Read-Host '  Choose'
    $Target = @{ '1' = 'site'; '2' = 'functions'; '3' = 'rules'; '4' = 'all' }[$choice]
    if (-not $Target) { exit 0 }
}

Test-Code
switch ($Target) {
    'site' { Publish-Site }
    'functions' { Publish-Functions }
    'rules' { Publish-Rules }
    'all' {
        Publish-Functions
        Publish-Site
        Write-Host ''
        Write-Host 'Next: reload each TV, then run deploy.bat again and choose 3 (security rules).' -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
