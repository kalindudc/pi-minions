#!/usr/bin/env bash
set -uo pipefail
export PI_MINIONS_DEBUG=1

rm -rf /tmp/logs/pi-minions/minions/*.log
rm -rf "$HOME/.pi/agent/sessions"/*tmp-pi-minions-test*
rm -rf /tmp/logs/pi-minions/*.log
touch /tmp/logs/pi-minions/debug.log
