import assert from "node:assert/strict";
import { assign, autoOptions, bestOption, colorDistance, contrast, defaultChosen, distinctColor, folderQuery, listed, nextColor, similarColors, visibleColors } from "./auto.bundle.mjs";
import { matchNotes } from "./query.bundle.mjs";

const note = (path, tags = [], frontmatter = null) => ({ id: path, path, name: path.split("/").pop(), tags, frontmatter });
const many = (folder, n, tags = []) => Array.from({ length: n }, (_x, i) => note(`${folder}/n${i}.md`, tags));
const input = (notes, extra = {}) => ({ notes, tags: [], properties: [], free: null, existing: [], ...extra });
const option = (options, mode) => options.find((o) => o.mode === mode);
const queries = (o) => o.items.map((i) => i.query);

// ---- folder queries --------------------------------------------------------
assert.equal(folderQuery(["wiki"]), "path:wiki/");
assert.equal(folderQuery(["wiki", "science"]), "path:wiki/science/");
assert.equal(folderQuery(["Проекты"]), "path:Проекты/");
assert.equal(folderQuery(["My Notes"]), 'path:"My Notes/"');
assert.equal(folderQuery(["a(b)"]), 'path:"a(b)/"');

// ---- folders: top level, largest listed first ------------------------------
{
	const notes = [...many("Projects", 5), ...many("Journal", 3), ...many("People", 2), note("Inbox.md")];
	const o = option(autoOptions(input(notes)), "folders");
	assert.equal(o.key, "");
	assert.deepEqual(listed(o).map((i) => i.query), ["path:Projects/", "path:Journal/", "path:People/"]);
	assert.deepEqual(listed(o).map((i) => i.ids.length), [5, 3, 2]);
	// Every suggestion finds, through the plugin's own search, exactly the notes it lists.
	for (const item of o.items) assert.deepEqual([...matchNotes(item.query, notes)].sort(), [...item.ids].sort());
	const { counts, total } = assign(o, defaultChosen(o));
	assert.equal(total, 10);
	assert.equal(counts.get("path:Projects/"), 5);
}

// ---- folders: nearly everything in one folder -> its subfolders ------------
{
	const notes = [...many("wiki/science", 6), ...many("wiki/people", 5), ...many("wiki/tools", 4), note("wiki/index.md"), note("README.md")];
	const o = option(autoOptions(input(notes)), "folders");
	assert.equal(o.key, "wiki");
	assert.deepEqual(listed(o).map((i) => i.query), ["path:wiki/science/", "path:wiki/people/", "path:wiki/tools/"]);
}
// One big folder without subfolders is not opened up; a single folder alone is no suggestion at all.
assert.equal(option(autoOptions(input([...many("wiki", 9), note("a.md")])), "folders"), undefined);

// ---- folders: a name inside another name ("Notes/" also matches "Meeting Notes/") ----
{
	const notes = [...many("Notes", 6), ...many("Meeting Notes", 2), ...many("Tasks", 3)];
	const o = option(autoOptions(input(notes)), "folders");
	const q = queries(o);
	// Written first, or "path:Notes/" would take its notes.
	assert.ok(q.indexOf('path:"Meeting Notes/"') < q.indexOf("path:Notes/"));
	const { counts, total } = assign(o, new Set(q));
	assert.equal(counts.get('path:"Meeting Notes/"'), 2);
	assert.equal(counts.get("path:Notes/"), 6);
	assert.equal(total, 11);
	// Listed for the user by what each one matches.
	assert.equal(listed(o)[0].query, "path:Notes/");
	assert.equal(listed(o)[0].ids.length, 8);
}

// ---- folders: letter case, quotes ------------------------------------------
{
	const notes = [...many("Wiki", 2), ...many("wiki", 2), ...many('He said "hi"', 3), ...many("Other", 2)];
	const o = option(autoOptions(input(notes)), "folders");
	assert.ok(!queries(o).some((q) => q.includes("hi")));
	// The graph ignores letter case: each of the two spellings matches all four notes.
	assert.equal(o.items.find((i) => i.query === "path:Wiki/").ids.length, 4);
	const { total } = assign(o, new Set(queries(o)));
	assert.equal(total, 6);
}

