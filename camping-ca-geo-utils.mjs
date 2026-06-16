import { PROVINCE_BBOXES } from "./camping-ca-province-bboxes.mjs";

function bboxHits(lat, lon) {
  const hits = [];
  for (const [pr, bbox] of Object.entries(PROVINCE_BBOXES)) {
    const [s, w, n, e] = bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) hits.push(pr);
  }
  return hits;
}

export function inferStateFromCoords(lat, lon) {
  const hits = bboxHits(lat, lon);
  return hits.length ? hits[0] : "";
}

export function applyInferredState(rec) {
  const st = inferStateFromCoords(rec.lat, rec.lon);
  if (!st) return;
  rec.reviewReasons = rec.reviewReasons || [];
  rec.mapFlags = rec.mapFlags || [];
  const prev = rec.state;
  rec.state = st;
  if (prev && prev !== st) {
    if (!rec.reviewReasons.includes("state-corrected-from-coords")) {
      rec.reviewReasons = [...(rec.reviewReasons || []), "state-corrected-from-coords"];
    }
    if (!rec.mapFlags.includes("STATE_CORRECTED")) {
      rec.mapFlags = [...(rec.mapFlags || []), "STATE_CORRECTED"];
    }
    rec.needsReview = true;
  } else {
    rec.reviewReasons = (rec.reviewReasons || []).filter((r) => r !== "missing-state");
    rec.mapFlags = (rec.mapFlags || []).filter((f) => f !== "NO_STATE");
    if (!rec.reviewReasons.length) rec.needsReview = (rec.mapFlags || []).length > 0;
  }
}
