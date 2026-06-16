/**
 * Google routing: Routes API (REST) with Maps JS Directions fallback for file:// pages.
 * Cache in localStorage. Override key via google-routes-config.js if present.
 */
(function (global) {
  const DEFAULT_API_KEY = "";
  const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
  const CACHE_KEY = "vancouver-trip-google-routes-cache-v1";
  const CACHE_VERSION = 3;
  const MAX_ROUTES_INTERMEDIATES = 23;
  let mapsJsLoadPromise = null;
  let lastRoutingError = "";

  function apiKey() {
    const k = global.GOOGLE_MAPS_API_KEY;
    if (k && /^AIza[\w-]+$/.test(String(k).trim())) return String(k).trim();
    return DEFAULT_API_KEY;
  }

  function setRoutingError(msg) {
    lastRoutingError = msg || "";
    if (global.googleRoutesLastError !== undefined) global.googleRoutesLastError = lastRoutingError;
  }

  function roundCoord(n) {
    return Math.round(+n * 1e4) / 1e4;
  }

  /** Park centroids and other off-road pins → nearest drivable gateway for routing only. */
  const ROUTING_COORD_SNAPS = [
    { lat: 46.86, lon: -121.71, snapLat: 46.7584, snapLon: -121.8136, note: "Ashford WA (Mt Rainier gateway)" },
    { lat: 46.86075416, lon: -121.71, snapLat: 46.7584, snapLon: -121.8136, note: "Ashford WA (Mt Rainier gateway)" },
  ];

  function snapCoordForRouting(lat, lon) {
    const r = roundCoord(lat);
    const c = roundCoord(lon);
    for (let i = 0; i < ROUTING_COORD_SNAPS.length; i++) {
      const s = ROUTING_COORD_SNAPS[i];
      if (roundCoord(s.lat) === r && roundCoord(s.lon) === c) {
        return { lat: s.snapLat, lon: s.snapLon, snapped: true, note: s.note };
      }
    }
    return { lat, lon, snapped: false };
  }

  function snapPathForRouting(path) {
    if (!path || !path.length) return path;
    return path.map((p) => {
      const s = snapCoordForRouting(p[0], p[1]);
      return [s.lat, s.lon];
    });
  }

  function routeCacheKey(path, departureTimeIso) {
    if (!path || path.length < 2) return "";
    const coords = path
      .map((p) => roundCoord(p[0]) + "," + roundCoord(p[1]))
      .join(";");
    return coords + "|" + (departureTimeIso || "none");
  }

  function haversineMi(a, b) {
    const R = 3959;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function pathStraightMi(path) {
    let mi = 0;
    for (let i = 0; i < path.length - 1; i++) mi += haversineMi(path[i], path[i + 1]);
    return mi;
  }

  /** Directions allows 25 points total; long spans often hit MAX_ROUTE_LENGTH_EXCEEDED. */
  function shouldRouteByLegs(path) {
    if (!path || path.length < 2) return false;
    if (path.length > 25) return true;
    return pathStraightMi(path) > 450;
  }

  function routeOptionsForTraffic(options) {
    if (!options || !options.departureTime) return options || {};
    const dt = new Date(options.departureTime);
    if (isNaN(dt.getTime()) || dt.getTime() < Date.now() + 60000) {
      const copy = Object.assign({}, options);
      delete copy.departureTime;
      return copy;
    }
    return options;
  }

  function mergeLegGeometries(parts) {
    const geometry = [];
    parts.forEach((g) => {
      if (!g || !g.length) return;
      if (geometry.length) {
        const last = geometry[geometry.length - 1];
        const first = g[0];
        if (last[0] === first[0] && last[1] === first[1]) g = g.slice(1);
      }
      geometry.push.apply(geometry, g);
    });
    return geometry;
  }

  function loadCacheStore() {
    try {
      const raw = global.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.version === CACHE_VERSION && data.routes) return data;
      }
    } catch (e) {
      /* ignore */
    }
    return { version: CACHE_VERSION, routes: {} };
  }

  function writeCacheStore(store) {
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(store));
    } catch (e) {
      /* quota */
    }
  }

  function getCachedRoute(cacheKey) {
    return loadCacheStore().routes[cacheKey] || null;
  }

  function setCachedRoute(cacheKey, entry) {
    const store = loadCacheStore();
    store.routes[cacheKey] = entry;
    writeCacheStore(store);
  }

  function decodeEncodedPolyline(encoded) {
    if (!encoded) return [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const out = [];
    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let b;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;
      out.push([lat / 1e5, lng / 1e5]);
    }
    return out;
  }

  function latLngWaypoint(lat, lon) {
    return {
      location: { latLng: { latitude: lat, longitude: lon } },
    };
  }

  function loadMapsJavascriptApi() {
    if (global.google && global.google.maps && global.google.maps.DirectionsService) {
      return Promise.resolve();
    }
    if (mapsJsLoadPromise) return mapsJsLoadPromise;
    mapsJsLoadPromise = new Promise((resolve, reject) => {
      const key = apiKey();
      const s = document.createElement("script");
      s.async = true;
      s.src =
        "https://maps.googleapis.com/maps/api/js?key=" +
        encodeURIComponent(key) +
        "&loading=async&libraries=geometry";
      s.onload = () => {
        if (global.google && global.google.maps) resolve();
        else reject(new Error("Maps JS loaded but google.maps missing"));
      };
      s.onerror = () => reject(new Error("Failed to load Maps JavaScript API"));
      document.head.appendChild(s);
    });
    return mapsJsLoadPromise;
  }

  function geometryFromDirectionsResult(result) {
    const route = result.routes && result.routes[0];
    if (!route) return [];
    if (route.overview_polyline && route.overview_polyline.points) {
      const pts = decodeEncodedPolyline(route.overview_polyline.points);
      if (pts.length >= 2) return pts;
    }
    if (route.overview_path && route.overview_path.length) {
      return route.overview_path.map((ll) => [ll.lat(), ll.lng()]);
    }
    const out = [];
    route.legs.forEach((leg) => {
      (leg.steps || []).forEach((step) => {
        if (step.path && step.path.length) {
          step.path.forEach((ll) => out.push([ll.lat(), ll.lng()]));
        } else if (step.polyline && step.polyline.points) {
          decodeEncodedPolyline(step.polyline.points).forEach((p) => out.push(p));
        }
      });
    });
    return out;
  }

  function isRoadGeometry(geometry, path) {
    if (!geometry || geometry.length < 2) return false;
    if (!path || path.length < 2) return geometry.length >= 2;
    if (geometry.length >= 10) return true;
    return geometry.length > path.length;
  }

  function routingPreferenceForOptions(options) {
    const opts = routeOptionsForTraffic(options);
    if (opts && opts.departureTime) {
      const dt = new Date(opts.departureTime);
      if (!isNaN(dt.getTime()) && dt.getTime() > Date.now() + 60000) {
        return "TRAFFIC_AWARE";
      }
    }
    return "TRAFFIC_UNAWARE";
  }

  function mayUseDirectionsFallback(path) {
    if (!path || path.length < 2 || path.length > 4) return false;
    return pathStraightMi(path) < 350;
  }

  function statsFromDirectionsResult(result) {
    const route = result.routes && result.routes[0];
    if (!route) return null;
    let meters = 0;
    let seconds = 0;
    route.legs.forEach((leg) => {
      if (leg.distance && leg.distance.value) meters += leg.distance.value;
      if (leg.duration && leg.duration.value) seconds += leg.duration.value;
    });
    return {
      miles: Math.round((meters / 1609.344) * 10) / 10,
      driveHours: Math.round((seconds / 3600) * 10) / 10,
      geometry: geometryFromDirectionsResult(result),
    };
  }

  async function computeRouteDirectionsJs(path, options) {
    await loadMapsJavascriptApi();
    const service = new global.google.maps.DirectionsService();
    const waypoints = path.slice(1, -1).map((p) => ({
      location: new global.google.maps.LatLng(p[0], p[1]),
      stopover: true,
    }));
    const request = {
      origin: new global.google.maps.LatLng(path[0][0], path[0][1]),
      destination: new global.google.maps.LatLng(
        path[path.length - 1][0],
        path[path.length - 1][1]
      ),
      waypoints: waypoints,
      travelMode: global.google.maps.TravelMode.DRIVING,
      unitSystem: global.google.maps.UnitSystem.IMPERIAL,
    };
    if (options && options.departureTime) {
      const dt = new Date(options.departureTime);
      if (!isNaN(dt.getTime())) {
        request.drivingOptions = { departureTime: dt };
      }
    }
    const result = await new Promise((resolve, reject) => {
      service.route(request, (res, status) => {
        if (status === global.google.maps.DirectionsStatus.OK) resolve(res);
        else reject(new Error("Directions: " + status));
      });
    });
    return statsFromDirectionsResult(result);
  }

  async function computeRouteOnce(path, options) {
    if (!path || path.length !== 2) {
      throw new Error("Routes API: single request requires exactly 2 waypoints (one leg)");
    }
    const opts = routeOptionsForTraffic(options);
    const routedPath = snapPathForRouting(path);
    let rest = null;
    try {
      rest = await computeRouteRest(routedPath, opts);
    } catch (e) {
      setRoutingError(e && e.message ? e.message : String(e));
    }
    if (rest) {
      setRoutingError("");
      return rest;
    }
    if (mayUseDirectionsFallback(routedPath)) {
      try {
        const js = await computeRouteDirectionsJs(routedPath, opts);
        if (js && js.miles != null) {
          setRoutingError("");
          return Object.assign(js, { via: "directions-js" });
        }
      } catch (e2) {
        setRoutingError(e2 && e2.message ? e2.message : String(e2));
      }
    }
    throw new Error(
      lastRoutingError ||
        "No drivable route — destination may be off-road (Mt Rainier area: use Ashford or Enumclaw WA)"
    );
  }

  async function computeRouteByLegs(path, options) {
    let miles = 0;
    let driveHours = 0;
    const geometries = [];
    for (let i = 0; i < path.length - 1; i++) {
      const legPath = [path[i], path[i + 1]];
      const legOpts = i === 0 ? options : {};
      const leg = await computeRouteOnce(legPath, legOpts);
      if (!leg) throw new Error("No route for leg " + (i + 1) + " of " + (path.length - 1));
      miles += leg.miles;
      driveHours += leg.driveHours;
      geometries.push(isRoadGeometry(leg.geometry, legPath) ? leg.geometry : legPath);
    }
    return {
      miles: Math.round(miles * 10) / 10,
      driveHours: Math.round(driveHours * 10) / 10,
      geometry: mergeLegGeometries(geometries),
      via: "legs",
    };
  }

  async function computeRouteRest(path, options) {
    if (!global.__allowGoogleRoutesNetwork) {
      throw new Error("Google Routes network disabled (use Recalculate in route editor)");
    }
    const key = apiKey();
    const intermediates =
      path.length > 2
        ? path.slice(1, -1).map((p) => latLngWaypoint(p[0], p[1]))
        : [];
    if (intermediates.length > MAX_ROUTES_INTERMEDIATES) {
      throw new Error(
        "Too many waypoints (" + intermediates.length + "); use leg routing or fewer stops"
      );
    }
    const body = {
      origin: latLngWaypoint(path[0][0], path[0][1]),
      destination: latLngWaypoint(path[path.length - 1][0], path[path.length - 1][1]),
      travelMode: "DRIVE",
      routingPreference: routingPreferenceForOptions(options),
      computeAlternativeRoutes: false,
      units: "IMPERIAL",
    };
    if (intermediates.length) body.intermediates = intermediates;
    if (options && options.departureTime) body.departureTime = options.departureTime;

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 45000);
    let res;
    try {
      res = await fetch(ROUTES_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      if (fetchErr && fetchErr.name === "AbortError") {
        throw new Error("Routes API request timed out (45s)");
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error("Routes API HTTP " + res.status + ": " + errText.slice(0, 180));
    }
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) {
      setRoutingError(
        "Google returned no drivable route — destination may be off-road or inside a park (Mt Rainier: Ashford or Enumclaw WA)"
      );
      return null;
    }

    let sec = null;
    if (route.duration != null) {
      if (typeof route.duration === "object" && route.duration.seconds != null) {
        sec = +route.duration.seconds;
      } else {
        const m = /^(\d+)s?$/.exec(String(route.duration).trim());
        if (m) sec = +m[1];
      }
    }
    const geometry =
      route.polyline && route.polyline.encodedPolyline
        ? decodeEncodedPolyline(route.polyline.encodedPolyline)
        : [];

    const encodedPolyline =
      route.polyline && route.polyline.encodedPolyline
        ? route.polyline.encodedPolyline
        : null;
    return {
      miles: Math.round((route.distanceMeters / 1609.344) * 10) / 10,
      driveHours: Number.isFinite(sec) ? Math.round((sec / 3600) * 10) / 10 : 0,
      geometry,
      encodedPolyline,
      via: "rest",
    };
  }

  async function googleComputeRoute(path, options) {
    const key = apiKey();
    if (!key || !path || path.length < 2) return null;
    const opts = options || {};
    const cacheKey = routeCacheKey(path, opts.departureTime);
    if (!opts.forceRefresh && cacheKey) {
      const hit = getCachedRoute(cacheKey);
      if (hit && hit.miles != null && hit.driveHours != null) {
        setRoutingError("");
        return {
          miles: hit.miles,
          driveHours: hit.driveHours,
          geometry: hit.geometry || [],
          fromCache: true,
          via: hit.via || "cache",
        };
      }
    }
    if (opts.allowNetwork !== true) return null;
    if (typeof global.RouteLegCache !== "undefined") {
      return global.RouteLegCache.fetchPathStats(path, {
        departureTime: opts.departureTime,
        allowNetwork: true,
        forceRefresh: !!opts.forceRefresh,
      });
    }
    return null;
  }

  async function googleRouteStats(path, options) {
    try {
      const r = await googleComputeRoute(path, options);
      if (!r) return null;
      return { miles: r.miles, driveHours: r.driveHours, via: r.via };
    } catch (e) {
      console.warn("googleRouteStats", e);
      return null;
    }
  }

  async function googleFetchRoadGeometry(path, options) {
    const opts = options || {};
    try {
      const r = await googleComputeRoute(path, opts);
      if (r && isRoadGeometry(r.geometry, path)) return r.geometry;
    } catch (e) {
      console.warn("googleFetchRoadGeometry", e);
    }
    return null;
  }

  function googleRoutesClearCache() {
    try {
      global.localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function googleRoutesUsingGoogle() {
    return typeof googleRouteStats === "function" && !!apiKey();
  }

  function googleRoutesLastError() {
    return lastRoutingError;
  }

  global.googleRouteStats = googleRouteStats;
  global.googleFetchRoadGeometry = googleFetchRoadGeometry;
  global.googleComputeRoute = googleComputeRoute;
  global.googleRoutesClearCache = googleRoutesClearCache;
  global.googleRoutesUsingGoogle = googleRoutesUsingGoogle;
  global.googleRoutesLastError = googleRoutesLastError;
  global.googleRouteCacheKey = routeCacheKey;
  global.googleMapsPreload = loadMapsJavascriptApi;
  global.__googleComputeRouteLeg = computeRouteOnce;
  global.decodeGoogleEncodedPolyline = decodeEncodedPolyline;
  global.__routeLegCacheSetError = setRoutingError;
  global.snapPathForRouting = snapPathForRouting;
  if (!global.GOOGLE_MAPS_API_KEY || !/^AIza/.test(String(global.GOOGLE_MAPS_API_KEY))) {
    global.GOOGLE_MAPS_API_KEY = DEFAULT_API_KEY;
  }
})(typeof window !== "undefined" ? window : globalThis);

