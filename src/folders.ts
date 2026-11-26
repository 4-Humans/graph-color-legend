/**
 * The "Folders" section of the legend: the folders the notes of the graph lie in.
 * Pure helpers (no Obsidian imports), so they can be unit-tested.
 */
import { folderQuery } from "./auto-groups";
import type { NoteInfo } from "./query-match";

export interface FolderEntry {
	/** `path:` query for the folder, the same one "Make it a color group" writes into the graph. */
	query: string;
	/** Notes that query matches. */
	ids: string[];
}

/** A folder with this share of the notes is opened up, and its subfolders are listed instead. */
const OPEN_SHARE = 0.8;
const MAX_DEPTH = 6;
/** No more rows than this (a vault can have thousands of folders). */
const MAX_FOLDERS = 300;

function folderParts(path: string): string[] {
	const parts = path.split("/");
	parts.pop();
	return parts;
}

interface Folder {
	parts: string[];
	notes: NoteInfo[];
}

/** Subfolders of a folder (or of the vault root, for no parts) that hold notes, at any depth below it. */
function children(parts: string[], notes: NoteInfo[]): Folder[] {
	const out = new Map<string, NoteInfo[]>();
	for (const note of notes) {
		const name = folderParts(note.path)[parts.length];
		if (name === undefined) continue;
		const list = out.get(name);
		if (list) list.push(note);
		else out.set(name, [note]);
	}
	return [...out].map(([name, list]) => ({ parts: [...parts, name], notes: list }));
}

/**
 * The folders to list: the top-level ones, and where nearly all notes lie in one folder, its subfolders
 * instead (a vault kept in "wiki/" lists what is inside "wiki/"). Notes that lie right in the vault root,
 * or right in an opened folder, belong to no row.
 *
 * A row counts the notes its `path:` query matches, which is the text anywhere in the path with letter
 * case ignored: "Notes/" also matches "Meeting Notes/…". So the row lights up exactly the notes that a
 * color group made of it would color.
 */
export function folderEntries(notes: NoteInfo[]): FolderEntry[] {
	let folders = children([], notes);
	for (let depth = 0; depth < MAX_DEPTH; depth++) {
		const big = folders.find((f) => f.notes.length >= notes.length * OPEN_SHARE);
		if (!big) break;
		let inside = children(big.parts, big.notes);
		// A chain of single folders ("vault/wiki/…") is walked down to where the notes part ways.
		for (let i = 0; i < MAX_DEPTH; i++) {
			const only = inside.length === 1 ? inside[0] : undefined;
			if (!only || only.notes.length < notes.length * OPEN_SHARE) break;
			inside = children(only.parts, only.notes);
		}
		if (inside.length < 2) break;
		folders = [...folders.filter((f) => f !== big), ...inside];
	}
	const paths = notes.map((n) => ({ id: n.id, path: n.path.toLowerCase() }));
	const out: FolderEntry[] = [];
	// The largest ones only, cut before the matching: it looks at every note for every folder.
	const largest = [...folders].sort((a, b) => b.notes.length - a.notes.length).slice(0, MAX_FOLDERS);
	for (const f of largest) {
		if (f.parts.some((p) => !p || p.includes('"'))) continue;
		const needle = f.parts.join("/").toLowerCase() + "/";
		const ids = paths.filter((p) => p.path.includes(needle)).map((p) => p.id);
		if (ids.length > 0) out.push({ query: folderQuery(f.parts), ids });
	}
	return out.sort((a, b) => b.ids.length - a.ids.length || a.query.localeCompare(b.query)).slice(0, MAX_FOLDERS);
}
