import { App, Menu, normalizePath, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, TFile, View } from "obsidian";
import {
	ColorGroup,
	getGraphPluginInstance,
	mergeRawGroups,
	normalizeGroups,
	rewriteLiveGroupQueries,
	rewriteRawGroups,
	setLiveGroupColor,
	readLiveGroups,
	setLiveGroups,
	setRawGroupColor,
} from "./graph-internals";
import { History, MAX_UNDO_BYTES, StepResult } from "./history";
import { PresetSuggestModal } from "./modals";
import { renameTagInNotes, RenameResult, TagUsage } from "./tag-rename";
import { Highlighter } from "./highlight";
import { t } from "./i18n";
import { labelFromQuery } from "./labels";
import { replaceTagInQuery } from "./tags";
import { ContentView, Legend, LegendSize, rgbToHex, SIZE_LIMITS } from "./legend";
import { collectLegendNotes } from "./attributes";

export type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";


export interface GraphColorLegendSettings {
	collapsed: boolean;
	position: Position;
	fontSize: number;
	opacity: number;
	highlight: boolean;
	showInLocalGraph: boolean;
	/** Extra legend sections: tags and properties of the notes in the graph. */
	showTags: boolean;
	showProperties: boolean;
	/** Collapsed legend sections ("tags", "properties"). */
	collapsedSections: string[];
	/** Custom names, keyed by the group's query. */
	names: Record<string, string>;
	/** Queries of hidden entries. */
	hidden: string[];
	/** Queries seen in the graph, for the settings list. */
	knownQueries: string[];
	/** Size of the legend, kept apart for the global and the local graph. */
	size: { graph: LegendSize | null; local: LegendSize | null };
	/** The legend can be turned off with a command; the graph then looks as without the plugin. */
	showLegend: boolean;
	/** Highlighting an entry also keeps the notes linked to it bright. */
	neighbors: boolean;
	/** Saved sets of color groups. */
	presets: Preset[];
	/** Own order of tags and properties in the legend (queries); entries not listed follow in the usual order. */
	order: { tags: string[]; properties: string[] };
}


interface GroupsSnapshot {
	globalGroups: ColorGroup[] | null;
	locals: { view: View; groups: ColorGroup[] }[];
}

export interface Preset {
	name: string;
	groups: ColorGroup[];
}

const MAX_PRESETS = 50;
const MAX_PRESET_GROUPS = 200;

const DEFAULT_SETTINGS: GraphColorLegendSettings = {
	collapsed: false,
	position: "top-left",
	fontSize: 13,
	opacity: 85,
	highlight: true,
	showInLocalGraph: true,
	showTags: true,
	showProperties: true,
	collapsedSections: ["properties"],
	names: {},
	hidden: [],
	knownQueries: [],
	size: { graph: null, local: null },
	showLegend: true,
	neighbors: false,
	presets: [],
	order: { tags: [], properties: [] },
};
// Note: DEFAULT_SETTINGS.names is never used directly; sanitizeSettings makes a fresh object.

const POSITIONS: Position[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Settings the settings tab edits directly (toggles, sliders, the corner). */
const CONTROL_KEYS = [
	"position",
	"fontSize",
	"opacity",
	"highlight",
	"showInLocalGraph",
	"showTags",
	"showProperties",
	"neighbors",
	"showLegend",
] as const;
type ControlKey = (typeof CONTROL_KEYS)[number];

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function sanitizeSize(v: unknown): LegendSize | null {
	if (typeof v !== "object" || v === null) return null;
	const d = v as Record<string, unknown>;
	const side = (x: unknown, min: number) =>
		typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(SIZE_LIMITS.max, Math.max(min, x))) : null;
	const w = side(d.w, SIZE_LIMITS.minW);
	const h = side(d.h, SIZE_LIMITS.minH);
	return w === null && h === null ? null : { w, h };
}

function sanitizePresets(v: unknown): Preset[] {
	if (!Array.isArray(v)) return [];
	const out: Preset[] = [];
	for (const p of v.slice(0, MAX_PRESETS)) {
		if (typeof p !== "object" || p === null) continue;
		const d = p as Record<string, unknown>;
		const name = typeof d.name === "string" ? d.name.trim().slice(0, 100) : "";
		if (!name || out.some((x) => x.name === name)) continue;
		const groups: ColorGroup[] = [];
		for (const g of Array.isArray(d.groups) ? d.groups.slice(0, MAX_PRESET_GROUPS) : []) {
			if (typeof g !== "object" || g === null) continue;
			const x = g as Record<string, unknown>;
			if (typeof x.query !== "string" || typeof x.rgb !== "number" || !Number.isFinite(x.rgb)) continue;
			const alpha = typeof x.alpha === "number" && Number.isFinite(x.alpha) ? Math.min(1, Math.max(0, x.alpha)) : 1;
			groups.push({ query: x.query.slice(0, 1000), rgb: Math.round(x.rgb) & 0xffffff, alpha });
		}
		out.push({ name, groups });
	}
	return out;
}

