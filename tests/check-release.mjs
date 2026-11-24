// Checks what the release and the Obsidian directory expect before a version goes out:
// the version is the same everywhere, and the code creates elements only with Obsidian's helpers.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (file) => readFileSync(file, "utf8");
const errors = [];

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const versions = JSON.parse(read("versions.json"));
const v = manifest.version;

if (!/^\d+\.\d+\.\d+$/.test(v)) errors.push(`manifest.json: version "${v}" is not x.y.z`);
if (pkg.version !== v) errors.push(`package.json: version ${pkg.version}, manifest.json has ${v}`);
if (lock.version !== v || lock.packages?.[""]?.version !== v) errors.push(`package-lock.json: version differs from ${v}`);
if (versions[v] !== manifest.minAppVersion) errors.push(`versions.json: "${v}" must be "${manifest.minAppVersion}"`);
if (!new RegExp(`^## ${v.replaceAll(".", "\\.")} \\(\\d{4}-\\d{2}-\\d{2}\\)$`, "m").test(read("CHANGELOG.md"))) {
	errors.push(`CHANGELOG.md: no "## ${v} (date)" section`);
}

// The directory's review is stricter than eslint here (it fails on these even where the linter is silent).
const banned = /document\.createElement|\.innerHTML|\.outerHTML|insertAdjacentHTML/;
const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
for (const file of walk("src").filter((f) => f.endsWith(".ts"))) {
	read(file)
		.split("\n")
		.forEach((line, i) => {
			if (banned.test(line)) errors.push(`${file}:${i + 1}: use createEl, createDiv or createSpan`);
		});
}

if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exit(1);
}
console.log(`Release checks passed for ${v}.`);
