import { App, normalizePath, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	ColorGroup,
	getGraphPluginInstance,
	normalizeGroups,
	rewriteLiveGroupQueries,
	rewriteRawGroups,
} from "./graph-internals";
import { Highlighter } from "./highlight";
import { t } from "./i18n";
import { labelFromQuery } from "./labels";
import { replaceTagInQuery } from "./tags";
import { ContentView, Legend, rgbToHex } from "./legend";

export type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface GraphColorLegendSettings {
	collapsed: boolean;
	position: Position;
	fontSize: number;
	opacity: number;
	highlight: boolean;
	showInLocalGraph: boolean;
	/** Custom names, keyed by the group's query. */
	names: Record<string, string>;
	/** Queries of hidden entries. */
	hidden: string[];
	/** Queries seen in the graph, for the settings list. */
	knownQueries: string[];
}

const DEFAULT_SETTINGS: GraphColorLegendSettings = {
	collapsed: false,
	position: "top-left",
	fontSize: 13,
	opacity: 85,
	highlight: true,
	showInLocalGraph: true,
	names: {},
	hidden: [],
	knownQueries: [],
};
// Note: DEFAULT_SETTINGS.names is never used directly; sanitizeSettings makes a fresh object.

const POSITIONS: Position[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
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
		names,
		hidden: stringList(d.hidden),
		knownQueries: stringList(d.knownQueries),
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

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new GraphColorLegendSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(async () => {
			await this.loadFileGroups();
			this.scan();
			this.registerEvent(this.app.workspace.on("layout-change", () => this.scan()));
			this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scan()));
			this.registerInterval(window.setInterval(() => this.tick(), TICK_MS));
		});
	}

	onunload(): void {
		for (const legend of this.legends.values()) legend.destroy();
		this.legends.clear();
		this.highlighter.destroy();
	}

	displayName(query: string): string {
		return this.settings.names[query] || labelFromQuery(query) || "—";
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

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const str = t();
		containerEl.empty();

		new Setting(containerEl)
			.setName(str.position)
			.setDesc(str.positionDesc)
			.addDropdown((d) =>
				d
					.addOptions({
						"top-left": str.topLeft,
						"top-right": str.topRight,
						"bottom-left": str.bottomLeft,
						"bottom-right": str.bottomRight,
					})
					.setValue(s.position)
					.onChange(async (v) => {
						s.position = v as Position;
						await this.plugin.saveSettingsAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName(str.fontSize)
			.setDesc(str.fontSizeDesc)
			.addSlider((sl) =>
				sl
					.setLimits(10, 20, 1)
					.setValue(s.fontSize)
					.onChange(async (v) => {
						s.fontSize = v;
						await this.plugin.saveSettingsAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName(str.opacity)
			.setDesc(str.opacityDesc)
			.addSlider((sl) =>
				sl
					.setLimits(30, 100, 5)
					.setValue(s.opacity)
					.onChange(async (v) => {
						s.opacity = v;
						await this.plugin.saveSettingsAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName(str.highlight)
			.setDesc(str.highlightDesc)
			.addToggle((tg) =>
				tg.setValue(s.highlight).onChange(async (v) => {
					s.highlight = v;
					await this.plugin.saveSettingsAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName(str.localGraph)
			.setDesc(str.localGraphDesc)
			.addToggle((tg) =>
				tg.setValue(s.showInLocalGraph).onChange(async (v) => {
					s.showInLocalGraph = v;
					await this.plugin.saveSettingsAndRefresh();
				}),
			);

		new Setting(containerEl).setName(str.entries).setDesc(str.entriesDesc).setHeading();

		const queries = s.knownQueries.length ? s.knownQueries : (this.plugin.fileGroups ?? []).map((g) => g.query);
		const colors = new Map((this.plugin.fileGroups ?? []).map((g) => [g.query, g.rgb] as const));
		if (queries.length === 0) {
			containerEl.createEl("p", { cls: "setting-item-description", text: str.entriesEmpty });
		}
		for (const q of queries) {
			const setting = new Setting(containerEl).setName(q || "—");
			const rgb = colors.get(q);
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
							if (value) s.names[q] = value;
							else delete s.names[q];
							await this.plugin.saveSettingsAndRefresh();
						}),
				)
				.addExtraButton((b) => {
					const hidden = s.hidden.includes(q);
					b.setIcon(hidden ? "eye-off" : "eye")
						.setTooltip(hidden ? str.show : str.hide)
						.onClick(async () => {
							if (s.hidden.includes(q)) s.hidden.remove(q);
							else s.hidden.push(q);
							await this.plugin.saveSettingsAndRefresh();
							this.display();
						});
				});
		}

		new Setting(containerEl)
			.setName(str.reset)
			.setDesc(str.resetDesc)
			.addButton((b) => {
				b.setButtonText(str.resetButton).onClick(async () => {
					s.names = {};
					s.hidden = [];
					await this.plugin.saveSettingsAndRefresh();
					this.display();
				});
				// Red "destructive" look that works on every supported Obsidian version.
				b.buttonEl.addClass("mod-warning");
			});
	}
}
