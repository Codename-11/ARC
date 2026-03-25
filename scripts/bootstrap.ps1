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

# ── Prerequisites ─────────────────────────────────────────────────────────────

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is required but was not found. Install from https://git-scm.com and re-run."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Info "Rust not found — installing via rustup..."

  $rustupInit = Join-Path $env:TEMP "rustup-init.exe"
  Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupInit
  & $rustupInit -y --no-modify-path
  Remove-Item $rustupInit -Force

  # Source the cargo environment for this session
  $cargoEnv = Join-Path $HOME ".cargo\env.ps1"
  if (Test-Path $cargoEnv) {
    . $cargoEnv
  } else {
    $env:PATH = "$HOME\.cargo\bin;$env:PATH"
  }

  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Fail "Rust installation failed. Please install manually from https://rustup.rs and re-run."
  }

  Info "Rust installed successfully."
}

# ── Clone / update repo ───────────────────────────────────────────────────────

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

# ── Build ─────────────────────────────────────────────────────────────────────

Info "Building arc binary (first run compiles dependencies — ~2 min)..."
Push-Location (Join-Path $repoDir "rust")
cargo build --release
Pop-Location

# ── Install binary ────────────────────────────────────────────────────────────

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

# Make available in this session immediately
$env:PATH = "$userBinDir;$env:PATH"

# ── Shell integration + launch ────────────────────────────────────────────────

Info "Running arc setup..."
& $binaryDest setup --shell powershell

Info "Bootstrap complete — open a new terminal, then run: arc"
Write-Host ""

& $binaryDest
