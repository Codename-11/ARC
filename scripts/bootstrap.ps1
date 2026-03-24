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

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is required but was not found on PATH."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js 18+ is required but was not found on PATH."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm is required but was not found on PATH."
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

if (Test-Path (Join-Path $repoDir ".git")) {
  Info "Updating existing repo at $repoDir"
  git -C $repoDir fetch --all --prune
  git -C $repoDir reset --hard origin/main
} else {
  if (Test-Path $repoDir) {
    Remove-Item -Recurse -Force $repoDir
  }

  Info "Cloning repo into $repoDir"
  git clone $repoUrl $repoDir
}

Info "Installing dependencies"
npm install --prefix $repoDir

Info "Running arc setup"
npm run cli --prefix $repoDir -- setup --shell powershell

Info "Bootstrap complete."
Write-Host "Open a new PowerShell window, then run: arc --help" -ForegroundColor Green