function stringList(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * data.json can come from a shared or synced vault, so every field is checked.
 * Names are kept in an object without a prototype, so a query such as "__proto__"
 * is an ordinary key.
 */
export function sanitizeSettings(raw: unknown): GraphColorLegendSettings {
	const d = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	const names = Object.create(null) as Record<string, string>;
	if (typeof d.names === "object" && d.names !== null && !Array.isArray(d.names)) {
		for (const [k, v] of Object.entries(d.names as Record<string, unknown>)) {
			if (typeof v === "string" && v.trim()) names[k] = v.slice(0, 200);
		}
	}
	return {
		collapsed: typeof d.collapsed === "boolean" ? d.collapsed : DEFAULT_SETTINGS.collapsed,
		position: POSITIONS.includes(d.position as Position) ? (d.position as Position) : DEFAULT_SETTINGS.position,
		fontSize: clampNumber(d.fontSize, 10, 20, DEFAULT_SETTINGS.fontSize),
		opacity: clampNumber(d.opacity, 30, 100, DEFAULT_SETTINGS.opacity),
		highlight: typeof d.highlight === "boolean" ? d.highlight : DEFAULT_SETTINGS.highlight,
		showInLocalGraph:
			typeof d.showInLocalGraph === "boolean" ? d.showInLocalGraph : DEFAULT_SETTINGS.showInLocalGraph,
		showTags: typeof d.showTags === "boolean" ? d.showTags : DEFAULT_SETTINGS.showTags,
		showProperties: typeof d.showProperties === "boolean" ? d.showProperties : DEFAULT_SETTINGS.showProperties,
		collapsedSections: Array.isArray(d.collapsedSections)
			? stringList(d.collapsedSections)
			: [...DEFAULT_SETTINGS.collapsedSections],
		names,
		hidden: stringList(d.hidden),
		knownQueries: stringList(d.knownQueries),
		size: (() => {
			const sz = (typeof d.size === "object" && d.size !== null ? d.size : {}) as Record<string, unknown>;
			return { graph: sanitizeSize(sz.graph), local: sanitizeSize(sz.local) };
		})(),
		showLegend: typeof d.showLegend === "boolean" ? d.showLegend : DEFAULT_SETTINGS.showLegend,
		neighbors: typeof d.neighbors === "boolean" ? d.neighbors : DEFAULT_SETTINGS.neighbors,
		presets: sanitizePresets(d.presets),
		order: (() => {
			const o = (typeof d.order === "object" && d.order !== null ? d.order : {}) as Record<string, unknown>;
			return { tags: stringList(o.tags).slice(0, 5000), properties: stringList(o.properties).slice(0, 5000) };
		})(),
	};
}

const GRAPH = "graph";
const LOCAL_GRAPH = "localgraph";
const TICK_MS = 700;

export default class GraphColorLegendPlugin extends Plugin {
	settings: GraphColorLegendSettings = sanitizeSettings(null);
	highlighter = new Highlighter();
	/** Groups from .obsidian/graph.json, used when the live graph state is not readable. */
	fileGroups: ColorGroup[] | null = null;
	private legends = new Map<ContentView, Legend>();
	/** Notes that give a legend entry its name (front matter `graph-legend`). */
	legendNotes = new Map<string, TFile>();
	private legendNotesTimer = 0;
	/** Undo and redo for the legend's changes; kept until Obsidian restarts. */
	history = new History(() => {
		for (const legend of this.legends.values()) legend.update();
	});

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new GraphColorLegendSettingTab(this.app, this));
		this.addCommands();

		this.app.workspace.onLayoutReady(async () => {
			this.legendNotes = collectLegendNotes(this.app);
			this.registerEvent(this.app.metadataCache.on("changed", () => this.queueLegendNotes()));
			this.registerEvent(this.app.vault.on("rename", () => this.queueLegendNotes()));
			this.registerEvent(this.app.vault.on("delete", () => this.queueLegendNotes()));
			await this.loadFileGroups();
			this.scan();
			this.registerEvent(this.app.workspace.on("layout-change", () => this.scan()));
			this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scan()));
			this.registerInterval(window.setInterval(() => this.tick(), TICK_MS));
		});
	}

	onunload(): void {
		window.clearTimeout(this.legendNotesTimer);
		this.openMenu?.hide();
		this.history.clear();
		for (const legend of this.legends.values()) legend.destroy();
		this.legends.clear();
		this.highlighter.destroy();
	}

	/** Own name from the plugin, then the note marked with `graph-legend`, then a name made from the query. */
	displayName(query: string): string {
		return this.settings.names[query] || this.legendNotes.get(query)?.basename || labelFromQuery(query) || "—";
	}

	private queueLegendNotes(): void {
		window.clearTimeout(this.legendNotesTimer);
		this.legendNotesTimer = window.setTimeout(() => {
			const next = collectLegendNotes(this.app);
			const same =
				next.size === this.legendNotes.size &&
				[...next].every(([q, f]) => this.legendNotes.get(q) === f && f.basename === this.legendNotes.get(q)?.basename);
			this.legendNotes = next;
			for (const legend of this.legends.values()) {
				legend.notesChanged();
				if (!same) legend.update(true);
			}
		}, 500);
	}

	private openMenu: Menu | null = null;

	/**
	 * Only one legend menu at a time. Obsidian closes a menu on a click outside it, but the legend
	 * keeps its clicks from reaching the graph, so a new right-click would otherwise stack menus.
	 */
	showMenu(menu: Menu, evt: MouseEvent): void {
		this.openMenu?.hide();
		this.openMenu = menu;
		menu.onHide(() => {
			if (this.openMenu === menu) this.openMenu = null;
		});
		menu.showAtMouseEvent(evt);
	}

	private addCommands(): void {
		const str = t();
		this.addCommand({
			id: "undo",
			name: str.cmdUndo,
			checkCallback: (checking) => {
				if (!this.history.canUndo) return false;
				if (!checking) void this.undo(this.activeLegend());
				return true;
			},
		});
		this.addCommand({
			id: "redo",
			name: str.cmdRedo,
			checkCallback: (checking) => {
				if (!this.history.canRedo) return false;
				if (!checking) void this.redo(this.activeLegend());
				return true;
			},
		});
		this.addCommand({
			id: "toggle-legend",
			name: str.cmdToggleLegend,
			callback: () => {
				this.settings.showLegend = !this.settings.showLegend;
				void this.saveSettingsAndRefresh();
			},
		});
		this.addCommand({
			id: "clear-highlights",
			name: str.clearSelection,
			callback: () => {
				for (const legend of this.legends.values()) legend.clearSelection();
			},
		});
		this.addCommand({
			id: "search-legend",
			name: str.cmdSearch,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || !this.settings.showLegend) return false;
				if (!checking) legend.openSearch();
				return true;
			},
		});
		this.addCommand({
			id: "toggle-only-highlighted",
			name: str.cmdFocus,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || !this.settings.highlight) return false;
				if (!checking) legend.toggleFocus();
				return true;
			},
		});
		this.addCommand({
			id: "toggle-neighbors",
			name: str.cmdNeighbors,
			callback: () => {
				this.settings.neighbors = !this.settings.neighbors;
				new Notice(this.settings.neighbors ? str.neighborsOn : str.neighborsOff, 3000);
				void this.saveSettingsAndRefresh();
			},
		});
		this.addCommand({
			id: "apply-preset",
			name: str.presetApply,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || this.settings.presets.length === 0) return false;
				if (!checking) {
					const choices = this.settings.presets.map((p) => ({ name: p.name, count: p.groups.length }));
					new PresetSuggestModal(this.app, choices, (name) => void this.applyPreset(legend, name)).open();
				}
				return true;
			},
		});
	}

	/** The legend of the graph the user works in now (or the only one that is visible). */
	activeLegend(): Legend | null {
		const view = this.app.workspace.getMostRecentLeaf()?.view;
		for (const legend of this.legends.values()) if (legend.view === view) return legend;
		const shown = [...this.legends.values()].filter((l) => l.view.containerEl.isShown());
		return shown.length === 1 ? (shown[0] ?? null) : null;
	}

	/**
	 * Replaces the color groups of a graph (new order, a new group, a preset) and offers to undo it.
	 * The global graph's groups are saved in the graph settings; a local graph keeps its own.
	 */
	async changeGroups(legend: Legend, next: ColorGroup[], label: string, message: string): Promise<void> {
		const prev = legend.currentGroups();
		const view = legend.view;
		const isLocal = legend.isLocal;
		const ok = await this.replaceGroups(view, isLocal, next);
		if (!ok) {
			new Notice(t().groupsFailed, 8000);
			return;
		}
		this.history.push({
			label,
			undo: async () => {
				await this.replaceGroups(view, isLocal, prev);
			},
			redo: async () => {
				await this.replaceGroups(view, isLocal, next);
			},
		});
		legend.flash(message, true);
	}

	/** Color of one group, from the color picker; quick changes of the same group are one step. */
	async changeGroupColor(query: string, prev: number, rgb: number): Promise<boolean> {
		const ok = await this.setGroupColor(query, rgb);
		if (!ok) return false;
		this.history.push({
			label: t().stepColor(this.displayName(query)),
			mergeKey: "color:" + query,
			undo: async () => {
				await this.setGroupColor(query, prev);
			},
			redo: async () => {
				await this.setGroupColor(query, rgb);
			},
		});
		return true;
	}

	/** Undo the last change and say so in the legend (or in a notice when no legend is at hand). */
	async undo(legend: Legend | null): Promise<void> {
		const done = await this.history.undo();
		if (done) this.report(legend, t().undone(done.step.label), done.result);
	}

	async redo(legend: Legend | null): Promise<void> {
		const done = await this.history.redo();
		if (done) this.report(legend, t().redone(done.step.label), done.result);
	}

	private report(legend: Legend | null, text: string, result: StepResult): void {
		const message = result.message ? `${text} ${result.message}` : text;
		if (legend) legend.flash(message, false, result.skipped);
		else new Notice(message, 4000);
	}

	/** Names, hidden entries and the order of tags and properties: what an undo of a legend setting restores. */
	legendState(): string {
		const s = this.settings;
		return JSON.stringify({ names: s.names, hidden: s.hidden, order: s.order });
	}

	async restoreLegendState(json: string): Promise<void> {
		const d = JSON.parse(json) as { names: Record<string, string>; hidden: string[]; order: GraphColorLegendSettings["order"] };
		const names = Object.create(null) as Record<string, string>;
		for (const [k, v] of Object.entries(d.names)) names[k] = v;
		this.settings.names = names;
		this.settings.hidden = [...d.hidden];
		this.settings.order = { tags: [...d.order.tags], properties: [...d.order.properties] };
		await this.saveSettingsAndRefresh();
	}

	/**
	 * Change legend settings (names, hidden entries, order) as one undoable step.
	 * With `flash`, the legend shows a short message with an Undo button.
	 */
	async recordSettings(
		label: string,
		mutate: () => void,
		opts: { legend?: Legend | null; flash?: string; mergeKey?: string } = {},
	): Promise<void> {
		const before = this.legendState();
		mutate();
		const after = this.legendState();
		if (before === after) return;
		this.history.push({
			label,
			mergeKey: opts.mergeKey,
			undo: () => this.restoreLegendState(before),
			redo: () => this.restoreLegendState(after),
		});
		await this.saveSettingsAndRefresh();
		if (opts.flash && opts.legend) opts.legend.flash(opts.flash, true);
	}

	private snapshotGroups(): GroupsSnapshot {
		const inst = getGraphPluginInstance(this.app);
		const stored = (inst?.options ? normalizeGroups(inst.options.colorGroups) : null) ?? this.fileGroups;
		const locals: GroupsSnapshot["locals"] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(LOCAL_GRAPH)) {
			if (leaf.isDeferred) continue;
			const groups = readLiveGroups(leaf.view);
			if (groups) locals.push({ view: leaf.view, groups });
		}
		return { globalGroups: stored ? stored.map((g) => ({ ...g })) : null, locals };
	}

	private async restoreGroups(snap: GroupsSnapshot): Promise<void> {
		if (snap.globalGroups) await this.replaceGroups(null, false, snap.globalGroups);
		for (const l of snap.locals) await this.replaceGroups(l.view, true, l.groups);
	}

	/**
	 * Puts notes back to the text they had: only notes whose text is still exactly what the plugin
	 * wrote are changed, so edits made after the rename are never lost.
	 */
	private async swapNotes(from: Map<string, string>, to: Map<string, string>): Promise<string[]> {
		const skipped: string[] = [];
		for (const [path, expected] of from) {
			const target = to.get(path);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (target === undefined || !(file instanceof TFile)) {
				skipped.push(path);
				continue;
			}
			let ok = false;
			try {
				await this.app.vault.process(file, (data) => {
					if (data !== expected) return data;
					ok = true;
					return target;
				});
			} catch {
				ok = false;
			}
			if (!ok) skipped.push(path);
		}
		return skipped;
	}

	/** Rename a tag in the notes and the graph groups, and keep what is needed to undo it. */
	async renameTagEverywhere(
		usage: TagUsage[],
		old: string,
		next: string,
		onProgress: (done: number, total: number) => void,
		legend: Legend | null,
	): Promise<{ result: RenameResult; graphUpdated: boolean; undoable: boolean }> {
		const str = t();
		const undoable = usage.reduce((sum, u) => sum + u.file.stat.size, 0) <= MAX_UNDO_BYTES;
		const before = new Map<string, string>();
		if (undoable) for (const u of usage) before.set(u.file.path, await this.app.vault.read(u.file));
		const groupsBefore = this.snapshotGroups();
		const stateBefore = this.legendState();

		const result = await renameTagInNotes(this.app, usage, old, next, onProgress);
		const graphUpdated = await this.renameTagInGraphGroups(old, next);
		if (!undoable) return { result, graphUpdated, undoable };

		const after = new Map<string, string>();
		for (const [path, text] of before) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const now = await this.app.vault.read(file);
			if (now !== text) after.set(path, now);
		}
		for (const path of [...before.keys()]) if (!after.has(path)) before.delete(path);
		const groupsAfter = this.snapshotGroups();
		const stateAfter = this.legendState();
		this.history.push({
			label: str.stepRenameTag(old, next, after.size),
			note: str.untilRestart,
			undo: async () => {
				const skipped = await this.swapNotes(after, before);
				await this.restoreGroups(groupsBefore);
				await this.restoreLegendState(stateBefore);
				return { skipped };
			},
			redo: async () => {
				const skipped = await this.swapNotes(before, after);
				await this.restoreGroups(groupsAfter);
				await this.restoreLegendState(stateAfter);
				return { skipped };
			},
		});
		legend?.flash(str.tagDone(old, next, result.changed), true);
		return { result, graphUpdated, undoable };
	}

	async replaceGroups(view: View | null, isLocal: boolean, next: ColorGroup[]): Promise<boolean> {
		let reached = false;
		if (isLocal) {
			reached = view !== null && setLiveGroups(view, next);
		} else {
			for (const leaf of this.app.workspace.getLeavesOfType(GRAPH)) {
				if (leaf.isDeferred) continue;
				if (setLiveGroups(leaf.view, next)) reached = true;
			}
			const inst = getGraphPluginInstance(this.app);
			if (inst?.options) {
				inst.options.colorGroups = mergeRawGroups(inst.options.colorGroups, next);
				if (typeof inst.saveOptions === "function") inst.saveOptions();
				reached = true;
			} else {
				try {
					const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
					const json = (await this.app.vault.adapter.exists(path))
						? (JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>)
						: {};
					json.colorGroups = mergeRawGroups(json.colorGroups, next);
					await this.app.vault.adapter.write(path, JSON.stringify(json, null, 2));
					reached = true;
				} catch {
					// leave reached as is
				}
			}
		}
		await this.loadFileGroups();
		for (const legend of this.legends.values()) legend.update(true);
		return reached;
	}

	async savePreset(name: string, groups: ColorGroup[]): Promise<void> {
		const list = this.settings.presets.filter((p) => p.name !== name);
		list.push({ name, groups: groups.map((g) => ({ ...g })) });
		this.settings.presets = list.slice(-MAX_PRESETS);
		await this.saveSettingsQuiet();
		new Notice(t().presetSaved(name), 4000);
	}

	async applyPreset(legend: Legend, name: string): Promise<void> {
		const preset = this.settings.presets.find((p) => p.name === name);
		if (!preset) return;
		await this.changeGroups(legend, preset.groups.map((g) => ({ ...g })), t().stepPreset(name), t().presetApplied(name));
	}

	rememberQueries(queries: string[]): void {
		const known = this.settings.knownQueries;
		if (queries.length === known.length && queries.every((q, i) => q === known[i])) return;
		this.settings.knownQueries = [...queries];
		void this.saveData(this.settings);
	}

	async loadSettings(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
	}

	/** Save without rebuilding the open legends (they pick changes up on the next tick). */
	async saveSettingsQuiet(): Promise<void> {
		await this.saveData(this.settings);
	}

	async saveSettingsAndRefresh(): Promise<void> {
		await this.saveData(this.settings);
		this.scan();
		for (const legend of this.legends.values()) legend.update(true);
	}

	/**
	 * After a tag rename: update color group queries in open graphs and in the saved
	 * graph settings, and move the plugin's own names to the new queries.
	 * Returns false if the graph settings could not be reached.
	 */
	async renameTagInGraphGroups(old: string, next: string): Promise<boolean> {
		const rewrite = (q: string) => replaceTagInQuery(q, old, next);
		let reached = false;

		for (const type of [GRAPH, LOCAL_GRAPH]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				if (leaf.isDeferred) continue;
				if (rewriteLiveGroupQueries(leaf.view, rewrite)) reached = true;
			}
		}

		const inst = getGraphPluginInstance(this.app);
		const stored = inst?.options ? rewriteRawGroups(inst.options.colorGroups, rewrite) : null;
		if (inst?.options && stored) {
			if (stored.changed) {
				inst.options.colorGroups = stored.groups;
				if (typeof inst.saveOptions === "function") inst.saveOptions();
			}
			reached = true;
		} else {
			// Graph core plugin not reachable: edit graph.json directly.
			try {
				const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
				if (await this.app.vault.adapter.exists(path)) {
					const json = JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>;
					const r = rewriteRawGroups(json.colorGroups, rewrite);
					if (r) {
						if (r.changed) {
							json.colorGroups = r.groups;
							await this.app.vault.adapter.write(path, JSON.stringify(json, null, 2));
						}
						reached = true;
					}
				}
			} catch {
				// leave reached as is
			}
		}

		// Keep custom names and hidden entries attached to the renamed queries.
		const s = this.settings;
		const names: Record<string, string> = Object.create(null) as Record<string, string>;
		for (const [q, n] of Object.entries(s.names)) names[rewrite(q)] = n;
		s.names = names;
		s.hidden = s.hidden.map(rewrite);
		s.knownQueries = s.knownQueries.map(rewrite);
		await this.loadFileGroups();
		await this.saveSettingsAndRefresh();
		return reached;
	}

	/**
	 * Change the color of one color group: in open graphs and in the saved graph settings,
	 * the same place as the graph's own Groups section. Returns false if the settings could not be reached.
	 */
	async setGroupColor(query: string, rgb: number): Promise<boolean> {
		let reached = false;
		for (const type of [GRAPH, LOCAL_GRAPH]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				if (leaf.isDeferred) continue;
				if (setLiveGroupColor(leaf.view, query, rgb)) reached = true;
			}
		}
		const inst = getGraphPluginInstance(this.app);
		const stored = inst?.options ? setRawGroupColor(inst.options.colorGroups, query, rgb) : null;
		if (inst?.options && stored) {
			if (stored.changed) {
				inst.options.colorGroups = stored.groups;
				if (typeof inst.saveOptions === "function") inst.saveOptions();
			}
			reached = true;
		} else {
			try {
				const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
				if (await this.app.vault.adapter.exists(path)) {
					const json = JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>;
					const r = setRawGroupColor(json.colorGroups, query, rgb);
					if (r) {
						if (r.changed) {
							json.colorGroups = r.groups;
							await this.app.vault.adapter.write(path, JSON.stringify(json, null, 2));
						}
						reached = true;
					}
				}
			} catch {
				// leave reached as is
			}
		}
		await this.loadFileGroups();
		for (const legend of this.legends.values()) legend.update(true);
		return reached;
	}

	private async loadFileGroups(): Promise<void> {
		try {
			const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
			if (!(await this.app.vault.adapter.exists(path))) return;
			const json = JSON.parse(await this.app.vault.adapter.read(path)) as { colorGroups?: unknown };
			this.fileGroups = normalizeGroups(json.colorGroups);
		} catch {
			this.fileGroups = null;
		}
	}

	private tick(): void {
		for (const legend of this.legends.values()) {
			if (legend.view.containerEl.isShown()) legend.update();
		}
	}

	/** Attach legends to graph views and drop the ones whose view is gone. */
	private scan(): void {
		const seen = new Set<ContentView>();
		const leaves = [
			...this.app.workspace.getLeavesOfType(GRAPH),
			...this.app.workspace.getLeavesOfType(LOCAL_GRAPH),
		];
		for (const leaf of leaves) {
			if (leaf.isDeferred) continue;
			const view = leaf.view as ContentView;
			if (!view.contentEl?.instanceOf(HTMLElement)) continue;
			const type = view.getViewType();
			if (type !== GRAPH && type !== LOCAL_GRAPH) continue;
			const isLocal = type === LOCAL_GRAPH;
			if (isLocal && !this.settings.showInLocalGraph) continue;
			seen.add(view);
			if (!this.legends.has(view)) this.legends.set(view, new Legend(this, view, isLocal));
		}
		for (const [view, legend] of this.legends) {
			if (!seen.has(view) || !view.contentEl.contains(legend.el)) {
				legend.destroy();
				this.legends.delete(view);
			}
		}
	}
}

class GraphColorLegendSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: GraphColorLegendPlugin,
	) {
		super(app, plugin);
	}

	/** Toggles, sliders and the dropdown, described once for both ways of drawing the tab. */
	private controls(): { key: ControlKey; name: string; desc: string; kind: "toggle" | "slider" | "dropdown"; min?: number; max?: number; step?: number }[] {
		const str = t();
		return [
			{ key: "position", name: str.position, desc: str.positionDesc, kind: "dropdown" },
			{ key: "fontSize", name: str.fontSize, desc: str.fontSizeDesc, kind: "slider", min: 10, max: 20, step: 1 },
			{ key: "opacity", name: str.opacity, desc: str.opacityDesc, kind: "slider", min: 30, max: 100, step: 5 },
			{ key: "highlight", name: str.highlight, desc: str.highlightDesc, kind: "toggle" },
			{ key: "showInLocalGraph", name: str.localGraph, desc: str.localGraphDesc, kind: "toggle" },
			{ key: "showTags", name: str.showTags, desc: str.showTagsDesc, kind: "toggle" },
			{ key: "showProperties", name: str.showProperties, desc: str.showPropertiesDesc, kind: "toggle" },
			{ key: "neighbors", name: str.neighbors, desc: str.neighborsDesc, kind: "toggle" },
			{ key: "showLegend", name: str.showLegend, desc: str.showLegendDesc, kind: "toggle" },
		];
	}

	private positions(): Record<string, string> {
		const str = t();
		return { "top-left": str.topLeft, "top-right": str.topRight, "bottom-left": str.bottomLeft, "bottom-right": str.bottomRight };
	}

	/**
	 * Obsidian 1.13 and later: settings described as data, so they show up in the settings search.
	 * Older versions ignore this method and call display() below.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const str = t();
		const s = this.plugin.settings;
		const items: SettingDefinitionItem[] = this.controls().map((c): SettingDefinitionItem => {
			const base = { name: c.name, desc: c.desc };
			if (c.kind === "toggle") return { ...base, control: { type: "toggle", key: c.key } };
			if (c.kind === "slider")
				return { ...base, control: { type: "slider", key: c.key, min: c.min ?? 0, max: c.max ?? 100, step: c.step ?? 1 } };
			return { ...base, control: { type: "dropdown", key: c.key, options: this.positions() } };
		});
		items.push({
			type: "list",
			heading: str.presets,
			emptyState: str.presetsEmpty,
			items: s.presets.map((preset) => ({
				name: preset.name,
				desc: str.presetGroups(preset.groups.length),
				render: (setting: Setting) => this.fillPreset(setting, preset, false),
			})),
			onDelete: (index: number) => {
				const preset = s.presets[index];
				if (preset) void this.deletePreset(preset);
			},
		});
		items.push({
			type: "group",
			heading: str.entries,
			items: [
				...this.entryQueries().map((q) => ({
					name: q || "—",
					desc: "",
					render: (setting: Setting) => this.fillEntry(setting, q),
				})),
				{ name: str.reset, desc: str.resetDesc, render: (setting: Setting) => this.fillReset(setting) },
			],
		});
		return items;
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		if (CONTROL_KEYS.includes(key as ControlKey) && typeof value === typeof s[key]) s[key] = value;
		return this.plugin.saveSettingsAndRefresh();
	}

	/** Draw the tab again after a list changed (new Obsidian redraws the definitions, old calls display()). */
	private redraw(): void {
		const tab = this as unknown as { update?: () => void };
		if (typeof tab.update === "function") tab.update();
		else this.display();
	}

	/** Obsidian before 1.13: the same settings drawn by hand. */
	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings as unknown as Record<ControlKey, unknown>;
		const str = t();
		containerEl.empty();

		for (const c of this.controls()) {
			const setting = new Setting(containerEl).setName(c.name).setDesc(c.desc);
			const save = async (v: unknown) => {
				await this.setControlValue(c.key, v);
			};
			if (c.kind === "toggle") setting.addToggle((tg) => tg.setValue(s[c.key] === true).onChange(save));
			else if (c.kind === "slider")
				setting.addSlider((sl) => sl.setLimits(c.min ?? 0, c.max ?? 100, c.step ?? 1).setValue(Number(s[c.key])).onChange(save));
			else setting.addDropdown((d) => d.addOptions(this.positions()).setValue(String(s[c.key])).onChange(save));
		}

		new Setting(containerEl).setName(str.presets).setDesc(str.presetsDesc).setHeading();
		if (this.plugin.settings.presets.length === 0) {
			containerEl.createEl("p", { cls: "setting-item-description", text: str.presetsEmpty });
		}
		for (const preset of this.plugin.settings.presets) {
			this.fillPreset(new Setting(containerEl).setDesc(str.presetGroups(preset.groups.length)), preset, true);
		}

		new Setting(containerEl).setName(str.entries).setDesc(str.entriesDesc).setHeading();
		const queries = this.entryQueries();
		if (queries.length === 0) {
			containerEl.createEl("p", { cls: "setting-item-description", text: str.entriesEmpty });
		}
		for (const q of queries) this.fillEntry(new Setting(containerEl).setName(q || "—"), q);
		this.fillReset(new Setting(containerEl).setName(str.reset).setDesc(str.resetDesc));
	}

	private entryQueries(): string[] {
		const s = this.plugin.settings;
		return s.knownQueries.length ? s.knownQueries : (this.plugin.fileGroups ?? []).map((g) => g.query);
	}

	private async deletePreset(preset: Preset): Promise<void> {
		const s = this.plugin.settings;
		s.presets = s.presets.filter((p) => p !== preset);
		await this.plugin.saveSettingsQuiet();
		this.redraw();
	}

	/** One saved set: its colors, its name (editable), and a delete button where the list has none. */
	private fillPreset(setting: Setting, preset: Preset, withDelete: boolean): void {
		const str = t();
		const s = this.plugin.settings;
		const dots = setting.nameEl.createSpan({ cls: "gcl-preset-dots" });
		for (const g of preset.groups.slice(0, 12)) {
			dots.createSpan({ cls: "gcl-swatch" }).setCssProps({ "--gcl-color": rgbToHex(g.rgb) });
		}
		setting.nameEl.prepend(dots);
		setting.addText((tx) =>
			tx.setValue(preset.name).onChange(async (v) => {
				const name = v.trim().slice(0, 100);
				if (!name || s.presets.some((p) => p !== preset && p.name === name)) return;
				preset.name = name;
				await this.plugin.saveSettingsQuiet();
			}),
		);
		if (withDelete) {
			setting.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip(str.presetDelete)
					.onClick(() => void this.deletePreset(preset)),
			);
		}
	}

	/** One legend entry: color, own name and the eye. */
	private fillEntry(setting: Setting, q: string): void {
		const str = t();
		const s = this.plugin.settings;
		const rgb = (this.plugin.fileGroups ?? []).find((g) => g.query === q)?.rgb;
		if (rgb !== undefined) {
			const sw = setting.nameEl.createSpan({ cls: "gcl-swatch gcl-settings-swatch" });
			sw.setCssProps({ "--gcl-color": rgbToHex(rgb) });
			setting.nameEl.prepend(sw);
		}
		setting
			.addText((tx) =>
				tx
					.setPlaceholder(labelFromQuery(q))
					.setValue(s.names[q] ?? "")
					.onChange(async (v) => {
						const value = v.trim();
						await this.plugin.recordSettings(
							str.stepRename(this.plugin.displayName(q)),
							() => {
								if (value) s.names[q] = value;
								else delete s.names[q];
							},
							{ mergeKey: "name:" + q },
						);
					}),
			)
			.addExtraButton((b) => {
				const paint = () => {
					const hidden = s.hidden.includes(q);
					b.setIcon(hidden ? "eye-off" : "eye").setTooltip(hidden ? str.show : str.hide);
				};
				paint();
				b.onClick(async () => {
					const wasHidden = s.hidden.includes(q);
					const name = this.plugin.displayName(q);
					await this.plugin.recordSettings(wasHidden ? str.stepShow(name) : str.stepHide(name), () => {
						if (wasHidden) s.hidden.remove(q);
						else s.hidden.push(q);
					});
					paint();
				});
			});
	}

	private fillReset(setting: Setting): void {
		const str = t();
		const s = this.plugin.settings;
		setting.addButton((b) => {
			b.setButtonText(str.resetButton).onClick(async () => {
				await this.plugin.recordSettings(str.stepResetNames, () => {
					s.names = Object.create(null) as Record<string, string>;
					s.hidden = [];
				});
				this.redraw();
			});
			// Red "destructive" look that works on every supported Obsidian version.
			b.buttonEl.addClass("mod-warning");
		});
	}
}