// ---- tags: top level only, largest first, a rare one before the common one it shares notes with ----
{
	const notes = [...many("a", 6, ["work"]), ...many("b", 2, ["work", "urgent"]), ...many("c", 3, ["home"])];
	const ids = (tag) => notes.filter((n) => n.tags.includes(tag)).map((n) => n.id);
	const tags = [
		{ query: "tag:#work", ids: ids("work") },
		{ query: "tag:#urgent", ids: ids("urgent") },
		{ query: "tag:#home", ids: ids("home") },
		{ query: "tag:#work/deep", ids: [notes[0].id] },
	];
	const o = option(autoOptions(input(notes, { tags })), "tags");
	assert.deepEqual(queries(o), ["tag:#urgent", "tag:#work", "tag:#home"]);
	assert.deepEqual(listed(o).map((i) => i.query), ["tag:#work", "tag:#home", "tag:#urgent"]);
	const { counts, total } = assign(o, new Set(queries(o)));
	// A note with a common and a rare tag goes to the rare one.
	assert.equal(counts.get("tag:#urgent"), 2);
	assert.equal(counts.get("tag:#work"), 6);
	assert.equal(total, 11);
	// Switched off: its notes go to the next group that matches them.
	assert.equal(assign(o, new Set(["tag:#work", "tag:#home"])).counts.get("tag:#work"), 8);
	// Already a color group (written another way): not suggested again.
	const again = option(autoOptions(input(notes, { tags, existing: ["tag:#Work"] })), "tags");
	assert.deepEqual(queries(again), ["tag:#home", "tag:#urgent"]);
}

// ---- properties: one option per property, the widest first -----------------
{
	const notes = many("n", 10);
	const id = (i) => notes[i].id;
	const properties = [
		{ query: "[status:done]", ids: [0, 1, 2, 3].map(id) },
		{ query: "[status:idea]", ids: [4, 5].map(id) },
		{ query: "[type:book]", ids: [0, 1].map(id) },
		{ query: "[type:film]", ids: [2].map(id) },
		{ query: "[lonely:x]", ids: [9].map(id) },
	];
	const options = autoOptions(input(notes, { properties })).filter((o) => o.mode === "property");
	assert.deepEqual(options.map((o) => o.key), ["status", "type"]);
	// Values that share no notes: the largest first, as the legend will list them.
	assert.deepEqual(queries(options[0]), ["[status:done]", "[status:idea]"]);
}

// ---- tags that share notes in a chain: every rarer one before the commoner one ----
{
	const notes = many("n", 12);
	const id = (i) => notes[i].id;
	const tags = [
		{ query: "tag:#a", ids: [0, 1, 2, 3, 4, 5].map(id) },
		{ query: "tag:#b", ids: [4, 5, 6, 7].map(id) },
		{ query: "tag:#c", ids: [7, 8].map(id) },
		{ query: "tag:#d", ids: [9, 10, 11].map(id) },
	];
	const o = option(autoOptions(input(notes, { tags })), "tags");
	assert.deepEqual(queries(o), ["tag:#c", "tag:#b", "tag:#a", "tag:#d"]);
	const { counts, total } = assign(o, new Set(queries(o)));
	assert.deepEqual([counts.get("tag:#a"), counts.get("tag:#b"), counts.get("tag:#c"), counts.get("tag:#d")], [4, 3, 2, 3]);
	assert.equal(total, 12);
}

// ---- a graph that already has groups: only the notes without a color -------
{
	const notes = [...many("Projects", 5), ...many("Journal", 3), ...many("People", 2)];
	const free = new Set([...notes.slice(5).map((n) => n.id)]);
	const o = option(autoOptions(input(notes, { free, existing: ["path:Projects/"] })), "folders");
	assert.deepEqual(listed(o).map((i) => i.query), ["path:Journal/", "path:People/"]);
	assert.equal(assign(o, defaultChosen(o)).total, 5);
	// Nothing free at all: nothing to offer.
	assert.deepEqual(autoOptions(input(notes, { free: new Set() })), []);
}

// ---- the first choice ------------------------------------------------------
{
	// Folders cover everything, tags only a part.
	const notes = [...many("A", 4, ["x"]), ...many("B", 4), ...many("C", 2, ["y"])];
	const tags = [
		{ query: "tag:#x", ids: notes.slice(0, 4).map((n) => n.id) },
		{ query: "tag:#y", ids: notes.slice(8).map((n) => n.id) },
	];
	assert.equal(bestOption(autoOptions(input(notes, { tags }))).mode, "folders");
	// All notes in the root: tags are the only way.
	const flat = notes.map((n, i) => note(`n${i}.md`, n.tags));
	const flatTags = tags.map((t, k) => ({ query: t.query, ids: flat.filter((n) => n.tags.includes(k ? "y" : "x")).map((n) => n.id) }));
	assert.equal(bestOption(autoOptions(input(flat, { tags: flatTags }))).mode, "tags");
	assert.equal(bestOption([]), null);
}

// ---- no more than a dozen switched on --------------------------------------
{
	const notes = Array.from({ length: 20 }, (_x, i) => many(`f${String(i).padStart(2, "0")}`, 20 - i)).flat();
	const o = option(autoOptions(input(notes)), "folders");
	assert.equal(o.items.length, 20);
	const chosen = defaultChosen(o);
	assert.equal(chosen.size, 12);
	assert.ok(chosen.has("path:f00/") && chosen.has("path:f11/") && !chosen.has("path:f12/"));
}

