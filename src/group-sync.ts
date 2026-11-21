/**
 * Comparing two sets of color groups, for changes made to the graph's settings file outside Obsidian
 * (an AI agent, sync, a text editor). Pure functions, so they can be tested without Obsidian.
 *
 * The rule: whatever adds or changes groups is applied at once; groups that disappear wait for the
 * person, because a removal nobody noticed cannot be undone later.
 */

export interface Group {
	query: string;
	rgb: number;
	alpha: number;
}

/** A group that disappeared, with the place it had, so it can be put back there. */
export interface RemovedGroup {
	group: Group;
	index: number;
}

export interface GroupsDiff {
	/** Groups that are new (by query), changed groups not counted. */
	added: number;
	/** Groups whose query, color or place changed. */
	changed: number;
	removed: RemovedGroup[];
}

export function groupsKey(list: Group[]): string {
	return JSON.stringify(list.map((g) => [g.query, g.rgb, g.alpha]));
}

/**
 * What changed from `before` to `after`. Groups are matched by query; a group that kept its place and
 * its color but got a new query (a renamed tag, an edited query) counts as changed, not as removed.
 */
export function diffGroups(before: Group[], after: Group[]): GroupsDiff {
	const usedAfter = new Set<number>();
	const matchedBefore = new Set<number>();
	let changed = 0;

	before.forEach((g, i) => {
		const j = after.findIndex((x, k) => !usedAfter.has(k) && x.query === g.query);
		if (j < 0) return;
		usedAfter.add(j);
		matchedBefore.add(i);
		const a = after[j];
		if (a && (a.rgb !== g.rgb || a.alpha !== g.alpha || i !== j)) changed++;
	});

	const removed: RemovedGroup[] = [];
	before.forEach((g, i) => {
		if (matchedBefore.has(i)) return;
		const same = after[i];
		if (same && !usedAfter.has(i) && same.rgb === g.rgb) {
			// Same place, same color, new query: an edit.
			usedAfter.add(i);
			changed++;
			return;
		}
		removed.push({ group: { ...g }, index: i });
	});

	const added = after.length - usedAfter.size;
	return { added, changed, removed };
}

/** `groups` with the kept groups put back at their old places (or at the end). Queries already there are skipped. */
export function withKept(groups: Group[], kept: RemovedGroup[]): Group[] {
	const out = groups.map((g) => ({ ...g }));
	const sorted = [...kept].sort((a, b) => a.index - b.index);
	for (const r of sorted) {
		if (out.some((g) => g.query === r.group.query)) continue;
		out.splice(Math.min(Math.max(0, r.index), out.length), 0, { ...r.group });
	}
	return out;
}

/** Adds newly removed groups to the waiting list, without repeating a query. */
export function addPending(pending: RemovedGroup[], removed: RemovedGroup[]): RemovedGroup[] {
	const out = pending.map((r) => ({ group: { ...r.group }, index: r.index }));
	for (const r of removed) {
		if (!out.some((x) => x.group.query === r.group.query)) out.push({ group: { ...r.group }, index: r.index });
	}
	return out;
}
