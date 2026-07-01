/* Fuel catalog explorer — open fuel-explorer.html after running build-fuel-explorer-data.mjs */
(function () {
  "use strict";

  var BRAND_COLORS = {
    bucees: "#e11d48",
    quiktrip: "#dc2626",
    racetrac: "#ea580c",
    wawa: "#ca8a04",
    sheetz: "#65a30d",
    loves: "#059669",
    pilot: "#0284c7",
    flyingj: "#2563eb",
    pilot_flyingj: "#7c3aed",
    maverik: "#c2410c",
    kwiktrip: "#be123c",
    kwikstar: "#9f1239",
    wallys: "#0f766e",
    busy_bee: "#ca8a04",
    parkers: "#1d4ed8",
    cefco: "#7c2d12",
    royal_farms: "#0369a1",
    quickchek: "#15803d",
    terribles: "#6b21a8",
    petro_pass: "#be123c",
    onroute: "#0d9488",
    husky_travel: "#0891b2",
    irving_bigstop: "#4f46e5",
    unmatched: "#64748b",
    suppressed: "#a855f7",
  };

  var state = {
    region: "us",
    data: typeof FUEL_EXPLORER !== "undefined" ? FUEL_EXPLORER : null,
    unmatched: [],
    selectedBrands: new Set(),
    map: null,
    layers: { matched: null, suppressed: null, unmatched: null },
    markers: [],
  };

  function regionData() {
    return state.data ? state.data[state.region] : null;
  }

  function brandSelectId(brandId) {
    if (brandId === "pilot" || brandId === "flyingj" || brandId === "pilot_flyingj") return "pilot_flyingj";
    return brandId;
  }

  function brandColor(brandId) {
    return BRAND_COLORS[brandSelectId(brandId)] || BRAND_COLORS[brandId] || "#94a3b8";
  }

  function el(id) {
    return document.getElementById(id);
  }

  function initMap() {
    state.map = L.map("map", { preferCanvas: true }).setView([39.5, -98.35], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(state.map);
    state.layers.matched = L.layerGroup().addTo(state.map);
    state.layers.suppressed = L.layerGroup();
    state.layers.unmatched = L.layerGroup();
  }

  function circleIcon(color, size) {
    size = size || 10;
    return L.divIcon({
      className: "",
      html:
        '<span style="display:block;width:' +
        size +
        "px;height:" +
        size +
        "px;border-radius:50%;background:" +
        color +
        ';border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function passesFilters(rec, kind) {
    var q = (el("searchBox").value || "").toLowerCase().trim();
    var st = el("stateSelect").value;
    if (st && rec.state !== st) return false;
    if (el("dieselOnly").checked && kind === "matched" && !rec.diesel) return false;
    if (el("reviewOnly").checked && kind === "matched" && !rec.review) return false;
    if (kind === "matched" && state.selectedBrands.size) {
      var selectId = rec.brandSelectId || brandSelectId(rec.brandId);
      if (!state.selectedBrands.has(selectId)) return false;
    }
    if (q) {
      var hay = [rec.name, rec.brand, rec.brandId, rec.osmBrand, rec.osmOperator, rec.state, rec.highway]
        .join(" ")
        .toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function clearMarkers() {
    state.layers.matched.clearLayers();
    state.layers.suppressed.clearLayers();
    state.layers.unmatched.clearLayers();
    state.markers = [];
  }

  function bindMarker(marker, rec, kind) {
    marker.on("click", function () {
      showDetail(rec, kind);
    });
    state.markers.push({ marker: marker, rec: rec, kind: kind });
  }

  function renderMarkers() {
    clearMarkers();
    var rd = regionData();
    if (!rd) return;

    if (el("layerMatched").checked) {
      rd.matched.forEach(function (rec) {
        if (!passesFilters(rec, "matched")) return;
        var m = L.marker([rec.lat, rec.lon], { icon: circleIcon(brandColor(rec.brandId), 11) });
        bindMarker(m, rec, "matched");
        state.layers.matched.addLayer(m);
      });
    }

    if (el("layerSuppressed").checked) {
      rd.suppressed.forEach(function (rec) {
        if (!passesFilters(rec, "suppressed")) return;
        var m = L.marker([rec.lat, rec.lon], { icon: circleIcon(BRAND_COLORS.suppressed, 9) });
        bindMarker(m, rec, "suppressed");
        state.layers.suppressed.addLayer(m);
      });
    }

    if (el("layerUnmatched").checked) {
      state.unmatched.forEach(function (rec) {
        if (!passesFilters(rec, "unmatched")) return;
        var m = L.marker([rec.lat, rec.lon], { icon: circleIcon(BRAND_COLORS.unmatched, 8) });
        bindMarker(m, rec, "unmatched");
        state.layers.unmatched.addLayer(m);
      });
    }

    syncLayerVisibility();
    updateStats();
  }

  function syncLayerVisibility() {
    var map = state.map;
    [["matched", el("layerMatched")], ["suppressed", el("layerSuppressed")], ["unmatched", el("layerUnmatched")]].forEach(
      function (pair) {
        var layer = state.layers[pair[0]];
        if (pair[1].checked) {
          if (!map.hasLayer(layer)) map.addLayer(layer);
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      }
    );
  }

  function showDetail(rec, kind) {
    var panel = el("detail");
    panel.classList.remove("hidden");
    var flags = (rec.flags || []).map(function (f) {
      return '<span class="badge">' + f + "</span>";
    }).join("");
    var title = rec.name || rec.brand || "(no name)";
  var html = "<h3>" + escapeHtml(title) + "</h3>";
    html += '<p><span class="badge" style="background:' + brandColor(rec.brandId || "unmatched") + '">' +
      escapeHtml(kind) + "</span> ";
    if (rec.brand) html += '<span class="badge">' + escapeHtml(rec.brand) + "</span>";
    if (rec.reason) html += '<span class="badge">' + escapeHtml(rec.reason) + "</span>";
    html += "</p>";
    html += "<dl>";
    html += row("Brand ID", rec.brandId);
    html += row("State", rec.state);
    html += row("Type", rec.type === "convenience_fuel" ? "Convenience fuel" : rec.type === "travel_plaza" ? "Travel plaza" : rec.type);
    html += row("Diesel", rec.diesel ? "yes" : rec.diesel === false ? "no" : "");
    html += row("OSM brand", rec.osmBrand);
    html += row("OSM operator", rec.osmOperator);
    html += row("Highway", rec.highway);
    html += row("Exit", rec.exit);
    html += row("Coords", rec.lat.toFixed(5) + ", " + rec.lon.toFixed(5));
    if (rec.kept) html += row("Kept instead", rec.kept);
    if (rec.searchBlob) html += row("Search blob", rec.searchBlob);
    if (rec.url) html += row("OSM", '<a href="' + rec.url + '" target="_blank" rel="noopener">view</a>');
    html += row("Flags", flags || "—");
    html += "</dl>";
    panel.innerHTML = html;
  }

  function row(label, val) {
    if (val == null || val === "") return "";
    return "<dt>" + label + "</dt><dd>" + (String(val).indexOf("<") === 0 ? val : escapeHtml(String(val))) + "</dd>";
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function updateStats() {
    var rd = regionData();
    if (!rd) return;
    var visible = state.markers.length;
    var suppNote = rd.suppressedPartial
      ? " (suppressed list not built — run master pipeline for full dedupe layer)"
      : "";
    el("statsPanel").innerHTML =
      "<strong>Visible:</strong> " +
      visible +
      " markers<br>" +
      "<strong>Matched in bundle:</strong> " +
      rd.stats.matched +
      "<br>" +
      "<strong>Suppressed (deduped):</strong> " +
      (rd.suppressed.length || rd.stats.suppressed) +
      suppNote +
      "<br>" +
      "<strong>Unmatched loaded:</strong> " +
      state.unmatched.length +
      "<br>" +
      "<strong>Generated:</strong> " +
      (rd.generated || "—");
  }

  function populateStateSelect() {
    var rd = regionData();
    var sel = el("stateSelect");
    var cur = sel.value;
    sel.innerHTML = '<option value="">All</option>';
    var states = Object.keys(rd.stats.byState || {}).sort();
    states.forEach(function (st) {
      var opt = document.createElement("option");
      opt.value = st;
      opt.textContent = st + " (" + rd.stats.byState[st] + ")";
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  }

  function populateBrandFilters() {
    var box = el("brandFilters");
    box.innerHTML = "";
    state.selectedBrands = new Set();
    var groups = state.data.brandGroups || [];
    var lastType = null;
    groups.forEach(function (g) {
      if (g.type !== lastType) {
        lastType = g.type;
        var heading = document.createElement("div");
        heading.className = "brand-type-heading";
        heading.textContent = g.type === "convenience_fuel" ? "Convenience fuel" : "Travel plaza";
        box.appendChild(heading);
      }
      state.selectedBrands.add(g.id);
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.brand = g.id;
      cb.addEventListener("change", function () {
        if (cb.checked) state.selectedBrands.add(g.id);
        else state.selectedBrands.delete(g.id);
        renderMarkers();
      });
      label.appendChild(cb);
      var suffix = g.strict ? " (strict)" : "";
      var regions = (g.regions || []).map(function (r) { return r.toUpperCase(); }).join("+");
      label.appendChild(document.createTextNode(" " + g.name + suffix + (regions ? " · " + regions : "")));
      box.appendChild(label);
    });
    if (!groups.length) {
      var rd = regionData();
      (rd.catalog || []).forEach(function (b) {
        state.selectedBrands.add(b.id);
        var label = document.createElement("label");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.dataset.brand = b.id;
        cb.addEventListener("change", function () {
          if (cb.checked) state.selectedBrands.add(b.id);
          else state.selectedBrands.delete(b.id);
          renderMarkers();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" " + b.name + (b.strict ? " (strict)" : "")));
        box.appendChild(label);
      });
    }
    if (regionData()?.stats?.byBrand) {
      Object.keys(regionData().stats.byBrand).forEach(function (id) {
        var selectId = brandSelectId(id);
        if (state.selectedBrands.has(selectId)) return;
        state.selectedBrands.add(selectId);
        var label = document.createElement("label");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.dataset.brand = selectId;
        cb.addEventListener("change", function () {
          if (cb.checked) state.selectedBrands.add(selectId);
          else state.selectedBrands.delete(selectId);
          renderMarkers();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" " + selectId.replace(/_/g, " ")));
        box.appendChild(label);
      });
    }
  }

  function setRegion(region) {
    state.region = region;
    document.querySelectorAll("#regionBtns button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.region === region);
    });
    state.unmatched = [];
    el("unmatchedFile").value = "";
    populateStateSelect();
    populateBrandFilters();
    renderMarkers();
    var rd = regionData();
    if (rd && rd.matched.length) {
      var bounds = L.latLngBounds(rd.matched.map(function (r) { return [r.lat, r.lon]; }));
      state.map.fitBounds(bounds.pad(0.05));
    }
  }

  function wireEvents() {
    document.querySelectorAll("#regionBtns button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setRegion(btn.dataset.region);
      });
    });
    ["searchBox", "stateSelect", "dieselOnly", "reviewOnly"].forEach(function (id) {
      el(id).addEventListener("input", renderMarkers);
      el(id).addEventListener("change", renderMarkers);
    });
    ["layerMatched", "layerSuppressed", "layerUnmatched"].forEach(function (id) {
      el(id).addEventListener("change", renderMarkers);
    });
    el("brandAll").addEventListener("click", function () {
      el("brandFilters").querySelectorAll("input").forEach(function (cb) {
        cb.checked = true;
        state.selectedBrands.add(cb.dataset.brand);
      });
      renderMarkers();
    });
    el("brandNone").addEventListener("click", function () {
      el("brandFilters").querySelectorAll("input").forEach(function (cb) {
        cb.checked = false;
        state.selectedBrands.delete(cb.dataset.brand);
      });
      renderMarkers();
    });
    el("unmatchedFile").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var j = JSON.parse(reader.result);
          state.unmatched = (j.unmatched || []).map(function (u) {
            return {
              lat: u.lat,
              lon: u.lon,
              name: u.name,
              brand: u.brand,
              brandId: "unmatched",
              osmBrand: u.brand,
              osmOperator: u.operator,
              highway: u.highway,
              searchBlob: u.searchBlob,
              state: "",
              url: u.url,
            };
          });
          el("layerUnmatched").checked = true;
          renderMarkers();
        } catch (e) {
          alert("Invalid JSON: " + e.message);
        }
      };
      reader.readAsText(file);
    });
  }

  function boot() {
    if (!state.data) {
      document.body.innerHTML = "<p style='padding:24px'>Missing fuel-explorer-data.js — run <code>node build-fuel-explorer-data.mjs</code></p>";
      return;
    }
    initMap();
    wireEvents();
    setRegion("us");
  }

  boot();
})();
