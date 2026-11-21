import assert from "node:assert/strict";
import { entriesFromFrontmatter, rewriteQueriesInFrontmatter, setNameInFrontmatter } from "./notes.bundle.mjs";

// Reading
assert.deepEqual(entriesFromFrontmatter({ "graph-legend": "tag:#work" }), [{ query: "tag:#work", name: null }]);
assert.deepEqual(entriesFromFrontmatter({ "graph-legend": "tag:#work", "graph-legend-name": " Work " }), [{ query: "tag:#work", name: "Work" }]);
assert.deepEqual(
	entriesFromFrontmatter({ "graph-legend": ["tag:#a", "tag:#b"], "graph-legend-name": ["A", ""] }),
	[{ query: "tag:#a", name: "A" }, { query: "tag:#b", name: null }],
);
// One name for two queries is ambiguous: ignored.
assert.deepEqual(
	entriesFromFrontmatter({ "graph-legend": ["tag:#a", "tag:#b"], "graph-legend-name": "X" }).map((e) => e.name),
	[null, null],
);
assert.deepEqual(entriesFromFrontmatter(null), []);
assert.deepEqual(entriesFromFrontmatter({ "graph-legend": 5 }), []);

// Writing, matched by meaning
let fm = { "graph-legend": "tag:#Work" };
assert.equal(setNameInFrontmatter(fm, "#work", "Работа"), true);
assert.equal(fm["graph-legend-name"], "Работа");
assert.equal(setNameInFrontmatter(fm, "#work", null), true);
assert.equal("graph-legend-name" in fm, false);
assert.equal(setNameInFrontmatter(fm, "tag:#other", "x"), false);

fm = { "graph-legend": ["tag:#a", "tag:#b"] };
setNameInFrontmatter(fm, "tag:#b", "B");
assert.deepEqual(fm["graph-legend-name"], ["", "B"]);
setNameInFrontmatter(fm, "tag:#a", "A");
assert.deepEqual(fm["graph-legend-name"], ["A", "B"]);
setNameInFrontmatter(fm, "tag:#a", "");
setNameInFrontmatter(fm, "tag:#b", null);
assert.equal("graph-legend-name" in fm, false);

// Tag rename follows into graph-legend
fm = { "graph-legend": "tag:#old tag:#x" };
assert.equal(rewriteQueriesInFrontmatter(fm, (q) => q.replace("#old", "#new")), true);
assert.equal(fm["graph-legend"], "tag:#new tag:#x");
fm = { "graph-legend": ["tag:#old", "tag:#y"] };
assert.equal(rewriteQueriesInFrontmatter(fm, (q) => q.replace("#old", "#new")), true);
assert.deepEqual(fm["graph-legend"], ["tag:#new", "tag:#y"]);
assert.equal(rewriteQueriesInFrontmatter(fm, (q) => q), false);

console.log("all note name tests passed");
