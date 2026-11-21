/**
 * Names of legend entries kept in notes:
 *   graph-legend: "<query>"          the color group this note describes (a string or a list)
 *   graph-legend-name: "<name>"      optional short name for the legend (a string, or a list in the same order)
 * Without graph-legend-name the legend uses the note's title.
 * Pure functions on front matter objects, so they can be tested without Obsidian.
 */
import { queryKey } from "./query-match";

export const QUERY_PROP = "graph-legend";
export const NAME_PROP = "graph-legend-name";
const MAX_NAME = 200;

export interface NoteEntry {
	query: string;
	/** The name from graph-legend-name, or null when the note's title should be used. */
	name: string | null;
}

function queryList(v: unknown): unknown[] {
	return typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
}

function cleanName(v: unknown): string | null {
	return typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_NAME) : null;
}

/** The entries one note describes, with their names. */
export function entriesFromFrontmatter(fm: unknown): NoteEntry[] {
	if (!fm || typeof fm !== "object") return [];
	const f = fm as Record<string, unknown>;
	const queries = queryList(f[QUERY_PROP]);
	const names = f[NAME_PROP];
	const out: NoteEntry[] = [];
	queries.forEach((q, i) => {
		if (typeof q !== "string" || !q.trim()) return;
		let name: string | null = null;
		if (Array.isArray(names)) name = cleanName(names[i]);
		// A single name only belongs to a note that describes a single entry.
		else if (queries.length === 1) name = cleanName(names);
		out.push({ query: q.trim(), name });
	});
	return out;
}

/**
 * Sets (or with null removes) the name of one entry in a note's front matter, in place.
 * Returns false when the note does not describe this entry.
 */
export function setNameInFrontmatter(fm: Record<string, unknown>, query: string, name: string | null): boolean {
	const queries = queryList(fm[QUERY_PROP]);
	const key = queryKey(query);
	const index = queries.findIndex((q) => typeof q === "string" && queryKey(q) === key);
	if (index < 0) return false;
	const value = name === null ? null : cleanName(name);
	if (queries.length === 1 && !Array.isArray(fm[NAME_PROP])) {
		if (value) fm[NAME_PROP] = value;
		else delete fm[NAME_PROP];
		return true;
	}
	const old = fm[NAME_PROP];
	const list: string[] = queries.map((_q, i) => {
		const v: unknown = Array.isArray(old) ? old[i] : undefined;
		return typeof v === "string" ? v : "";
	});
	list[index] = value ?? "";
	if (list.every((v) => !v.trim())) delete fm[NAME_PROP];
	else fm[NAME_PROP] = list;
	return true;
}

/** Rewrites the queries in graph-legend, in place (used when a tag is renamed). Returns true if anything changed. */
export function rewriteQueriesInFrontmatter(fm: Record<string, unknown>, rewrite: (q: string) => string): boolean {
	const v = fm[QUERY_PROP];
	if (typeof v === "string") {
		const next = rewrite(v);
		if (next === v) return false;
		fm[QUERY_PROP] = next;
		return true;
	}
	if (!Array.isArray(v)) return false;
	let changed = false;
	const next = v.map((q: unknown) => {
		if (typeof q !== "string") return q;
		const r = rewrite(q);
		if (r !== q) changed = true;
		return r;
	});
	if (changed) fm[QUERY_PROP] = next;
	return changed;
}
