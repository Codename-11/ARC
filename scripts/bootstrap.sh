#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/Codename-11/ARC.git"
INSTALL_ROOT="${ARC_INSTALL_DIR:-$HOME/.arc-install}"
REPO_DIR="$INSTALL_ROOT/repo"

info() {
  printf '[arc] %s\n' "$1"
}

fail() {
  printf '[arc] %s\n' "$1" >&2
  exit 1
}

info "Bootstrap starting..."

# ── Prerequisites ──────────────────────────────────────────────────────────────

command -v git >/dev/null 2>&1 || fail "git is required. Install it and re-run."
command -v node >/dev/null 2>&1 || fail "Node.js >= 18 is required. Install from https://nodejs.org and re-run."

NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js >= 18 is required (found $(node --version)). Update and re-run."
fi

# ── Clone / update repo ────────────────────────────────────────────────────────

mkdir -p "$INSTALL_ROOT"

if [ -d "$REPO_DIR/.git" ]; then
  info "Updating existing repo at $REPO_DIR"
  git -C "$REPO_DIR" fetch --all --prune
  git -C "$REPO_DIR" reset --hard origin/master
else
  rm -rf "$REPO_DIR"
  info "Cloning repo into $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
fi

# ── Install dependencies and build ────────────────────────────────────────────

info "Installing dependencies..."
cd "$REPO_DIR"
npm install --no-fund --no-audit
info "Building..."
npm run build

# ── Install shims and PATH ────────────────────────────────────────────────────

info "Running arc setup..."
node "$REPO_DIR/dist/index.js" setup

info "Bootstrap complete — open a new terminal, then run: arc"
printf '\n'

node "$REPO_DIR/dist/index.js"
