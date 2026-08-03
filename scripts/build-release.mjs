import {execFileSync} from "node:child_process";
import {readFile, rm, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "module.json"), "utf8"));
const dist = path.join(root, "dist");
await rm(dist, {recursive: true, force: true});
await mkdir(dist, {recursive: true});
const output = path.join(dist, `${manifest.id}-v${manifest.version}.zip`);
const files = ["module.json", "README.md", "CHANGELOG.md", "LICENSE", "scripts/actor-vault.js", "styles", "templates", "lang"];
execFileSync("zip", ["-r", output, ...files], {cwd: root, stdio: "inherit"});
console.log(output);
