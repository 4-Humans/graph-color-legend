/**
 * Renaming a tag in the notes of the vault.
 * Only public Obsidian API is used: metadataCache to find tags, vault.process and
 * fileManager.processFrontMatter to change files safely.
 */
import { App, getAllTags, TFile } from "obsidian";
import {
	bareTag,
	countFrontmatterTags,
	renameFrontmatterTags,
	renameTagValue,
	tagMatches,
} from "./tags";

export interface TagUsage {
	file: TFile;
	/** Tags in the note text. */
	inline: number;
	/** Tags in the note properties (frontmatter). */
	properties: number;
}

export interface RenameResult {
	changed: number;
	failed: { path: string; reason: string }[];
}

/** Notes that use `old` (or its nested tags), from the metadata cache. */
export function findTagUsage(app: App, old: string): TagUsage[] {
	const out: TagUsage[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;
		const inline = (cache.tags ?? []).filter((t) => tagMatches(t.tag, old)).length;
		const properties = countFrontmatterTags(cache.frontmatter, old);
		if (inline || properties) out.push({ file, inline, properties });
	}
	out.sort((a, b) => a.file.path.localeCompare(b.file.path));
	return out;
}

/** Number of notes that already have `tag` (exactly, not nested). */
export function countNotesWithTag(app: App, tag: string): number {
	const want = "#" + bareTag(tag).toLowerCase();
	let n = 0;
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;
		const tags = getAllTags(cache) ?? [];
		if (tags.some((t) => t.toLowerCase() === want)) n++;
	}
	return n;
}

/**
 * Renames the tag in every listed note.
 * The text of a note is changed only if every tag found by the cache is still at its
 * place; otherwise the note is left as it is and reported, so nothing is half-changed.
 */
export async function renameTagInNotes(
	app: App,
	usage: TagUsage[],
	old: string,
	next: string,
	onProgress?: (done: number, total: number) => void,
): Promise<RenameResult> {
	const result: RenameResult = { changed: 0, failed: [] };
	let done = 0;
	for (const { file, inline, properties } of usage) {
		try {
			if (inline) {
				const cache = app.metadataCache.getFileCache(file);
				const places = (cache?.tags ?? [])
					.filter((t) => tagMatches(t.tag, old))
					.map((t) => ({ tag: t.tag, start: t.position.start.offset, end: t.position.end.offset }))
					.sort((a, b) => b.start - a.start);
				let stale = false;
				await app.vault.process(file, (data) => {
					let text = data;
					for (const p of places) {
						const found = text.slice(p.start, p.end);
						const renamed = renameTagValue(found, old, next);
						if (found.toLowerCase() !== p.tag.toLowerCase() || renamed === null) {
							stale = true;
							return data;
						}
						text = text.slice(0, p.start) + renamed + text.slice(p.end);
					}
					return text;
				});
				if (stale) {
					result.failed.push({ path: file.path, reason: "stale" });
					continue;
				}
			}
			if (properties) {
				await app.fileManager.processFrontMatter(file, (fm: unknown) => {
					renameFrontmatterTags(fm, old, next);
				});
			}
			result.changed++;
		} catch (e) {
			result.failed.push({ path: file.path, reason: e instanceof Error ? e.message : String(e) });
		} finally {
			done++;
			onProgress?.(done, usage.length);
		}
	}
	return result;
}
