Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/Codename-11/ARC.git"
$installRoot = if ($env:ARC_INSTALL_DIR) {
  $env:ARC_INSTALL_DIR
} else {
  Join-Path $HOME ".arc-install"
}
$repoDir = Join-Path $installRoot "repo"

function Info($message) {
  Write-Host "[arc] $message" -ForegroundColor Cyan
}

function Fail($message) {
  Write-Host "[arc] $message" -ForegroundColor Red
  exit 1
}

Info "Bootstrap starting..."

# ── Prerequisites ─────────────────────────────────────────────────────────────

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is required but was not found. Install from https://git-scm.com and re-run."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js >= 18 is required but was not found. Install from https://nodejs.org and re-run."
}

$nodeVersion = (node --version) -replace '^v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
  Fail "Node.js >= 18 is required (found v$nodeVersion). Update from https://nodejs.org and re-run."
}

# ── Clone / update repo ───────────────────────────────────────────────────────

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

if (Test-Path (Join-Path $repoDir ".git")) {
  Info "Updating existing repo at $repoDir"
  git -C $repoDir fetch --all --prune
  git -C $repoDir reset --hard origin/master
} else {
  if (Test-Path $repoDir) {
    Remove-Item -Recurse -Force $repoDir
  }
  Info "Cloning repo into $repoDir"
  git clone $repoUrl $repoDir
}

# ── Install dependencies and build ───────────────────────────────────────────

Info "Installing dependencies..."
Push-Location $repoDir
npm install --no-fund --no-audit
Info "Building..."
npm run build
Pop-Location

# ── Install shims and PATH ───────────────────────────────────────────────────

Info "Running arc setup..."
node (Join-Path $repoDir "dist" "index.js") setup --shell powershell

Info "Bootstrap complete — open a new terminal, then run: arc"
Write-Host ""

node (Join-Path $repoDir "dist" "index.js")
