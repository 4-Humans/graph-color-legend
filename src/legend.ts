import { MarkdownView, Menu, Notice, Platform, TFile, View, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { AttributeEntry, Attributes, collectAttributes, collectNotes } from "./attributes";
import { EntryModal } from "./entry-modal";
import { ColorGroup, getRenderer, nodeRgb, openGlobalSearch, readLiveGroups, UNGROUPED } from "./graph-internals";
import { freeColor, NewGroupModal, NotesModal, PathsModal, PresetNameModal } from "./modals";
import { matchNotes, NoteInfo } from "./query-match";
import { HighlightSpec } from "./highlight";
import { t } from "./i18n";
import type GraphColorLegendPlugin from "./main";
import type { SearchScope } from "./main";
import { extractTags } from "./tags";
import { copyImage, legendImage, saveImage } from "./export-image";
import type { SearchProgress, SearchResult } from "./note-search";
import { looksLikeQuery, NoteHit, prepareQuery, Snippet } from "./text-search";

/** A view with a content element (graph views are item views). */
export type ContentView = View & { contentEl: HTMLElement };

export function rgbToHex(rgb: number): string {
	return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
}

/** Legend size set by dragging its edge; a null side means "fit the content". */
/** How long the global graph must stay without color groups before the legend offers the saved copy. */
const LOST_GROUPS_MS = 2000;

export interface LegendSize {
	w: number | null;
	h: number | null;
}

export const SIZE_LIMITS = { minW: 140, minH: 60, max: 4000 };

/** Visibility of one entry: shown, highlighted on the graph, or hidden from the legend. */
type EntryState = "visible" | "selected" | "hidden";

/** One row of the legend: a color group, or a tag / property of the notes in the graph. */
interface Entry {
	query: string;
	/** Group color; null for tags and properties (they keep the notes' own colors). */
	rgb: number | null;
	/** Notes to keep bright, for tags and properties. */
	ids: string[];
	/** Position in the graph's list of color groups (groups only). */
	index?: number;
	/** The row for nodes no group colors: its dot has their grey, it cannot be renamed, moved or made a group. */
	ungrouped?: { rgb: number | null };
}

/** What the legend can tell about one color group from the graph as it is drawn now. */
interface GroupInfo {
	count: number;
	warnings: string[];
}

type SectionId = "tags" | "properties";
type DragSection = "groups" | SectionId;

/** Pixels the mouse has to move with the button held before an entry is picked up. */
const DRAG_THRESHOLD = 5;
/** How long the message with Undo stays under the header. */
const FLASH_MS = 8000;
const FLASH_AFTER_LEAVE_MS = 3000;
/** A plain message (after undo or redo) goes away on its own. */
const FLASH_INFO_MS = 3000;
const FLASH_LONG_MS = 15000;

interface Flash {
	text: string;
	/** An Undo button for the change just made. After an undo or redo there is no button: redo is the arrow. */
	undo: boolean;
	skipped: string[];
}

/** Room kept free while resizing: the graph's own controls column on the right, and a margin below. */
const GAP_X = 72;
const GAP_Y = 24;
/** Touch: a press this long opens the entry menu instead of highlighting. */
const LONG_PRESS_MS = 550;

/** Text search: wait this long after the last keystroke. */
const TEXT_DELAY_MS = 250;
/** Notes listed at first, and added by "show more". */
const TEXT_NOTES_STEP = 5;
/** Lines with matches shown under a note at first, and after "…and N more". */
const TEXT_SNIPPETS = 3;
const TEXT_SNIPPETS_MORE = 50;

const EMPTY_ATTRS: Attributes = { tags: [], properties: [], signature: "" };

/** One legend panel attached to one graph view. */
export class Legend {
	readonly el: HTMLElement;
	private signature = "";
	private groups: ColorGroup[] = [];
	private attrs: Attributes = EMPTY_ATTRS;
	private attrNodes = -1;
	private editing = false;
	private hoverQuery: string | null = null;
	/** Highlighted ("selected") entries. Not saved: they reset when Obsidian restarts. */
	private selected = new Set<string>();
	/** Highlighted entries whose linked notes stay bright too (the entry menu), when the setting does not do it for all. */
	private linked = new Set<string>();
	/** Set after a long press so the click that follows it does not also toggle the highlight. */
	private suppressClick = false;
	/** Search box under the header (not saved). */
	private searchOpen = false;
	private searchText = "";
	private searchInput: HTMLInputElement | null = null;
	private focusSearch = false;
	private bodyEl: HTMLElement | null = null;
	/** Text search in the notes (the same box): the query being searched, and what it found. */
	private textQuery = "";
	private textResult: SearchResult | null = null;
	private textBusy: SearchProgress | null = null;
	/** Grows with every search, so an older one knows it is no longer wanted. */
	private textRun = 0;
	private textTimer = 0;
	private textShown = TEXT_NOTES_STEP;
	private textCollapsed = false;
	/** Lines with matches of the listed notes, with the limit they were read with. */
	private textSnippets = new Map<string, { limit: number; list: Snippet[] }>();
	private textExpanded = new Set<string>();
	/** The found note under the pointer (or chosen with the arrow keys): only it stays bright. */
	private textHover: string | null = null;
	private textCursor = -1;
	/** The tab where found notes open, so the graph stays on screen. */
	private resultLeaf: WorkspaceLeaf | null = null;
	/** "Only highlighted": the other nodes are hidden, not faded. Not saved. */
	private focusMode = false;
	private notes: NoteInfo[] = [];
	/** Notes matching each color group's query (null: query too complex to check here). */
	private groupMatches: (Set<string> | null)[] = [];
	private matchKey = "";
	/** Number of nodes drawn in each group color. */
	private colorCounts = new Map<number, number>();
	/** Nodes no color group colors, and the grey the graph draws most of them in. */
	private ungroupedIds: string[] = [];
	private ungroupedRgb: number | null = null;
	/** An entry is being dragged: the legend is not redrawn meanwhile. */
	private drag = false;
	private flashMsg: Flash | null = null;
	/** Since when the global graph has had no color groups at all (a moment of loading is not a loss). */
	private noGroupsSince: number | null = null;
	private flashTimer = 0;
	private pointerInside = false;
	/** Set when the legend was just moved by its title, so the click that ends the move does not collapse it. */
	private justMoved = false;

	constructor(
		private plugin: GraphColorLegendPlugin,
		readonly view: ContentView,
		readonly isLocal: boolean,
	) {
		this.el = view.contentEl.createDiv({ cls: "gcl-legend" });
		// Marks the graph view so CSS can keep the graph settings panel above the legend.
		view.contentEl.addClass("gcl-has-legend");
		// Keep pointer and wheel events on the legend from panning or zooming the graph.
		for (const type of ["pointerdown", "mousedown", "touchstart", "wheel", "dblclick", "contextmenu"]) {
			this.el.addEventListener(type, (e) => e.stopPropagation());
		}
		this.el.addEventListener("pointerleave", () => {
			this.pointerInside = false;
			// The message bar waits while the pointer is on the legend, then goes a little later.
			if (this.flashMsg && this.flashSticky(this.flashMsg)) this.scheduleFlashEnd(FLASH_AFTER_LEAVE_MS);
			if (this.hoverQuery === null) return;
			this.hoverQuery = null;
			this.applyHighlight();
		});
		this.el.addEventListener("pointerenter", () => {
			this.pointerInside = true;
			if (this.flashMsg && this.flashSticky(this.flashMsg)) window.clearTimeout(this.flashTimer);
		});
		this.update(true);
	}

	destroy(): void {
		window.clearTimeout(this.flashTimer);
		this.searchOpen = false;
		this.resetText();
		this.setHighlight(null);
		this.el.remove();
		this.view.contentEl.removeClass("gcl-has-legend");
	}

	private get sizeKey(): "graph" | "local" {
		return this.isLocal ? "local" : "graph";
	}

	/** Called when notes change: tags and properties are read again on the next tick. */
	notesChanged(): void {
		this.attrNodes = -1;
		// Notes were edited while a text search is shown: search again, keeping what is unfolded.
		const q = this.textWanted();
		if (q === "") return;
		window.clearTimeout(this.textTimer);
		this.textTimer = window.setTimeout(() => void this.runTextSearch(q, true), 600);
	}

	/** Tags and properties are read again only when the set of nodes or the notes change. */
	private refreshAttributes(force: boolean, groups: ColorGroup[]): void {
		const s = this.plugin.settings;
		const r = getRenderer(this.view);
		const n = r?.nodes.length ?? 0;
		const key = JSON.stringify(groups.map((g) => g.query));
		if (!force && n === this.attrNodes && key === this.matchKey) return;
		this.attrNodes = n;
		this.matchKey = key;
		this.notes = collectNotes(this.plugin.app, r);
		this.groupMatches = groups.map((g) => matchNotes(g.query, this.notes));
		this.attrs = s.showTags || s.showProperties ? collectAttributes(this.plugin.app, this.notes) : EMPTY_ATTRS;
	}

	private countColors(groups: ColorGroup[]): void {
		const counts = new Map<number, number>();
		const nodes = getRenderer(this.view)?.nodes ?? [];
		for (const node of nodes) {
			const rgb = nodeRgb(node);
			if (rgb !== null) counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
		}
		this.colorCounts = counts;
		// Nodes no color group colors: the graph draws them grey. Tag nodes are not notes and stay out.
		const groupRgbs = new Set(groups.map((g) => g.rgb));
		const ids: string[] = [];
		const greys = new Map<number, number>();
		for (const node of nodes) {
			if (node.type === "tag") continue;
			const rgb = nodeRgb(node);
			if (rgb !== null && groupRgbs.has(rgb)) continue;
			ids.push(node.id);
			if (rgb !== null) greys.set(rgb, (greys.get(rgb) ?? 0) + 1);
		}
		// The dot gets the grey most of them have.
		let grey: number | null = null;
		let most = 0;
		for (const [rgb, n] of greys) if (n > most) [grey, most] = [rgb, n];
		this.ungroupedIds = ids;
		this.ungroupedRgb = grey;
	}

	/** The last row of the color groups, for the grey nodes; null when there are none or the setting is off. */
	private ungroupedEntry(): Entry | null {
		if (!this.plugin.settings.showUngrouped || this.ungroupedIds.length === 0) return null;
		return { query: UNGROUPED, rgb: null, ids: this.ungroupedIds, ungrouped: { rgb: this.ungroupedRgb } };
	}

	/** Count of a group and what may be wrong with it: covered by a group above, or sharing its color. */
	private groupInfo(index: number): GroupInfo {
		const str = t();
		const g = this.groups[index];
		if (!g) return { count: 0, warnings: [] };
		const name = (i: number) => `«${this.plugin.displayName(this.groups[i]?.query ?? "")}»`;
		const same = this.groups.map((_x, i) => i).filter((i) => i !== index && this.groups[i]?.rgb === g.rgb);
		const colored = this.colorCounts.get(g.rgb) ?? 0;
		const own = this.groupMatches[index] ?? null;
		const warnings: string[] = [];
		let count = colored;
		if (same.length > 0) {
			warnings.push(str.sameColor(same.map(name).join(", ")));
			// Shared color: count this group's own notes if all queries up to it can be checked here.
			const earlier = this.groupMatches.slice(0, index);
			if (own && earlier.every((m) => m !== null)) {
				count = [...own].filter((id) => !earlier.some((m) => m?.has(id))).length;
			}
		} else if (own && own.size > colored) {
			const coverers = this.groups
				.map((_x, i) => i)
				.filter((i) => i < index && [...own].some((id) => this.groupMatches[i]?.has(id)));
			if (coverers.length > 0) {
				warnings.push(colored === 0 ? str.coveredAll(coverers.map(name).join(", ")) : str.coveredSome(own.size - colored, coverers.map(name).join(", ")));
			}
		}
		return { count, warnings };
	}

	/** Color groups as the legend sees them now (for undo and presets). */
	currentGroups(): ColorGroup[] {
		return this.groups.map((g) => ({ ...g }));
	}

	clearSelection(): void {
		if (this.selected.size === 0) return;
		this.selected.clear();
		this.linked.clear();
		this.update(true);
	}

	openSearch(): void {
		const s = this.plugin.settings;
		if (s.collapsed) {
			s.collapsed = false;
			void this.plugin.saveSettingsQuiet();
		}
		this.searchOpen = true;
		this.focusSearch = true;
		this.update(true);
		this.searchInput?.focus();
		this.searchInput?.select();
	}

	toggleFocus(): void {
		this.focusMode = !this.focusMode;
		this.update(true);
	}

	/** Re-reads groups; rebuilds only if something changed (or when forced). */
	update(force = false): void {
		if (this.drag) return;
		const live = readLiveGroups(this.view);
		const groups = live ?? (this.isLocal ? [] : (this.plugin.fileGroups ?? []));
		this.refreshAttributes(force, groups);
		this.countColors(groups);
		this.watchGroups(groups);
		const s = this.plugin.settings;
		const sig = JSON.stringify([
			[...this.colorCounts],
			s.showLegend,
			s.neighbors,
			s.presets.map((p) => p.name),
			this.focusMode,
			this.plugin.history.version,
			s.order,
			this.flashMsg,
			groups,
			this.attrs.signature,
			s.collapsed,
			s.position,
			s.style,
			s.offset[this.sizeKey],
			s.fontSize,
			s.opacity,
			s.highlight,
			s.showTags,
			s.showProperties,
			s.hideEmpty,
			s.showUngrouped,
			this.ungroupedIds.length,
			this.ungroupedRgb,
			s.searchText,
			s.searchScope,
			this.groupsLost(),
			this.isLocal ? 0 : this.plugin.settings.pendingRemoved.length,
			s.collapsedSections,
			s.names,
			s.hidden,
			s.size[this.sizeKey],
			[...this.plugin.legendNotes].map(([k, n]) => [k, n.file.basename, n.name]),
			this.editing,
		]);
		if (!force && sig === this.signature) {
			this.reapplyHighlight();
			return;
		}
		this.signature = sig;
		this.groups = groups;
		if (live) this.plugin.rememberQueries(live.map((g) => g.query));
		// Drop selections whose entry is gone or hidden.
		const known = new Set(this.allEntries().map((e) => e.query));
		for (const q of [...this.selected]) {
			if (!known.has(q) || s.hidden.includes(q)) this.selected.delete(q);
		}
		if (!s.highlight) this.selected.clear();
		for (const q of [...this.linked]) if (!this.selected.has(q)) this.linked.delete(q);
		this.render();
		this.applyHighlight();
	}

	private groupEntries(): Entry[] {
		return this.groups.map((g, index) => ({ query: g.query, rgb: g.rgb, ids: [], index }));
	}

	private sectionEntries(id: SectionId): Entry[] {
		const s = this.plugin.settings;
		const list: AttributeEntry[] = id === "tags" ? (s.showTags ? this.attrs.tags : []) : s.showProperties ? this.attrs.properties : [];
		// A tag or property that already is a color group is listed only once, as the group.
		const groupQueries = new Set(this.groups.map((g) => g.query.trim()));
		const entries = list.filter((a) => !groupQueries.has(a.query)).map((a) => ({ query: a.query, rgb: null, ids: a.ids }));
		// Own order first (set by dragging); entries not in it follow in the usual order.
		const rank = new Map(s.order[id].map((q, i) => [q, i] as const));
		if (rank.size === 0) return entries;
		return entries
			.map((e, i) => ({ e, key: rank.get(e.query) ?? rank.size + i }))
			.sort((a, b) => a.key - b.key)
			.map((x) => x.e);
	}

	private allEntries(): Entry[] {
		const none = this.ungroupedEntry();
		return [...this.groupEntries(), ...(none ? [none] : []), ...this.sectionEntries("tags"), ...this.sectionEntries("properties")];
	}

	private stateOf(query: string): EntryState {
		if (this.plugin.settings.hidden.includes(query)) return "hidden";
		return this.selected.has(query) ? "selected" : "visible";
	}

	private render(): void {
		const s = this.plugin.settings;
		const str = t();
		const el = this.el;
		// Rows are rebuilt, so a row under the pointer will not get pointerleave.
		this.hoverQuery = null;
		// Keep the list where it was scrolled to.
		const scroll = this.bodyEl?.scrollTop ?? 0;
		el.empty();
		el.className = "gcl-legend";
		const offset = s.offset[this.sizeKey];
		el.addClass(`gcl-pos-${this.placement()}`);
		if (this.placement() === "free" && offset) {
			el.setCssProps({ "--gcl-x": String(offset.x), "--gcl-y": String(offset.y) });
		}
		el.toggleClass("is-compact", s.style === "compact");
		el.toggleClass("is-collapsed", s.collapsed);
		el.toggleClass("is-editing", this.editing);
		el.toggleClass("is-off", !s.showLegend);
		el.toggleClass("is-text-search", !s.collapsed && this.textWanted() !== "");
		const hasAny = this.groups.length > 0 || this.attrs.tags.length > 0 || this.attrs.properties.length > 0;
		// A local graph without its own groups (and nothing else to list) gets no legend.
		el.toggleClass("is-empty-local", this.isLocal && !hasAny);
		el.setCssProps({
			"--gcl-font-size": `${s.fontSize}px`,
			"--gcl-bg-opacity": `${s.opacity}%`,
		});
		this.applySize(s.collapsed ? null : s.size[this.sizeKey]);

		const header = el.createDiv({ cls: "gcl-header" });
		const toggle = header.createEl("button", { cls: "gcl-icon-button gcl-toggle clickable-icon" });
		setIcon(toggle, s.collapsed ? "list" : "chevron-down");
		toggle.setAttr("aria-label", s.collapsed ? str.expand : str.collapse);
		setTooltip(toggle, s.collapsed ? str.expand : str.collapse);
		toggle.addEventListener("click", () => {
			s.collapsed = !s.collapsed;
			if (s.collapsed) this.editing = false;
			void this.plugin.saveSettingsAndRefresh();
		});
		const title = header.createSpan({ cls: "gcl-title", text: str.legend });
		setTooltip(title, str.moveHint, { placement: "bottom" });
		title.addEventListener("click", () => {
			if (this.justMoved) {
				this.justMoved = false;
				return;
			}
			toggle.click();
		});
		// Hold the title (or the empty part of the header) and move the legend anywhere on the graph.
		header.addEventListener("pointerdown", (e) => this.armMove(e));
		header.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.openLegendMenu(e);
		});

		// The way out of "only highlighted" stays visible even when the legend is collapsed.
		if (this.wantsFocusButton()) this.addFocusButton(header);

		if (s.collapsed) return;

		this.addHistoryButtons(header);

		if (this.editing) {
			this.addBulkButtons(header);
			this.addPresetButton(header);
			this.addImageButton(header);
		}

		const searchBtn = header.createEl("button", { cls: "gcl-icon-button gcl-search-toggle clickable-icon" });
		setIcon(searchBtn, "search");
		searchBtn.toggleClass("is-active", this.searchOpen);
		searchBtn.setAttr("aria-label", str.search);
		setTooltip(searchBtn, str.search);
		searchBtn.addEventListener("click", () => {
			// Open the box; when it is already open, go back to it with the text selected (like Ctrl+F).
			if (!this.searchOpen) {
				this.searchOpen = true;
				this.focusSearch = true;
				this.update(true);
			}
			this.searchInput?.focus();
			this.searchInput?.select();
		});

		const editBtn = header.createEl("button", { cls: "gcl-icon-button gcl-edit clickable-icon" });
		setIcon(editBtn, this.editing ? "check" : "pencil");
		editBtn.setAttr("aria-label", this.editing ? str.doneEditing : str.edit);
		setTooltip(editBtn, this.editing ? str.doneEditing : str.edit);
		editBtn.addEventListener("click", () => {
			this.editing = !this.editing;
			this.update(true);
		});

		const settingsBtn = header.createEl("button", { cls: "gcl-icon-button gcl-settings clickable-icon" });
		setIcon(settingsBtn, "settings");
		settingsBtn.setAttr("aria-label", str.openSettings);
		setTooltip(settingsBtn, str.openSettings);
		settingsBtn.addEventListener("click", () => this.plugin.openSettings());

		this.searchInput = null;
		if (this.searchOpen) this.renderSearchBox();
		if (this.flashMsg) this.renderFlash(this.flashMsg);
		if (this.groupsLost()) this.renderLostBar();
		if (!this.isLocal && this.plugin.settings.pendingRemoved.length > 0) this.renderRemovedBar();
		if (this.focusMode) this.renderFocusBar();

		const body = el.createDiv({ cls: "gcl-body" });
		this.bodyEl = body;
		this.addResizeHandles();
		if (!hasAny) {
			body.createDiv({ cls: "gcl-empty", text: str.noGroups });
			return;
		}
		this.renderBody();
		body.scrollTop = scroll;
	}

	/** The rows only; called on every keystroke in the search box, so the box keeps its focus. */
	private renderBody(): void {
		const body = this.bodyEl;
		if (!body) return;
		const str = t();
		this.hoverQuery = null;
		body.empty();
		const text = this.renderTextBlock(body);
		const groups = this.groupEntries().filter((e) => this.matches(e));
		this.renderRows(body, groups, "groups");
		const none = this.ungroupedEntry();
		const ungrouped = none && this.matches(none) ? [none] : [];
		this.renderRows(body, ungrouped, "ungrouped");
		const shown = groups.length + ungrouped.length + this.renderSection(body, "tags", str.sectionTags) + this.renderSection(body, "properties", str.sectionProperties);
		if (this.searching() && shown === 0 && !text) body.createDiv({ cls: "gcl-empty", text: str.noMatches });
	}

	private searching(): boolean {
		return this.searchOpen && this.searchText.trim() !== "";
	}

	/** Search matches the shown name and the query, ignoring case. */
	private matches(entry: Entry): boolean {
		if (!this.searching()) return true;
		const q = this.searchText.trim().toLowerCase();
		return this.plugin.displayName(entry.query).toLowerCase().includes(q) || entry.query.toLowerCase().includes(q);
	}

	private renderSearchBox(): void {
		const str = t();
		const box = this.el.createDiv({ cls: "gcl-search" });
		const field = box.createDiv({ cls: "gcl-search-field" });
		const icon = field.createSpan({ cls: "gcl-search-icon" });
		setIcon(icon, "search");
		const input = field.createEl("input", { cls: "gcl-search-input", type: "text", attr: { spellcheck: "false" } });
		input.placeholder = str.search;
		input.value = this.searchText;
		this.searchInput = input;
		// Cross inside the field: clear the text, keep the box open.
		const clear = field.createEl("button", { cls: "gcl-icon-button gcl-search-clear clickable-icon" });
		setIcon(clear, "x");
		clear.setAttr("aria-label", str.clearSearch);
		setTooltip(clear, str.clearSearch);
		clear.toggleClass("is-hidden", this.searchText === "");
		clear.addEventListener("click", () => {
			this.searchText = "";
			input.value = "";
			clear.addClass("is-hidden");
			this.queueTextSearch();
			this.renderBody();
			input.focus();
		});
		// Cross next to the field: close the search.
		const close = box.createEl("button", { cls: "gcl-icon-button gcl-search-close clickable-icon" });
		setIcon(close, "x");
		close.setAttr("aria-label", str.closeSearch);
		setTooltip(close, str.closeSearch);
		close.addEventListener("click", () => this.closeSearch());

		input.addEventListener("input", () => {
			this.searchText = input.value;
			clear.toggleClass("is-hidden", input.value === "");
			this.queueTextSearch();
			this.renderBody();
		});
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Escape") {
				e.preventDefault();
				this.closeSearch();
			} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				// Arrows walk through the found places, Enter opens the chosen one.
				if (this.moveTextCursor(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
			} else if (e.key === "Enter") {
				const chosen = this.textHits()[this.textCursor];
				if (!chosen) return;
				e.preventDefault();
				chosen.click();
			}
		});
		if (this.focusSearch) {
			this.focusSearch = false;
			window.setTimeout(() => input.focus(), 0);
		}
	}

	/** Undo and redo arrows, like in a text editor. */
	private addHistoryButtons(header: HTMLElement): void {
		const str = t();
		const h = this.plugin.history;
		const make = (kind: "undo" | "redo") => {
			const btn = header.createEl("button", { cls: `gcl-icon-button gcl-${kind} clickable-icon` });
			setIcon(btn, kind === "undo" ? "undo-2" : "redo-2");
			if (!btn.querySelector("svg")) setIcon(btn, kind);
			const step = kind === "undo" ? h.peekUndo() : h.peekRedo();
			const can = kind === "undo" ? h.canUndo : h.canRedo;
			btn.toggleClass("is-disabled", !can);
			btn.setAttr("aria-disabled", String(!can));
			let tip = step ? (kind === "undo" ? str.undoTip(step.label) : str.redoTip(step.label)) : kind === "undo" ? str.nothingToUndo : str.nothingToRedo;
			if (step?.note) tip += "\n" + step.note;
			btn.setAttr("aria-label", tip);
			setTooltip(btn, tip);
			btn.addEventListener("click", () => {
				if (!can) return;
				void (kind === "undo" ? this.plugin.undo(this) : this.plugin.redo(this));
			});
		};
		make("undo");
		make("redo");
	}

	/**
	 * A short message under the header, next to where the user works (notices appear in the far corner).
	 * `action` adds an Undo (or Redo) button; `skipped` lists notes left alone by an undo.
	 */
	flash(text: string, undo: boolean, skipped: string[] = []): void {
		const f: Flash = { text, undo, skipped };
		this.flashMsg = f;
		window.clearTimeout(this.flashTimer);
		if (!this.flashSticky(f)) this.scheduleFlashEnd(FLASH_INFO_MS);
		// A bar with a button stays while the pointer is on the legend, so it does not vanish under the cursor.
		else if (!this.pointerInside) this.scheduleFlashEnd(skipped.length ? FLASH_LONG_MS : FLASH_MS);
		this.update(true);
	}

	private flashSticky(f: Flash): boolean {
		return f.undo || f.skipped.length > 0;
	}

	private scheduleFlashEnd(ms: number): void {
		window.clearTimeout(this.flashTimer);
		this.flashTimer = window.setTimeout(() => {
			this.flashMsg = null;
			this.update(true);
		}, ms);
	}

	/** Remembers the groups of the global graph, and notes when they have all gone. */
	private watchGroups(groups: ColorGroup[]): void {
		if (this.isLocal) return;
		if (groups.length > 0) {
			this.noGroupsSince = null;
			this.plugin.rememberGroups(groups);
		} else if (this.noGroupsSince === null) {
			this.noGroupsSince = Date.now();
		}
	}

	/** All color groups of the global graph are gone, but the plugin has a copy of them. */
	private groupsLost(): boolean {
		return (
			!this.isLocal &&
			this.noGroupsSince !== null &&
			Date.now() - this.noGroupsSince >= LOST_GROUPS_MS &&
			this.plugin.settings.groupsBackup.length > 0
		);
	}

	private renderLostBar(): void {
		const str = t();
		const bar = this.el.createDiv({ cls: "gcl-flash gcl-lost" });
		bar.createSpan({ cls: "gcl-flash-text", text: str.groupsLost(this.plugin.settings.groupsBackup.length) });
		const restore = bar.createEl("button", { cls: "gcl-flash-button gcl-flash-redo", text: str.groupsRestore });
		restore.addEventListener("click", () => void this.plugin.restoreGroupsBackup(this));
		const drop = bar.createEl("button", { cls: "gcl-flash-button gcl-flash-undo", text: str.groupsKeepEmpty });
		drop.addEventListener("click", () => void this.plugin.dropGroupsBackup());
	}

	/** Groups removed from graph.json outside Obsidian wait here until the person looks at them. */
	private renderRemovedBar(): void {
		const str = t();
		const bar = this.el.createDiv({ cls: "gcl-flash gcl-lost" });
		bar.createSpan({ cls: "gcl-flash-text", text: str.removedBar(this.plugin.settings.pendingRemoved.length) });
		const review = bar.createEl("button", { cls: "gcl-flash-button gcl-flash-redo", text: str.removedReview });
		review.addEventListener("click", () => this.plugin.openRemovedReview());
	}

	private renderFlash(f: Flash): void {
		const str = t();
		const bar = this.el.createDiv({ cls: "gcl-flash" });
		const text = f.skipped.length ? `${f.text} ${str.skippedNotes(f.skipped.length)}` : f.text;
		bar.createSpan({ cls: "gcl-flash-text", text });
		if (f.skipped.length) {
			const show = bar.createEl("button", { cls: "gcl-flash-button", text: str.showList });
			show.addEventListener("click", () => new PathsModal(this.plugin.app, str.skippedTitle, f.skipped).open());
		}
		if (f.undo) {
			const btn = bar.createEl("button", { cls: "gcl-flash-button gcl-flash-undo", text: str.undo });
			btn.addEventListener("click", () => void this.plugin.undo(this));
		}
		const close = bar.createEl("button", { cls: "gcl-icon-button gcl-flash-close clickable-icon" });
		setIcon(close, "x");
		close.setAttr("aria-label", str.dismiss);
		close.addEventListener("click", () => {
			window.clearTimeout(this.flashTimer);
			this.flashMsg = null;
			this.update(true);
		});
	}

	/** "Only highlighted" is offered when something is highlighted: entries, or notes found by the text search. */
	private wantsFocusButton(): boolean {
		const s = this.plugin.settings;
		return s.highlight && (this.focusMode || (!s.collapsed && (this.selected.size > 0 || this.textIds() !== null)));
	}

	private addFocusButton(header: HTMLElement): void {
		const str = t();
		const btn = header.createEl("button", { cls: "gcl-icon-button gcl-focus clickable-icon" });
		// Right after the title, also when it is added later (text search results came in).
		header.querySelector(".gcl-title")?.insertAdjacentElement("afterend", btn);
		setIcon(btn, "focus");
		btn.toggleClass("is-active", this.focusMode);
		const tip = this.focusMode ? str.focusOff : str.focusOn;
		btn.setAttr("aria-label", tip);
		setTooltip(btn, tip);
		btn.addEventListener("click", () => this.toggleFocus());
	}

	/** Shown while "only highlighted" is on, with a plain way back. */
	private renderFocusBar(): void {
		const str = t();
		const bar = this.el.createDiv({ cls: "gcl-focus-bar" });
		bar.createSpan({ cls: "gcl-focus-text", text: this.selected.size > 0 || this.textIds() !== null ? str.focusActive : str.focusEmpty });
		const exit = bar.createEl("button", { cls: "gcl-focus-exit", text: str.focusExit });
		exit.addEventListener("click", () => this.toggleFocus());
	}

	/** Sets of color groups: apply one, or save the current groups as a new set. */
	private addPresetButton(header: HTMLElement): void {
		const str = t();
		const btn = header.createEl("button", { cls: "gcl-icon-button gcl-presets clickable-icon" });
		setIcon(btn, "palette");
		btn.setAttr("aria-label", str.presets);
		setTooltip(btn, str.presets);
		btn.addEventListener("click", (e) => {
			const menu = new Menu();
			const presets = this.plugin.settings.presets;
			const now = JSON.stringify(this.groups.map((g) => [g.query, g.rgb]));
			for (const p of presets) {
				const current = JSON.stringify(p.groups.map((g) => [g.query, g.rgb])) === now;
				menu.addItem((item) =>
					item
						.setTitle(p.name)
						.setIcon(current ? "check" : "palette")
						.onClick(() => void this.plugin.applyPreset(this, p.name)),
				);
			}
			if (presets.length) menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(str.presetSave)
					.setIcon("save")
					.onClick(() => {
						const groups = this.currentGroups();
						new PresetNameModal(this.plugin.app, presets.map((p) => p.name), (name) => void this.plugin.savePreset(name, groups)).open();
					}),
			);
			this.plugin.showMenu(menu, e);
		});
	}

	private closeSearch(): void {
		this.searchOpen = false;
		this.searchText = "";
		this.resetText();
		this.update(true);
	}

	// ---- text search in the notes ------------------------------------------

	/** What the text search should look for now, or "" (box closed, too short, turned off in the settings). */
	private textWanted(): string {
		return this.searchOpen && this.plugin.settings.searchText ? prepareQuery(this.searchText) : "";
	}

	/** True while this legend shows (or is about to show) text search results; their texts stay in memory. */
	usesTextSearch(): boolean {
		return this.textWanted() !== "";
	}

	/** Paths of the notes the text search found, or null when there is nothing to highlight. */
	private textIds(): string[] | null {
		if (this.textWanted() === "") return null;
		const hits = this.scopedHits();
		return hits.length > 0 ? hits.map((h) => h.path) : null;
	}

	/** The found notes in the chosen scope: only those drawn on this graph, or all of them. */
	private scopedHits(result: SearchResult | null = this.textResult): NoteHit[] {
		if (!result) return [];
		if (this.plugin.settings.searchScope === "all") return result.hits;
		const onGraph = new Set((getRenderer(this.view)?.nodes ?? []).map((n) => n.id));
		return result.hits.filter((h) => onGraph.has(h.path));
	}

	/** The switch under the results: where to look. The choice is kept. */
	private setTextScope(scope: SearchScope): void {
		const s = this.plugin.settings;
		if (s.searchScope === scope) return;
		s.searchScope = scope;
		this.textShown = TEXT_NOTES_STEP;
		this.textExpanded.clear();
		this.textHover = null;
		this.textCursor = -1;
		void this.plugin.saveSettingsQuiet();
		this.syncFocusButton();
		this.applyHighlight();
		void this.loadSnippets();
	}

	private resetText(): void {
		window.clearTimeout(this.textTimer);
		this.textRun++;
		this.textQuery = "";
		this.textResult = null;
		this.textBusy = null;
		this.textShown = TEXT_NOTES_STEP;
		this.textSnippets.clear();
		this.textExpanded.clear();
		this.textHover = null;
		this.textCursor = -1;
		this.plugin.releaseSearchIfIdle();
	}

	/** Called on every keystroke: the search itself starts after a short pause. */
	private queueTextSearch(): void {
		window.clearTimeout(this.textTimer);
		const q = this.textWanted();
		this.el.toggleClass("is-text-search", q !== "");
		if (q === "") {
			if (this.textResult || this.textQuery) {
				this.resetText();
				this.syncFocusButton();
				this.applyHighlight();
			}
			return;
		}
		if (q === this.textQuery) return;
		this.textTimer = window.setTimeout(() => void this.runTextSearch(q, false), TEXT_DELAY_MS);
	}

	private async runTextSearch(q: string, keep: boolean): Promise<void> {
		const run = ++this.textRun;
		const current = () => run === this.textRun;
		this.textQuery = q;
		this.textBusy = null;
		const result = await this.plugin.noteSearch.run(q, () => !current(), (p) => {
			this.textBusy = p;
			this.renderBody();
		});
		if (!result || !current()) return;
		if (!keep) {
			this.textShown = TEXT_NOTES_STEP;
			this.textExpanded.clear();
			this.textCursor = -1;
		}
		const fresh = new Map<string, { limit: number; list: Snippet[] }>();
		for (const hit of this.scopedHits(result).slice(0, this.textShown)) {
			const limit = this.snippetLimit(hit.path);
			fresh.set(hit.path, { limit, list: await this.plugin.noteSearch.snippetsOf(hit.path, q, limit) });
			if (!current()) return;
		}
		this.textSnippets = fresh;
		this.textResult = result;
		this.textBusy = null;
		this.textHover = null;
		this.renderBody();
		this.syncFocusButton();
		this.applyHighlight();
	}

	private snippetLimit(path: string): number {
		return this.textExpanded.has(path) ? TEXT_SNIPPETS_MORE : TEXT_SNIPPETS;
	}

	/** Reads the snippets that the list needs and does not have yet, then draws the list again. */
	private async loadSnippets(): Promise<void> {
		const result = this.textResult;
		if (!result) return;
		const run = this.textRun;
		for (const hit of this.scopedHits(result).slice(0, this.textShown)) {
			const have = this.textSnippets.get(hit.path);
			const limit = this.snippetLimit(hit.path);
			if (have && have.limit >= limit) continue;
			const list = await this.plugin.noteSearch.snippetsOf(hit.path, result.query, limit);
			if (run !== this.textRun) return;
			this.textSnippets.set(hit.path, { limit, list });
		}
		this.renderBody();
	}

	/** The header's "only highlighted" button comes and goes with the results, without redrawing the search box. */
	private syncFocusButton(): void {
		const header = this.el.querySelector<HTMLElement>(".gcl-header");
		if (!header) return;
		const have = header.querySelector(".gcl-focus");
		const want = this.wantsFocusButton();
		if (want && !have) this.addFocusButton(header);
		else if (!want && have) have.remove();
	}

	private textHits(): HTMLElement[] {
		return Array.from(this.bodyEl?.querySelectorAll<HTMLElement>(".gcl-hit") ?? []);
	}

	/** Arrow keys in the search box: the next or previous found place. False when there is nowhere to go. */
	private moveTextCursor(step: number): boolean {
		const items = this.textHits();
		if (items.length === 0) return false;
		const next = Math.min(items.length - 1, Math.max(0, this.textCursor + step));
		this.textCursor = next;
		this.markTextCursor(items);
		const path = items[next]?.dataset.path ?? null;
		if (path !== this.textHover) {
			this.textHover = path;
			this.applyHighlight();
		}
		return true;
	}

	/** A clicked place becomes the one the arrow keys go on from. */
	private setTextCursor(el: HTMLElement): void {
		const items = this.textHits();
		this.textCursor = items.indexOf(el);
		this.markTextCursor(items);
	}

	private markTextCursor(items: HTMLElement[]): void {
		items.forEach((el, i) => el.toggleClass("is-cursor", i === this.textCursor));
		items[this.textCursor]?.scrollIntoView({ block: "nearest" });
	}

	/**
	 * What the search found in the text of the notes, above the legend's own rows: the rows move down,
	 * and everything scrolls together. Returns true when the block is shown.
	 */
	private renderTextBlock(body: HTMLElement): boolean {
		const q = this.textWanted();
		if (q === "") return false;
		const str = t();
		const app = this.plugin.app;
		const result = this.textResult;
		const block = body.createDiv({ cls: "gcl-text" });

		const head = block.createDiv({ cls: "gcl-section gcl-text-head" });
		const icon = head.createSpan({ cls: "gcl-section-icon" });
		setIcon(icon, this.textCollapsed ? "chevron-right" : "chevron-down");
		head.createSpan({ cls: "gcl-section-title", text: str.textTitle });
		const everywhere = this.plugin.settings.searchScope === "all";
		const hits = this.scopedHits(result);
		const total = everywhere && result ? result.total : hits.reduce((sum, h) => sum + h.count, 0);
		if (result) head.createSpan({ cls: "gcl-section-count", text: String(total) });
		head.addEventListener("click", () => {
			this.textCollapsed = !this.textCollapsed;
			this.renderBody();
		});
		if (this.textCollapsed) return true;

		const nodes = new Map((getRenderer(this.view)?.nodes ?? []).map((n) => [n.id, n] as const));
		const stale = !result || result.query !== q;
		if (this.textBusy) {
			block.createDiv({ cls: "gcl-text-summary", text: str.textSearching(this.textBusy.done, this.textBusy.total) });
		} else if (!result) {
			block.createDiv({ cls: "gcl-text-summary", text: str.textWait });
		}
		if (looksLikeQuery(this.searchText)) {
			const hint = block.createDiv({ cls: "gcl-text-hint" });
			hint.createSpan({ text: str.textQueryHint });
			this.addCoreSearchButton(hint);
		}
		if (!result) return true;

		// Notes with matches on the other side of the switch: said every time, so that nothing is lost unseen.
		const outside = everywhere ? 0 : result.hits.length - hits.length;
		if (hits.length === 0) {
			let none = everywhere ? str.textNone : str.textNoneGraph;
			if (outside > 0) none += " " + str.textOutsideNotes(outside);
			block.createDiv({ cls: "gcl-text-summary", text: none });
		} else if (!this.textBusy) {
			const onGraph = hits.filter((h) => nodes.has(h.path)).length;
			let summary = str.textSummary(total, hits.length);
			if (onGraph < hits.length) summary += " · " + str.textOnGraph(onGraph);
			if (outside > 0) summary += " · " + str.textOutside(outside);
			block.createDiv({ cls: "gcl-text-summary", text: summary });
		}
		// Where to look: the notes drawn on this graph, or every note of the vault.
		const scope = block.createDiv({ cls: "gcl-text-scope" });
		const choices: [SearchScope, string][] = [
			["graph", str.textScopeGraph],
			["all", str.textScopeAll],
		];
		for (const [value, label] of choices) {
			const on = everywhere === (value === "all");
			const btn = scope.createEl("button", { cls: "gcl-text-scope-button", text: label, attr: { "aria-pressed": String(on) } });
			btn.toggleClass("is-active", on);
			btn.addEventListener("click", () => this.setTextScope(value));
		}
		block.toggleClass("is-stale", stale);

		let missing = false;
		for (const hit of hits.slice(0, this.textShown)) {
			const file = app.vault.getAbstractFileByPath(hit.path);
			if (!(file instanceof TFile)) continue;
			const snips = this.textSnippets.get(hit.path)?.list;
			if (!snips) missing = true;
			const inText = hit.count - (hit.inName ? 1 : 0);
			const group = block.createDiv({ cls: "gcl-hit-group" });
			group.addEventListener("pointerenter", (e) => {
				if (e.pointerType !== "mouse" || this.textHover === hit.path) return;
				this.textHover = hit.path;
				this.applyHighlight();
			});
			group.addEventListener("pointerleave", () => {
				if (this.textHover !== hit.path) return;
				this.textHover = null;
				this.applyHighlight();
			});

			const row = group.createDiv({ cls: "gcl-hit gcl-hit-note" });
			row.dataset.path = hit.path;
			const node = nodes.get(hit.path);
			const rgb = node ? nodeRgb(node) : null;
			const swatch = row.createSpan({ cls: "gcl-swatch" });
			if (rgb !== null) swatch.setCssProps({ "--gcl-color": rgbToHex(rgb) });
			else swatch.addClass("is-attribute");
			swatch.toggleClass("is-off-graph", !node);
			const name = row.createSpan({ cls: "gcl-label", text: file.basename });
			const where = file.parent && file.parent.path !== "/" ? file.parent.path : "";
			setTooltip(name, where ? `${where}/${file.name}` : file.name, { placement: "top" });
			if (!node) row.createSpan({ cls: "gcl-hit-tag", text: str.textOffGraph });
			if (hit.inName && inText === 0) row.createSpan({ cls: "gcl-hit-tag", text: str.textInName });
			row.createSpan({ cls: "gcl-count", text: String(hit.count) });
			row.addEventListener("click", (e) => {
				this.setTextCursor(row);
				void this.openHit(hit.path, snips?.[0] ?? null, e.ctrlKey || e.metaKey);
			});

			const shown = (snips ?? []).slice(0, this.snippetLimit(hit.path));
			for (const snip of shown) {
				const line = group.createDiv({ cls: "gcl-hit gcl-hit-snippet" });
				line.dataset.path = hit.path;
				for (const part of snip.parts) {
					if (part.hit) line.createEl("mark", { cls: "gcl-hit-mark", text: part.text });
					else line.createSpan({ text: part.text });
				}
				line.addEventListener("click", (e) => {
					this.setTextCursor(line);
					void this.openHit(hit.path, snip, e.ctrlKey || e.metaKey);
				});
			}
			// Matches in the lines that are not shown yet.
			const rest = inText - shown.reduce((sum, x) => sum + x.matches, 0);
			if (snips && rest > 0 && !this.textExpanded.has(hit.path)) {
				const more = group.createDiv({ cls: "gcl-hit-more", text: str.tagMore(rest) });
				more.addEventListener("click", () => {
					this.textExpanded.add(hit.path);
					void this.loadSnippets();
				});
			}
		}
		const hidden = hits.length - this.textShown;
		if (hidden > 0) {
			const more = block.createDiv({ cls: "gcl-text-more", text: str.textMoreNotes(hidden) });
			more.addEventListener("click", () => {
				this.textShown += TEXT_NOTES_STEP;
				void this.loadSnippets();
			});
		}
		if (result.skipped > 0) block.createDiv({ cls: "gcl-text-summary", text: str.textSkipped(result.skipped) });
		if (hits.length > 0 && !looksLikeQuery(this.searchText)) {
			this.addCoreSearchButton(block.createDiv({ cls: "gcl-text-foot" }));
		}
		if (missing) void this.loadSnippets();
		if (this.textCursor >= 0) this.markTextCursor(this.textHits());
		return true;
	}

	/** For anything the plain search does not do: the same text in Obsidian's own search. */
	private addCoreSearchButton(parent: HTMLElement): void {
		const str = t();
		const btn = parent.createEl("button", { cls: "gcl-flash-button gcl-text-core", text: str.textOpenCore });
		btn.addEventListener("click", () => {
			if (!openGlobalSearch(this.plugin.app, this.searchText.trim())) new Notice(str.searchOff);
		});
	}

	/** Opens a found note with the cursor on the found text. The graph stays on screen where there is room. */
	private async openHit(path: string, snip: Snippet | null, newTab: boolean): Promise<void> {
		const app = this.plugin.app;
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		try {
			const leaf = this.leafForHit(newTab);
			await leaf.openFile(file, { active: true, eState: snip ? { line: snip.line } : undefined });
			const view = leaf.view;
			if (!snip || !(view instanceof MarkdownView) || view.getMode() !== "source") return;
			// Reading view only scrolls to the line; the editor also selects the found text.
			const from = { line: snip.line, ch: snip.ch };
			const to = { line: snip.line, ch: snip.ch + snip.length };
			view.editor.setSelection(from, to);
			view.editor.scrollIntoView({ from, to }, true);
		} catch {
			new Notice(t().textOpenFailed);
		}
	}

	private leafForHit(newTab: boolean): WorkspaceLeaf {
		const ws = this.plugin.app.workspace;
		const own = this.view.leaf;
		// Phones and tablets: the note takes the graph's place; "back" returns to the graph.
		if (Platform.isMobile) return own;
		if (newTab) return ws.getLeaf("tab");
		const root = own.getRoot();
		// A graph in a side panel: the note goes to the main area, as links there do.
		if (root === ws.leftSplit || root === ws.rightSplit) return ws.getLeaf(false);
		const usable = (leaf: WorkspaceLeaf) => leaf !== own && leaf.parent !== own.parent && leaf.getRoot() === root && !leaf.getViewState().pinned;
		const leaves: WorkspaceLeaf[] = [];
		ws.iterateAllLeaves((leaf) => {
			if (usable(leaf)) leaves.push(leaf);
		});
		// The tab used last time; else a note or an empty tab that is on screen next to the graph; else a new split.
		if (this.resultLeaf && leaves.includes(this.resultLeaf)) return this.resultLeaf;
		const beside = leaves.find((leaf) => ["markdown", "empty"].includes(leaf.view.getViewType()) && leaf.view.containerEl.isShown());
		this.resultLeaf = beside ?? ws.createLeafBySplit(own, "vertical");
		return this.resultLeaf;
	}

	/** A collapsible block of tags or properties under the color groups. */
	/** Returns how many rows it shows. */
	private renderSection(body: HTMLElement, id: SectionId, name: string): number {
		const entries = this.sectionEntries(id).filter((e) => this.matches(e));
		if (entries.length === 0) return 0;
		const s = this.plugin.settings;
		// While searching, sections with matches open up.
		const collapsed = !this.searching() && s.collapsedSections.includes(id);
		const head = body.createDiv({ cls: "gcl-section" });
		const icon = head.createSpan({ cls: "gcl-section-icon" });
		setIcon(icon, collapsed ? "chevron-right" : "chevron-down");
		head.createSpan({ cls: "gcl-section-title", text: name });
		head.createSpan({ cls: "gcl-section-count", text: String(entries.length) });
		head.addEventListener("click", () => {
			if (collapsed) s.collapsedSections.remove(id);
			else s.collapsedSections.push(id);
			void this.plugin.saveSettingsAndRefresh();
		});
		// Right-click on the section title: back to the usual order.
		head.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle(t().resetOrder).setIcon("arrow-down-up");
				if (s.order[id].length === 0) item.setDisabled(true);
				else
					item.onClick(() => {
						void this.plugin.recordSettings(t().stepResetOrder, () => (s.order[id] = []), {
							legend: this,
							flash: t().orderReset,
						});
					});
			});
			this.plugin.showMenu(menu, e);
		});
		if (collapsed) return 0;
		this.renderRows(body, entries, id);
		return entries.length;
	}

	private renderRows(body: HTMLElement, entries: Entry[], section: DragSection | "ungrouped"): void {
		const s = this.plugin.settings;
		const str = t();
		for (const entry of entries) {
			const state = this.stateOf(entry.query);
			if (state === "hidden" && !this.editing) continue;
			const info = entry.index !== undefined ? this.groupInfo(entry.index) : null;
			// An empty group stays out of the way, except in edit mode, while searching or while highlighted.
			if (info && state === "visible" && !this.editing && !this.searching() && this.isEmpty(info)) continue;
			const row = body.createDiv({ cls: "gcl-row" });
			row.toggleClass("is-hidden", state === "hidden");
			row.toggleClass("is-selected", state === "selected");
			row.dataset.query = entry.query;
			row.dataset.section = section;
			if (entry.index !== undefined) row.dataset.index = String(entry.index);

			const dot = entry.rgb ?? entry.ungrouped?.rgb ?? null;
			if (dot !== null) {
				const swatch = row.createSpan({ cls: "gcl-swatch" });
				swatch.setCssProps({ "--gcl-color": rgbToHex(dot) });
			} else if (entry.ungrouped) {
				// Obsidian gives these nodes no color of their own: the dot takes the theme's node grey.
				row.createSpan({ cls: "gcl-swatch is-ungrouped" });
			} else {
				// Tags and properties have no color of their own.
				row.createSpan({ cls: "gcl-swatch is-attribute" });
			}

			// Edit mode: a grip to drag by (on phones the only way, since a long press opens the menu).
			const movable = !entry.ungrouped;
			if (this.editing && movable) {
				const grip = row.createSpan({ cls: "gcl-grip" });
				setIcon(grip, "grip-vertical");
				setTooltip(grip, section === "groups" ? str.dragHint : str.dragHintOwn);
				grip.addEventListener("pointerdown", (e) => {
					if (e.button !== 0) return;
					e.preventDefault();
					e.stopPropagation();
					this.startDrag(row, e);
				});
				grip.addEventListener("click", (e) => e.stopPropagation());
				row.prepend(grip);
			}
			// Mouse: hold the entry itself and move it.
			if (movable) row.addEventListener("pointerdown", (e) => this.armDrag(row, e));

			// A color group nobody named shows its raw query: say so, and how to name it.
			const unnamed = entry.rgb !== null && !!entry.query && !this.plugin.hasName(entry.query);
			const label = row.createSpan({ cls: "gcl-label", text: this.plugin.displayName(entry.query) });
			if (unnamed) label.addClass("is-unnamed");
			const tip = entry.ungrouped
				? `${str.ungroupedHint}\n${str.menuHint}`
				: entry.query
					? `${entry.query}\n${unnamed ? str.noNameHint + "\n" : ""}${str.menuHint}`
					: str.menuHint;
			setTooltip(row, tip, {
				placement: s.position.endsWith("right") ? "left" : "right",
			});
			if (this.linked.has(entry.query) && !s.neighbors) {
				// Its linked notes are highlighted too (chosen in the entry menu).
				const mark = row.createSpan({ cls: "gcl-linked-mark" });
				setIcon(mark, "link");
				setTooltip(mark, str.neighborsOn, { placement: s.position.endsWith("right") ? "left" : "right" });
			}
			if (info) {
				if (info.warnings.length > 0) {
					const warn = row.createSpan({ cls: "gcl-warn" });
					// Lucide renamed this icon; older Obsidian versions only know the old name.
					setIcon(warn, "triangle-alert");
					if (!warn.querySelector("svg")) setIcon(warn, "alert-triangle");
					setTooltip(warn, info.warnings.join("\n"), { placement: s.position.endsWith("right") ? "left" : "right" });
				}
				row.toggleClass("is-empty", info.count === 0);
				row.createSpan({ cls: "gcl-count", text: String(info.count) });
			} else if (entry.ids.length > 0) {
				row.createSpan({ cls: "gcl-count", text: String(entry.ids.length) });
			}

			// Click: highlight on/off. Right-click or long press: the entry menu.
			row.addEventListener("click", (e) => {
				if (this.suppressClick) {
					this.suppressClick = false;
					return;
				}
				if (!s.highlight) {
					this.openMenu(e, entry);
					return;
				}
				this.setState(entry.query, state === "selected" ? "visible" : "selected");
			});
			row.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				this.openMenu(e, entry);
			});
			this.addLongPress(row, entry);

			if (this.editing) {
				if (!entry.ungrouped) {
					const rename = row.createEl("button", { cls: "gcl-icon-button clickable-icon" });
					setIcon(rename, "pencil");
					rename.setAttr("aria-label", str.rename);
					rename.addEventListener("click", (e) => {
						e.stopPropagation();
						this.openMenu(e, entry);
					});
				}
				// One eye, three states: grey = shown, blue = highlighted, crossed out = hidden.
				const eye = row.createEl("button", { cls: "gcl-icon-button gcl-eye clickable-icon" });
				setIcon(eye, state === "hidden" ? "eye-off" : "eye");
				eye.toggleClass("is-selected", state === "selected");
				const next = this.nextState(state);
				const tip = next === "selected" ? str.menuPin : next === "hidden" ? str.hide : str.show;
				eye.setAttr("aria-label", tip);
				setTooltip(eye, tip);
				eye.addEventListener("click", (e) => {
					e.stopPropagation();
					this.setState(entry.query, next);
				});
				continue;
			}

			row.addEventListener("pointerenter", (e) => {
				if (e.pointerType === "touch" || this.focusMode || this.drag) return;
				this.hoverQuery = entry.query;
				this.applyHighlight();
			});
			row.addEventListener("pointerleave", () => {
				if (this.hoverQuery !== entry.query) return;
				this.hoverQuery = null;
				this.applyHighlight();
			});
		}
	}

	/** Mouse down on an entry: it is picked up only once the pointer moves a little, so a click stays a click. */
	private armDrag(row: HTMLElement, e: PointerEvent): void {
		if (e.button !== 0 || e.pointerType === "touch" || this.drag) return;
		const target = e.targetNode;
		if (target?.instanceOf(Element) && target.closest("button")) return;
		const x0 = e.clientX;
		const y0 = e.clientY;
		const move = (ev: PointerEvent) => {
			if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < DRAG_THRESHOLD) return;
			stop();
			this.startDrag(row, ev, y0);
		};
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	}

	/**
	 * Picks the entry up: a slightly transparent copy follows the pointer, the entry's place stays
	 * empty, and the other entries of the same section move apart to show where it will land.
	 * It only moves within its own section; Esc or leaving the section puts it back.
	 */
	private startDrag(row: HTMLElement, e: PointerEvent, grabY = e.clientY): void {
		const body = this.bodyEl;
		const section = row.dataset.section as DragSection | undefined;
		if (!body || !section || this.drag) return;
		const rect = row.getBoundingClientRect();
		const ghost = row.cloneNode(true) as HTMLElement;
		ghost.addClass("gcl-ghost");
		ghost.removeClass("is-selected");
		const font = getComputedStyle(row).fontSize;
		ghost.setCssProps({
			"--gcl-ghost-x": `${rect.left}px`,
			"--gcl-ghost-y": `${rect.top}px`,
			"--gcl-ghost-w": `${rect.width}px`,
			"--gcl-ghost-h": `${rect.height}px`,
			"--gcl-ghost-font": font,
		});
		activeDocument.body.appendChild(ghost);
		const home = row.nextSibling;
		const offsetY = grabY - rect.top;
		row.addClass("is-placeholder");
		this.el.addClass("is-dragging");
		this.hoverQuery = null;
		this.applyHighlight();
		this.suppressClick = true;
		let outside = false;

		const siblings = () =>
			Array.from(body.querySelectorAll<HTMLElement>(`.gcl-row[data-section="${section}"]`)).filter((x) => x !== row);
		/** Move the empty place, animating the entries that shift (FLIP). */
		const place = (before: Node | null) => {
			if (row.nextSibling === before || row === before) return;
			const all = siblings();
			const old = new Map(all.map((x) => [x, x.getBoundingClientRect().top]));
			body.insertBefore(row, before);
			for (const x of all) {
				const dy = (old.get(x) ?? 0) - x.getBoundingClientRect().top;
				if (dy) x.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 140, easing: "ease-out" });
			}
		};
		const move = (ev: PointerEvent) => {
			ghost.setCssProps({ "--gcl-ghost-y": `${ev.clientY - offsetY}px` });
			const box = body.getBoundingClientRect();
			if (ev.clientY < box.top + 18) body.scrollTop -= 10;
			else if (ev.clientY > box.bottom - 18) body.scrollTop += 10;
			const list = siblings();
			const first = list[0];
			const last = list[list.length - 1];
			if (!first || !last) return;
			const top = Math.min(first.getBoundingClientRect().top, row.getBoundingClientRect().top) - rect.height;
			const bottom = Math.max(last.getBoundingClientRect().bottom, row.getBoundingClientRect().bottom) + rect.height;
			outside = ev.clientY < top || ev.clientY > bottom;
			ghost.toggleClass("is-outside", outside);
			if (outside) {
				place(home);
				return;
			}
			const target = list.find((x) => {
				const b = x.getBoundingClientRect();
				return ev.clientY < b.top + b.height / 2;
			});
			place(target ?? last.nextSibling);
		};
		const finish = (drop: boolean) => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("keydown", key, true);
			ghost.remove();
			row.removeClass("is-placeholder");
			this.el.removeClass("is-dragging");
			// The click that follows the mouse up must not toggle the highlight.
			window.setTimeout(() => (this.suppressClick = false), 0);
			const moved = drop && !outside && row.nextSibling !== home;
			const after = row.nextElementSibling;
			const next = after?.instanceOf(HTMLElement) && after.dataset.section === section ? after : null;
			const prevEl = row.previousElementSibling;
			const prev = prevEl?.instanceOf(HTMLElement) && prevEl.dataset.section === section ? prevEl : null;
			if (!moved) body.insertBefore(row, home);
			this.drag = false;
			if (moved) this.dropEntry(section, row, next, prev);
			else this.update(true);
		};
		const up = () => finish(true);
		const cancel = () => finish(false);
		const key = (ev: KeyboardEvent) => {
			if (ev.key !== "Escape") return;
			ev.preventDefault();
			ev.stopPropagation();
			finish(false);
		};
		this.drag = true;
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("keydown", key, true);
		move(e);
	}

	/** Saves a new order: groups in the graph settings, tags and properties in the plugin. */
	private dropEntry(section: DragSection, row: HTMLElement, next: HTMLElement | null, prev: HTMLElement | null): void {
		const str = t();
		const query = row.dataset.query ?? "";
		const name = this.plugin.displayName(query);
		if (section === "groups") {
			const from = Number(row.dataset.index);
			const groups = this.currentGroups();
			if (!Number.isInteger(from) || from < 0 || from >= groups.length) return this.update(true);
			const [moved] = groups.splice(from, 1);
			if (!moved) return this.update(true);
			// Neighbors by their place in the full list (hidden or filtered groups keep their places).
			const shift = (i: number) => (i > from ? i - 1 : i);
			let at = groups.length;
			if (next?.dataset.index !== undefined) at = shift(Number(next.dataset.index));
			else if (prev?.dataset.index !== undefined) at = shift(Number(prev.dataset.index)) + 1;
			groups.splice(at, 0, moved);
			void this.plugin.changeGroups(this, groups, str.stepMove(name), str.groupMoved(name));
			return;
		}
		const s = this.plugin.settings;
		const full = this.sectionEntries(section).map((e) => e.query).filter((q) => q !== query);
		let at = full.length;
		const nq = next?.dataset.query;
		const pq = prev?.dataset.query;
		if (nq !== undefined && full.includes(nq)) at = full.indexOf(nq);
		else if (pq !== undefined && full.includes(pq)) at = full.indexOf(pq) + 1;
		full.splice(at, 0, query);
		void this.plugin.recordSettings(str.stepMove(name), () => (s.order[section] = full), {
			legend: this,
			flash: str.groupMoved(name),
		});
	}

	/** Phones and tablets have no right click: a long press opens the menu. */
	private addLongPress(row: HTMLElement, entry: Entry): void {
		let timer = 0;
		const cancel = () => window.clearTimeout(timer);
		row.addEventListener("pointerdown", (e) => {
			if (e.pointerType !== "touch") return;
			cancel();
			timer = window.setTimeout(() => {
				this.suppressClick = true;
				this.openMenu(new MouseEvent("contextmenu", { clientX: e.clientX, clientY: e.clientY }), entry);
			}, LONG_PRESS_MS);
		});
		for (const type of ["pointerup", "pointercancel", "pointerleave"]) row.addEventListener(type, cancel);
	}

	/**
	 * Header buttons in edit mode. The eye goes round for all entries at once, like the eye of one entry:
	 * highlight all → hide all → show all. The cross clears all highlights.
	 */
	private addBulkButtons(header: HTMLElement): void {
		const s = this.plugin.settings;
		const str = t();
		// While searching, the bulk buttons act on the entries that match.
		const current = () => this.allEntries().filter((e) => this.matches(e));
		const nextFor = (entries: Entry[]): EntryState => {
			const allHidden = entries.every((e) => s.hidden.includes(e.query));
			const allSelected = entries.every((e) => this.selected.has(e.query));
			if (!s.highlight) return allHidden ? "visible" : "hidden";
			return allSelected ? "hidden" : allHidden ? "visible" : "selected";
		};
		const entries = current();
		if (entries.length === 0) return;
		const allHidden = entries.every((e) => s.hidden.includes(e.query));
		const allSelected = entries.every((e) => this.selected.has(e.query));
		const next = nextFor(entries);
		const all = header.createEl("button", { cls: "gcl-icon-button gcl-eye gcl-all clickable-icon" });
		setIcon(all, allHidden ? "eye-off" : "eye");
		all.toggleClass("is-selected", allSelected);
		const tip = next === "selected" ? str.selectAll : next === "hidden" ? str.hideAll : str.showAll;
		all.setAttr("aria-label", tip);
		setTooltip(all, tip);
		all.addEventListener("click", () => {
			const list = current();
			const step = nextFor(list);
			const queries = list.map((e) => e.query);
			if (step === "selected") for (const q of queries) this.selected.add(q);
			else for (const q of queries) this.selected.delete(q);
			const label = step === "hidden" ? str.stepHideAll : str.stepShowAll;
			void this.plugin
				.recordSettings(label, () => {
					if (step === "hidden") {
						for (const q of queries) if (!s.hidden.includes(q)) s.hidden.push(q);
					} else {
						s.hidden = s.hidden.filter((q) => !queries.includes(q));
					}
				})
				.then(() => this.update(true));
		});

		if (!s.highlight) return;
		const none = header.createEl("button", { cls: "gcl-icon-button gcl-clear-all clickable-icon" });
		setIcon(none, "x");
		none.setAttr("aria-label", str.clearSelection);
		setTooltip(none, str.clearSelection);
		none.toggleClass("is-disabled", this.selected.size === 0);
		none.addEventListener("click", () => {
			this.selected.clear();
			this.linked.clear();
			this.update(true);
		});
	}

	/** The entry menu's "Highlight linked notes": highlights the entry with the notes linked to it, or stops that. */
	private toggleLinked(query: string): void {
		if (this.linked.has(query)) {
			this.linked.delete(query);
		} else {
			this.linked.add(query);
			this.selected.add(query);
		}
		this.update(true);
	}

	/** Eye button order: shown → highlighted → hidden → shown (no "highlighted" when highlighting is off). */
	private nextState(state: EntryState): EntryState {
		if (state === "visible") return this.plugin.settings.highlight ? "selected" : "hidden";
		if (state === "selected") return "hidden";
		return "visible";
	}

	private setState(query: string, state: EntryState): void {
		const s = this.plugin.settings;
		const wasHidden = s.hidden.includes(query);
		if (state === "selected") this.selected.add(query);
		else {
			this.selected.delete(query);
			this.linked.delete(query);
		}
		if ((state === "hidden") !== wasHidden) {
			const name = this.plugin.displayName(query);
			void this.plugin.recordSettings(wasHidden ? t().stepShow(name) : t().stepHide(name), () => {
				if (state === "hidden") s.hidden.push(query);
				else s.hidden.remove(query);
			});
		} else {
			this.update(true);
		}
	}

	/** Menu for one entry: highlight, open its page, rename (legend only or everywhere), hide. */
	private openMenu(evt: MouseEvent, entry: Entry): void {
		const str = t();
		const s = this.plugin.settings;
		const query = entry.query;
		const menu = new Menu();
		if (s.highlight) {
			const selected = this.selected.has(query);
			menu.addItem((item) => {
				item
					.setTitle(selected ? str.menuUnpin : str.menuPin)
					.setIcon("eye")
					.onClick(() => this.setState(query, selected ? "visible" : "selected"));
				// "Highlight" gets the same blue eye as a highlighted entry.
				if (!selected) {
					const dom = (item as unknown as { dom?: unknown }).dom;
					if (dom instanceof HTMLElement) dom.addClass("gcl-menu-select");
				}
			});
			// Linked notes of this entry only. When the setting already does it for every entry, the item shows that.
			const linked = s.neighbors || this.linked.has(query);
			menu.addItem((item) => {
				item
					.setTitle(str.neighbors)
					.setIcon("link")
					.setChecked(linked)
					.setDisabled(s.neighbors)
					.onClick(() => this.toggleLinked(query));
			});
			menu.addSeparator();
		}
		const page = this.plugin.legendNote(query)?.file;
		if (page) {
			menu.addItem((item) =>
				item
					.setTitle(str.openPage)
					.setIcon("file-text")
					.onClick(() => void this.plugin.app.workspace.getLeaf("tab").openFile(page)),
			);
		}
		menu.addItem((item) => item.setTitle(str.showNotes).setIcon("list").onClick(() => this.showNotes(entry)));
		if (entry.ungrouped) {
			// No group behind it: nothing to rename or to make a group of.
			menu.addSeparator();
			const off = s.hidden.includes(query);
			menu.addItem((item) =>
				item
					.setTitle(off ? str.show : str.hide)
					.setIcon(off ? "eye" : "eye-off")
					.onClick(() => this.setState(query, off ? "visible" : "hidden")),
			);
			this.plugin.showMenu(menu, evt);
			return;
		}
		if (entry.rgb === null) {
			menu.addItem((item) =>
				item
					.setTitle(str.makeGroup)
					.setIcon("palette")
					.onClick(() => this.makeGroup(entry)),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(entry.rgb !== null && !this.plugin.hasName(query) ? str.menuGiveName : str.menuRenameLegend)
				.setIcon("pencil")
				.onClick(() => new EntryModal(this.plugin, query, "legend", null, this).open()),
		);
		const hasTags = extractTags(query).length > 0;
		menu.addItem((item) => {
			item.setTitle(hasTags ? str.menuRenameEverywhere : str.menuRenameEverywhereNoTags).setIcon("pencil-line");
			if (hasTags) item.onClick(() => new EntryModal(this.plugin, query, "tag", entry.rgb, this).open());
			else item.setDisabled(true);
		});
		menu.addSeparator();
		const hidden = s.hidden.includes(query);
		menu.addItem((item) =>
			item
				.setTitle(hidden ? str.show : str.hide)
				.setIcon(hidden ? "eye" : "eye-off")
				.onClick(() => this.setState(query, hidden ? "visible" : "hidden")),
		);
		this.plugin.showMenu(menu, evt);
	}

	/** The notes of an entry, as the graph shows them now. */
	private showNotes(entry: Entry): void {
		const app = this.plugin.app;
		let ids: string[];
		let shared = false;
		if (entry.rgb !== null) {
			const rgb = entry.rgb;
			ids = (getRenderer(this.view)?.nodes ?? []).filter((n) => nodeRgb(n) === rgb).map((n) => n.id);
			shared = this.groups.filter((g) => g.rgb === rgb).length > 1;
		} else {
			ids = entry.ids;
		}
		const files = ids.map((id) => app.vault.getAbstractFileByPath(id)).filter((f): f is TFile => f instanceof TFile);
		new NotesModal(app, this.plugin.displayName(entry.query), entry.ungrouped ? "" : entry.query, files, shared).open();
	}

	/** A tag or property becomes a color group of the graph. */
	private makeGroup(entry: Entry): void {
		const name = this.plugin.displayName(entry.query);
		const start = freeColor(this.groups.map((g) => g.rgb));
		new NewGroupModal(this.plugin.app, name, entry.query, start, (rgb, first) => {
			const group: ColorGroup = { query: entry.query, rgb, alpha: 1 };
			const next = first ? [group, ...this.currentGroups()] : [...this.currentGroups(), group];
			void this.plugin.changeGroups(this, next, t().stepNewGroup(name), t().groupCreated(name));
		}).open();
	}

	// ---- place, style and picture -------------------------------------------

	/** The corner the legend stands in, or "free" when it was moved and its place is known. */
	private placement(): string {
		const s = this.plugin.settings;
		if (s.position !== "free") return s.position;
		return s.offset[this.sizeKey] ? "free" : "top-left";
	}

	/** Moving starts only after the pointer travels a few pixels, so a plain click still collapses the legend. */
	private armMove(e: PointerEvent): void {
		if (e.button !== 0) return;
		const target = e.target;
		if (target instanceof Element && target.closest("button, .gcl-resize")) return;
		const win = this.el.win;
		const startX = e.clientX;
		const startY = e.clientY;
		let moving = false;
		let rect = this.el.getBoundingClientRect();
		let box = this.view.contentEl.getBoundingClientRect();
		let x = 0;
		let y = 0;
		const move = (ev: PointerEvent) => {
			if (ev.pointerId !== e.pointerId) return;
			if (!moving) {
				if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
				moving = true;
				rect = this.el.getBoundingClientRect();
				box = this.view.contentEl.getBoundingClientRect();
				this.el.addClass("is-moving");
			}
			ev.preventDefault();
			const left = Math.min(Math.max(0, rect.left - box.left + ev.clientX - startX), Math.max(0, box.width - rect.width));
			const top = Math.min(Math.max(0, rect.top - box.top + ev.clientY - startY), Math.max(0, box.height - rect.height));
			x = box.width > 0 ? left / box.width : 0;
			y = box.height > 0 ? top / box.height : 0;
			this.el.removeClass(`gcl-pos-${this.placement()}`);
			this.el.addClass("gcl-pos-free");
			this.el.setCssProps({ "--gcl-x": String(x), "--gcl-y": String(y) });
		};
		const end = (ev: PointerEvent) => {
			if (ev.pointerId !== e.pointerId) return;
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", end);
			win.removeEventListener("pointercancel", end);
			if (!moving) return;
			this.el.removeClass("is-moving");
			this.justMoved = true;
			// The click (if any) comes right after pointerup; forget the flag if it does not.
			window.setTimeout(() => (this.justMoved = false), 300);
			const s = this.plugin.settings;
			s.position = "free";
			s.offset[this.sizeKey] = { x, y };
			this.signature = "";
			void this.plugin.saveSettingsQuiet().then(() => this.update(true));
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", end);
		win.addEventListener("pointercancel", end);
	}

	/** Right-click on the header: style, place and picture of the legend. */
	private openLegendMenu(evt: MouseEvent): void {
		const str = t();
		const s = this.plugin.settings;
		const menu = new Menu();
		for (const style of ["list", "compact"] as const) {
			menu.addItem((item) =>
				item
					.setTitle(style === "list" ? str.styleList : str.styleCompact)
					.setIcon(style === "list" ? "list" : "list-collapse")
					.setChecked(s.style === style)
					.onClick(() => {
						s.style = style;
						void this.plugin.saveSettingsAndRefresh();
					}),
			);
		}
		if (s.position === "free") {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(str.backToCorner)
					.setIcon("corner-up-left")
					.onClick(() => {
						s.position = "top-left";
						s.offset[this.sizeKey] = null;
						void this.plugin.saveSettingsAndRefresh();
					}),
			);
		}
		if (this.hasGroups()) {
			menu.addSeparator();
			this.addImageItems(menu);
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(str.openSettings).setIcon("settings").onClick(() => this.plugin.openSettings()));
		this.plugin.showMenu(menu, evt);
	}

	private addImageItems(menu: Menu): void {
		const str = t();
		menu.addItem((item) => item.setTitle(str.imageCopy).setIcon("copy").onClick(() => void this.exportImage("copy")));
		menu.addItem((item) => item.setTitle(str.imageSave).setIcon("image-down").onClick(() => void this.exportImage("save")));
	}

	private addImageButton(header: HTMLElement): void {
		const str = t();
		if (!this.hasGroups()) return;
		const btn = header.createEl("button", { cls: "gcl-icon-button gcl-image clickable-icon" });
		setIcon(btn, "image");
		btn.setAttr("aria-label", str.imageMenu);
		setTooltip(btn, str.imageMenu);
		btn.addEventListener("click", (e) => {
			const menu = new Menu();
			this.addImageItems(menu);
			this.plugin.showMenu(menu, e);
		});
	}

	/**
	 * A group the "hide empty groups" setting leaves out: no nodes in this graph. That includes a group whose
	 * notes all go to groups above (a catch-all group kept last); edit mode still shows it with its warning.
	 */
	private isEmpty(info: GroupInfo): boolean {
		return this.plugin.settings.hideEmpty && info.count === 0;
	}

	/** Color groups the legend shows: not hidden by the eye and not left out as empty. */
	private shownGroups(): ColorGroup[] {
		const hidden = this.plugin.settings.hidden;
		return this.groups.filter((g, i) => !hidden.includes(g.query) && !this.isEmpty(this.groupInfo(i)));
	}

	/** True when the legend lists at least one color group that is not hidden. */
	hasGroups(): boolean {
		return this.shownGroups().length > 0;
	}

	/** The color groups shown in the legend as a picture: copied to the clipboard or saved in the vault. */
	async exportImage(mode: "copy" | "save"): Promise<void> {
		const str = t();
		const entries = this.shownGroups()
			.map((g) => ({ name: this.plugin.displayName(g.query), rgb: g.rgb }));
		const none = this.ungroupedEntry();
		if (none && !this.plugin.settings.hidden.includes(UNGROUPED)) {
			entries.push({ name: this.plugin.displayName(UNGROUPED), rgb: none.ungrouped?.rgb ?? 0x888888 });
		}
		if (entries.length === 0) return;
		try {
			const blob = await legendImage(this.el, str.legend, entries);
			if (mode === "copy" && (await copyImage(blob))) {
				new Notice(str.imageCopied);
				return;
			}
			// Where the clipboard cannot take images (some phones), the picture is saved instead.
			const path = await saveImage(this.plugin.app, blob);
			new Notice(mode === "copy" ? str.imageSavedInstead(path) : str.imageSaved(path), 8000);
		} catch {
			new Notice(str.imageFailed, 8000);
		}
	}

	// ---- size -------------------------------------------------------------

	private applySize(size: LegendSize | null): void {
		const w = size?.w ?? null;
		const h = size?.h ?? null;
		this.el.toggleClass("has-width", w !== null);
		this.el.toggleClass("has-height", h !== null);
		this.el.setCssProps({
			"--gcl-width": w !== null ? `${w}px` : "auto",
			"--gcl-height": h !== null ? `${h}px` : "auto",
		});
	}

	/**
	 * Handles on the free sides: the legend is pinned to one corner, so it grows away from it
	 * (top-left legend: right edge, bottom edge and their corner).
	 */
	private addResizeHandles(): void {
		// A moved legend is placed by its top-left corner, so it grows to the right and down.
		const placed = this.placement();
		const pos = placed === "free" ? "top-left" : placed;
		const x = pos.endsWith("left") ? "e" : "w";
		const y = pos.startsWith("top") ? "s" : "n";
		for (const dir of [x, y, y + x]) {
			const handle = this.el.createDiv({ cls: `gcl-resize gcl-resize-${dir}` });
			handle.addEventListener("pointerdown", (e) => this.startResize(e, handle, dir));
			// Double-click: back to the automatic size.
			handle.addEventListener("dblclick", () => {
				this.plugin.settings.size[this.sizeKey] = null;
				void this.plugin.saveSettingsAndRefresh();
			});
		}
	}

	private startResize(e: PointerEvent, handle: HTMLElement, dir: string): void {
		// While search results are shown the legend is larger for the time being; that size is not for keeping.
		if (e.button !== 0 || this.el.hasClass("is-text-search")) return;
		e.preventDefault();
		const rect = this.el.getBoundingClientRect();
		const box = this.view.contentEl.getBoundingClientRect();
		const startX = e.clientX;
		const startY = e.clientY;
		const growX = dir.includes("e") ? 1 : dir.includes("w") ? -1 : 0;
		const growY = dir.includes("s") ? 1 : dir.includes("n") ? -1 : 0;
		const prev = this.plugin.settings.size[this.sizeKey];
		let w = growX ? rect.width : (prev?.w ?? null);
		let h = growY ? rect.height : (prev?.h ?? null);
		const clamp = (v: number, min: number, max: number) => Math.round(Math.min(Math.max(min, max), Math.max(min, v)));
		this.el.setCssProps({ "--gcl-resize-cursor": getComputedStyle(handle).cursor });
		this.el.addClass("is-resizing");
		handle.setPointerCapture(e.pointerId);

		const move = (ev: PointerEvent) => {
			if (growX) w = clamp(rect.width + (ev.clientX - startX) * growX, SIZE_LIMITS.minW, box.width - GAP_X);
			if (growY) h = clamp(rect.height + (ev.clientY - startY) * growY, SIZE_LIMITS.minH, box.height - GAP_Y);
			this.applySize({ w, h });
		};
		const end = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
			this.el.removeClass("is-resizing");
			this.plugin.settings.size[this.sizeKey] = w === null && h === null ? null : { w, h };
			// Other legends of the same kind pick the new size up on their next tick.
			this.signature = "";
			void this.plugin.saveSettingsQuiet().then(() => this.update(true));
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	}

	// ---- highlight --------------------------------------------------------

	private currentSpec(): HighlightSpec | null {
		const s = this.plugin.settings;
		if (!s.highlight || !s.showLegend) return null;
		const hovering = this.hoverQuery !== null && !this.editing && !this.focusMode;
		// Text search results take the graph while they are shown; pointing at a legend entry still shows that entry.
		const found = hovering ? null : this.textIds();
		if (found) {
			const one = this.textHover !== null && !this.focusMode && found.includes(this.textHover) ? [this.textHover] : found;
			return { rgbs: [], ids: one, hideOthers: this.focusMode };
		}
		const queries = new Set(this.selected);
		if (hovering && this.hoverQuery !== null) queries.add(this.hoverQuery);
		if (queries.size === 0) return null;
		const spec: HighlightSpec = { rgbs: [], ids: [], hideOthers: this.focusMode };
		for (const e of this.allEntries()) {
			if (!queries.has(e.query)) continue;
			if (e.rgb !== null) spec.rgbs.push(e.rgb);
			else spec.ids.push(...e.ids);
		}
		if (!spec.rgbs.length && !spec.ids.length) return null;
		if (s.neighbors) {
			this.addNeighbors(spec, spec);
		} else if (this.linked.size > 0) {
			// Only the entries chosen in their menu bring their linked notes along.
			const base: HighlightSpec = { rgbs: [], ids: [], hideOthers: false };
			for (const e of this.allEntries()) {
				if (!queries.has(e.query) || !this.linked.has(e.query)) continue;
				if (e.rgb !== null) base.rgbs.push(e.rgb);
				else base.ids.push(...e.ids);
			}
			if (base.rgbs.length || base.ids.length) this.addNeighbors(spec, base);
		}
		return spec;
	}

	/** Also keep the notes that link to, or are linked from, a note of `base` (the whole spec, or a part of it). */
	private addNeighbors(spec: HighlightSpec, base: HighlightSpec): void {
		const r = getRenderer(this.view);
		if (!r) return;
		const nodesOf = (part: HighlightSpec): Set<string> => {
			const rgbs = new Set(part.rgbs);
			const ids = new Set(part.ids);
			for (const node of r.nodes) {
				const rgb = nodeRgb(node);
				if (rgb !== null && rgbs.has(rgb)) ids.add(node.id);
			}
			return ids;
		};
		const kept = nodesOf(spec);
		const from = base === spec ? kept : nodesOf(base);
		const extra = new Set<string>();
		for (const link of r.links) {
			const a = link.source?.id;
			const b = link.target?.id;
			if (typeof a !== "string" || typeof b !== "string") continue;
			if (from.has(a) && !kept.has(b)) extra.add(b);
			else if (from.has(b) && !kept.has(a)) extra.add(a);
		}
		spec.ids = [...kept, ...extra];
	}

	private applyHighlight(): void {
		this.setHighlight(this.currentSpec());
	}

	private reapplyHighlight(): void {
		const spec = this.currentSpec();
		if (spec === null) return;
		const r = getRenderer(this.view);
		if (!r) return;
		// Neighbors depend on the links, which change while the graph is open; same spec = no redraw.
		if (this.plugin.settings.neighbors || this.linked.size > 0) this.plugin.highlighter.set(r, spec);
		this.plugin.highlighter.refresh(r);
	}

	private setHighlight(spec: HighlightSpec | null): void {
		const r = getRenderer(this.view);
		if (!r) return;
		this.plugin.highlighter.set(r, spec);
	}
}
