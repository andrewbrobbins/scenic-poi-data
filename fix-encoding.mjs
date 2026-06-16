import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ps1 = `# Re-save .js/.html as UTF-8 (Google Drive often stores UTF-16).
$utf8 = New-Object System.Text.UTF8Encoding $false
$files = @(
  "route-explorer-data.js",
  "route-explorer-app.js",
  "route-editor-app.js",
  "map-symbols.js",
  "route-leg-cache.js",
  "map-osrm-core.js",
  "route-plans-bridge.js",
  "camping-map-app.js",
  "camping-us-viewer.js",
  "camping-us-explorer-embed.js",
  "fuel-us-explorer-embed.js",
  "fuel-us-brand-catalog.json",
  "build-fuel-us-ingest-osm.mjs",
  "build-fuel-us-master.mjs",
  "build-fuel-us-explorer-embed.mjs",
  "build-fuel-us-all.mjs",
  "fuel-us-lib.mjs",
  "camping-map.html",
  "route-explorer.html",
  "route-editor.html"
)
foreach ($name in $files) {
  $path = Join-Path $PSScriptRoot $name
  if (-not (Test-Path $path)) { Write-Warning "Skip missing $path"; continue }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::Unicode)
    [System.IO.File]::WriteAllText($path, $text, $utf8)
    Write-Host "Converted $name UTF-16 -> UTF-8"
  } elseif ($bytes.Length -ge 2 -and $bytes[0] -ne 0xFF -and $bytes[1] -eq 0x00) {
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::Unicode)
    [System.IO.File]::WriteAllText($path, $text, $utf8)
    Write-Host "Converted $name UTF-16LE -> UTF-8"
  } else {
    Write-Host "OK $name (already UTF-8)"
  }
}
`;

const tools = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(tools, "fix-js-encoding.ps1"), ps1, "utf8");

const files = ["camping-map.html", "camping-map-app.js", "camping-us-viewer.js"];
for (const name of files) {
  const p = path.join(tools, name);
  if (!fs.existsSync(p)) continue;
  const b = fs.readFileSync(p);
  if (b.length >= 2 && b[1] === 0) {
    const text = b.toString("utf16le");
    fs.writeFileSync(p, text, "utf8");
    console.log("converted", name, "utf16->utf8");
  } else {
    console.log("ok", name, "utf8", b.slice(0, 3).join(","));
  }
}
