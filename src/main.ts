import { App, Menu, normalizePath, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, TFile, View } from "obsidian";
import {
	ColorGroup,
	getGraphPluginInstance,
	mergeRawGroups,
	normalizeGroups,
	rewriteLiveGroupQueries,
	UNGROUPED,
	rewriteRawGroups,
	setLiveGroupColor,
	readLiveGroups,
	setLiveGroups,
	setRawGroupColor,
} from "./graph-internals";
import { History, MAX_UNDO_BYTES, StepResult } from "./history";
import { PALETTE, PresetSuggestModal } from "./modals";
import { renameTagInNotes, RenameResult, TagUsage } from "./tag-rename";
import { Highlighter } from "./highlight";
import { t } from "./i18n";
import { agentRule } from "./ai-text";
import { visibleColors } from "./auto-groups";
import { labelFromQuery } from "./labels";
import { replaceTagInQuery } from "./tags";
import { ContentView, graphBackground, Legend, LegendSize, rgbToHex, SIZE_LIMITS } from "./legend";
import { collectLegendNotes, LegendNote } from "./attributes";
import { entriesFromFrontmatter, rewriteQueriesInFrontmatter, setNameInFrontmatter } from "./note-names";
import { queryKey } from "./query-match";
import { addPending, diffGroups, groupsKey, RemovedGroup, withKept } from "./group-sync";
import { RemovedGroupsModal } from "./removed-modal";
import { NoteSearch } from "./note-search";

export type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "free";
export type LegendStyle = "list" | "compact";
export type SearchScope = "graph" | "all";
/** Where a moved legend stands: its top-left corner as a share of the graph's width and height. */
export interface LegendOffset {
	x: number;
	y: number;
}


export interface GraphColorLegendSettings {
	collapsed: boolean;
	position: Position;
	fontSize: number;
	opacity: number;
	highlight: boolean;
	showInLocalGraph: boolean;
	/** Color groups with no nodes in the graph are left out of the legend (still shown in edit mode and search). */
	hideEmpty: boolean;
	/** A last row for the nodes that no color group colors (grey on the graph). */
	showUngrouped: boolean;
	/** The legend's search box also looks in the text of the notes. */
	searchText: boolean;
	/** Where that search looks: in the notes drawn on the graph, or in all notes of the vault. */
	searchScope: SearchScope;
	/** Extra legend sections: tags and properties of the notes in the graph. */
	showTags: boolean;
	showProperties: boolean;
	/** One more section: the folders the notes of the graph lie in. */
	showFolders: boolean;
	/** Collapsed legend sections ("tags", "properties", "folders"). */
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
	/** Automatic copy of the global graph's color groups, offered back when they all disappear. */
	groupsBackup: ColorGroup[];
	/** The global graph's color groups as the plugin last saw them agreed on; null before the first look. */
	knownGroups: ColorGroup[] | null;
	/** Groups removed from graph.json outside Obsidian, kept on the graph until the person decides. */
	pendingRemoved: RemovedGroup[];
	/** Own order of tags, properties and folders in the legend (queries); entries not listed follow in the usual order. */
	order: { tags: string[]; properties: string[]; folders: string[] };
	/** List: roomy rows. Compact: tight rows, for many groups or small screens. */
	style: LegendStyle;
	/** Place of the legend moved by its title (position "free"), kept apart for the global and the local graph. */
	offset: { graph: LegendOffset | null; local: LegendOffset | null };
	/** A graph without color groups gets an offer to color it; "Not needed" turns the offer off. */
	autoOffer: boolean;
	/** The graph node under the pointer lights up its row in the legend. */
	nodeHover: boolean;
	/** A local graph without color groups gets an offer to use the global graph's; "Not needed" turns it off. */
	localOffer: boolean;
	/** A local graph that opens without color groups of its own gets the global graph's by itself. */
	localAuto: boolean;
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
	hideEmpty: true,
	showUngrouped: true,
	searchText: true,
	searchScope: "graph",
	showTags: true,
	showProperties: true,
	showFolders: true,
	collapsedSections: ["properties", "folders"],
	names: {},
	hidden: [],
	knownQueries: [],
	size: { graph: null, local: null },
	showLegend: true,
	neighbors: false,
	presets: [],
	groupsBackup: [],
	knownGroups: null,
	pendingRemoved: [],
	order: { tags: [], properties: [], folders: [] },
	style: "list",
	offset: { graph: null, local: null },
	autoOffer: true,
	nodeHover: true,
	localOffer: true,
	localAuto: false,
};
// Note: DEFAULT_SETTINGS.names is never used directly; sanitizeSettings makes a fresh object.

const POSITIONS: Position[] = ["top-left", "top-right", "bottom-left", "bottom-right", "free"];
const STYLES: LegendStyle[] = ["list", "compact"];

