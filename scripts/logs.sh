#!/usr/bin/env bash
set -euo pipefail

rm -rf /tmp/logs/pi-minions
mkdir -p /tmp/logs/pi-minions && touch /tmp/logs/pi-minions/debug.log
ln -sf /tmp/logs/pi-minions tmp/logs

echo "Tailing ./tmp/logs/debug.log  (Ctrl+C to stop)"
tail -f -n 100 ./tmp/logs/debug.log
