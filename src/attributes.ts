/**
 * Tags and properties of the notes that the graph shows.
 * Read from Obsidian's metadata cache (public API); nothing is written.
 */
import { App, getAllTags, TFile } from "obsidian";
import type { GraphRenderer } from "./graph-internals";
import type { NoteInfo } from "./query-match";

export interface AttributeEntry {
	/** Same form as a graph search query: `tag:#name` or `[key:value]`. */
	query: string;
	/** Node ids (file paths) of the notes that have it. */
	ids: string[];
}

export interface Attributes {
	tags: AttributeEntry[];
	properties: AttributeEntry[];
	/** Changes when the lists change; used to avoid rebuilding the legend. */
	signature: string;
}

/** Properties that describe the note itself rather than group it. */
const SKIP_KEYS = new Set(["tags", "tag", "aliases", "alias", "cssclasses", "cssclass", "position", "graph-legend"]);
/** A property is listed only if it splits notes into a few groups. */
const MAX_VALUES = 12;
const MAX_VALUE_LENGTH = 40;

type Scalar = string | number | boolean;

function scalars(v: unknown): Scalar[] | null {
	const ok = (x: unknown): x is Scalar => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
	if (ok(v)) return [v];
	if (Array.isArray(v) && v.every(ok)) return v;
	return null;
}

function add(map: Map<string, Set<string>>, key: string, id: string): void {
	let set = map.get(key);
	if (!set) map.set(key, (set = new Set<string>()));
	set.add(id);
}

/** The notes behind the nodes of a graph (attachments and unresolved links are skipped). */
export function collectNotes(app: App, renderer: GraphRenderer | null): NoteInfo[] {
	const out: NoteInfo[] = [];
	for (const node of renderer?.nodes ?? []) {
		if (typeof node.id !== "string") continue;
		const file = app.vault.getAbstractFileByPath(node.id);
		if (!(file instanceof TFile)) continue;
		const cache = app.metadataCache.getFileCache(file);
		const tags = cache ? (getAllTags(cache) ?? []).map((t) => t.replace(/^#/, "").toLowerCase()) : [];
		out.push({
			id: node.id,
			path: file.path,
			name: file.name,
			tags,
			frontmatter: cache?.frontmatter ?? null,
		});
	}
	return out;
}

export function collectAttributes(app: App, notes: NoteInfo[]): Attributes {
	const tagIds = new Map<string, Set<string>>();
	const values = new Map<string, Map<string, Set<string>>>();
	const keyNotes = new Map<string, Set<string>>();
	for (const note of notes) {
		const file = app.vault.getAbstractFileByPath(note.path);
		if (!(file instanceof TFile)) continue;
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;
		for (const raw of getAllTags(cache) ?? []) {
			// "#a/b" also counts for "#a", like the graph's own tag search.
			const parts = raw.replace(/^#/, "").split("/");
			for (let i = 1; i <= parts.length; i++) add(tagIds, parts.slice(0, i).join("/"), note.id);
		}
		const fm = cache.frontmatter;
		if (!fm) continue;
		for (const [key, v] of Object.entries(fm)) {
			if (SKIP_KEYS.has(key.toLowerCase())) continue;
			const list = scalars(v);
			if (!list) continue;
			add(keyNotes, key, note.id);
			let byValue = values.get(key);
			if (!byValue) values.set(key, (byValue = new Map<string, Set<string>>()));
			for (const x of list) {
				const s = String(x).trim();
				if (s && s.length <= MAX_VALUE_LENGTH) add(byValue, s, note.id);
			}
		}
	}

	const tags: AttributeEntry[] = [...tagIds]
		.map(([name, ids]) => ({ query: `tag:#${name}`, ids: [...ids] }))
		.sort((a, b) => b.ids.length - a.ids.length || a.query.localeCompare(b.query));

	const properties: AttributeEntry[] = [];
	for (const key of [...values.keys()].sort((a, b) => a.localeCompare(b))) {
		const byValue = values.get(key);
		if (!byValue || byValue.size === 0 || byValue.size > MAX_VALUES) continue;
		if ((keyNotes.get(key)?.size ?? 0) < 2) continue;
		for (const [value, ids] of [...byValue].sort((a, b) => a[0].localeCompare(b[0]))) {
			properties.push({ query: `[${key}:${value}]`, ids: [...ids] });
		}
	}

	const signature = JSON.stringify([tags.map((t) => [t.query, t.ids.length]), properties.map((p) => [p.query, p.ids.length])]);
	return { tags, properties, signature };
}

/** Notes that name a legend entry: front matter `graph-legend: <query>` (a string or a list). */
export function collectLegendNotes(app: App): Map<string, TFile> {
	const out = new Map<string, TFile>();
	for (const file of app.vault.getMarkdownFiles()) {
		const v: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.["graph-legend"];
		const list = typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
		for (const q of list) {
			if (typeof q === "string" && q.trim() && !out.has(q.trim())) out.set(q.trim(), file);
		}
	}
	return out;
}