/** Settings the settings tab edits directly (toggles, sliders, the corner). */
const CONTROL_KEYS = [
	"position",
	"style",
	"fontSize",
	"opacity",
	"highlight",
	"showInLocalGraph",
	"localAuto",
	"hideEmpty",
	"showUngrouped",
	"searchText",
	"showTags",
	"showProperties",
	"showFolders",
	"neighbors",
	"nodeHover",
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

function sanitizeOffset(v: unknown): LegendOffset | null {
	if (typeof v !== "object" || v === null) return null;
	const d = v as Record<string, unknown>;
	const share = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null);
	const x = share(d.x);
	const y = share(d.y);
	return x === null || y === null ? null : { x, y };
}

function sanitizeGroupList(v: unknown): ColorGroup[] {
	const groups: ColorGroup[] = [];
	for (const g of Array.isArray(v) ? v.slice(0, MAX_PRESET_GROUPS) : []) {
		if (typeof g !== "object" || g === null) continue;
		const x = g as Record<string, unknown>;
		if (typeof x.query !== "string" || typeof x.rgb !== "number" || !Number.isFinite(x.rgb)) continue;
		const alpha = typeof x.alpha === "number" && Number.isFinite(x.alpha) ? Math.min(1, Math.max(0, x.alpha)) : 1;
		groups.push({ query: x.query.slice(0, 1000), rgb: Math.round(x.rgb) & 0xffffff, alpha });
	}
	return groups;
}

function sanitizeRemoved(v: unknown): RemovedGroup[] {
	const out: RemovedGroup[] = [];
	for (const r of Array.isArray(v) ? v.slice(0, MAX_PRESET_GROUPS) : []) {
		if (typeof r !== "object" || r === null) continue;
		const x = r as Record<string, unknown>;
		const group = sanitizeGroupList([x.group])[0];
		const index = typeof x.index === "number" && Number.isFinite(x.index) ? Math.max(0, Math.round(x.index)) : 0;
		if (group && !out.some((o) => o.group.query === group.query)) out.push({ group, index });
	}
	return out;
}

function sanitizePresets(v: unknown): Preset[] {
	if (!Array.isArray(v)) return [];
	const out: Preset[] = [];
	for (const p of v.slice(0, MAX_PRESETS)) {
		if (typeof p !== "object" || p === null) continue;
		const d = p as Record<string, unknown>;
		const name = typeof d.name === "string" ? d.name.trim().slice(0, 100) : "";
		if (!name || out.some((x) => x.name === name)) continue;
		out.push({ name, groups: sanitizeGroupList(d.groups) });
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
		hideEmpty: typeof d.hideEmpty === "boolean" ? d.hideEmpty : DEFAULT_SETTINGS.hideEmpty,
		showUngrouped: typeof d.showUngrouped === "boolean" ? d.showUngrouped : DEFAULT_SETTINGS.showUngrouped,
		searchText: typeof d.searchText === "boolean" ? d.searchText : DEFAULT_SETTINGS.searchText,
		searchScope: d.searchScope === "all" || d.searchScope === "graph" ? d.searchScope : DEFAULT_SETTINGS.searchScope,
		showTags: typeof d.showTags === "boolean" ? d.showTags : DEFAULT_SETTINGS.showTags,
		showProperties: typeof d.showProperties === "boolean" ? d.showProperties : DEFAULT_SETTINGS.showProperties,
		showFolders: typeof d.showFolders === "boolean" ? d.showFolders : DEFAULT_SETTINGS.showFolders,
		collapsedSections: (() => {
			if (!Array.isArray(d.collapsedSections)) return [...DEFAULT_SETTINGS.collapsedSections];
			const list = stringList(d.collapsedSections);
			// Settings saved before the "Folders" section existed: it starts folded, so the legend does not grow by itself.
			if (typeof d.showFolders !== "boolean" && !list.includes("folders")) list.push("folders");
			return list;
		})(),
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
		groupsBackup: sanitizeGroupList(d.groupsBackup),
		knownGroups: Array.isArray(d.knownGroups) ? sanitizeGroupList(d.knownGroups) : null,
		pendingRemoved: sanitizeRemoved(d.pendingRemoved),
		order: (() => {
			const o = (typeof d.order === "object" && d.order !== null ? d.order : {}) as Record<string, unknown>;
			return {
				tags: stringList(o.tags).slice(0, 5000),
				properties: stringList(o.properties).slice(0, 5000),
				folders: stringList(o.folders).slice(0, 5000),
			};
		})(),
		style: STYLES.includes(d.style as LegendStyle) ? (d.style as LegendStyle) : DEFAULT_SETTINGS.style,
		offset: (() => {
			const o = (typeof d.offset === "object" && d.offset !== null ? d.offset : {}) as Record<string, unknown>;
			return { graph: sanitizeOffset(o.graph), local: sanitizeOffset(o.local) };
		})(),
		autoOffer: typeof d.autoOffer === "boolean" ? d.autoOffer : DEFAULT_SETTINGS.autoOffer,
		nodeHover: typeof d.nodeHover === "boolean" ? d.nodeHover : DEFAULT_SETTINGS.nodeHover,
		localOffer: typeof d.localOffer === "boolean" ? d.localOffer : DEFAULT_SETTINGS.localOffer,
		localAuto: typeof d.localAuto === "boolean" ? d.localAuto : DEFAULT_SETTINGS.localAuto,
	};
}

