/**
 * Pure helpers for tag names. No Obsidian imports, so they can be unit-tested.
 * Tags are compared without "#" and case-insensitively, as Obsidian does.
 */

/** Strip a leading "#" and surrounding spaces. */
export function bareTag(tag: string): string {
	return tag.trim().replace(/^#/, "");
}

/** True if `tag` is `old` or nested under it (old/child). Both without "#". */
export function tagMatches(tag: string, old: string): boolean {
	const t = bareTag(tag).toLowerCase();
	const o = bareTag(old).toLowerCase();
	return t === o || t.startsWith(o + "/");
}

/** Rename `tag` (with or without "#") if it matches `old`; keeps "#" and the nested part. */
export function renameTagValue(tag: string, old: string, next: string): string | null {
	const hasHash = tag.trim().startsWith("#");
	const t = bareTag(tag);
	if (!tagMatches(t, old)) return null;
	const rest = t.slice(bareTag(old).length); // "" or "/child"
	return (hasHash ? "#" : "") + bareTag(next) + rest;
}

/**
 * Checks a new tag name. Returns null when valid, or a reason key.
 * Obsidian tags use letters, digits, "_", "-" and "/" for nesting, and need at least one non-digit.
 */
export function validateTag(name: string): "empty" | "chars" | "digits" | "slash" | null {
	const t = bareTag(name);
	if (!t) return "empty";
	if (!/^(?:[\p{L}\p{N}\p{M}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}_\-/]|\ufe0f)+$/u.test(t)) return "chars";
	if (t.startsWith("/") || t.endsWith("/") || t.includes("//")) return "slash";
	if (!/[^\d/]/u.test(t)) return "digits";
	return null;
}

const TAG_CHARS = "[^\\s()\"\\[\\]]+";

/** Tags used in a graph search query: `tag:#x`, `tag:x` and bare `#x`. Without "#", unique, in order. */
export function extractTags(query: string): string[] {
	const out: string[] = [];
	const add = (t: string) => {
		const b = bareTag(t);
		if (b && !out.some((x) => x.toLowerCase() === b.toLowerCase())) out.push(b);
	};
	const opRe = new RegExp(`\\btag:#?(${TAG_CHARS})`, "giu");
	for (const m of query.matchAll(opRe)) add(m[1] ?? "");
	const bareRe = new RegExp(`(?:^|[\\s(])#(${TAG_CHARS})`, "gu");
	for (const m of query.matchAll(bareRe)) add(m[1] ?? "");
	return out;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace a tag in a graph search query (operator `tag:` and bare `#tag`), keeping nested parts. */
export function replaceTagInQuery(query: string, old: string, next: string): string {
	const o = escapeRe(bareTag(old));
	const n = bareTag(next);
	const end = `(?=$|[\\s()"/\\]])`;
	const opRe = new RegExp(`(\\btag:#?)${o}${end}`, "giu");
	let out = query.replace(opRe, (_m, pre: string) => pre + n);
	const bareRe = new RegExp(`((?:^|[\\s(])#)${o}${end}`, "giu");
	out = out.replace(bareRe, (_m, pre: string) => pre + n);
	return out;
}

const FM_TAG_KEY = /^tags?$/i;

function renameInString(value: string, old: string, next: string): { value: string; count: number } {
	let count = 0;
	const out = value.replace(/[^\s,]+/g, (tok) => {
		const r = renameTagValue(tok, old, next);
		if (r === null) return tok;
		count++;
		return r;
	});
	return { value: out, count };
}

/** How many frontmatter tag values match `old` (keys "tags"/"tag", list or string). */
export function countFrontmatterTags(fm: unknown, old: string): number {
	if (typeof fm !== "object" || fm === null) return 0;
	let count = 0;
	for (const [key, v] of Object.entries(fm as Record<string, unknown>)) {
		if (!FM_TAG_KEY.test(key)) continue;
		if (Array.isArray(v)) {
			for (const item of v) if (typeof item === "string" && tagMatches(item, old)) count++;
		} else if (typeof v === "string") {
			count += renameInString(v, old, old).count;
		}
	}
	return count;
}

/** Renames matching tags in a frontmatter object in place. Returns how many values changed. */
export function renameFrontmatterTags(fm: unknown, old: string, next: string): number {
	if (typeof fm !== "object" || fm === null) return 0;
	const obj = fm as Record<string, unknown>;
	let count = 0;
	for (const key of Object.keys(obj)) {
		if (!FM_TAG_KEY.test(key)) continue;
		const v = obj[key];
		if (Array.isArray(v)) {
			let keyCount = 0;
			const renamed = v.map((item: unknown) => {
				if (typeof item !== "string") return item;
				const r = renameTagValue(item, old, next);
				if (r === null) return item;
				keyCount++;
				return r;
			});
			if (keyCount === 0) continue;
			count += keyCount;
			// Merging into an existing tag can leave duplicates; keep the first of each.
			const seen = new Set<string>();
			obj[key] = renamed.filter((item: unknown) => {
				if (typeof item !== "string") return true;
				const k = bareTag(item).toLowerCase();
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			});
		} else if (typeof v === "string") {
			const r = renameInString(v, old, next);
			obj[key] = r.value;
			count += r.count;
		}
	}
	return count;
}
