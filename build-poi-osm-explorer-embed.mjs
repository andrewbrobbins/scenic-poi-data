/**
 * Browser embed bundles for playgrounds / scenic viewpoints.
 * Usage: node build-poi-osm-explorer-embed.mjs [--region=us|ca] [--kind=playground|viewpoint]
 */
import fs from "fs";
import {
  POI_KINDS,
  embedPath,
  masterPath,
  readJson,
  toEmbedRow,
} from "./poi-osm-lib.mjs";

function parseArgs() {
  const out = { regions: ["us", "ca"], kinds: Object.keys(POI_KINDS) };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--region=")) out.regions = [arg.slice(9)];
    else if (arg.startsWith("--kind=")) out.kinds = [arg.slice(7)];
  }
  return out;
}

function buildEmbed(region, kind) {
  const kindCfg = POI_KINDS[kind];
  const master = readJson(masterPath(region, kind));
  if (!master?.records?.length) throw new Error(`Missing master: ${masterPath(region, kind)}`);
  const records = master.records.map(toEmbedRow);
  const varName = `${kindCfg.embedVar}_${region.toUpperCase()}`;
  const payload = {
    generated: master.generated,
    kind,
    region,
    count: records.length,
    records,
  };
  const out = embedPath(region, kind);
  fs.writeFileSync(
    out,
    `/* Auto-generated — node build-poi-osm-explorer-embed.mjs */\nvar ${varName}=` +
      JSON.stringify(payload) +
      ";\n",
    "utf8"
  );
  console.log("Wrote", out, records.length, "records");
}

const args = parseArgs();
for (const region of args.regions) {
  for (const kind of args.kinds) {
    buildEmbed(region, kind);
  }
}
