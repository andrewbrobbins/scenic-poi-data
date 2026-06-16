/**
 * Re-save tools/*.js as UTF-8 (Google Drive often stores UTF-16 LE without BOM).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));

function decodeUtf16Le(buf) {
  let out = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out += String.fromCharCode(buf[i] | (buf[i + 1] << 8));
  }
  return out;
}

function isUtf16Le(buf) {
  if (buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xfe) return true;
  let zeroOdd = 0;
  let zeroEven = 0;
  const n = Math.min(buf.length, 200);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) {
      if (i % 2 === 1) zeroOdd++;
      else zeroEven++;
    }
  }
  return zeroOdd > 8 && zeroEven < 2;
}

let converted = 0;
for (const name of files) {
  const filePath = path.join(dir, name);
  const buf = fs.readFileSync(filePath);
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString("utf16le").slice(1);
    converted++;
  } else if (isUtf16Le(buf)) {
    text = decodeUtf16Le(buf);
    converted++;
  } else {
    text = buf.toString("utf8");
  }
  fs.writeFileSync(filePath, text, { encoding: "utf8" });
  const check = fs.readFileSync(filePath);
  const ok = check[0] !== 0 && (check.length < 2 || check[1] !== 0);
  console.log(ok ? "utf-8" : "FAIL", name);
}
console.log("Done. Converted", converted, "UTF-16 file(s).");
