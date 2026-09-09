#!/bin/zsh
set -euo pipefail

label="com.cashcat.sentinel"
domain="gui/$(id -u)"
target_plist="/Users/myandong/Library/LaunchAgents/${label}.plist"

launchctl bootout "${domain}/${label}" 2>/dev/null || true
if [[ -f "${target_plist}" ]]; then
  mv "${target_plist}" "${target_plist}.disabled"
fi
