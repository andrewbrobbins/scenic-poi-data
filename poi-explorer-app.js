/* POI map explorer — open poi-explorer.html after node build-poi-explorer-data.mjs */
(function () {
  "use strict";

  var GROUP_ORDER = ["scenic", "benchmark", "fuel", "camping", "playground", "historic", "nps"];
  var GROUP_LABELS = {
    scenic: "Scenic overlooks",
    benchmark: "Scenic benchmark",
    fuel: "Fuel",
    camping: "Camping",
    playground: "Playgrounds",
    historic: "Historic",
    nps: "NPS units",
  };
  var COLORS = {
    scenic_kept: "#06b6d4",
    scenic_excluded: "#64748b",
    benchmark: "#f59e0b",
    fuel_generic: "#a3a3a3",
    camping: "#ea580c",
    playground: "#22c55e",
    historic: "#a855f7",
  };
  var FUEL_BRAND_COLORS = {
    bucees: "#e11d48",
    quiktrip: "#dc2626",
    racetrac: "#ea580c",
    wawa: "#ca8a04",
    sheetz: "#65a30d",
    loves: "#059669",
    pilot: "#0284c7",
    flyingj: "#2563eb",
    pilot_flyingj: "#7c3aed",
    petro_pass: "#be123c",
    onroute: "#0d9488",
    husky_travel: "#0891b2",
    irving_bigstop: "#4f46e5",
  };
  var MARKER_SIZE = { default: 14, small: 11, benchmark: 18 };
  var NPS_COLORS = {
    park: "#15803d",
    monument: "#ca8a04",
    historic_park: "#7c3aed",
    historic_site: "#9333ea",
    recreation: "#0d9488",
    memorial: "#be123c",
    preserve: "#059669",
    parkway_trail: "#2563eb",
    affiliated: "#64748b",
    visitor_center: "#1d4ed8",
    other: "#94a3b8",
  };
  var VIEWPORT_CULL = 2000;
  var BOUNDARY_STYLE = { weight: 2, opacity: 0.9, fillOpacity: 0.14 };

  var state = {
    region: "both",
    activeCategory: "scenic",
    manifest: typeof POI_EXPLORER !== "undefined" ? POI_EXPLORER : null,
    enabled: new Set(),
    loadedSlices: {},
    layerGroups: {},
    boundariesGroup: null,
    showParkBoundaries: false,
    map: null,
    renderTimer: null,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function categoriesForRegion() {
    var found = new Set();
    layerKeysForRegion().forEach(function (key) {
      found.add(state.manifest.layers[key].group);
    });
    return GROUP_ORDER.filter(function (g) {
      return found.has(g);
    });
  }

  function layerKeysForRegion() {
    if (!state.manifest) return [];
    return Object.keys(state.manifest.layers).filter(function (key) {
      var L = state.manifest.layers[key];
      if (L.noRegion) return true;
      if (L.noRegionFilter) return true;
      if (state.region === "both") return true;
      return L.region === state.region;
    });
  }

  function layerKeysForCategory() {
    return layerKeysForRegion().filter(function (key) {
      return state.manifest.layers[key].group === state.activeCategory;
    });
  }

  function initMap() {
    state.map = L.map("map", { preferCanvas: true }).setView([45, -100], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(state.map);
    state.map.on("moveend zoomend", scheduleRender);
  }

  function scheduleRender() {
    if (state.renderTimer) clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(renderAllLayers, 120);
  }

  function setLoading(on, msg) {
    var box = el("mapLoading");
    if (!box) {
      box = document.createElement("div");
      box.id = "mapLoading";
      box.className = "map-loading";
      document.querySelector(".map-wrap").appendChild(box);
    }
    box.textContent = msg || "Loading…";
    box.classList.toggle("visible", !!on);
  }

  function loadSlice(slicePath) {
    return new Promise(function (resolve, reject) {
      if (state.loadedSlices[slicePath]) return resolve(state.loadedSlices[slicePath]);
      var s = document.createElement("script");
      s.src = slicePath;
      s.onload = function () {
        state.loadedSlices[slicePath] = true;
        resolve();
      };
      s.onerror = function () {
        reject(new Error("Failed to load " + slicePath));
      };
      document.body.appendChild(s);
    });
  }

  function recordsForLayer(key) {
    var L = state.manifest.layers[key];
    if (!L) return [];
    if (L.inline) return L.inline;
    if (L.slice) {
      var data = window.POI_EXPLORER_SLICES && window.POI_EXPLORER_SLICES[key];
      return data || [];
    }
    return [];
  }

  function layerColor(Ldef) {
    if (Ldef.group === "nps" && Ldef.npsCategory) {
      return NPS_COLORS[Ldef.npsCategory] || "#15803d";
    }
    if (Ldef.fuelBrandId) {
      return FUEL_BRAND_COLORS[Ldef.fuelBrandId] || "#94a3b8";
    }
    return COLORS[Ldef.id] || "#94a3b8";
  }

  function boundaryColor(props) {
    return NPS_COLORS[props.category] || "#15803d";
  }

  /** Leaflet + preferCanvas only draws the first polygon of MultiPolygon features. */
  function flattenBoundaryCollection(fc) {
    var features = [];
    (fc.features || []).forEach(function (f) {
      if (!f.geometry) return;
      if (f.geometry.type === "MultiPolygon") {
        f.geometry.coordinates.forEach(function (poly) {
          features.push({
            type: "Feature",
            properties: f.properties,
            geometry: { type: "Polygon", coordinates: poly },
          });
        });
      } else {
        features.push(f);
      }
    });
    return { type: "FeatureCollection", features: features };
  }

  function boundaryPassesFilters(props) {
    if (!props) return false;
    if (state.region === "us" && props.country !== "US") return false;
    if (state.region === "ca" && props.country !== "CA") return false;
    var st = el("stateSelect").value;
    if (st && props.state) {
      var states = String(props.state)
        .split(/[,;]/)
        .map(function (s) {
          return s.trim();
        });
      if (states.indexOf(st) === -1) return false;
    }
    var q = (el("searchBox").value || "").toLowerCase().trim();
    if (!q) return true;
    var hay = [props.name, props.parkCode, props.unitType, props.state, props.country]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function showBoundaryDetail(props) {
    var panel = el("detail");
    panel.classList.remove("hidden");
    var rows = [
      ["Type", "Park boundary"],
      ["Name", props.name || "—"],
      ["Park code", props.parkCode || "—"],
      ["Country", props.country || "—"],
      ["State", props.state || "—"],
      ["Unit type", props.unitType || "—"],
      ["Category", (props.category || "").replace(/_/g, " ")],
    ];
    var dl = rows
      .map(function (r) {
        return "<dt>" + r[0] + "</dt><dd>" + escapeHtml(String(r[1])) + "</dd>";
      })
      .join("");
  var links = "";
    if (props.parkCode && props.country === "US") {
      links =
        '<p><a href="https://www.nps.gov/' +
        props.parkCode +
        '/" target="_blank" rel="noopener">NPS unit page</a></p>';
    }
    panel.innerHTML = "<h3>" + escapeHtml(props.name || "Park boundary") + "</h3>" + "<dl>" + dl + "</dl>" + links;
  }

  function renderParkBoundaries() {
    if (!state.boundariesGroup) {
      state.boundariesGroup = L.layerGroup();
    }
    state.boundariesGroup.clearLayers();

    if (!state.showParkBoundaries) {
      if (state.map.hasLayer(state.boundariesGroup)) state.map.removeLayer(state.boundariesGroup);
      return 0;
    }

    if (typeof PARK_BOUNDARIES === "undefined" || !PARK_BOUNDARIES.features) {
      return 0;
    }

    var flatBoundaries = flattenBoundaryCollection(PARK_BOUNDARIES);
    var geo = L.geoJSON(flatBoundaries, {
      filter: function (feature) {
        return boundaryPassesFilters(feature.properties);
      },
      style: function (feature) {
        var color = boundaryColor(feature.properties || {});
        return {
          color: color,
          weight: BOUNDARY_STYLE.weight,
          opacity: BOUNDARY_STYLE.opacity,
          fillColor: color,
          fillOpacity: BOUNDARY_STYLE.fillOpacity,
        };
      },
      onEachFeature: function (feature, layer) {
        var props = feature.properties || {};
        layer.bindTooltip(escapeHtml(props.name || props.parkCode || "Boundary"), {
          sticky: true,
          className: "poi-tooltip-leaflet",
        });
        layer.on("click", function () {
          showBoundaryDetail(props);
        });
      },
    });
    state.boundariesGroup.addLayer(geo);
    geo.bringToBack();

    if (!state.map.hasLayer(state.boundariesGroup)) {
      state.boundariesGroup.addTo(state.map);
    }
    return geo.getLayers().length;
  }

  function osmUrl(rec) {
    if (rec.url) return rec.url;
    if (rec.osmNodeId) return "https://www.openstreetmap.org/node/" + rec.osmNodeId;
    return null;
  }

  function markerTooltipHtml(rec, layerKey) {
    var Ldef = state.manifest.layers[layerKey];
    var lines = [];
    var title = rec.name || rec.id;
    lines.push("<strong>" + escapeHtml(title) + "</strong>");
    if (rec.state) lines.push(escapeHtml(rec.state));
    if (rec.brand && Ldef && Ldef.group === "fuel") lines.push(escapeHtml(rec.brand));
    if (rec.diesel) lines.push("Diesel");
    if (rec.highway) lines.push(escapeHtml(rec.highway));
    if (rec.roadDistanceM != null) lines.push("Road: " + rec.roadDistanceM + " m");
    if (rec.status === "kept") lines.push("Kept");
    if (rec.status === "excluded") lines.push("Excluded");
    if (rec.landManager) lines.push(escapeHtml(rec.landManager));
    if (rec.parentName && Ldef && Ldef.id === "nps_visitor_centers") lines.push(escapeHtml(rec.parentName));
    if (rec.hoursSummary && rec.hoursSummary.summary && Ldef && Ldef.id === "nps_visitor_centers") {
      lines.push(escapeHtml(rec.hoursSummary.summary));
    }
    if (rec.category && Ldef && Ldef.group === "nps") lines.push(escapeHtml(rec.category.replace(/_/g, " ")));
    var url = osmUrl(rec);
    if (url) {
      lines.push('<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">OSM details</a>');
    }
    return '<div class="poi-map-tooltip">' + lines.join("<br>") + "</div>";
  }

  function passesFilters(rec) {
    var st = el("stateSelect").value;
    if (st && rec.state !== st) return false;
    var q = (el("searchBox").value || "").toLowerCase().trim();
    if (!q) return true;
    var hay = [rec.id, rec.name, rec.state, rec.brand, rec.brandId, rec.tier, rec.category, rec.landManager, rec.notes, rec.parkCode]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function inBounds(rec, bounds) {
    return bounds.contains([rec.lat, rec.lon]);
  }

  function circleIcon(color, size) {
    size = size || MARKER_SIZE.default;
    return L.divIcon({
      className: "",
      html:
        '<span style="display:block;width:' +
        size +
        "px;height:" +
        size +
        "px;border-radius:50%;background:" +
        color +
        ';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.55)"></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function diamondIcon(color, size) {
    size = size || MARKER_SIZE.benchmark;
    return L.divIcon({
      className: "",
      html:
        '<span style="display:block;width:' +
        size +
        "px;height:" +
        size +
        "px;background:" +
        color +
        ';border:2px solid #fff;transform:rotate(45deg);box-shadow:0 1px 4px rgba(0,0,0,.55)"></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function squareIcon(color, size) {
    size = size || MARKER_SIZE.default;
    return L.divIcon({
      className: "",
      html:
        '<span style="display:block;width:' +
        size +
        "px;height:" +
        size +
        "px;border-radius:2px;background:" +
        color +
        ';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.55)"></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function showDetail(rec, layerKey) {
    var Ldef = state.manifest.layers[layerKey];
    var panel = el("detail");
    panel.classList.remove("hidden");
    var tags = "";
    if (rec.status === "kept") tags += '<span class="tag tag-kept">kept</span>';
    if (rec.status === "excluded") tags += '<span class="tag tag-excluded">excluded</span>';
    if (rec.expect === "include") tags += '<span class="tag tag-include">expect include</span>';
    if (rec.expect === "exclude") tags += '<span class="tag tag-exclude">expect exclude</span>';
    if (rec.tier) tags += '<span class="tag">' + rec.tier + "</span>";

    var rows = [
      ["Category", GROUP_LABELS[state.activeCategory] || state.activeCategory],
      ["Layer", Ldef ? Ldef.label : layerKey],
      ["ID", rec.id],
      ["State", rec.state || "—"],
    ];
    if (rec.parkCode) rows.push(["Park code", rec.parkCode]);
    if (rec.parentName) rows.push(["Parent unit", rec.parentName]);
    if (rec.parentDesignation) rows.push(["Designation", rec.parentDesignation]);
    if (rec.parentCategory) rows.push(["Unit category", rec.parentCategory.replace(/_/g, " ")]);
    if (rec.hoursSummary && rec.hoursSummary.summary) rows.push(["Hours", rec.hoursSummary.summary]);
    if (rec.hoursSummary && rec.hoursSummary.seasonalNote) rows.push(["Seasonal hours", rec.hoursSummary.seasonalNote]);
    if (rec.seasonal && rec.seasonal.description && !rec.hoursSummary?.seasonalNote) {
      rows.push(["Season", rec.seasonal.description]);
    }
    if (rec.coordConfidence) rows.push(["Coord confidence", rec.coordConfidence]);
    if (rec.needsReview) rows.push(["Needs review", "Yes"]);
    if (rec.roadDistanceM != null) rows.push(["Road distance", rec.roadDistanceM + " m"]);
    if (rec.dLean != null) rows.push(["dLean", rec.dLean + " m"]);
    if (rec.dPath != null) rows.push(["dPath", rec.dPath + " m"]);
    if (rec.dParking != null) rows.push(["dParking", rec.dParking + " m"]);
    if (rec.displayTier) rows.push(["Display tier", rec.displayTier]);
    if (rec.excludeReason) rows.push(["Exclude reason", rec.excludeReason]);
    if (rec.brandId) rows.push(["Brand", rec.brand + " (" + rec.brandId + ")"]);
    if (rec.fuelType) {
      rows.push(["Fuel type", rec.fuelType === "convenience_fuel" ? "Convenience fuel" : "Travel plaza"]);
    }
    if (rec.landManager) rows.push(["Land manager", rec.landManager]);
    if (rec.category) rows.push(["NPS type", rec.category]);
    if (rec.tier) rows.push(["Benchmark tier", rec.tier]);
    if (rec.expect) rows.push(["Expected @120m", rec.expect]);
    if (rec.notes) rows.push(["Notes", rec.notes]);
    if (rec.sampleOnly) rows.push(["Note", "Sample only — rebuild ingest for full excluded set"]);

    var dl = rows
      .map(function (r) {
        return "<dt>" + r[0] + "</dt><dd>" + escapeHtml(String(r[1])) + "</dd>";
      })
      .join("");
    var links = "";
    if (rec.url) {
      var linkLabel = rec.url.indexOf("nps.gov") !== -1 ? "NPS" : "OpenStreetMap";
      links += '<p><a href="' + rec.url + '" target="_blank" rel="noopener">' + linkLabel + "</a></p>";
    }
    if (rec.osmNodeId)
      links +=
        '<p><a href="https://www.openstreetmap.org/node/' +
        rec.osmNodeId +
        '" target="_blank" rel="noopener">OSM node ' +
        rec.osmNodeId +
        "</a></p>";

    panel.innerHTML = "<h3>" + escapeHtml(rec.name || rec.id) + "</h3>" + tags + "<dl>" + dl + "</dl>" + links;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderLayer(key) {
    var Ldef = state.manifest.layers[key];
    if (!Ldef) return;

    var group = state.layerGroups[key];
    if (!group) {
      group = L.layerGroup();
      state.layerGroups[key] = group;
    }
    group.clearLayers();

    if (!state.enabled.has(key)) {
      if (state.map.hasLayer(group)) state.map.removeLayer(group);
      return;
    }

    var records = recordsForLayer(key);
    var bounds = state.map.getBounds();
    var cull = records.length > VIEWPORT_CULL;
    var color = layerColor(Ldef);
    var iconFn =
      Ldef.id === "benchmark"
        ? function () {
            return diamondIcon(color);
          }
        : Ldef.id === "nps_visitor_centers"
          ? function () {
              return squareIcon(color);
            }
          : function () {
              return circleIcon(color, Ldef.id === "scenic_excluded" ? MARKER_SIZE.small : MARKER_SIZE.default);
            };
    var shown = 0;
    var maxShow = cull ? 8000 : records.length;

    for (var i = 0; i < records.length && shown < maxShow; i++) {
      var rec = records[i];
      if (!passesFilters(rec)) continue;
      if (cull && !inBounds(rec, bounds)) continue;
      var m = L.marker([rec.lat, rec.lon], { icon: iconFn() });
      m.bindTooltip(markerTooltipHtml(rec, key), {
        direction: "top",
        offset: [0, -8],
        opacity: 0.96,
        className: "poi-tooltip-leaflet",
      });
      m.on("click", (function (r, k) {
        return function () {
          showDetail(r, k);
        };
      })(rec, key));
      group.addLayer(m);
      shown++;
    }

    if (!state.map.hasLayer(group)) group.addTo(state.map);
    return { total: records.length, shown: shown, culled: cull };
  }

  function renderAllLayers() {
    var boundaryCount = renderParkBoundaries();
    var stats = [];
    var keys = new Set(layerKeysForRegion());
    Object.keys(state.layerGroups).forEach(function (k) {
      keys.add(k);
    });
    keys.forEach(function (key) {
      var r = renderLayer(key);
      if (r) stats.push(r);
    });
    updateStats(stats, boundaryCount);
  }

  function updateStats(extra, boundaryCount) {
    var lines = [
      "Category: " + (GROUP_LABELS[state.activeCategory] || state.activeCategory),
      "Generated: " + (state.manifest.generated || "?").slice(0, 19),
    ];
    if (state.showParkBoundaries) {
      lines.push("Park boundaries shown: " + (boundaryCount || 0).toLocaleString());
    }
    state.enabled.forEach(function (key) {
      var Ldef = state.manifest.layers[key];
      if (!Ldef) return;
      var n = Ldef.count || (Ldef.inline ? Ldef.inline.length : 0);
      lines.push(Ldef.label + (Ldef.region ? " (" + Ldef.region.toUpperCase() + ")" : "") + ": " + n.toLocaleString());
    });
    if (extra && extra.length) {
      var shown = extra.reduce(function (a, b) {
        return a + b.shown;
      }, 0);
      lines.push("Markers in view: " + shown.toLocaleString());
    }
    el("statsPanel").innerHTML = lines.map(function (l) {
      return "<div>" + l + "</div>";
    }).join("");
  }

  function applyCategoryDefaults() {
    state.enabled.clear();
    layerKeysForCategory().forEach(function (key) {
      var L = state.manifest.layers[key];
      if (L.defaultInCategory) state.enabled.add(key);
    });
  }

  function syncLayerCheckboxes() {
    layerKeysForCategory().forEach(function (key) {
      var cb = document.querySelector('input[data-key="' + key + '"]');
      if (cb) cb.checked = state.enabled.has(key);
    });
  }

  function buildCategoryUI() {
    var container = el("categoryList");
    container.innerHTML = "";
    categoriesForRegion().forEach(function (cat) {
      var label = document.createElement("label");
      label.className = cat === state.activeCategory ? "active" : "";
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "poi-category";
      radio.value = cat;
      radio.checked = cat === state.activeCategory;
      var text = document.createElement("span");
      text.textContent = GROUP_LABELS[cat] || cat;
      label.appendChild(radio);
      label.appendChild(text);
      label.addEventListener("click", function () {
        selectCategory(cat);
      });
      container.appendChild(label);
    });
  }

  function buildLayerUI() {
    var container = el("layerList");
    container.innerHTML = "";
    var keys = layerKeysForCategory();
    keys.sort(function (a, b) {
      var la = state.manifest.layers[a].label;
      var lb = state.manifest.layers[b].label;
      var cmp = la.localeCompare(lb);
      if (cmp !== 0) return cmp;
      return (state.manifest.layers[a].region || "").localeCompare(state.manifest.layers[b].region || "");
    });
    if (!keys.length) {
      container.innerHTML = '<p class="hint">No layers for this category and region.</p>';
      return;
    }

    keys.forEach(function (key) {
      var L = state.manifest.layers[key];
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.key = key;
      cb.checked = state.enabled.has(key);
      var meta = document.createElement("span");
      meta.innerHTML =
        L.label +
        (L.region ? ' <span class="layer-meta">' + L.region.toUpperCase() + "</span>" : "") +
        ' <span class="layer-meta">(' +
        (L.count || 0).toLocaleString() +
        (L.large ? ", large" : "") +
        ")</span>";
      label.appendChild(cb);
      label.appendChild(meta);
      container.appendChild(label);

      cb.addEventListener("change", function () {
        toggleLayer(key, cb.checked);
      });
    });
  }

  function selectCategory(cat) {
    if (cat === state.activeCategory) return;
    state.activeCategory = cat;
    el("detail").classList.add("hidden");
    applyCategoryDefaults();
    buildCategoryUI();
    buildLayerUI();
    buildStateSelect();
    preloadDefaultSlices().then(renderAllLayers);
  }

  function toggleLayer(key, on) {
    if (on) state.enabled.add(key);
    else state.enabled.delete(key);

    var Ldef = state.manifest.layers[key];
    if (on && Ldef.slice && !state.loadedSlices[Ldef.slice]) {
      setLoading(true, "Loading " + Ldef.label + "…");
      loadSlice(Ldef.slice)
        .then(function () {
          setLoading(false);
          renderAllLayers();
        })
        .catch(function (e) {
          setLoading(false);
          alert(e.message);
        });
    } else {
      renderAllLayers();
    }
  }

  function buildStateSelect() {
    var sel = el("stateSelect");
    var states = new Set();
    layerKeysForCategory().forEach(function (key) {
      var Ldef = state.manifest.layers[key];
      var records = Ldef.inline || [];
      records.forEach(function (r) {
        if (r.state) states.add(r.state);
      });
      if (Ldef.slice && window.POI_EXPLORER_SLICES && window.POI_EXPLORER_SLICES[key]) {
        window.POI_EXPLORER_SLICES[key].forEach(function (r) {
          if (r.state) states.add(r.state);
        });
      }
    });
    sel.innerHTML = '<option value="">All</option>';
    Array.from(states)
      .sort()
      .forEach(function (st) {
        var o = document.createElement("option");
        o.value = st;
        o.textContent = st;
        sel.appendChild(o);
      });
  }

  function bindRegion() {
    el("regionBtns").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-region]");
      if (!btn) return;
      state.region = btn.dataset.region;
      el("regionBtns").querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      var cats = categoriesForRegion();
      if (cats.indexOf(state.activeCategory) === -1) {
        state.activeCategory = cats[0] || state.manifest.defaultCategory || "scenic";
      }
      applyCategoryDefaults();
      buildCategoryUI();
      buildLayerUI();
      buildStateSelect();
      preloadDefaultSlices().then(renderAllLayers);
    });
  }

  function preloadDefaultSlices() {
    var promises = [];
    state.enabled.forEach(function (key) {
      var Ldef = state.manifest.layers[key];
      if (Ldef && Ldef.slice && !state.loadedSlices[Ldef.slice]) {
        promises.push(loadSlice(Ldef.slice));
      }
    });
    return Promise.all(promises);
  }

  function init() {
    if (!state.manifest) {
      document.body.innerHTML =
        "<p style='padding:24px'>Missing poi-explorer-data.js — run <code>node build-poi-explorer-data.mjs</code></p>";
      return;
    }
    state.activeCategory = state.manifest.defaultCategory || "scenic";
    initMap();
    bindRegion();
    applyCategoryDefaults();
    buildCategoryUI();
    buildLayerUI();
    buildStateSelect();
    el("searchBox").addEventListener("input", scheduleRender);
    el("stateSelect").addEventListener("change", scheduleRender);
    var boundaryCb = el("layerParkBoundaries");
    if (boundaryCb) {
      boundaryCb.addEventListener("change", function () {
        state.showParkBoundaries = boundaryCb.checked;
        renderAllLayers();
      });
    }
    preloadDefaultSlices().then(renderAllLayers);
  }

  init();
})();
