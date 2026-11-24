/**
 * "Color the graph": suggests color groups for the notes that have no color yet, by folders,
 * by tags or by the values of a property. Pure helpers (no Obsidian imports), so they can be unit-tested.
 *
 * A note gets the color of the first group that matches it. Every list of items here is therefore
 * kept in the order the groups are written in, and the counts shown to the user follow that order.
 */
import { queryKey, type NoteInfo } from "./query-match";

export type AutoMode = "folders" | "tags" | "property";

/** One suggested color group. */
export interface AutoItem {
	query: string;
	/** Notes without a color that this query matches. */
	ids: string[];
}

/** One way to color the graph. */
export interface AutoOption {
	mode: AutoMode;
	/** The property (mode "property"); the folder the suggested folders lie in (mode "folders", "" for the vault root). */
	key: string;
	/** In writing order: a note takes the first chosen item that matches it. */
	items: AutoItem[];
}

export interface AutoInput {
	/** The notes behind the nodes of the graph. */
	notes: NoteInfo[];
	/** Tags and property values of those notes, as the legend lists them (`tag:#name`, `[key:value]`). */
	tags: AutoItem[];
	properties: AutoItem[];
	/** Ids of the notes no color group colors yet; null when the graph has no groups (all notes are free). */
	free: Set<string> | null;
	/** Queries of the groups the graph already has: they are not suggested again. */
	existing: string[];
}

/** Groups switched on at first: more colors than this are hard to tell apart. */
export const AUTO_MAX_DEFAULT = 12;
/** A folder with this share of the notes is opened up, and its subfolders are suggested instead. */
const DESCEND_SHARE = 0.8;
const MAX_DEPTH = 6;
/** No more suggestions than this in one list (a vault can have thousands of tags). */
const MAX_ITEMS = 300;

function folderParts(path: string): string[] {
	const parts = path.split("/");
	parts.pop();
	return parts;
}

/** `path:` query for a folder, written the way people write it by hand. */
export function folderQuery(parts: string[]): string {
	const p = parts.join("/") + "/";
	return /^[\p{L}\p{N}_\-./]+$/u.test(p) ? `path:${p}` : `path:"${p}"`;
}

/** Notes grouped by the folder they lie in at this depth (notes right in the parent folder are left out). */
function childFolders(notes: NoteInfo[], depth: number): Map<string, NoteInfo[]> {
	const out = new Map<string, NoteInfo[]>();
	for (const note of notes) {
		const name = folderParts(note.path)[depth];
		if (name === undefined) continue;
		const list = out.get(name);
		if (list) list.push(note);
		else out.set(name, [note]);
	}
	return out;
}

/**
 * Puts items in an order where nobody takes another item's notes by accident. `path:` matches any part
 * of a path, so `path:Notes/` also matches "Meeting Notes/…": the item whose own notes would be taken
 * goes first. Items are otherwise kept by size, largest first.
 */
function orderFolders(items: { item: AutoItem; own: Set<string> }[]): AutoItem[] {
	const bySize = [...items].sort((a, b) => b.item.ids.length - a.item.ids.length || a.item.query.localeCompare(b.item.query));
	const before = new Map<number, Set<number>>();
	bySize.forEach((a, i) => {
		bySize.forEach((b, j) => {
			if (i === j) return;
			// a matches notes that lie in b's folder: b must be written first.
			if (a.item.ids.some((id) => b.own.has(id))) {
				let set = before.get(i);
				if (!set) before.set(i, (set = new Set<number>()));
				set.add(j);
			}
		});
	});
	const done = new Set<number>();
	const out: AutoItem[] = [];
	while (out.length < bySize.length) {
		let next = bySize.findIndex((_x, i) => !done.has(i) && [...(before.get(i) ?? [])].every((j) => done.has(j)));
		// Two folders that match each other's notes (A/B/ and B/A/): no right order, keep the larger first.
		if (next < 0) next = bySize.findIndex((_x, i) => !done.has(i));
		const picked = bySize[next];
		if (!picked) break;
		done.add(next);
		out.push(picked.item);
	}
	return out;
}

