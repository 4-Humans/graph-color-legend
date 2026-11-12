import assert from "node:assert/strict";
import { matchNotes, parseQuery } from "./query.bundle.mjs";

const notes = [
	{ id: "a.md", path: "wiki/a.md", name: "a.md", tags: ["tools", "tools/voice"], frontmatter: { stage: "idea", tags: ["tools"] } },
	{ id: "b.md", path: "wiki/topics/b.md", name: "b.md", tags: ["tools"], frontmatter: { stage: ["project", "x"] } },
	{ id: "c.md", path: "notes/c.md", name: "Cat note.md", tags: [], frontmatter: null },
];
const ids = (q) => {
	const m = matchNotes(q, notes);
	return m === null ? null : [...m].sort();
};
assert.deepEqual(ids("tag:#tools"), ["a.md", "b.md"]);
assert.deepEqual(ids("tag:#tools tag:#voice"), []);
assert.deepEqual(ids("tag:#tools/voice"), ["a.md"]);
assert.deepEqual(ids("#tools -tag:#tools/voice"), ["b.md"]);
assert.deepEqual(ids("[stage:idea]"), ["a.md"]);
assert.deepEqual(ids("[stage:project]"), ["b.md"]);
assert.deepEqual(ids("[stage]"), ["a.md", "b.md"]);
assert.deepEqual(ids('path:"wiki/topics"'), ["b.md"]);
assert.deepEqual(ids("file:cat"), ["c.md"]);
assert.equal(ids("tools OR voice"), null);
assert.equal(ids("(tag:#a)"), null);
assert.equal(ids("plain words"), null);
assert.equal(ids(""), null);
assert.equal(ids("[broken"), null);
assert.equal(parseQuery("x".repeat(600)), null);
// Linear on crafted input.
const t0 = performance.now();
for (let i = 0; i < 200; i++) parseQuery("[".repeat(250) + '"'.repeat(249));
assert.ok(performance.now() - t0 < 2000);
console.log("all query tests passed");
