#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
LOG=".full-run.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG"
}

run() {
  log ">>> $*"
  "$@" 2>&1 | tee -a "$LOG"
}

log "========================================"
log "Resume after US PBF re-download"
log "========================================"

EXPECTED_US=11966010215
DEST="osm-pbf/geofabrik/us-latest.osm.pbf"
URL="https://download.geofabrik.de/north-america/us-260615.osm.pbf"
mkdir -p "$(dirname "$DEST")"

log "Downloading US PBF (fresh, no resume) -> $DEST"
curl -f --retry 10 --retry-delay 10 --retry-all-errors \
  --connect-timeout 60 --max-time 0 \
  --progress-bar -o "$DEST" "$URL" 2>&1 | tee -a "$LOG"

ACTUAL=$(stat -c '%s' "$DEST")
if [[ "$ACTUAL" != "$EXPECTED_US" ]]; then
  log "ERROR: US PBF size mismatch (got $ACTUAL, expected $EXPECTED_US)"
  exit 1
fi
log "US PBF verified ($(( ACTUAL / 1024 / 1024 )) MB)"

run node build-poi-osm-all.mjs --skip-download
run node build-fuel-us-all.mjs
run node build-fuel-ca-all.mjs
run node build-fuel-generic-explorer-embed.mjs
run node build-camping-us-all.mjs
run node build-camping-ca-all.mjs
run node build-nps-us-cache.mjs
run node build-park-boundaries.mjs

log "========================================"
log "Full run completed successfully"
log "========================================"
