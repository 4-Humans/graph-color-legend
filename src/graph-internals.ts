/**
 * Everything that touches the graph view's internal (undocumented) state lives here.
 * Each access is checked, so a change in a future Obsidian version makes the
 * related feature switch off instead of throwing.
 *
 * Checked against Obsidian 1.15.0:
 *   view.dataEngine (global graph) or view.engine (local graph)
 *   engine.colorGroupOptions.getColoredQueries(): { query, color: { a, rgb } }[]
 *   view.renderer.nodes[]: { id, type, color: { a, rgb } | null, circle, text, render() }
 *   view.renderer.links[]: { source, target, line, arrow, render() }
 *   view.renderer.changed()
 */
import type { View } from "obsidian";

export interface ColorGroup {
	query: string;
	rgb: number;
	alpha: number;
}

interface GraphColor {
	a: number;
	rgb: number;
}

interface DisplayObject {
	alpha: number;
}

export interface GraphNode {
	id: string;
	type: string;
	color: GraphColor | null;
	renderer: GraphRenderer;
	circle?: DisplayObject | null;
	text?: DisplayObject | null;
	render(): void;
}

export interface GraphLink {
	source: GraphNode;
	target: GraphNode;
	renderer: GraphRenderer;
	line?: DisplayObject | null;
	arrow?: DisplayObject | null;
	render(): void;
}

export interface GraphRenderer {
	nodes: GraphNode[];
	links: GraphLink[];
	changed(): void;
}

interface ColorGroupOptions {
	getColoredQueries(): { query: string; color: GraphColor | null }[];
}

interface GraphEngine {
	colorGroupOptions?: ColorGroupOptions;
}

type GraphLikeView = View & {
	dataEngine?: GraphEngine;
	engine?: GraphEngine;
	renderer?: GraphRenderer;
};

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

export function normalizeGroups(raw: unknown): ColorGroup[] | null {
	if (!Array.isArray(raw)) return null;
	const out: ColorGroup[] = [];
	for (const g of raw) {
		if (!isObject(g)) continue;
		const query = typeof g.query === "string" ? g.query : "";
		const color = isObject(g.color) ? g.color : null;
		if (!color || typeof color.rgb !== "number") continue;
		const alpha = typeof color.a === "number" ? color.a : 1;
		out.push({ query, rgb: color.rgb, alpha });
	}
	return out;
}

/** Color groups as currently shown in the graph's own settings panel. */
export function readLiveGroups(view: View): ColorGroup[] | null {
	try {
		const v = view as GraphLikeView;
		const engine = v.dataEngine ?? v.engine;
		const opts = engine?.colorGroupOptions;
		if (!opts || typeof opts.getColoredQueries !== "function") return null;
		return normalizeGroups(opts.getColoredQueries());
	} catch {
		return null;
	}
}

export function getRenderer(view: View): GraphRenderer | null {
	const r = (view as GraphLikeView).renderer;
	if (!isObject(r)) return null;
	if (!Array.isArray(r.nodes) || !Array.isArray(r.links) || typeof r.changed !== "function") return null;
	return r;
}

/** Fill color of a node as an RGB integer, or null if it has no group color. */
export function nodeRgb(node: GraphNode): number | null {
	const c = node.color;
	return isObject(c) && typeof c.rgb === "number" ? c.rgb : null;
}

interface WritableColorGroupOptions extends ColorGroupOptions {
	setColorQueries(groups: { query: string; color: GraphColor | null }[]): void;
}

interface GraphPluginInstance {
	options?: { colorGroups?: unknown };
	saveOptions?: () => void;
}

/**
 * Rewrites the color group queries of an open graph view (global or local).
 * The view saves its own settings after that. Returns true if something changed.
 */
export function rewriteLiveGroupQueries(view: View, rewrite: (q: string) => string): boolean {
	try {
		const v = view as GraphLikeView & { dataEngine?: { updateSearch?: () => void }; engine?: { updateSearch?: () => void } };
		const engine = (v.dataEngine ?? v.engine);
		const opts = engine?.colorGroupOptions as WritableColorGroupOptions | undefined;
		if (!opts || typeof opts.getColoredQueries !== "function" || typeof opts.setColorQueries !== "function") return false;
		const groups = opts.getColoredQueries();
		let changed = false;
		const next = groups.map((g) => {
			const q = rewrite(g.query);
			if (q !== g.query) changed = true;
			return { query: q, color: g.color };
		});
		if (!changed) return false;
		opts.setColorQueries(next);
		if (typeof engine?.updateSearch === "function") engine.updateSearch();
		return true;
	} catch {
		return false;
	}
}

/** The core graph plugin's stored options (what graph.json holds), if reachable. */
export function getGraphPluginInstance(app: unknown): GraphPluginInstance | null {
	try {
		const a = app as { internalPlugins?: { getPluginById?: (id: string) => { instance?: unknown } | null } };
		const inst = a.internalPlugins?.getPluginById?.("graph")?.instance;
		return isObject(inst) ? (inst) : null;
	} catch {
		return null;
	}
}

/** Rewrites queries in a raw colorGroups array (as stored in graph.json). */
export function rewriteRawGroups(raw: unknown, rewrite: (q: string) => string): { groups: unknown[]; changed: boolean } | null {
	if (!Array.isArray(raw)) return null;
	let changed = false;
	const groups = raw.map((g: unknown) => {
		if (!isObject(g) || typeof g.query !== "string") return g;
		const q = rewrite(g.query);
		if (q === g.query) return g;
		changed = true;
		return { ...g, query: q };
	});
	return { groups, changed };
}