/** OSRM fallback */
const OSRM_DRIVING = "https://router.project-osrm.org/route/v1/driving";
function usingGoogleRoutes() {
  return (
    typeof googleRouteStats === "function" &&
    typeof googleFetchRoadGeometry === "function" &&
    typeof window !== "undefined" &&
    window.GOOGLE_MAPS_API_KEY &&
    /^AIza/.test(String(window.GOOGLE_MAPS_API_KEY))
  );
}

function geometryLooksLikeRoad(geom, path) {
  if (!geom || geom.length < 2) return false;
  if (!path || path.length < 2) return true;
  if (geom.length >= 10) return true;
  return geom.length > path.length;
}

async function fetchRoadGeometry(path, options) {
  if (!path || path.length < 2) return [];
  const opts = options || {};
  const allowNetwork = opts.allowNetwork === true || opts.forceRefresh === true;

  if (typeof RouteLegCache !== "undefined") {
    if (allowNetwork && usingGoogleRoutes()) {
      const legs = RouteLegCache.pathToLegs(path);
      const geoms = [];
      let dep = opts.departureTime || null;
      for (let i = 0; i < legs.length; i++) {
        const leg = await RouteLegCache.fetchLeg(legs[i], {
          departureTime: i === 0 ? dep : null,
          allowNetwork: true,
          forceRefresh: !!opts.forceRefresh,
        });
        if (leg && leg.geometry && leg.geometry.length >= 2) geoms.push(leg.geometry);
        else geoms.push(legs[i]);
      }
      return RouteLegCache.mergeGeometries(geoms);
    }
    const cached = RouteLegCache.getPathGeometry(path, opts);
    if (cached.geometry && cached.geometry.length >= 2) return cached.geometry;
    return path.map((p) => [p[0], p[1]]);
  }

  return path.map((p) => [p[0], p[1]]);
}

