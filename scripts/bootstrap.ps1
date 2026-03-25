Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/Codename-11/ARC.git"
$installRoot = if ($env:ARC_INSTALL_DIR) {
  $env:ARC_INSTALL_DIR
} else {
  Join-Path $HOME ".arc-install"
}
$repoDir = Join-Path $installRoot "repo"
$userBinDir = if ($env:ARC_LOCAL_BIN_DIR) {
  $env:ARC_LOCAL_BIN_DIR
} else {
  Join-Path $HOME ".local\bin"
}

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

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Fail "Rust (cargo) is required. Install from https://rustup.rs then re-run this script."
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

Info "Building arc binary (this may take a minute on first run)..."
Push-Location (Join-Path $repoDir "rust")
cargo build --release
Pop-Location

# Copy binary to user bin dir
New-Item -ItemType Directory -Force -Path $userBinDir | Out-Null
$binarySource = Join-Path $repoDir "rust\target\release\arc.exe"
$binaryDest   = Join-Path $userBinDir "arc.exe"
Copy-Item -Force $binarySource $binaryDest

# Add user bin dir to Windows user PATH if needed
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$normalizedBin = $userBinDir.TrimEnd('\').ToLower()
$alreadyInPath = ($currentPath -split ";") | Where-Object { $_.Trim().TrimEnd('\').ToLower() -eq $normalizedBin }
if (-not $alreadyInPath) {
  $newPath = if ($currentPath) { "$currentPath;$userBinDir" } else { $userBinDir }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Info "Added $userBinDir to your Windows user PATH."
}

# Add to current session PATH so we can run arc immediately
$env:PATH = "$userBinDir;$env:PATH"

Info "Running arc setup (shell integration)..."
& $binaryDest setup --shell powershell

Info "Bootstrap complete — launching ARC..."
Write-Host ""

# Launch the interactive CLI (onboarding wizard on first run, dashboard if profiles exist)
& $binaryDest
