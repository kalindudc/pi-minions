#!/usr/bin/env bash
set -euo pipefail
export PI_MINIONS_DEBUG=1

# npm scripts prepend node_modules/.bin to PATH, causing `pi` to resolve
# to the local devDependency instead of the globally installed one.
GLOBAL_PI=$(which -a pi 2>/dev/null | grep -v 'node_modules' | head -n 1)
if [ -z "$GLOBAL_PI" ]; then
  echo "Error: global pi not found. Install with: npm install -g @mariozechner/pi-coding-agent"
  exit 1
fi

mkdir -p /tmp/logs/pi-minions/

# Rotate: keep last session as .prev so nothing is lost
if [ -s /tmp/logs/pi-minions/debug.log ]; then
  cp /tmp/logs/pi-minions/debug.log /tmp/logs/pi-minions/debug.prev.log
fi

echo "" > /tmp/logs/pi-minions/debug.log

echo ""
echo "  ┌───────────────────────────────────────────-──┐"
echo "  │  pi-minions dev session starting             │"
echo "  │  Open a second terminal and run: npm run logs│"
echo "  │  Log: ./tmp/logs/pi-minions/debug.log        │"
echo "  └───────────────────────────────────────────-──┘"
echo ""

$GLOBAL_PI
