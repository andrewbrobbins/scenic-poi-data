/**
 * Shared emoji map markers (decimal code points via String.fromCodePoint).
 * Vibrant badge colors for contrast on light and dark map tiles.
 */
/* global L */
var MAP_SYMBOLS = {
  camping: String.fromCodePoint(127957),
  npsPark: String.fromCodePoint(127966),
  npsHistoric: String.fromCodePoint(127963),
  hotel: String.fromCodePoint(127976),
  waypoint: String.fromCodePoint(128205),
  nightly: String.fromCodePoint(127769),
  via: String.fromCodePoint(128204),
  start: String.fromCodePoint(128681),
  finish: String.fromCodePoint(127937),
  scenic: String.fromCodePoint(127748),
  fuel: String.fromCodePoint(0x26fd),
  other: String.fromCodePoint(128310),
};

var SYMBOL_COLORS = {
  camping: { fill: "#c2410c", ring: "#fdba74" },
  npsPark: { fill: "#15803d", ring: "#86efac" },
  npsHistoric: { fill: "#6d28d9", ring: "#c4b5fd" },
  hotel: { fill: "#1d4ed8", ring: "#93c5fd" },
  waypoint: { fill: "#b91c1c", ring: "#fca5a5" },
  nightly: { fill: "#ea580c", ring: "#fed7aa" },
  via: { fill: "#a16207", ring: "#fde047" },
  start: { fill: "#047857", ring: "#6ee7b7" },
  finish: { fill: "#be123c", ring: "#fda4af" },
  scenic: { fill: "#0e7490", ring: "#67e8f9" },
  fuel: { fill: "#ca8a04", ring: "#fde047" },
  other: { fill: "#9333ea", ring: "#d8b4fe" },
};

function mapEmojiIcon(symbolKey, size) {
  size = size || 18;
  var ch = MAP_SYMBOLS[symbolKey] || MAP_SYMBOLS.other;
  var style =
    "font-size:" +
    size +
    "px;line-height:1;display:block;text-align:center;" +
    "filter:drop-shadow(0 0 1px #fff) drop-shadow(0 1px 2px rgba(0,0,0,.75))";
  return L.divIcon({
    className: "map-emoji-pin",
    html: '<span class="map-emoji-pin-inner" style="' + style + '">' + ch + "</span>",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function npsSymbolKey(category) {
  if (category === "park" || category === "preserve" || category === "monument" || category === "memorial") {
    return "npsPark";
  }
  if (category === "historic_site" || category === "historic_park") return "npsHistoric";
  return "waypoint";
}
