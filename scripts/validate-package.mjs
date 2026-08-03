import {readFile, access} from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));
const required = ["id", "title", "version", "compatibility", "esmodules"];
for (const key of required) {
  if (!(key in manifest)) throw new Error(`module.json missing required key: ${key}`);
}
if (manifest.id !== "actor-vault") throw new Error("Unexpected module id");
for (const path of [...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map(l => l.path)]) {
  await access(new URL(`../${path}`, import.meta.url));
}
console.log(`Validated ${manifest.title} v${manifest.version}`);
