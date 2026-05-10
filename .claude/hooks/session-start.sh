#!/usr/bin/env bash
# Claude Code on web SessionStart hook.
# Installs Doppler CLI into ~/.local/bin so `doppler run -- <cmd>` works
# (the standard pattern from CLAUDE.md "시크릿 사용 규칙").
#
# Web sessions have DOPPLER_TOKEN_PRD/STG/DEV pre-injected as env vars, so
# `doppler login` is not needed. We export DOPPLER_TOKEN=$DOPPLER_TOKEN_PRD
# (CLAUDE.md default = project=clavier, config=prd) so plain `doppler run`
# auto-resolves the config without requiring `doppler setup`.
#
# Idempotent: skips install if `doppler` is already on PATH.

set -euo pipefail

# Only run on Claude Code on the web (Mac uses installScripts.sh + Homebrew).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

# Make sure ~/.local/bin is on PATH for the rest of the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  if ! grep -qsF "export PATH=\"$INSTALL_DIR:" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  fi
  export PATH="$INSTALL_DIR:$PATH"
fi

# Pick a default service token. Order: explicit DOPPLER_TOKEN > PRD > STG > DEV.
# Whatever is chosen scopes `doppler run` to that config automatically.
if [ -z "${DOPPLER_TOKEN:-}" ]; then
  if [ -n "${DOPPLER_TOKEN_PRD:-}" ]; then
    DEFAULT_TOKEN="$DOPPLER_TOKEN_PRD"; TOKEN_SOURCE="DOPPLER_TOKEN_PRD"
  elif [ -n "${DOPPLER_TOKEN_STG:-}" ]; then
    DEFAULT_TOKEN="$DOPPLER_TOKEN_STG"; TOKEN_SOURCE="DOPPLER_TOKEN_STG"
  elif [ -n "${DOPPLER_TOKEN_DEV:-}" ]; then
    DEFAULT_TOKEN="$DOPPLER_TOKEN_DEV"; TOKEN_SOURCE="DOPPLER_TOKEN_DEV"
  else
    DEFAULT_TOKEN=""; TOKEN_SOURCE=""
  fi

  if [ -n "$DEFAULT_TOKEN" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    if ! grep -qs '^export DOPPLER_TOKEN=' "$CLAUDE_ENV_FILE" 2>/dev/null; then
      echo "export DOPPLER_TOKEN=\"\${$TOKEN_SOURCE}\"" >> "$CLAUDE_ENV_FILE"
    fi
    export DOPPLER_TOKEN="$DEFAULT_TOKEN"
  fi
fi

# If doppler is already installed (warm container cache), we're done.
if command -v doppler >/dev/null 2>&1; then
  echo "doppler already installed: $(doppler --version 2>/dev/null || echo unknown)"
  exit 0
fi

# Use Doppler's official installer in unprivileged mode.
# --install-path: install into a writable dir (no sudo)
# --no-package-manager: skip apt/yum/brew, just drop the binary
echo "Installing Doppler CLI into $INSTALL_DIR ..."
if ! curl -fsSL --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh \
      | sh -s -- --install-path "$INSTALL_DIR" --no-package-manager >/dev/null; then
  # Fallback: direct binary download from GitHub releases.
  echo "install.sh failed, falling back to GitHub release tarball ..." >&2
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ASSET_ARCH="linux_amd64" ;;
    aarch64) ASSET_ARCH="linux_arm64" ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
  esac
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://github.com/DopplerHQ/cli/releases/latest/download/doppler_latest_${ASSET_ARCH}.tar.gz" \
    -o "$TMP/doppler.tgz"
  tar -xzf "$TMP/doppler.tgz" -C "$TMP"
  install -m 0755 "$TMP/doppler" "$INSTALL_DIR/doppler"
fi

if command -v doppler >/dev/null 2>&1; then
  echo "Doppler CLI installed: $(doppler --version 2>/dev/null)"
else
  echo "ERROR: Doppler CLI install failed" >&2
  exit 1
fi
