/**
 * A small evaluator for the simple graph search queries that color groups usually use:
 * tags, properties, paths and file names, joined by spaces (AND), each optionally negated with "-".
 *
 * It is only used to explain the legend (counts and "covered by a group above"); the graph's own
 * colors stay the source of truth. Anything else (OR, brackets, regex, plain words) returns null,
 * so the legend never guesses. Input is capped and parsing is linear.
 */

const MAX_QUERY = 500;

/** What the evaluator needs to know about one note. */
export interface NoteInfo {
	id: string;
	path: string;
	/** File name with extension. */
	name: string;
	/** Tags without "#", lower case. */
	tags: string[];
	frontmatter: Record<string, unknown> | null;
}

type Term =
	| { kind: "tag"; value: string; not: boolean }
	| { kind: "prop"; key: string; value: string | null; not: boolean }
	| { kind: "path"; value: string; not: boolean }
	| { kind: "file"; value: string; not: boolean };

/** Splits on spaces, keeping "quoted text" and [property: value] together. */
function tokens(s: string): string[] | null {
	const out: string[] = [];
	let cur = "";
	let quote = false;
	let bracket = false;
	for (const ch of s) {
		if (ch === '"' && !bracket) quote = !quote;
		else if (ch === "[" && !quote) {
			if (bracket) return null;
			bracket = true;
		} else if (ch === "]" && !quote) {
			if (!bracket) return null;
			bracket = false;
		}
		if (/\s/.test(ch) && !quote && !bracket) {
			if (cur) out.push(cur);
			cur = "";
		} else cur += ch;
	}
	if (quote || bracket) return null;
	if (cur) out.push(cur);
	return out;
}

function unquote(s: string): string {
	return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

export function parseQuery(query: string): Term[] | null {
	const q = query.trim();
	if (!q || q.length > MAX_QUERY) return null;
	const list = tokens(q);
	if (!list || list.length === 0) return null;
	const terms: Term[] = [];
	for (let tok of list) {
		let not = false;
		if (tok.startsWith("-") && tok.length > 1) {
			not = true;
			tok = tok.slice(1);
		}
		if (tok === "OR" || tok.includes("(") || tok.includes(")")) return null;
		let m: RegExpExecArray | null;
		if ((m = /^tag:#?([^\s#]+)$/i.exec(tok)) || (m = /^#([^\s#]+)$/.exec(tok))) {
			terms.push({ kind: "tag", value: (m[1] ?? "").toLowerCase(), not });
		} else if ((m = /^\[([^:\]]+)(?::(.*))?\]$/.exec(tok))) {
			const key = (m[1] ?? "").trim().toLowerCase();
			const raw = m[2] === undefined ? null : unquote(m[2].trim()).toLowerCase();
			if (!key) return null;
			terms.push({ kind: "prop", key, value: raw === "" ? null : raw, not });
		} else if ((m = /^path:(.+)$/i.exec(tok))) {
			const v = unquote(m[1] ?? "").toLowerCase();
			if (!v) return null;
			terms.push({ kind: "path", value: v, not });
		} else if ((m = /^file:(.+)$/i.exec(tok))) {
			const v = unquote(m[1] ?? "").toLowerCase();
			if (!v) return null;
			terms.push({ kind: "file", value: v, not });
		} else {
			return null;
		}
	}
	return terms;
}

function propValues(v: unknown): string[] {
	const one = (x: unknown) => (typeof x === "string" || typeof x === "number" || typeof x === "boolean" ? [String(x).toLowerCase()] : []);
	return Array.isArray(v) ? v.flatMap(one) : one(v);
}

function termMatches(term: Term, note: NoteInfo): boolean {
	switch (term.kind) {
		case "tag":
			return note.tags.some((t) => t === term.value || t.startsWith(term.value + "/"));
		case "path":
			return note.path.toLowerCase().includes(term.value);
		case "file":
			return note.name.toLowerCase().includes(term.value);
		case "prop": {
			const fm = note.frontmatter;
			if (!fm) return false;
			const key = Object.keys(fm).find((k) => k.toLowerCase() === term.key);
			if (key === undefined) return false;
			if (term.value === null) return true;
			const value = term.value;
			return propValues(fm[key]).some((v) => v.includes(value));
		}
	}
}

/** Ids of the notes that match; null when the query uses syntax this evaluator does not know. */
export function matchNotes(query: string, notes: NoteInfo[]): Set<string> | null {
	const terms = parseQuery(query);
	if (!terms) return null;
	const out = new Set<string>();
	for (const note of notes) {
		if (terms.every((t) => termMatches(t, note) !== t.not)) out.add(note.id);
	}
	return out;
}
