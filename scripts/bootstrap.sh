#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/Codename-11/ARC.git"
INSTALL_ROOT="${ARC_INSTALL_DIR:-$HOME/.arc-install}"
REPO_DIR="$INSTALL_ROOT/repo"
USER_BIN_DIR="${ARC_LOCAL_BIN_DIR:-$HOME/.local/bin}"

info() {
  printf '[arc] %s\n' "$1"
}

fail() {
  printf '[arc] %s\n' "$1" >&2
  exit 1
}

info "Bootstrap starting..."

command -v git   >/dev/null 2>&1 || fail "git is required but was not found on PATH."
command -v cargo >/dev/null 2>&1 || fail "Rust (cargo) is required. Install from https://rustup.rs then re-run this script."

mkdir -p "$INSTALL_ROOT"

if [ -d "$REPO_DIR/.git" ]; then
  info "Updating existing repo at $REPO_DIR"
  git -C "$REPO_DIR" fetch --all --prune
  git -C "$REPO_DIR" reset --hard origin/main
else
  rm -rf "$REPO_DIR"
  info "Cloning repo into $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
fi

info "Building arc binary (this may take a minute on first run)..."
cargo build --release --manifest-path "$REPO_DIR/rust/Cargo.toml"

# Install binary
mkdir -p "$USER_BIN_DIR"
cp -f "$REPO_DIR/rust/target/release/arc" "$USER_BIN_DIR/arc"
chmod +x "$USER_BIN_DIR/arc"

# Ensure user bin dir is on PATH for this session
export PATH="$USER_BIN_DIR:$PATH"

info "Running arc setup (shell integration)..."
"$USER_BIN_DIR/arc" setup

info "Bootstrap complete — launching ARC..."
printf '\n'

# Launch the interactive CLI (onboarding wizard on first run, dashboard if profiles exist)
"$USER_BIN_DIR/arc"