const GRAPH = "graph";
const LOCAL_GRAPH = "localgraph";
const TICK_MS = 700;
/** How often graph.json is looked at for changes made outside Obsidian. */
const FILE_CHECK_MS = 2000;
/** How long a state the graph showed counts as "just shown": Obsidian saves its own changes within a second or two. */
const RECENT_MS = 6000;

export default class GraphColorLegendPlugin extends Plugin {
	settings: GraphColorLegendSettings = sanitizeSettings(null);
	highlighter = new Highlighter();
	/** Groups from .obsidian/graph.json, used when the live graph state is not readable. */
	fileGroups: ColorGroup[] | null = null;
	private legends = new Map<ContentView, Legend>();
	/** Notes that give a legend entry its name (front matter `graph-legend`). */
	legendNotes = new Map<string, LegendNote>();
	private legendNotesTimer = 0;
	/** Text search in the notes, shared by the legends of all open graphs. */
	noteSearch = new NoteSearch(this.app);
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
			void this.moveNamesToNotes();
			this.registerEvent(this.app.metadataCache.on("changed", () => this.queueLegendNotes()));
			this.registerEvent(this.app.vault.on("rename", () => this.queueLegendNotes()));
			this.registerEvent(this.app.vault.on("delete", () => this.queueLegendNotes()));
			await this.loadFileGroups();
			await this.startupGroupsCheck();
			this.scan();
			this.registerEvent(this.app.workspace.on("layout-change", () => this.scan()));
			this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scan()));
			this.registerInterval(window.setInterval(() => this.tick(), TICK_MS));
			this.registerInterval(window.setInterval(() => void this.checkGraphFile(), FILE_CHECK_MS));
		});
	}

	onunload(): void {
		window.clearTimeout(this.legendNotesTimer);
		this.openMenu?.hide();
		this.history.clear();
		for (const legend of this.legends.values()) legend.destroy();
		this.legends.clear();
		this.highlighter.destroy();
		this.noteSearch.release();
	}

	/** The note that describes this entry (front matter `graph-legend`), matched by meaning, not character by character. */
	legendNote(query: string): LegendNote | undefined {
		return this.legendNotes.get(queryKey(query));
	}

	/**
	 * Name in the note (`graph-legend-name`), then the name kept by the plugin, then the note's title,
	 * then a name made from the query.
	 */
	displayName(query: string): string {
		if (query === UNGROUPED) return t().ungrouped;
		const note = this.legendNote(query);
		return note?.name || this.settings.names[query] || note?.file.basename || labelFromQuery(query) || "—";
	}

	/** True when someone gave the entry a name: in the legend, in a note, or by describing it in a note. */
	hasName(query: string): boolean {
		if (query === UNGROUPED) return true;
		return !!(this.settings.names[query] || this.legendNote(query));
	}

	/** The name as the user gave it (for the rename box), without the fallbacks. */
	ownName(query: string): string {
		return this.legendNote(query)?.name || this.settings.names[query] || "";
	}

	/** Writes the name into the note that describes the entry; false if that did not work. */
	private async writeNoteName(note: LegendNote, query: string, name: string | null): Promise<boolean> {
		let ok = false;
		try {
			await this.app.fileManager.processFrontMatter(note.file, (fm: Record<string, unknown>) => {
				ok = setNameInFrontmatter(fm, query, name);
			});
		} catch {
			ok = false;
		}
		return ok;
	}

	/**
	 * Gives an entry a name. When a note describes the entry, the name goes into that note
	 * (`graph-legend-name`), so people and AI agents see the same name; otherwise the plugin keeps it.
	 * Empty value: back to the note's title or the name made from the query. Can be undone.
	 */
	async setEntryName(query: string, value: string, legend: Legend | null = null): Promise<void> {
		const str = t();
		const v = value.trim();
		const note = this.legendNote(query);
		if (!note) {
			await this.recordSettings(str.stepRename(this.displayName(query)), () => {
				if (v) this.settings.names[query] = v;
				else delete this.settings.names[query];
			});
			return;
		}
		const before = note.name;
		const plugin = this.settings.names[query];
		if ((before ?? "") === v && plugin === undefined) return;
		const label = str.stepRename(this.displayName(query));
		const apply = async (name: string | null, pluginName: string | undefined): Promise<StepResult | void> => {
			if (!(await this.writeNoteName(note, query, name))) return { skipped: [note.file.path] };
			if (pluginName === undefined) delete this.settings.names[query];
			else this.settings.names[query] = pluginName;
			this.optimisticName(query, name);
			await this.saveSettingsAndRefresh();
		};
		const first = await apply(v || null, undefined);
		if (first?.skipped) {
			new Notice(str.nameNoteFailed(note.file.path), 8000);
			return;
		}
		this.history.push({
			label,
			undo: () => apply(before, plugin),
			redo: () => apply(v || null, undefined),
		});
		legend?.flash(str.nameInNote(note.file.basename), true);
	}

	/**
	 * A note that named an entry was deleted, or its `graph-legend` removed: the name stays with the
	 * plugin, so it does not disappear from the legend. Only for entries the legend still shows.
	 */
	private keepNamesOfLostNotes(before: Map<string, LegendNote>, after: Map<string, LegendNote>): boolean {
		let changed = false;
		for (const [key, note] of before) {
			if (!note.name || after.has(key)) continue;
			const query = this.settings.knownQueries.find((q) => queryKey(q) === key);
			if (query === undefined) continue;
			this.settings.names[query] = note.name;
			changed = true;
		}
		return changed;
	}

	/** Shows a name written to a note at once, before Obsidian re-reads the note. */
	private optimisticName(query: string, name: string | null): void {
		const note = this.legendNote(query);
		if (note) note.name = name;
	}

	/**
	 * Names that the plugin keeps for entries that now have a describing note move into that note,
	 * unless the note already has its own name. Runs when notes change.
	 */
	private async moveNamesToNotes(): Promise<void> {
		const moved: string[] = [];
		let changed = false;
		for (const [query, name] of Object.entries(this.settings.names)) {
			const note = this.legendNote(query);
			if (!note) continue;
			// The note already names the entry: the note's name is shown, the plugin's stays as a spare.
			if (note.name) continue;
			if (await this.writeNoteName(note, query, name)) {
				this.optimisticName(query, name);
				delete this.settings.names[query];
				moved.push(note.file.basename);
				changed = true;
			}
		}
		if (!changed) return;
		await this.saveSettingsAndRefresh();
		if (moved.length) new Notice(t().namesMoved(moved), 8000);
	}

	private queueLegendNotes(): void {
		window.clearTimeout(this.legendNotesTimer);
		this.legendNotesTimer = window.setTimeout(() => {
			const next = collectLegendNotes(this.app);
			const sig = (m: Map<string, LegendNote>) =>
				JSON.stringify([...m].map(([k, n]) => [k, n.file.path, n.file.basename, n.name]));
			const same = sig(next) === sig(this.legendNotes);
			const keptBack = same ? false : this.keepNamesOfLostNotes(this.legendNotes, next);
			this.legendNotes = next;
			if (keptBack) void this.saveData(this.settings);
			for (const legend of this.legends.values()) {
				legend.notesChanged();
				if (!same) legend.update(true);
			}
			if (!same) void this.moveNamesToNotes();
		}, 500);
	}

	/** The texts kept for the search are dropped when no legend shows text search results any more. */
	releaseSearchIfIdle(): void {
		for (const legend of this.legends.values()) if (legend.usesTextSearch()) return;
		this.noteSearch.release();
	}

	private openMenu: Menu | null = null;

	/** Opens this plugin's tab in Obsidian's settings (the settings window is not in the public API). */
	openSettings(): void {
		const setting = (this.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => unknown } }).setting;
		if (typeof setting?.open !== "function") return;
		setting.open();
		setting.openTabById?.(this.manifest.id);
	}

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
		this.addCommand({
			id: "color-graph",
			name: str.autoButton,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || legend.isLocal) return false;
				if (!checking) legend.openAutoGroups();
				return true;
			},
		});
		this.addCommand({
			id: "take-global-groups",
			name: str.cmdLocalTake,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || !legend.canTakeGlobalGroups()) return false;
				if (!checking) legend.takeGlobalGroups();
				return true;
			},
		});
		this.addCommand({
			id: "toggle-compact",
			name: str.cmdCompact,
			callback: () => {
				this.settings.style = this.settings.style === "compact" ? "list" : "compact";
				void this.saveSettingsAndRefresh();
			},
		});
		this.addCommand({
			id: "copy-legend-image",
			name: str.imageCopy,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || !legend.hasGroups()) return false;
				if (!checking) void legend.exportImage("copy");
				return true;
			},
		});
		this.addCommand({
			id: "copy-legend-text",
			name: str.textCopy,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || !legend.hasGroups()) return false;
				if (!checking) void legend.copyText();
				return true;
			},
		});
		this.addCommand({
			id: "save-legend-image",
			name: str.imageSave,
			checkCallback: (checking) => {
				const legend = this.activeLegend();
				if (!legend || !legend.hasGroups()) return false;
				if (!checking) void legend.exportImage("save");
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
	 * Changes with the same `mergeKey` that follow each other quickly are one step to undo.
	 * The global graph's groups are saved in the graph settings; a local graph keeps its own.
	 */
	async changeGroups(legend: Legend, next: ColorGroup[], label: string, message: string, mergeKey?: string): Promise<void> {
		const prev = legend.currentGroups();
		const view = legend.view;
		const isLocal = legend.isLocal;
		// The first groups of a graph that had none: undoing them leaves the saved copy as it was too,
		// or the legend would offer to bring back the very groups that were just undone.
		const copyBefore = !isLocal && prev.length === 0 ? this.settings.groupsBackup.map((g) => ({ ...g })) : null;
		const ok = await this.replaceGroups(view, isLocal, next);
		if (!ok) {
			new Notice(t().groupsFailed, 8000);
			return;
		}
		this.history.push({
			label,
			mergeKey,
			undo: async () => {
				await this.replaceGroups(view, isLocal, prev);
				if (copyBefore) {
					this.settings.groupsBackup = copyBefore.map((g) => ({ ...g }));
					await this.saveSettingsQuiet();
				}
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
		this.settings.order = { tags: [...d.order.tags], properties: [...d.order.properties], folders: [...(d.order.folders ?? [])] };
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

	/** The global graph's color groups as its settings hold them now (a copy). */
	globalGroups(): ColorGroup[] {
		const inst = getGraphPluginInstance(this.app);
		const stored = (inst?.options ? normalizeGroups(inst.options.colorGroups) : null) ?? this.fileGroups ?? [];
		return stored.map((g) => ({ ...g }));
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
		// Notes that describe an entry with this tag (`graph-legend`) follow the rename, or the entry would lose its name.
		const rewrite = (q: string) => replaceTagInQuery(q, old, next);
		const legendFiles = this.app.vault
			.getMarkdownFiles()
			.filter((f) =>
				entriesFromFrontmatter(this.app.metadataCache.getFileCache(f)?.frontmatter).some((e) => rewrite(e.query) !== e.query),
			);
		if (undoable) for (const f of legendFiles) if (!before.has(f.path)) before.set(f.path, await this.app.vault.read(f));

		const result = await renameTagInNotes(this.app, usage, old, next, onProgress);
		for (const f of legendFiles) {
			try {
				await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
					rewriteQueriesInFrontmatter(fm, rewrite);
				});
			} catch (e) {
				result.failed.push({ path: f.path, reason: e instanceof Error ? e.message : String(e) });
			}
		}
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
		// The plugin's own change is what it knows from now on, at once: closing Obsidian right after it
		// must not make the change look like one made from outside at the next start.
		if (!isLocal && reached) await this.setKnown(next);
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

	/** Keeps a copy of the global graph's color groups; never overwritten with an empty list. */
	rememberGroups(groups: ColorGroup[]): void {
		if (groups.length === 0) return;
		const next = groups.slice(0, MAX_PRESET_GROUPS).map((g) => ({ ...g }));
		const key = (list: ColorGroup[]) => JSON.stringify(list.map((g) => [g.query, g.rgb, g.alpha]));
		if (key(next) === key(this.settings.groupsBackup)) return;
		this.settings.groupsBackup = next;
		void this.saveData(this.settings);
	}

	/** Puts the saved copy back after the groups disappeared (for example "Restore default settings" of the graph). */
	async restoreGroupsBackup(legend: Legend): Promise<void> {
		const backup = this.settings.groupsBackup.map((g) => ({ ...g }));
		if (backup.length === 0) return;
		await this.changeGroups(legend, backup, t().stepRestoreGroups, t().groupsRestored);
	}

	/** "Not needed": the groups were removed on purpose, so the copy is dropped. */
	async dropGroupsBackup(): Promise<void> {
		this.settings.groupsBackup = [];
		// The graph was left without colors on purpose: no offer to color it either (the menu still has it).
		this.settings.autoOffer = false;
		await this.saveSettingsAndRefresh();
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
		this.noteMemory();
		for (const legend of this.legends.values()) {
			if (legend.view.containerEl.isShown()) legend.update();
		}
		this.maybeReviewRemoved();
	}

	// ---- Changes to graph.json made outside Obsidian (an AI agent, sync, a text editor) ----

	private graphFileStamp = "";
	private checkingFile = false;
	private reviewOpen = false;
	/** The review window opens by itself once per Obsidian run (and again when more groups go). */
	private reviewShown = false;
	private recentMemory: { key: string; time: number }[] = [];
	private startupChecked = false;

	private graphPath(): string {
		return normalizePath(`${this.app.vault.configDir}/graph.json`);
	}

	/** The global graph's groups that Obsidian holds in memory (what the graph shows), or null if out of reach. */
	private memoryGroups(): ColorGroup[] | null {
		const inst = getGraphPluginInstance(this.app);
		return inst?.options ? (normalizeGroups(inst.options.colorGroups) ?? []) : null;
	}

	/**
	 * The groups the open global graph shows, or null when no graph is open. Obsidian rereads graph.json into its
	 * settings when the file changes, but an open graph keeps showing the old groups: this is what the person sees.
	 */
	private shownGroups(): ColorGroup[] | null {
		for (const leaf of this.app.workspace.getLeavesOfType(GRAPH)) {
			if (leaf.isDeferred) continue;
			const groups = readLiveGroups(leaf.view);
			if (groups) return groups;
		}
		return null;
	}

	/** Puts groups into Obsidian's memory and the open graphs without writing graph.json, so nothing else in the file is overwritten. */
	private setMemoryGroups(groups: ColorGroup[]): boolean {
		const inst = getGraphPluginInstance(this.app);
		if (!inst?.options) return false;
		inst.options.colorGroups = mergeRawGroups(inst.options.colorGroups, groups);
		for (const leaf of this.app.workspace.getLeavesOfType(GRAPH)) {
			if (!leaf.isDeferred) setLiveGroups(leaf.view, groups);
		}
		return true;
	}

	/** Writes the color groups into graph.json and leaves the rest of the file (filters, forces) as it is. */
	private async writeFileGroups(groups: ColorGroup[]): Promise<void> {
		const path = this.graphPath();
		const json = (await this.app.vault.adapter.exists(path))
			? (JSON.parse(await this.app.vault.adapter.read(path)) as Record<string, unknown>)
			: {};
		if (groupsKey(normalizeGroups(json.colorGroups) ?? []) === groupsKey(groups)) return;
		const raw = getGraphPluginInstance(this.app)?.options?.colorGroups ?? json.colorGroups;
		json.colorGroups = mergeRawGroups(raw, groups);
		await this.app.vault.adapter.write(path, JSON.stringify(json, null, 2));
	}

	/** Remembers what the graph showed lately, to tell Obsidian's own (late) saves from changes made outside. */
	private noteMemory(): void {
		// Only the open graph counts: Obsidian's settings memory also changes when the file is changed outside.
		const m = this.shownGroups();
		if (!m) return;
		const key = groupsKey(m);
		const now = Date.now();
		const last = this.recentMemory[this.recentMemory.length - 1];
		if (last && last.key === key) {
			last.time = now;
			return;
		}
		this.recentMemory = this.recentMemory.filter((x) => now - x.time < RECENT_MS).slice(-50);
		this.recentMemory.push({ key, time: now });
		if (!this.startupChecked) return;
		// A change made in Obsidian itself: it is what the plugin knows now, and a waiting group the person
		// deleted by hand needs no decision any more.
		const s = this.settings;
		const before = s.pendingRemoved.length;
		s.pendingRemoved = s.pendingRemoved.filter((r) => m.some((g) => g.query === r.group.query));
		if (before !== s.pendingRemoved.length || !s.knownGroups || groupsKey(s.knownGroups) !== key) {
			s.knownGroups = m.map((g) => ({ ...g }));
			void this.saveSettingsQuiet();
			if (before !== s.pendingRemoved.length) this.refreshLegends();
		}
	}

	private shownRecently(key: string): boolean {
		const now = Date.now();
		return this.recentMemory.some((x) => x.key === key && now - x.time < RECENT_MS);
	}

	private refreshLegends(): void {
		for (const legend of this.legends.values()) legend.update(true);
	}

	private async setKnown(groups: ColorGroup[]): Promise<void> {
		const s = this.settings;
		if (s.knownGroups && groupsKey(s.knownGroups) === groupsKey(groups)) return;
		s.knownGroups = groups.map((g) => ({ ...g }));
		await this.saveSettingsQuiet();
	}

	/** Groups removed while Obsidian was closed: found by comparing with the set the plugin saw last time. */
	private async startupGroupsCheck(): Promise<void> {
		try {
			const stat = await this.app.vault.adapter.stat(this.graphPath());
			this.graphFileStamp = stat ? `${stat.mtime}:${stat.size}` : "";
		} catch {
			this.graphFileStamp = "";
		}
		const memory = this.memoryGroups();
		if (memory === null) return;
		this.startupChecked = true;
		const s = this.settings;
		if (s.knownGroups === null) {
			// First run with this version: nothing to compare with yet.
			await this.setKnown(memory);
			this.noteMemory();
			return;
		}
		s.pendingRemoved = s.pendingRemoved.filter((r) => !memory.some((g) => g.query === r.group.query));
		s.pendingRemoved = addPending(s.pendingRemoved, diffGroups(s.knownGroups, memory).removed);
		const next = s.pendingRemoved.length ? withKept(memory, s.pendingRemoved) : memory;
		if (groupsKey(next) !== groupsKey(memory)) this.setMemoryGroups(next);
		this.noteMemory();
		s.knownGroups = next.map((g) => ({ ...g }));
		await this.saveSettingsQuiet();
		if (s.pendingRemoved.length) this.reviewShown = false;
	}

	/** Looks at graph.json every few seconds; a change made outside Obsidian reaches the graph at once. */
	private async checkGraphFile(): Promise<void> {
		if (this.checkingFile) return;
		this.checkingFile = true;
		try {
			const path = this.graphPath();
			const stat = await this.app.vault.adapter.stat(path);
			if (!stat) return;
			const stamp = `${stat.mtime}:${stat.size}`;
			if (stamp === this.graphFileStamp) return;
			let groups: ColorGroup[];
			try {
				const json = JSON.parse(await this.app.vault.adapter.read(path)) as { colorGroups?: unknown };
				groups = normalizeGroups(json.colorGroups) ?? [];
			} catch {
				// Half-written or broken: look again next time.
				return;
			}
			this.graphFileStamp = stamp;
			this.fileGroups = groups;
			if (this.memoryGroups() === null) {
				this.refreshLegends();
				return;
			}
			const key = groupsKey(groups);
			const shown = this.shownGroups();
			if (shown && key === groupsKey(shown)) {
				// Obsidian (or this plugin) saved what the graph shows.
				await this.setKnown(shown);
				return;
			}
			// A late save of something the graph showed a moment ago is Obsidian's own, not a change from outside.
			if (shown && this.shownRecently(key)) return;
			const known = this.settings.knownGroups;
			if (!known) {
				await this.setKnown(groups);
				return;
			}
			if (key === groupsKey(known) && !shown) return;
			await this.applyOutsideGroups(known, groups, shown);
		} catch {
			// The next look tries again.
		} finally {
			this.checkingFile = false;
		}
	}

	/** New, changed and reordered groups go to the graph at once; removed ones stay until the person decides. */
	private async applyOutsideGroups(known: ColorGroup[], file: ColorGroup[], shown: ColorGroup[] | null): Promise<void> {
		const s = this.settings;
		const str = t();
		const diff = diffGroups(known, file);
		s.pendingRemoved = s.pendingRemoved.filter((r) => !file.some((g) => g.query === r.group.query));
		s.pendingRemoved = addPending(s.pendingRemoved, diff.removed);
		const next = withKept(file, s.pendingRemoved);
		const before = shown ?? known;
		// Obsidian's memory may already hold the file's groups (it rereads the file), so it is always set.
		this.setMemoryGroups(next);
		this.noteMemory();
		const visible = groupsKey(next) !== groupsKey(before);
		if (visible) {
			const prev = before.map((g) => ({ ...g }));
			this.history.push({
				label: str.stepGroupsFromFile,
				undo: async () => {
					await this.replaceGroups(null, false, prev);
				},
				redo: async () => {
					await this.replaceGroups(null, false, next);
				},
			});
		}
		s.knownGroups = next.map((g) => ({ ...g }));
		await this.saveSettingsQuiet();
		this.refreshLegends();
		if (visible && (diff.added > 0 || diff.changed > 0 || diff.removed.length === 0)) {
			for (const legend of this.legends.values()) if (!legend.isLocal) legend.flash(str.groupsFromFile, true);
		}
		if (diff.removed.length > 0) this.reviewShown = false;
	}

	/** Opens the review of removed groups when a graph is on screen and nobody is typing; otherwise it waits. */
	private maybeReviewRemoved(): void {
		if (this.reviewOpen || this.reviewShown || this.settings.pendingRemoved.length === 0) return;
		const graphShown = this.app.workspace
			.getLeavesOfType(GRAPH)
			.some((leaf) => !leaf.isDeferred && leaf.view.containerEl.isShown());
		if (!graphShown) return;
		const el = activeDocument.activeElement;
		if (el?.instanceOf(HTMLElement) && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
		this.openRemovedReview();
	}

	/** The window with the removed groups; also opened from the bar in the legend. */
	openRemovedReview(): void {
		if (this.reviewOpen || this.settings.pendingRemoved.length === 0) return;
		this.reviewOpen = true;
		this.reviewShown = true;
		new RemovedGroupsModal(this, [...this.settings.pendingRemoved], () => {
			this.reviewOpen = false;
		}).open();
	}

	/** The person's answer: groups in `keep` stay (and go back into graph.json), the others are removed. */
	async decideRemoved(shown: string[], keep: Set<string>): Promise<void> {
		const s = this.settings;
		const str = t();
		// Take in whatever changed in the file meanwhile, so writing it below loses nothing.
		await this.checkGraphFile();
		const decided = new Set(shown);
		const pending = s.pendingRemoved.filter((r) => decided.has(r.group.query));
		if (pending.length === 0) return;
		const memory = this.shownGroups() ?? this.memoryGroups() ?? [];
		const drop = new Set(pending.filter((r) => !keep.has(r.group.query)).map((r) => r.group.query));
		const kept = pending.length - drop.size;
		const next = memory.filter((g) => !drop.has(g.query));
		// Groups that went missing after the window opened were not shown, so they still wait.
		s.pendingRemoved = s.pendingRemoved.filter((r) => !decided.has(r.group.query));
		if (s.pendingRemoved.length) this.reviewShown = false;
		this.setMemoryGroups(next);
		// The file gets exactly what the graph shows: kept groups go back, so the agent sees them too, and
		// removed ones stay out even if Obsidian saved them back in the meantime.
		try {
			await this.writeFileGroups(next);
		} catch {
			new Notice(str.groupsFailed, 8000);
		}
		this.noteMemory();
		s.knownGroups = next.map((g) => ({ ...g }));
		await this.saveSettingsQuiet();
		const prev = memory.map((g) => ({ ...g }));
		if (drop.size > 0) {
			this.history.push({
				label: str.stepRemovedGroups,
				undo: async () => {
					await this.replaceGroups(null, false, prev);
				},
				redo: async () => {
					await this.replaceGroups(null, false, next);
				},
			});
		}
		this.refreshLegends();
		const message = str.removedDone(kept, drop.size);
		const legend = [...this.legends.values()].find((l) => !l.isLocal);
		if (legend) legend.flash(message, drop.size > 0);
		else new Notice(message, 5000);
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
			{ key: "style", name: str.style, desc: str.styleDesc, kind: "dropdown" },
			{ key: "fontSize", name: str.fontSize, desc: str.fontSizeDesc, kind: "slider", min: 10, max: 20, step: 1 },
			{ key: "opacity", name: str.opacity, desc: str.opacityDesc, kind: "slider", min: 30, max: 100, step: 5 },
			{ key: "highlight", name: str.highlight, desc: str.highlightDesc, kind: "toggle" },
			{ key: "showInLocalGraph", name: str.localGraph, desc: str.localGraphDesc, kind: "toggle" },
			{ key: "localAuto", name: str.localAuto, desc: str.localAutoDesc, kind: "toggle" },
			{ key: "hideEmpty", name: str.hideEmpty, desc: str.hideEmptyDesc, kind: "toggle" },
			{ key: "showUngrouped", name: str.showUngrouped, desc: str.showUngroupedDesc, kind: "toggle" },
			{ key: "searchText", name: str.searchText, desc: str.searchTextDesc, kind: "toggle" },
			{ key: "showTags", name: str.showTags, desc: str.showTagsDesc, kind: "toggle" },
			{ key: "showProperties", name: str.showProperties, desc: str.showPropertiesDesc, kind: "toggle" },
			{ key: "showFolders", name: str.showFolders, desc: str.showFoldersDesc, kind: "toggle" },
			{ key: "neighbors", name: str.neighbors, desc: str.neighborsDesc, kind: "toggle" },
			{ key: "nodeHover", name: str.nodeHover, desc: str.nodeHoverDesc, kind: "toggle" },
			{ key: "showLegend", name: str.showLegend, desc: str.showLegendDesc, kind: "toggle" },
		];
	}

	private positions(): Record<string, string> {
		const str = t();
		return {
			"top-left": str.topLeft,
			"top-right": str.topRight,
			"bottom-left": str.bottomLeft,
			"bottom-right": str.bottomRight,
			free: str.positionFree,
		};
	}

	/** Choices of a dropdown setting. */
	private options(key: ControlKey): Record<string, string> {
		const str = t();
		return key === "style" ? { list: str.styleList, compact: str.styleCompact } : this.positions();
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
			return { ...base, control: { type: "dropdown", key: c.key, options: this.options(c.key) } };
		});
		items.push({
			type: "group",
			heading: str.aiHeading,
			items: [{ name: str.aiRule, desc: str.aiRuleDesc, render: (setting: Setting) => this.fillAgentRule(setting) }],
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

	/** The rule that makes an AI agent name the color groups it adds: one button puts it on the clipboard. */
	private fillAgentRule(setting: Setting): void {
		const str = t();
		setting.addButton((b) =>
			b.setButtonText(str.aiRuleCopy).onClick(async () => {
				try {
					// The settings can be a window of their own: its clipboard is the one that has the focus.
					// Only colors that show on the graph of the theme in use, in the palette's order.
					const colors = visibleColors(PALETTE, graphBackground(b.buttonEl.doc));
					await b.buttonEl.win.navigator.clipboard.writeText(agentRule(this.app.vault.configDir, colors));
					new Notice(str.aiRuleCopied, 3000);
				} catch {
					new Notice(str.copyFailed, 6000);
				}
			}),
		);
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
			else setting.addDropdown((d) => d.addOptions(this.options(c.key)).setValue(String(s[c.key])).onChange(save));
		}

		new Setting(containerEl).setName(str.aiHeading).setHeading();
		this.fillAgentRule(new Setting(containerEl).setName(str.aiRule).setDesc(str.aiRuleDesc));

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
		const note = this.plugin.legendNote(q);
		if (note) setting.setDesc(str.nameInNoteSetting(note.file.basename));
		setting
			.addText((tx) => {
				tx.setPlaceholder(note ? note.file.basename : labelFromQuery(q)).setValue(this.plugin.ownName(q));
				if (note) {
					// The name lives in a note: write it once, when the field is left, not on every key.
					tx.inputEl.addEventListener("change", () => void this.plugin.setEntryName(q, tx.getValue()));
					return;
				}
				tx.onChange(async (v) => {
					const value = v.trim();
					await this.plugin.recordSettings(
						str.stepRename(this.plugin.displayName(q)),
						() => {
							if (value) s.names[q] = value;
							else delete s.names[q];
						},
						{ mergeKey: "name:" + q },
					);
				});
			})
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