function folderOption(notes: NoteInfo[], free: NoteInfo[]): AutoOption {
	let base: string[] = [];
	let pool = notes;
	for (let depth = 0; depth < MAX_DEPTH; depth++) {
		let top: [string, NoteInfo[]] | null = null;
		for (const entry of childFolders(pool, base.length)) if (!top || entry[1].length > top[1].length) top = entry;
		// Nearly everything lies in one folder: its subfolders tell more than the folder itself.
		if (!top || top[1].length < pool.length * DESCEND_SHARE) break;
		if (childFolders(top[1], base.length + 1).size < 2) break;
		base = [...base, top[0]];
		pool = top[1];
	}
	const prefix = base.length ? base.join("/").toLowerCase() + "/" : "";
	const items: { item: AutoItem; own: Set<string> }[] = [];
	for (const [name, list] of childFolders(pool, base.length)) {
		if (!name || name.includes('"')) continue;
		const query = folderQuery([...base, name]);
		const needle = prefix + name.toLowerCase() + "/";
		const own = new Set(list.map((n) => n.id));
		// The same test the graph's search does: the text anywhere in the path, letter case ignored.
		const ids = free.filter((n) => n.path.toLowerCase().includes(needle)).map((n) => n.id);
		if (ids.length > 0) items.push({ item: { query, ids }, own });
	}
	// The largest ones only, cut before the ordering: it compares every pair.
	const top = items.sort((a, b) => b.item.ids.length - a.item.ids.length || a.item.query.localeCompare(b.item.query)).slice(0, MAX_ITEMS);
	return { mode: "folders", key: base.join("/"), items: orderFolders(top) };
}

/**
 * The writing order for tags and property values: the largest first, as the legend will then list them.
 * Only where two of them share notes is the rarer one written first, so a note with a common and a
 * rare tag shows the rare one, which says more about it. `items` come largest first.
 */
function rareBeforeCommon(items: AutoItem[]): AutoItem[] {
	const out: AutoItem[] = [];
	const placed = new Map<string, AutoItem[]>();
	for (const item of items) {
		const shared = new Set<AutoItem>();
		for (const id of item.ids) for (const other of placed.get(id) ?? []) shared.add(other);
		const at = shared.size > 0 ? out.findIndex((o) => shared.has(o)) : -1;
		if (at < 0) out.push(item);
		else out.splice(at, 0, item);
		for (const id of item.ids) {
			const list = placed.get(id);
			if (list) list.push(item);
			else placed.set(id, [item]);
		}
	}
	return out;
}

function largest(items: AutoItem[]): AutoItem[] {
	return [...items].sort((a, b) => b.ids.length - a.ids.length || a.query.localeCompare(b.query)).slice(0, MAX_ITEMS);
}

function onlyFree(items: AutoItem[], free: Set<string> | null): AutoItem[] {
	if (!free) return items.filter((i) => i.ids.length > 0);
	return items.map((i) => ({ query: i.query, ids: i.ids.filter((id) => free.has(id)) })).filter((i) => i.ids.length > 0);
}

/** `[key:value]` -> key (null for anything else). */
function propertyKey(query: string): string | null {
	const m = /^\[([^:\]]+):.*\]$/.exec(query);
	return m ? (m[1] ?? "").trim() : null;
}

/**
 * The ways this graph can be colored, each with at least two groups to offer: folders, then tags,
 * then one option per property (the property most notes have first).
 */
