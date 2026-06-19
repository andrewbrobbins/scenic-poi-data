/**
 * @deprecated Use build-fuel-official-reconcile.mjs --region=us --brand=bucees
 *
 * Thin wrapper kept for backwards compatibility.
 */
import {
  applyOfficialReconcileToMaster,
  pathsForRegion,
  reconcileOfficialRegion,
} from "./build-fuel-official-reconcile.mjs";

export async function reconcileBucees() {
  const { report } = await reconcileOfficialRegion("us", { brandFilter: "bucees" });
  const bucees = report.brands.find((b) => b.brandId === "bucees");
  return {
    generated: report.generated,
    officialCount: bucees?.officialCount ?? 0,
    osmCount: bucees?.osmCount ?? 0,
    matchedCount: bucees?.matchedCount ?? 0,
    rejectedCount: bucees?.rejectedCount ?? 0,
    supplementCount: bucees?.supplementCount ?? 0,
    matchRadiusMi: report.matchRadiusMi,
    matched: bucees?.matched ?? [],
    rejected: bucees?.rejectedSample ?? [],
    supplements: bucees?.supplementSample ?? [],
  };
}

export { applyOfficialReconcileToMaster as applyBuceesReconcileToMaster };

if (process.argv[1]?.endsWith("build-fuel-bucees-reconcile.mjs")) {
  const apply = process.argv.includes("--apply-master");
  reconcileBucees()
    .then(() => {
      if (apply) applyOfficialReconcileToMaster("us", pathsForRegion("us").report);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
