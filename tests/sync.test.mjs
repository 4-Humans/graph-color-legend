import assert from "node:assert/strict";
import { addPending, diffGroups, groupsKey, withKept } from "./sync.bundle.mjs";

const g = (query, rgb = 1, alpha = 1) => ({ query, rgb, alpha });
const A = g("tag:#a", 10), B = g("tag:#b", 20), C = g("tag:#c", 30), D = g("tag:#d", 40);

// Nothing changed
assert.deepEqual(diffGroups([A, B], [A, B]), { added: 0, changed: 0, removed: [] });

// Added at the end, added in the middle (the others moved: changed)
assert.deepEqual(diffGroups([A, B], [A, B, C]), { added: 1, changed: 0, removed: [] });
assert.deepEqual(diffGroups([A, B], [A, C, B]), { added: 1, changed: 1, removed: [] });

// New color, new place
assert.deepEqual(diffGroups([A, B], [A, g("tag:#b", 99)]), { added: 0, changed: 1, removed: [] });
assert.deepEqual(diffGroups([A, B], [B, A]), { added: 0, changed: 2, removed: [] });

// Removed: with its old place
assert.deepEqual(diffGroups([A, B, C], [A, C]), { added: 0, changed: 1, removed: [{ group: B, index: 1 }] });
assert.deepEqual(diffGroups([A, B], []).removed.map((r) => r.index), [0, 1]);

// A renamed tag: same place and color, new query, is an edit, not a removal
assert.deepEqual(diffGroups([A, B], [A, g("tag:#b2", 20)]), { added: 0, changed: 1, removed: [] });
// Same place, other color, new query: one removed, one added
assert.deepEqual(diffGroups([A, B], [A, g("tag:#x", 77)]), { added: 1, changed: 0, removed: [{ group: B, index: 1 }] });

// Duplicated queries are matched one to one
assert.deepEqual(diffGroups([A, A], [A]).removed.length, 1);

// Kept groups go back to their places
assert.deepEqual(withKept([A, C], [{ group: B, index: 1 }]), [A, B, C]);
assert.deepEqual(withKept([A], [{ group: C, index: 2 }, { group: B, index: 1 }]), [A, B, C]);
assert.deepEqual(withKept([], [{ group: D, index: 7 }]), [D]);
// Already back in the file: not doubled
assert.deepEqual(withKept([A, B], [{ group: B, index: 1 }]), [A, B]);
// The input is not changed
const list = [A];
withKept(list, [{ group: B, index: 0 }]);
assert.deepEqual(list, [A]);

// Waiting list: no query twice
assert.deepEqual(addPending([{ group: B, index: 1 }], [{ group: B, index: 3 }, { group: C, index: 2 }]), [
	{ group: B, index: 1 },
	{ group: C, index: 2 },
]);

// The key tells sets apart by query, color, opacity and order
assert.notEqual(groupsKey([A, B]), groupsKey([B, A]));
assert.notEqual(groupsKey([A]), groupsKey([g("tag:#a", 10, 0.5)]));
assert.equal(groupsKey([A]), groupsKey([{ ...A }]));

// Round trip: what diffGroups reports removed, withKept puts back exactly
for (let n = 0; n < 500; n++) {
	const all = [A, B, C, D].filter(() => Math.random() < 0.8);
	const after = all.filter(() => Math.random() < 0.6);
	const { removed } = diffGroups(all, after);
	assert.deepEqual(withKept(after, removed), all, JSON.stringify({ all, after }));
}

console.log("sync tests passed");
