/**
 * Texts meant for an AI agent that keeps the vault: the rule that makes it name the color groups it
 * adds, and the legend written out as plain text. Both are in English whatever the interface language:
 * the reader is the agent. Pure helpers (no Obsidian imports), so they can be unit-tested.
 */

/**
 * Colors of the built-in palette that show on a dark and on a light graph alike. The rule lists them when
 * the caller has no better list (the settings button passes the colors that show on the theme in use).
 */
export const RULE_COLORS = [0xe6194b, 0x3cb44b, 0x4363d8, 0xf58231, 0x911eb4, 0xf032e6, 0x469990, 0x9a6324, 0x808000];

/**
 * The rule for the agent's instructions file (AGENTS.md, CLAUDE.md and the like).
 * `colors` are offered to the agent in this order, each as the number graph.json stores and its hex code:
 * comparing numbers needs no judgment by eye, so a small model picks a free color as surely as a large one.
 */
export function agentRule(configDir: string, colors: number[] = RULE_COLORS): string {
	const list = colors.map((c) => `${c & 0xffffff} = ${hex(c)}`).join(", ");
	return [
		`When you add a color group to ${configDir}/graph.json:`,
		"1. Find or create the note that describes the group.",
		'2. In its front matter, add: graph-legend: "<query>" (the group\'s query from graph.json)',
		'3. For a short legend name, also add: graph-legend-name: "<name>"',
		`4. For its color ("rgb" in graph.json), take the first number of this list that no group has yet: ${list}. If all are taken, pick a color that is easy to tell apart from the others.`,
		"5. Put the group above every group that already matches some of the same notes: a note takes the color of the first group that matches it.",
		"6. Do not edit the Graph Color Legend plugin's data.json.",
	].join("\n");
}

export interface LegendTextRow {
	/** The name the legend shows; the query itself when the group has no name. */
	name: string;
	query: string;
	rgb: number;
	/** Notes of the graph the group colors now. */
	count: number;
}

function hex(rgb: number): string {
	return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0").toUpperCase();
}

function notes(n: number): string {
	return `${n} ${n === 1 ? "note" : "notes"}`;
}

/** One line of text: line breaks and backticks in a name or query would break the list. */
function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").replace(/`/g, "'").trim();
}

/**
 * The color groups of a graph as a numbered list, in the order the graph applies them.
 * `ungrouped` is the number of notes no group colors (null to leave the line out).
 */
export function legendText(local: boolean, rows: LegendTextRow[], ungrouped: number | null): string {
	const lines = [
		`Color groups of the Obsidian ${local ? "local graph" : "graph"}, in order. A note takes the color of the first group that matches it.`,
		"",
	];
	rows.forEach((row, i) => {
		const query = oneLine(row.query);
		const name = oneLine(row.name);
		const named = name !== "" && name !== query;
		lines.push(`${i + 1}. ${named ? name + ": " : ""}query \`${query}\`, color ${hex(row.rgb)}, ${notes(row.count)}`);
	});
	if (rows.length === 0) lines.push("(no color groups)");
	if (ungrouped !== null && ungrouped > 0) lines.push(`No group: ${notes(ungrouped)}`);
	return lines.join("\n");
}
