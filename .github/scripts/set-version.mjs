// Stamp a version (from the release tag) into the Tauri config and package.json
// so build artifacts are named for the tag. Run at build time only; the change
// is not committed back. Usage: node .github/scripts/set-version.mjs 0.0.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: set-version.mjs <version>");
  process.exit(1);
}

for (const file of ["src-tauri/tauri.conf.json", "package.json"]) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`set ${file} version -> ${version}`);
}
