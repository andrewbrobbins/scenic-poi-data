/**
 * Ingest official state/provincial park data from verified matrix entries.
 *
 * Usage:
 *   node build-state-parks-ingest-official.mjs
 *   node build-state-parks-ingest-official.mjs --refresh
 *   node build-state-parks-ingest-official.mjs --state=MN,TX,WA
 */
import { log, logSection } from "./pipeline-log.mjs";
import {
  ingestOfficialAdmin,
  loadSourceMatrix,
  verifiedSources,
} from "./state-parks-official-lib.mjs";

function parseArgs() {
  const refresh = process.argv.includes("--refresh");
  const region = process.argv.includes("--region=ca") ? "ca" : process.argv.includes("--region=us") ? "us" : "all";
  const stateArg = process.argv.find((a) => a.startsWith("--state="));
  const states = stateArg ? stateArg.slice(8).split(",").map((s) => s.trim().toUpperCase()) : null;
  return { refresh, region, states };
}

async function main() {
  const { refresh, region, states } = parseArgs();
  const matrix = loadSourceMatrix();

  const rows = [];
  if (region === "all" || region === "us") rows.push(...verifiedSources(matrix, "US"));
  if (region === "all" || region === "ca") rows.push(...verifiedSources(matrix, "CA"));

  const filtered = states ? rows.filter((r) => states.includes(r.admin)) : rows;

  if (!filtered.length) {
    log("No verified sources in matrix — run node build-state-parks-discover-sources.mjs first", {
      level: "warn",
    });
    return;
  }

  logSection(`Official ingest (${filtered.length} regions)`);
  let total = 0;

  for (const row of filtered) {
    log(`Fetching ${row.admin} from ${row.agency}...`);
    try {
      const records = await ingestOfficialAdmin(row, { force: refresh });
      log(`  ${row.admin}: ${records.length} records (${row.featureCount ?? "?"} raw features)`);
      total += records.length;
    } catch (e) {
      log(`  ${row.admin} FAILED: ${e.message}`, { level: "error" });
    }
  }

  log(`Official ingest complete: ${total} records across ${filtered.length} regions`);
}

main().catch((e) => {
  log(String(e), { level: "error" });
  process.exit(1);
});
