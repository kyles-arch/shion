// Guncelleme bildirimi (latest.json) uretir: GitHub Releases'a setup.exe + .sig ile birlikte yuklenir.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const v = conf.version;
const exe = `Shion_${v}_x64-setup.exe`;
const dir = path.join(root, "src-tauri/target/release/bundle/nsis");
const sig = fs.readFileSync(path.join(dir, exe + ".sig"), "utf8").trim();
const notes = process.argv[2] || `Shion ${v}`;
const out = {
  version: v,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms: {
    "windows-x86_64": { signature: sig, url: `https://github.com/kyles-arch/shion/releases/download/v${v}/${exe}` },
  },
};
fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(out, null, 2));
console.log("latest.json yazildi:", path.join(dir, "latest.json"));
