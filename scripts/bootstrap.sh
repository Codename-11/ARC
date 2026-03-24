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

command -v git >/dev/null 2>&1 || fail "git is required but was not found on PATH."
command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required but was not found on PATH."
command -v npm >/dev/null 2>&1 || fail "npm is required but was not found on PATH."

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

info "Installing dependencies"
npm install --prefix "$REPO_DIR"

info "Running arc setup"
npm run cli --prefix "$REPO_DIR" -- setup

info "Bootstrap complete."
printf 'Open a new shell, then run: arc --help\n'
