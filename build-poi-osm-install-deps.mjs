/**
 * Install POI PBF parser deps without npm on PATH (uses node fetch + tar).
 * Usage: node build-poi-osm-install-deps.mjs
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(TOOLS, "node_modules");
const CACHE = path.join(TOOLS, ".cache");

const ROOT = { name: "osm-pbf-parser", version: "2.0.0" };

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function resolveVersion(name, range) {
  const meta = await fetchJson(`https://registry.npmjs.org/${name}`);
  if (meta.versions?.[range]) return range;
  const list = meta.versions ? Object.keys(meta.versions) : [];
  if (!list.length) throw new Error("No versions for " + name);
  const pick = list.filter((v) => !/alpha|beta|rc/i.test(v)).pop() || list.pop();
  return pick;
}

async function downloadTarball(name, version) {
  const dest = path.join(NM, name);
  if (fs.existsSync(path.join(dest, "package.json"))) return;

  const meta = await fetchJson(`https://registry.npmjs.org/${name}/${version}`);
  const tarball = meta.dist.tarball;
  const tgzPath = path.join(CACHE, `${name}-${version}.tgz`);
  fs.mkdirSync(path.dirname(tgzPath), { recursive: true });
  if (!fs.existsSync(tgzPath)) {
    console.log("Download", name, version);
    const res = await fetch(tarball);
    if (!res.ok) throw new Error(`Failed ${tarball}: ${res.status}`);
    await pipeline(res.body, fs.createWriteStream(tgzPath));
  }
  fs.mkdirSync(dest, { recursive: true });
  execSync(`tar -xzf "${tgzPath}" -C "${dest}" --strip-components=1`, { stdio: "pipe", shell: true });
  console.log("Installed", name, version);
}

async function installTree(name, version, seen) {
  const key = `${name}@${version}`;
  if (seen.has(key)) return;
  seen.add(key);

  const meta = await fetchJson(`https://registry.npmjs.org/${name}/${version}`);
  for (const [dep, range] of Object.entries(meta.dependencies || {})) {
    const v = await resolveVersion(dep, range.replace(/^[\^~]/, ""));
    await installTree(dep, v, seen);
  }
  await downloadTarball(name, version);
}

const marker = path.join(NM, "osm-pbf-parser", "package.json");
if (fs.existsSync(marker)) {
  console.log("node_modules already present — skip install");
} else {
  fs.mkdirSync(NM, { recursive: true });
  const seen = new Set();
  await installTree(ROOT.name, ROOT.version, seen);
  console.log("Installed", seen.size, "packages");
}
