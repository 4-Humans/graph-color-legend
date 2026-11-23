import assert from "node:assert/strict";
import { countAll, findAll, fold, looksLikeQuery, prepareQuery, snippets, sortHits } from "./search.bundle.mjs";

// Folding: lower case, "ё" as "е", the length never changes.
assert.equal(fold("Ёлка И ёж"), "елка и еж");
assert.equal(fold("ABC def"), "abc def");
for (const s of ["İstanbul", "ẞ straße", "ǅ", "ΟΔΟΣ", "Ёё", "á", "😀 Смайл", ""]) assert.equal(fold(s).length, s.length, s);

// The query: trimmed, folded, at least two characters.
assert.equal(prepareQuery("  Ёж "), "еж");
assert.equal(prepareQuery("a"), "");
assert.equal(prepareQuery("  "), "");
assert.equal(prepareQuery("x".repeat(500)).length, 200);

// Finding: part of a word counts, matches do not overlap, the limit holds.
assert.deepEqual(findAll(fold("Гольфкар и гольф"), "гольф"), [0, 11]);
assert.deepEqual(findAll("aaaa", "aa"), [0, 2]);
assert.deepEqual(findAll("abc", ""), []);
assert.equal(countAll("ab ".repeat(50), "ab", 10), 10);
assert.equal(countAll(fold("Тёплый тЕплый теплый"), prepareQuery("ТЁПЛЫЙ")), 3);
// Typed as is: quotes, colons and dashes are plain characters.
assert.equal(countAll(fold('see "tag:#work" - done'), prepareQuery('"tag:#work" -')), 1);

// Snippets: one per line, every match in the shown part marked, the place of the first match kept.
const text = "# Title\r\nFirst line here\r\n" + "x".repeat(100) + " NEEDLE " + "y".repeat(100) + "\nlast needle and Needle";
const [s, , none] = snippets(text, "needle", 5, 10);
const s2 = snippets(text, "needle", 5)[1];
assert.equal(none, undefined);
assert.deepEqual(s.parts, [{ text: "…" + "x".repeat(9) + " ", hit: false }, { text: "NEEDLE", hit: true }, { text: " " + "y".repeat(9) + "…", hit: false }]);
assert.deepEqual([s.line, s.ch, s.length, s.matches], [2, 101, 6, 1]);
assert.deepEqual(s2.parts, [{ text: "last ", hit: false }, { text: "needle", hit: true }, { text: " and ", hit: false }, { text: "Needle", hit: true }]);
assert.deepEqual([s2.line, s2.ch, s2.matches], [3, 5, 2]);
// A whole short line: no dots, no line break characters.
const [one] = snippets("a\r\nfind me now\r\nb", "me", 3);
assert.deepEqual([one.parts.map((x) => x.text).join("|"), one.line, one.ch], ["find |me| now", 1, 5]);
// The limit counts lines; matches past the shown part of a long line are counted, not shown.
assert.equal(snippets("кот\nкот\nкот", "кот", 2).length, 2);
const [far] = snippets("кот " + "z".repeat(200) + " кот", "кот", 1, 10);
assert.deepEqual([far.matches, far.parts.filter((x) => x.hit).length, far.parts[far.parts.length - 1].text.endsWith("…")], [2, 1, true]);
// Runs of spaces and tabs are shown as one space; the original letters are kept.
assert.deepEqual(snippets("a \t  b  HiT   c", "hit", 1)[0].parts.map((x) => x.text), ["a b ", "HiT", " c"]);
assert.deepEqual(snippets("Кот. КОТ! кот?", "кот", 2)[0].parts.filter((x) => x.hit).map((x) => x.text), ["Кот", "КОТ", "кот"]);
assert.deepEqual(snippets("abc", "", 3), []);

// A hint for queries meant for Obsidian's own search; plain text gets none.
for (const q of ["tag:#work", "path:Projects", "file:plan line:(a b)", "-tag:#x", "cats OR dogs", "/\\d+/", "[status:done]", "task-todo:buy"]) assert.equal(looksLikeQuery(q), true, q);
for (const q of ["гольфкар", "cats or dogs", "status: done", "a/b", "see [1] here", "10:30", "x", "OR"]) assert.equal(looksLikeQuery(q), false, q);

// More matches first, then by path.
assert.deepEqual(
	sortHits([{ path: "b", count: 1, inName: false }, { path: "a", count: 1, inName: true }, { path: "c", count: 5, inName: false }]).map((h) => h.path),
	["c", "a", "b"],
);

console.log("search tests passed");
