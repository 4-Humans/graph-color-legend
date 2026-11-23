/**
 * Runs the legend's text search over the notes of the vault.
 *
 * Notes are read with Obsidian's cachedRead in small portions, so the app stays responsive. While a
 * search box is open the folded text stays in memory (within a cap), so the next letters are found at
 * once; when the last search box closes, the memory is released. Nothing is written anywhere.
 */
import { App, Platform, TFile } from "obsidian";
import { countAll, fold, NoteHit, Snippet, snippets, sortHits } from "./text-search";

/** Notes larger than this are left out (and counted as skipped). */
const MAX_NOTE_BYTES = 2_000_000;
/** How much folded text is kept between searches, in characters. */
const CACHE_CHARS = Platform.isMobile ? 6_000_000 : 40_000_000;
/** Work this long, then let the app breathe. */
const SLICE_MS = 12;

export interface SearchResult {
	query: string;
	/** Notes with matches, most matches first. */
	hits: NoteHit[];
	/** All matches in all notes. */
	total: number;
	/** Notes left out as too large. */
	skipped: number;
}

export interface SearchProgress {
	done: number;
	total: number;
}

interface Cached {
	mtime: number;
	size: number;
	folded: string;
}

function pause(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export class NoteSearch {
	private cache = new Map<string, Cached>();
	private cachedChars = 0;

	constructor(private app: App) {}

	/** Forget the texts (called when no search box is open any more). */
	release(): void {
		this.cache.clear();
		this.cachedChars = 0;
	}

	private async foldedText(file: TFile): Promise<string> {
		const known = this.cache.get(file.path);
		if (known && known.mtime === file.stat.mtime && known.size === file.stat.size) return known.folded;
		if (known) {
			this.cachedChars -= known.folded.length;
			this.cache.delete(file.path);
		}
		const folded = fold(await this.app.vault.cachedRead(file));
		if (this.cachedChars + folded.length <= CACHE_CHARS) {
			this.cache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, folded });
			this.cachedChars += folded.length;
		}
		return folded;
	}

	/**
	 * Searches every note for the (already folded) query. Returns null when `cancelled` turns true
	 * meanwhile: a newer search has started or the box was closed.
	 */
	async run(query: string, cancelled: () => boolean, onProgress: (p: SearchProgress) => void): Promise<SearchResult | null> {
		const files = this.app.vault.getMarkdownFiles();
		const hits: NoteHit[] = [];
		let total = 0;
		let skipped = 0;
		let sliceStart = Date.now();
		let lastReport = 0;
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!file) continue;
			let count = 0;
			if (file.stat.size > MAX_NOTE_BYTES) {
				skipped++;
			} else {
				try {
					count = countAll(await this.foldedText(file), query);
				} catch {
					skipped++;
				}
				if (cancelled()) return null;
			}
			const inName = fold(file.basename).includes(query);
			if (inName) count++;
			if (count > 0) {
				hits.push({ path: file.path, count, inName });
				total += count;
			}
			const now = Date.now();
			if (now - sliceStart >= SLICE_MS) {
				if (now - lastReport >= 150) {
					lastReport = now;
					onProgress({ done: i + 1, total: files.length });
				}
				await pause();
				if (cancelled()) return null;
				sliceStart = Date.now();
			}
		}
		return { query, hits: sortHits(hits), total, skipped };
	}

	/** The first matches of one note with the text around them, read from the note as it is now. */
	async snippetsOf(path: string, query: string, limit: number): Promise<Snippet[]> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.stat.size > MAX_NOTE_BYTES) return [];
		try {
			return snippets(await this.app.vault.cachedRead(file), query, limit);
		} catch {
			return [];
		}
	}
}