async function fetchRoadGeometrySegmented(path) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const seg = a[1] + "," + a[0] + ";" + b[1] + "," + b[0];
    try {
      const res = await fetch(
        OSRM_DRIVING + "/" + seg + "?overview=full&geometries=geojson"
      );
      const data = await res.json();
      if (data.code === "Ok" && data.routes && data.routes[0]) {
        const pts = data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
        if (out.length) pts.shift();
        out.push(...pts);
        continue;
      }
    } catch (e) {
      /* straight fallback per segment */
    }
    if (!out.length || out[out.length - 1][0] !== a[0] || out[out.length - 1][1] !== a[1]) {
      out.push([a[0], a[1]]);
    }
    out.push([b[0], b[1]]);
  }
  return out;
}

async function addRoadRouteLayer(map, path, style, routeLayerStore, id) {
  const straight = path.map((p) => [p[0], p[1]]);
  const latlngs = await fetchRoadGeometry(path, { allowNetwork: false });
  const line = L.polyline(latlngs.length >= 2 ? latlngs : straight, style).addTo(map);
  if (routeLayerStore && id) routeLayerStore[id] = line;
  return line;
}

async function osrmRouteStatsDirect(path) {
  if (!path || path.length < 2) return null;
  const coordStr = path.map((p) => p[1] + "," + p[0]).join(";");
  try {
    const res = await fetch(OSRM_DRIVING + "/" + coordStr + "?overview=false");
    const data = await res.json();
    if (data.code === "Ok" && data.routes && data.routes[0]) {
      const r = data.routes[0];
      return {
        miles: Math.round((r.distance / 1609.344) * 10) / 10,
        driveHours: Math.round((r.duration / 3600) * 10) / 10,
      };
    }
  } catch (e) {
    return null;
  }
  if (path.length === 2) return null;
  let miles = 0;
  let seconds = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const leg = await osrmRouteStatsDirect([path[i], path[i + 1]]);
    if (!leg) return null;
    miles += leg.miles;
    seconds += leg.driveHours * 3600;
  }
  return {
    miles: Math.round(miles * 10) / 10,
    driveHours: Math.round((seconds / 3600) * 10) / 10,
  };
}

/** Distance (mi) and duration (hours) for a waypoint path. */
async function osrmRouteStats(path, options) {
  if (!path || path.length < 2) return null;
  const opts = options || {};
  const allowNetwork = opts.allowNetwork === true || opts.forceRefresh === true;

  if (typeof RouteLegCache !== "undefined" && usingGoogleRoutes()) {
    return RouteLegCache.fetchPathStats(path, {
      departureTime: opts.departureTime,
      allowNetwork,
      forceRefresh: !!opts.forceRefresh,
    });
  }
  if (allowNetwork) return osrmRouteStatsDirect(path);
  return null;
}
