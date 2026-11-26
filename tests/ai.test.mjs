import assert from "node:assert/strict";
import { agentRule, legendText, RULE_COLORS } from "./ai.bundle.mjs";

// The rule names the vault's own settings folder, the two properties the legend reads, and the colors to take.
{
	const rule = agentRule(".obsidian");
	assert.ok(rule.startsWith("When you add a color group to .obsidian/graph.json:"));
	assert.ok(rule.includes('graph-legend: "<query>"'));
	assert.ok(rule.includes('graph-legend-name: "<name>"'));
	assert.ok(rule.includes("data.json"));
	assert.ok(rule.includes("first group that matches it"));
	assert.equal(rule.split("\n").length, 7);
	assert.ok(agentRule(".config").startsWith("When you add a color group to .config/graph.json:"));
	// Each color as the number graph.json stores, then its hex code; the first one is the palette's crimson.
	assert.ok(rule.includes("take the first number of this list that no group has yet: 15079755 = #E6194B, 3978315 = #3CB44B, "));
	for (const c of RULE_COLORS) assert.ok(rule.includes(`${c} = #${c.toString(16).padStart(6, "0").toUpperCase()}`));
	// The caller's own list (the colors that show on the theme in use) replaces the default one, in its order.
	const own = agentRule(".obsidian", [0xffe119, 0x000075]);
	assert.ok(own.includes("no group has yet: 16769305 = #FFE119, 117 = #000075. If all are taken"));
	assert.ok(!own.includes("15079755"));
}

// The legend as text: groups in order, with name, query, color and count.
{
	const text = legendText(
		false,
		[
			{ name: "Meetings", query: "tag:#work tag:#meeting", rgb: 0xe6194b, count: 12 },
			{ name: "path:Journal/", query: "path:Journal/", rgb: 0x00ff0a, count: 1 },
		],
		5,
	);
	assert.deepEqual(text.split("\n"), [
		"Color groups of the Obsidian graph, in order. A note takes the color of the first group that matches it.",
		"",
		"1. Meetings: query `tag:#work tag:#meeting`, color #E6194B, 12 notes",
		"2. query `path:Journal/`, color #00FF0A, 1 note",
		"No group: 5 notes",
	]);
}
// A local graph says so; no groups and no grey notes are said plainly; odd characters cannot break the list.
{
	assert.ok(legendText(true, [], null).startsWith("Color groups of the Obsidian local graph"));
	assert.ok(legendText(true, [], 0).endsWith("(no color groups)"));
	const text = legendText(false, [{ name: "a\nb `c`", query: "tag:#x\n2. fake", rgb: 0x1000000 + 0x0000ff, count: 0 }], null);
	assert.equal(text.split("\n").length, 3);
	assert.ok(text.endsWith("1. a b 'c': query `tag:#x 2. fake`, color #0000FF, 0 notes"));
}

console.log("ai: ok");
