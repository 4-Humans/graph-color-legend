import assert from "node:assert/strict";
import { folderEntries } from "./folders.bundle.mjs";
import { matchNotes } from "./query.bundle.mjs";

const note = (path) => ({ id: path, path, name: path.split("/").pop(), tags: [], frontmatter: null });
const many = (folder, n) => Array.from({ length: n }, (_x, i) => note(`${folder}/n${i}.md`));
const rows = (notes) => folderEntries(notes).map((f) => [f.query, f.ids.length]);

// Top-level folders, the largest first; notes in the vault root belong to no row.
{
	const notes = [...many("Projects", 5), ...many("Journal", 3), ...many("People/Friends", 2), note("Inbox.md")];
	assert.deepEqual(rows(notes), [
		["path:Projects/", 5],
		["path:Journal/", 3],
		["path:People/", 2],
	]);
	// Every row lists exactly the notes its query finds through the plugin's own search.
	for (const f of folderEntries(notes)) assert.deepEqual([...matchNotes(f.query, notes)].sort(), [...f.ids].sort());
}

// Nearly everything in one folder: its subfolders are listed, next to the other top-level folders.
{
	const notes = [...many("wiki/science", 6), ...many("wiki/people", 5), ...many("wiki/tools", 4), note("wiki/index.md"), ...many("raw", 2), note("README.md")];
	assert.deepEqual(rows(notes), [
		["path:wiki/science/", 6],
		["path:wiki/people/", 5],
		["path:wiki/tools/", 4],
		["path:raw/", 2],
	]);
}
// The same, two levels down.
{
	const notes = [...many("vault/wiki/a", 6), ...many("vault/wiki/b", 5), note("vault/wiki/index.md"), note("vault/notes.md")];
	assert.deepEqual(rows(notes), [
		["path:vault/wiki/a/", 6],
		["path:vault/wiki/b/", 5],
	]);
}
// One big folder with a single subfolder (or none) is not opened up.
assert.deepEqual(rows([...many("wiki", 9), note("a.md")]), [["path:wiki/", 9]]);
assert.deepEqual(rows([...many("wiki/all", 9), note("a.md")]), [["path:wiki/", 9]]);

// A name with a space is quoted; a row counts what its query matches, which is the text anywhere in the path.
{
	const notes = [...many("Notes", 3), ...many("Meeting Notes", 2), ...many("Архив", 2)];
	assert.deepEqual(rows(notes), [
		["path:Notes/", 5],
		['path:"Meeting Notes/"', 2],
		["path:Архив/", 2],
	]);
	for (const f of folderEntries(notes)) assert.deepEqual([...matchNotes(f.query, notes)].sort(), [...f.ids].sort());
}

// Folders whose name cannot be written into a query are left out; no notes, no rows.
assert.deepEqual(rows([...many('a"b', 2), ...many("ok", 1)]), [["path:ok/", 1]]);
assert.deepEqual(rows([]), []);
assert.deepEqual(rows([note("a.md"), note("b.md")]), []);

// A large vault stays quick and the list stays bounded.
{
	const notes = [];
	for (let i = 0; i < 1000; i++) notes.push(note(`f${i}/n.md`), note(`f${i}/m.md`));
	const t0 = Date.now();
	const list = folderEntries(notes);
	assert.equal(list.length, 300);
	assert.ok(Date.now() - t0 < 3000, "folderEntries is too slow");
}

console.log("folders: ok");
