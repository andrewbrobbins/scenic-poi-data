#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
LOG=".full-run.log"
DOWNLOAD_LOG=".download.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG"
}

run() {
  log ">>> $*"
  "$@" 2>&1 | tee -a "$LOG"
}

resolve_geofabrik_url() {
  local url="$1"
  curl -fsI -L --max-time 120 "$url" | awk '
    /^[Ll]ocation: / { loc = $2 }
    END {
      gsub(/\r/, "", loc)
      if (loc != "") print loc
      else print ""
    }
  '
}

download_pbf() {
  local url="$1" dest="$2" label="$3"
  mkdir -p "$(dirname "$dest")"

  local resolved="$url"
  local tmp
  tmp="$(resolve_geofabrik_url "$url" || true)"
  if [[ -n "$tmp" ]]; then
    resolved="$tmp"
  fi

  if [[ -f "$dest" ]]; then
    local mb
    mb=$(du -m "$dest" | cut -f1)
    log "$label: resuming ($mb MB on disk)"
  else
    log "$label: starting download"
  fi
  log "$label: $resolved -> $dest"

  curl -f -C - --retry 10 --retry-delay 10 --retry-all-errors \
    --connect-timeout 60 --max-time 0 \
    --progress-bar -o "$dest" "$resolved" 2>&1 | tee -a "$DOWNLOAD_LOG" | tee -a "$LOG"

  local mb
  mb=$(du -m "$dest" | cut -f1)
  log "$label: done ($mb MB)"
}

log "========================================"
log "Full scenic-poi-data run started"
log "Monitor downloads: tail -f $DOWNLOAD_LOG"
log "Monitor full run:  tail -f $LOG"
log "========================================"

download_pbf \
  "https://download.geofabrik.de/north-america/us-latest.osm.pbf" \
  "osm-pbf/geofabrik/us-latest.osm.pbf" \
  "United States PBF"

download_pbf \
  "https://download.geofabrik.de/north-america/canada-latest.osm.pbf" \
  "osm-pbf/geofabrik/canada-latest.osm.pbf" \
  "Canada PBF"

run node build-poi-osm-all.mjs --skip-download
run node build-fuel-us-all.mjs
run node build-fuel-ca-all.mjs
run node build-fuel-generic-explorer-embed.mjs
run node build-camping-us-all.mjs
run node build-camping-ca-all.mjs
run node build-nps-us-cache.mjs
vc_api_args=(--skip-api)
if [[ -f .env ]] && grep -qE '^NPS_API_KEY=.+' .env; then
  vc_api_args=(--require-api)
  log "NPS visitor centers: NPS_API_KEY found — running API ingest"
else
  log "NPS visitor centers: no NPS_API_KEY — ArcGIS-only (--skip-api)"
fi
run node build-nps-visitor-centers-all.mjs "${vc_api_args[@]}"
run node build-park-boundaries.mjs

log "========================================"
log "Full run completed successfully"
log "========================================"