// ---- colors ----------------------------------------------------------------
{
	const palette = [0x000075, 0xe6194b, 0xffe119, 0x3cb44b];
	const dark = 0x1e1e1e;
	const light = 0xffffff;
	assert.ok(contrast(0x000075, dark) < 2 && contrast(0xffe119, light) < 2);
	// Dark blue does not show on a dark background, yellow not on a white one.
	assert.equal(nextColor(palette, [], dark), 0xe6194b);
	assert.equal(nextColor(palette, [0xe6194b], dark), 0xffe119);
	assert.equal(nextColor(palette, [], light), 0x000075);
	assert.equal(nextColor(palette, [0x000075, 0xe6194b], light), 0x3cb44b);
	// The clear ones are used up: the rest of the palette, then new colors, never one twice.
	assert.equal(nextColor(palette, [0xe6194b, 0xffe119, 0x3cb44b], dark), 0x000075);
	const used = [...palette];
	for (let i = 0; i < 40; i++) {
		const c = nextColor(palette, used, dark);
		assert.ok(!used.includes(c), `color ${c.toString(16)} given twice`);
		assert.ok(contrast(c, dark) >= 2);
		used.push(c);
	}
}

// ---- colors that are hard to tell apart ------------------------------------
{
	const palette = [
		0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0xfabed4, 0x469990,
		0xdcbeff, 0x9a6324, 0x800000, 0xaaffc3, 0x808000, 0x000075,
	];
	const dark = 0x1e1e1e;
	const light = 0xffffff;
	assert.equal(colorDistance(0x123456, 0x123456), 0);
	assert.ok(colorDistance(0x000000, 0xffffff) > 0.99 && colorDistance(0x000000, 0xffffff) < 1.01);
	// Neighboring shades are similar; the same color is not (it has its own warning); clearly different ones are not.
	assert.ok(similarColors(0xe06c75, 0xe5707a));
	assert.ok(similarColors(0x339af0, 0x4dabf7));
	assert.ok(similarColors(0x800080, 0x8b008b));
	assert.ok(!similarColors(0xe6194b, 0xe6194b));
	assert.ok(!similarColors(0xff0000, 0xff6600));
	assert.ok(!similarColors(0x1e90ff, 0x4169e1));
	// No two colors of the palette are similar, so the plugin's own suggestions never raise the warning.
	for (const a of palette) for (const b of palette) assert.ok(!similarColors(a, b), `${a.toString(16)} ~ ${b.toString(16)}`);

	// A new group does not get a palette color that is hard to tell from one the graph already has.
	assert.ok(similarColors(0xe6194b, 0xe01f50));
	assert.equal(nextColor(palette, [0xe01f50], dark), 0x3cb44b);
	assert.equal(nextColor(palette, [0xe01f50, 0x3fb04e], dark), 0xffe119);
	// Nothing left that stands apart: still an unused color rather than none.
	const crowded = palette.map((c) => c ^ 0x010101);
	const c = nextColor(palette, crowded, dark);
	assert.ok(palette.includes(c));
	// New hues keep away from the colors in use while they can.
	const used = [...palette];
	for (let i = 0; i < 10; i++) {
		const n = nextColor(palette, used, dark);
		assert.ok(used.every((u) => !similarColors(u, n)), `new color ${n.toString(16)} is close to a used one`);
		used.push(n);
	}

	// "Pick a color that stands out": far from all the others, visible on the background, on both themes.
	for (const bg of [dark, light]) {
		const others = [0xe6194b, 0xe01f50, 0x3cb44b, 0x4363d8];
		const d = distinctColor(palette, others, bg);
		assert.ok(contrast(d, bg) >= 2);
		assert.ok(others.every((o) => !similarColors(o, d) && o !== d));
		assert.ok(Math.min(...others.map((o) => colorDistance(o, d))) > 0.15);
		// The whole palette taken: still a color that is none of them.
		const all = distinctColor(palette, palette, bg);
		assert.ok(!palette.includes(all) && contrast(all, bg) >= 2);
	}
	// With no other groups any visible color will do.
	assert.ok(contrast(distinctColor(palette, [], dark), dark) >= 2);
}

console.log("auto: ok");

// Plain red next to the palette's crimson is hard to tell apart on a graph and counts as similar;
// the closest pair of the built-in palette does not.
{
	assert.equal(similarColors(0xff0000, 0xe6194b), true);
	assert.equal(similarColors(0xfabed4, 0xdcbeff), false);
}

// The default colors of the rule for AI agents are exactly the palette colors that show on both themes.
{
	const palette = [0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0xfabed4, 0x469990, 0xdcbeff, 0x9a6324, 0x800000, 0xaaffc3, 0x808000, 0x000075];
	const both = visibleColors(visibleColors(palette, 0x1e1e1e), 0xffffff);
	assert.deepEqual(both, [0xe6194b, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0xf032e6, 0x469990, 0x9a6324, 0x808000]);
	assert.equal(visibleColors(palette, 0x1e1e1e).length, 15);
}
