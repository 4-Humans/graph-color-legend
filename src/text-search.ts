/**
 * Plain text search for the legend: finds what was typed, as typed (like Find in a text editor).
 * No operators, no regular expressions. Letter case is ignored, and "ё" equals "е".
 *
 * Nothing here touches Obsidian, so the matching is covered by tests.
 */

/** The search starts from this many characters. */
export const MIN_QUERY = 2;
export const MAX_QUERY = 200;
/** Matches counted in one note; more than this is shown as the cap. */
export const MAX_HITS_PER_NOTE = 1000;

/**
 * Lower case with "ё" as "е". The result always has the same length as the input,
 * so a place found in the folded text is the same place in the original.
 */
export function fold(text: string): string {
	let out = text.toLowerCase();
	if (out.length !== text.length) {
		// A few letters change length in lower case (for example "İ"); those keep their own form.
		out = "";
		for (let i = 0; i < text.length; i++) {
			const c = text.charAt(i);
			const lc = c.toLowerCase();
			out += lc.length === 1 ? lc : c;
		}
	}
	return out.includes("ё") ? out.replace(/ё/g, "е") : out;
}

/** What is searched for: the typed text without the spaces around it, or "" when it is too short. */
export function prepareQuery(typed: string): string {
	const q = fold(typed.trim()).slice(0, MAX_QUERY);
	return q.length >= MIN_QUERY ? q : "";
}

/** Places of a (folded) query in a (folded) text, without overlaps. */
export function findAll(folded: string, query: string, limit = MAX_HITS_PER_NOTE): number[] {
	const out: number[] = [];
	if (!query) return out;
	let at = folded.indexOf(query);
	while (at !== -1 && out.length < limit) {
		out.push(at);
		at = folded.indexOf(query, at + query.length);
	}
	return out;
}

/** How many times a (folded) query occurs, up to the limit. */
export function countAll(folded: string, query: string, limit = MAX_HITS_PER_NOTE): number {
	if (!query) return 0;
	let n = 0;
	let at = folded.indexOf(query);
	while (at !== -1 && n < limit) {
		n++;
		at = folded.indexOf(query, at + query.length);
	}
	return n;
}

/** A line of a note with what was found in it, cut to a readable length. */
export interface Snippet {
	/** The shown part of the line in pieces, plain text and found text in turn. */
	parts: { text: string; hit: boolean }[];
	/** Line of the note (from 0) and the place of the first match in it: what the editor needs to go there. */
	line: number;
	ch: number;
	/** Length of the found text. */
	length: number;
	/** Matches in this line, including those outside the shown part. */
	matches: number;
}

const ELLIPSIS = "…";

function squeeze(s: string): string {
	return s.replace(/\s+/g, " ");
}

/**
 * The lines of a text that contain the (folded) query, the first `limit` of them. Each line is shown
 * around its first match, `radius` characters to each side, with every match inside that part marked.
 */
export function snippets(text: string, query: string, limit: number, radius = 60): Snippet[] {
	const out: Snippet[] = [];
	if (!query) return out;
	const places = findAll(fold(text), query);
	let line = 0;
	let counted = 0;
	let i = 0;
	while (i < places.length && out.length < limit) {
		const first = places[i] ?? 0;
		const lineStart = text.lastIndexOf("\n", first - 1) + 1;
		let lineEnd = text.indexOf("\n", first);
		if (lineEnd === -1) lineEnd = text.length;
		// Line number: count the line breaks passed since the previous snippet.
		for (let k = text.indexOf("\n", counted); k !== -1 && k < lineStart; k = text.indexOf("\n", k + 1)) line++;
		counted = lineStart;
		if (lineEnd > lineStart && text.charAt(lineEnd - 1) === "\r") lineEnd--;
		const inLine: number[] = [];
		while (i < places.length && (places[i] ?? 0) < lineEnd) inLine.push(places[i++] ?? 0);

		const from = Math.max(lineStart, first - radius);
		const to = Math.min(lineEnd, first + query.length + radius);
		const parts: Snippet["parts"] = [];
		let at = from;
		for (const place of inLine) {
			if (place + query.length > to) break;
			if (place > at) parts.push({ text: squeeze(text.slice(at, place)), hit: false });
			parts.push({ text: text.slice(place, place + query.length), hit: true });
			at = place + query.length;
		}
		if (at < to) parts.push({ text: squeeze(text.slice(at, to)), hit: false });
		const head = parts[0];
		if (head && !head.hit) head.text = (from > lineStart ? ELLIPSIS : "") + head.text.replace(/^ /, "");
		else if (from > lineStart) parts.unshift({ text: ELLIPSIS, hit: false });
		const tail = parts[parts.length - 1];
		if (tail && !tail.hit) tail.text = tail.text.replace(/ $/, "") + (to < lineEnd ? ELLIPSIS : "");
		else if (to < lineEnd) parts.push({ text: ELLIPSIS, hit: false });
		out.push({ parts: parts.filter((x) => x.text !== ""), line, ch: first - lineStart, length: query.length, matches: inLine.length });
	}
	return out;
}

const OPERATORS = /(^|\s)-?(tag|path|file|line|section|block|content|task|task-todo|task-done|match-case|ignore-case):/i;

/**
 * True when the typed text looks like a query for Obsidian's own search (an operator, OR, a regular
 * expression, a property in brackets). The legend still searches it as plain text and only adds a hint.
 */
export function looksLikeQuery(typed: string): boolean {
	const q = typed.trim();
	if (q.length < MIN_QUERY) return false;
	if (OPERATORS.test(q)) return true;
	if (/\S\s+OR\s+\S/.test(q)) return true;
	if (/^\/.+\/$/.test(q)) return true;
	if (/^\[[^\]]+\]$/.test(q)) return true;
	return false;
}

/** One note with matches. */
export interface NoteHit {
	path: string;
	/** Matches in the text (capped) plus one when the name matches. */
	count: number;
	inName: boolean;
}

/** Notes with more matches first; the same number: by path. */
export function sortHits(hits: NoteHit[]): NoteHit[] {
	return hits.sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
