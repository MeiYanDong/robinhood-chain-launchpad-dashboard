#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
if [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--apply]" >&2
  exit 64
fi

RELEASE_ROOT="/opt/robinhood-chain-launchpad/releases"
CURRENT_LINK="/opt/robinhood-chain-launchpad/current"
DEPLOY_BACKUP_ROOT="/opt/robinhood-chain-launchpad/deploy-backups"
FAILED_PREPARATION_ROOT="/opt/robinhood-chain-launchpad/failed-preparations"
CASHCAT_CACHE_ROOT="/var/lib/cashcat-sentinel/.cache/google-chrome-headless"
CASHCAT_CONFIG_ROOT="/var/lib/cashcat-sentinel/.config/google-chrome-headless"
KEEP_RELEASES=3
KEEP_DEPLOY_BACKUPS=3
CASHCAT_STALE_MINUTES=1440
FAILED_PREPARATION_STALE_DAYS=7
DISK_WARN_PERCENT=75
DISK_CRITICAL_PERCENT=85

log() {
  printf '%s\n' "$*"
}

remove_directory() {
  local root="$1"
  local target="$2"
  case "$target" in
    "$root"/*) ;;
    *) log "refusing unsafe target: $target"; return 1 ;;
  esac
  if [[ "$MODE" == "apply" ]]; then
    rm -rf -- "$target"
    log "removed $target"
  else
    log "would remove $target"
  fi
}

current_release="$(realpath "$CURRENT_LINK")"
case "$current_release" in
  "$RELEASE_ROOT"/*) ;;
  *) log "current release is outside the protected release root"; exit 65 ;;
esac

declare -A protected_releases=(["$current_release"]=1)
rollback_slots=$((KEEP_RELEASES - 1))
while IFS= read -r release_name; do
  release_path="$RELEASE_ROOT/$release_name"
  [[ "$release_path" == "$current_release" ]] && continue
  if (( rollback_slots > 0 )); then
    protected_releases["$release_path"]=1
    rollback_slots=$((rollback_slots - 1))
  fi
done < <(find "$RELEASE_ROOT" -xdev -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)

declare -A process_releases=()
for process_dir in /proc/[0-9]*; do
  process_target="$(readlink "$process_dir/cwd" 2>/dev/null || true)"
  case "$process_target" in
    "$RELEASE_ROOT"/*) process_releases["$process_target"]=1 ;;
  esac
done

while IFS= read -r release_path; do
  [[ -n "${protected_releases[$release_path]:-}" ]] && continue
  if [[ -n "${process_releases[$release_path]:-}" ]]; then
    log "skipped process-referenced release $release_path"
    continue
  fi
  remove_directory "$RELEASE_ROOT" "$release_path"
done < <(find "$RELEASE_ROOT" -xdev -mindepth 1 -maxdepth 1 -type d -print | sort -r)

backup_slots=$KEEP_DEPLOY_BACKUPS
while IFS= read -r backup_path; do
  if (( backup_slots > 0 )); then
    backup_slots=$((backup_slots - 1))
    continue
  fi
  remove_directory "$DEPLOY_BACKUP_ROOT" "$backup_path"
done < <(find "$DEPLOY_BACKUP_ROOT" -xdev -mindepth 1 -maxdepth 1 -type d -print | sort -r)

while IFS= read -r failed_path; do
  remove_directory "$FAILED_PREPARATION_ROOT" "$failed_path"
done < <(
  find "$FAILED_PREPARATION_ROOT" -xdev -mindepth 1 -maxdepth 1 -type d \
    -mtime "+$FAILED_PREPARATION_STALE_DAYS" -print
)

if pgrep -f '[c]hrome|[c]hromium' >/dev/null; then
  log "skipped CashCat browser cache cleanup because Chrome is active"
else
  for cache_root in "$CASHCAT_CACHE_ROOT" "$CASHCAT_CONFIG_ROOT"; do
    while IFS= read -r cache_path; do
      remove_directory "$cache_root" "$cache_path"
    done < <(
      find "$cache_root" -xdev -mindepth 1 -maxdepth 1 -type d \
        -name 'scoped_dir*' -mmin "+$CASHCAT_STALE_MINUTES" -print
    )
  done
fi

disk_percent="$(df --output=pcent / | tail -n 1 | tr -cd '0-9')"
log "disk_used_percent=$disk_percent mode=$MODE"
if (( disk_percent >= DISK_CRITICAL_PERCENT )); then
  log "critical: disk use is at or above ${DISK_CRITICAL_PERCENT}%"
  exit 2
fi
if (( disk_percent >= DISK_WARN_PERCENT )); then
  log "warning: disk use is at or above ${DISK_WARN_PERCENT}%"
fi
