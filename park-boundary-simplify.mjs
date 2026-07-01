/** Perpendicular distance in WGS84 degrees (planar OK at park scale). */
function perpendicularDistanceDeg([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function ringIsClosed(ring) {
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly;
}

function openRing(ring) {
  if (ring.length < 2) return ring.slice();
  return ringIsClosed(ring) ? ring.slice(0, -1) : ring.slice();
}

function closeRing(open) {
  if (!open.length) return open;
  const [fx, fy] = open[0];
  const [lx, ly] = open[open.length - 1];
  if (fx === lx && fy === ly) return open;
  return [...open, open[0]];
}

function douglasPeuckerOpen(coords, tolerance) {
  if (coords.length <= 2) return coords.slice();
  let maxDist = 0;
  let index = 0;
  const end = coords.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistanceDeg(coords[i], coords[0], coords[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= tolerance) return [coords[0], coords[end]];
  const left = douglasPeuckerOpen(coords.slice(0, index + 1), tolerance);
  const right = douglasPeuckerOpen(coords.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/**
 * Keep ring as returned by ArcGIS when under maxPts.
 * Otherwise reduce with Douglas–Peucker (geometry-aware), not uniform decimation.
 */
export function limitRingVertices(ring, maxPts, baseTolerance = 1e-7) {
  if (!ring?.length || ring.length <= maxPts) return ring;
  const open = openRing(ring);
  if (open.length <= maxPts) return closeRing(open);

  let tolerance = baseTolerance;
  let simplified = closeRing(open);
  for (let i = 0; i < 32; i++) {
    simplified = closeRing(douglasPeuckerOpen(open, tolerance));
    if (simplified.length <= maxPts) return simplified;
    tolerance *= 1.4;
  }
  return simplified;
}
