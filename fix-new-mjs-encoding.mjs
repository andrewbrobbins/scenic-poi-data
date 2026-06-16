#!/usr/bin/env node
/** Re-save listed .mjs as UTF-8 (Google Drive often stores UTF-16). */
import fs from "fs";
const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node fix-new-mjs-encoding.mjs file1.mjs ...");
  process.exit(1);
}
for (const f of files) {
  const b = fs.readFileSync(f);
  let text;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) text = b.toString("utf16le");
  else if (b.length >= 2 && b[1] === 0x00) text = b.toString("utf16le");
  else text = b.toString("utf8");
  fs.writeFileSync(f, text, "utf8");
  console.log("UTF-8:", f);
}
