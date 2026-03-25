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

# ── Prerequisites ──────────────────────────────────────────────────────────────

command -v git >/dev/null 2>&1 || fail "git is required. Install it and re-run."

if ! command -v cargo >/dev/null 2>&1; then
  info "Rust not found — installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path

  # Source cargo env for this session
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"

  command -v cargo >/dev/null 2>&1 \
    || fail "Rust installation failed. Install manually from https://rustup.rs and re-run."

  info "Rust installed successfully."
fi

# ── Clone / update repo ────────────────────────────────────────────────────────

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

# ── Build ──────────────────────────────────────────────────────────────────────

info "Building arc binary (first run compiles dependencies — ~2 min)..."
cargo build --release --manifest-path "$REPO_DIR/rust/Cargo.toml"

# ── Install binary ─────────────────────────────────────────────────────────────

mkdir -p "$USER_BIN_DIR"
cp -f "$REPO_DIR/rust/target/release/arc" "$USER_BIN_DIR/arc"
chmod +x "$USER_BIN_DIR/arc"

export PATH="$USER_BIN_DIR:$PATH"

# ── Shell integration + launch ─────────────────────────────────────────────────

info "Running arc setup..."
"$USER_BIN_DIR/arc" setup

info "Bootstrap complete — open a new terminal, then run: arc"
printf '\n'

"$USER_BIN_DIR/arc"
