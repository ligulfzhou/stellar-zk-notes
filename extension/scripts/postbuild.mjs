import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "manifest.template.json"), "utf8")
);
manifest.action.default_popup = "popup.html";
manifest.background.service_worker = "background.js";
manifest.content_scripts[0].js = ["content-script.js"];

writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("extension dist ready:", dist);