export function autoOptions(input: AutoInput): AutoOption[] {
	const taken = new Set(input.existing.map((q) => queryKey(q)));
	const fresh = (items: AutoItem[]) => items.filter((i) => !taken.has(queryKey(i.query)));
	const freeNotes = input.free ? input.notes.filter((n) => input.free?.has(n.id)) : input.notes;
	const out: AutoOption[] = [];

	const folders = folderOption(input.notes, freeNotes);
	folders.items = fresh(folders.items);
	out.push(folders);

	// Top-level tags only: `tag:#a` already covers `#a/b`.
	const tags = fresh(onlyFree(input.tags.filter((t) => !t.query.slice(5).includes("/")), input.free));
	out.push({ mode: "tags", key: "", items: rareBeforeCommon(largest(tags)) });

	const byKey = new Map<string, AutoItem[]>();
	for (const item of fresh(onlyFree(input.properties, input.free))) {
		const key = propertyKey(item.query);
		if (key === null) continue;
		const list = byKey.get(key);
		if (list) list.push(item);
		else byKey.set(key, [item]);
	}
	const props: AutoOption[] = [...byKey].map(([key, items]) => ({ mode: "property", key, items: rareBeforeCommon(largest(items)) }));
	const reach = (o: AutoOption) => new Set(o.items.flatMap((i) => i.ids)).size;
	props.sort((a, b) => reach(b) - reach(a) || a.key.localeCompare(b.key));
	out.push(...props);

	return out.filter((o) => o.items.length >= 2);
}

/**
 * Items in the order they are listed for the user: the one that colors the most notes first
 * (counted with every item switched on, so the order does not jump while items are switched).
 */
export function listed(option: AutoOption): AutoItem[] {
	const { counts } = assign(option, new Set(option.items.map((i) => i.query)));
	const n = (i: AutoItem) => counts.get(i.query) ?? 0;
	return [...option.items].sort((a, b) => n(b) - n(a) || b.ids.length - a.ids.length || a.query.localeCompare(b.query));
}

/** The groups switched on at first: the largest ones, a dozen at most. */
export function defaultChosen(option: AutoOption): Set<string> {
	return new Set(listed(option).slice(0, AUTO_MAX_DEFAULT).map((i) => i.query));
}

/** How many notes each chosen group will color (first match wins, in writing order), and how many in all. */
export function assign(option: AutoOption, chosen: Set<string>): { counts: Map<string, number>; total: number } {
	const seen = new Set<string>();
	const counts = new Map<string, number>();
	for (const item of option.items) {
		if (!chosen.has(item.query)) continue;
		let n = 0;
		for (const id of item.ids) {
			if (seen.has(id)) continue;
			seen.add(id);
			n++;
		}
		counts.set(item.query, n);
	}
	return { counts, total: seen.size };
}

/** The option that colors the most notes with its first choice; folders win a tie, then tags. */
export function bestOption(options: AutoOption[]): AutoOption | null {
	let best: AutoOption | null = null;
	let most = -1;
	for (const o of options) {
		const total = assign(o, defaultChosen(o)).total;
		if (total > most) [best, most] = [o, total];
	}
	return best;
}

// ---- colors ---------------------------------------------------------------

/** Relative luminance of an RGB integer (WCAG). */
export function luminance(rgb: number): number {
	const channel = (v: number) => {
		const x = v / 255;
		return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * channel((rgb >> 16) & 255) + 0.7152 * channel((rgb >> 8) & 255) + 0.0722 * channel(rgb & 255);
}

export function contrast(a: number, b: number): number {
	const x = luminance(a);
	const y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Below this a node is hard to see on the graph's background (dark blue on a dark theme, yellow on a light one). */
const MIN_CONTRAST = 2;

function hslToRgb(h: number, s: number, l: number): number {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return (f(0) << 16) | (f(8) << 8) | f(4);
}

/**
 * The next color for a new group: the first palette color that is not used yet and stands out on the
 * background; when those run out, the unused color that stands out best; then new hues, so two groups
 * never share a color (same-colored groups are highlighted together).
 */
export function nextColor(palette: number[], used: number[], background: number): number {
	const free = palette.filter((c) => !used.includes(c));
	const clear = free.find((c) => contrast(c, background) >= MIN_CONTRAST);
	if (clear !== undefined) return clear;
	if (free.length > 0) return [...free].sort((a, b) => contrast(b, background) - contrast(a, background))[0] ?? 0;
	const light = luminance(background) > 0.4 ? 0.42 : 0.62;
	for (let i = 0; i < 360; i++) {
		const c = hslToRgb((used.length * 137.508 + i * 23) % 360, 0.7, light);
		if (!used.includes(c)) return c;
	}
	return 0x888888;
}
