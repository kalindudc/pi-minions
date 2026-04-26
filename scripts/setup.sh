#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "Error: node is required. Install via fnm: https://github.com/Schniz/fnm"
  exit 1
fi
echo "  node $(node --version)"

echo "==> Checking package manager..."
if command -v pnpm &>/dev/null; then
  echo "  pnpm $(pnpm --version) (preferred)"
else
  echo "  npm $(npm --version) (pnpm not found, using npm)"
fi


if [[ -z "${CI:-}" ]]; then
  echo "==> Checking pi..."
  if ! command -v pi &>/dev/null; then
    echo "Error: pi is required. Install with: npm install -g @mariozechner/pi-coding-agent"
    exit 1
  fi
  echo "  pi $(pi --version 2>/dev/null || echo '(version unavailable)')"

  echo "==> Configuring git hooks..."
  git config core.hooksPath .githooks
  echo "  ✓ Git hooks path set to .githooks"

  mkdir -p tmp/

  if [[ ! -L tmp/sessions ]]; then
    ln -s "$HOME/.pi/agent/sessions" tmp/sessions
    echo " "
    echo "✓ session files can be found in ./tmp/sessions/"
  fi

  if [[ ! -L tmp/logs ]]; then
    ln -s /tmp/logs/pi-minions tmp/logs
    echo ""
    echo "✓ debug logs can be found in ./tmp/logs/"
  fi
fi

echo ""
echo "✓ Development environment ready."
echo ""
echo "  npm test          run unit tests"
echo "  npm run typecheck TypeScript type check"
echo "  npm run style     lint, format, and type check"
echo "  npm run dev       load extension into pi"
echo "  npm run test:e2e  smoke test in pi print mode"
