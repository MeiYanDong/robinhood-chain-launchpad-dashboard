#!/bin/zsh
set -euo pipefail

label="com.cashcat.sentinel"
domain="gui/$(id -u)"
project_dir="${0:A:h:h}"
source_plist="${project_dir}/deploy/macos/${label}.plist"
target_plist="/Users/myandong/Library/LaunchAgents/${label}.plist"

plutil -lint "${source_plist}"
install -m 0644 "${source_plist}" "${target_plist}"
launchctl bootout "${domain}/${label}" 2>/dev/null || true
launchctl bootstrap "${domain}" "${target_plist}"
launchctl kickstart -k "${domain}/${label}"
launchctl print "${domain}/${label}"
