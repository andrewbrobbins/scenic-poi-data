import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const tripRoot = path.join(tools, "..");
const srcDir = path.join(tripRoot, "Icons");
const dstDir = path.join(tools, "map-icons", "fuel");

const pairs = [
  ["petro-canada icon.png", "petro_pass.png"],
  ["Huskey icon.png", "husky_travel.png"],
  ["irving icon.png", "irving_bigstop.png"],
  ["onroute icon.png", "onroute.png"],
];

fs.mkdirSync(dstDir, { recursive: true });
for (const [src, out] of pairs) {
  const from = path.join(srcDir, src);
  const to = path.join(dstDir, out);
  if (!fs.existsSync(from)) {
    console.warn("Missing", from);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log("Copied", out, fs.statSync(to).size, "bytes");
}
