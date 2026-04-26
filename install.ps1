# Elaine one-shot installer for Windows.
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/w4coder/elaine-ai/main/install.ps1 | iex
# Ensures Node 20+ (via winget), then runs `npx github:w4coder/elaine-ai` to launch the setup wizard.

$ErrorActionPreference = 'Stop'

$Repo = if ($env:ELAINE_REPO) { $env:ELAINE_REPO } else { 'w4coder/elaine-ai' }
$RequiredNodeMajor = 20

function Write-Step($msg) { Write-Host "> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "OK $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "!! $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "XX $msg" -ForegroundColor Red; exit 1 }

function Test-NodeOk {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return $false }
    $version = & node -p 'process.versions.node.split(".")[0]'
    return [int]$version -ge $RequiredNodeMajor
}

function Install-Node {
    Write-Step "Installing Node.js LTS via winget..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Err "winget not available. Install Node $RequiredNodeMajor+ manually from https://nodejs.org and re-run."
    }
    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { Write-Err "winget failed to install Node.js" }

    # Refresh PATH so node/npm/npx are visible in this session.
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
    Write-Ok "Node $(node -v) installed"
}

Write-Host ""
Write-Host "Elaine installer" -ForegroundColor White
Write-Host ""

if (Test-NodeOk) {
    Write-Ok "Node $(node -v) already meets requirement (>= $RequiredNodeMajor)"
} else {
    Write-Warn2 "Node $RequiredNodeMajor+ not found"
    Install-Node
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Err "npx not found after Node install. Open a new shell and re-run."
}

Write-Step "Launching Elaine setup wizard via npx..."
& npx -y "github:$Repo"
exit $LASTEXITCODE
