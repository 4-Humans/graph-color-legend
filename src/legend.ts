import { Menu, View, setIcon, setTooltip } from "obsidian";
import { EntryModal } from "./entry-modal";
import { extractTags } from "./tags";

/** A view with a content element (graph views are item views). */
export type ContentView = View & { contentEl: HTMLElement };
import { ColorGroup, getRenderer, readLiveGroups } from "./graph-internals";
import { t } from "./i18n";
import type GraphColorLegendPlugin from "./main";

export function rgbToHex(rgb: number): string {
	return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
}

/** One legend panel attached to one graph view. */
export class Legend {
	readonly el: HTMLElement;
	private signature = "";
	private groups: ColorGroup[] = [];
	private editing = false;
	private hoverQuery: string | null = null;
	private pinnedQuery: string | null = null;

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
			if (this.hoverQuery === null) return;
			this.hoverQuery = null;
			this.applyHighlight();
		});
		this.update(true);
	}

	destroy(): void {
		this.setHighlight(null);
		this.el.remove();
		this.view.contentEl.removeClass("gcl-has-legend");
	}

	/** Re-reads groups; rebuilds only if something changed (or when forced). */
	update(force = false): void {
		const live = readLiveGroups(this.view);
		const groups = live ?? (this.isLocal ? [] : (this.plugin.fileGroups ?? []));
		const s = this.plugin.settings;
		const sig = JSON.stringify([
			groups,
			s.collapsed,
			s.position,
			s.fontSize,
			s.opacity,
			s.names,
			s.hidden,
			this.editing,
		]);
		if (!force && sig === this.signature) {
			this.reapplyHighlight();
			return;
		}
		this.signature = sig;
		this.groups = groups;
		if (live) this.plugin.rememberQueries(live.map((g) => g.query));
		if (this.pinnedQuery !== null && !groups.some((g) => g.query === this.pinnedQuery)) {
			this.pinnedQuery = null;
		}
		this.render();
		this.applyHighlight();
	}

	private render(): void {
		const s = this.plugin.settings;
		const str = t();
		const el = this.el;
		// Rows are rebuilt, so a row under the pointer will not get pointerleave.
		this.hoverQuery = null;
		el.empty();
		el.className = "gcl-legend";
		el.addClass(`gcl-pos-${s.position}`);
		el.toggleClass("is-collapsed", s.collapsed);
		el.toggleClass("is-editing", this.editing);
		// A local graph without its own groups gets no legend.
		el.toggleClass("is-empty-local", this.isLocal && this.groups.length === 0);
		el.setCssProps({
			"--gcl-font-size": `${s.fontSize}px`,
			"--gcl-bg-opacity": `${s.opacity}%`,
		});

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
		title.addEventListener("click", () => toggle.click());

		if (s.collapsed) return;

		const editBtn = header.createEl("button", { cls: "gcl-icon-button gcl-edit clickable-icon" });
		setIcon(editBtn, this.editing ? "check" : "pencil");
		editBtn.setAttr("aria-label", this.editing ? str.doneEditing : str.edit);
		setTooltip(editBtn, this.editing ? str.doneEditing : str.edit);
		editBtn.addEventListener("click", () => {
			this.editing = !this.editing;
			this.update(true);
		});

		const body = el.createDiv({ cls: "gcl-body" });
		const visible = this.groups.filter((g) => this.editing || !s.hidden.includes(g.query));
		if (this.groups.length === 0) {
			body.createDiv({ cls: "gcl-empty", text: str.noGroups });
			return;
		}

		for (const g of visible) {
			const isHidden = s.hidden.includes(g.query);
			const row = body.createDiv({ cls: "gcl-row" });
			row.toggleClass("is-hidden", isHidden);
			row.toggleClass("is-pinned", this.pinnedQuery === g.query);
			row.dataset.query = g.query;

			const swatch = row.createSpan({ cls: "gcl-swatch" });
			swatch.setCssProps({ "--gcl-color": rgbToHex(g.rgb) });

			const name = this.plugin.displayName(g.query);
			row.createSpan({ cls: "gcl-label", text: name });
			setTooltip(row, g.query ? `${g.query}\n${str.menuHint}` : str.menuHint, {
				placement: this.plugin.settings.position.endsWith("right") ? "left" : "right",
			});

			if (this.editing) {
				const rename = row.createEl("button", { cls: "gcl-icon-button clickable-icon" });
				setIcon(rename, "pencil");
				rename.setAttr("aria-label", str.rename);
				rename.addEventListener("click", (e) => {
					e.stopPropagation();
					this.openMenu(e, g.query, false);
				});
				const hide = row.createEl("button", { cls: "gcl-icon-button clickable-icon" });
				setIcon(hide, isHidden ? "eye-off" : "eye");
				hide.setAttr("aria-label", isHidden ? str.show : str.hide);
				hide.addEventListener("click", (e) => {
					e.stopPropagation();
					if (isHidden) s.hidden.remove(g.query);
					else s.hidden.push(g.query);
					void this.plugin.saveSettingsAndRefresh();
				});
				continue;
			}

			row.addEventListener("pointerenter", (e) => {
				if (e.pointerType === "touch") return;
				this.hoverQuery = g.query;
				this.applyHighlight();
			});
			row.addEventListener("pointerleave", () => {
				if (this.hoverQuery !== g.query) return;
				this.hoverQuery = null;
				this.applyHighlight();
			});
			row.addEventListener("click", (e) => this.openMenu(e, g.query, true));
		}
	}

	private togglePin(query: string): void {
		this.pinnedQuery = this.pinnedQuery === query ? null : query;
		this.el.querySelectorAll(".gcl-row").forEach((r) => {
			(r as HTMLElement).toggleClass("is-pinned", (r as HTMLElement).dataset.query === this.pinnedQuery);
		});
		this.applyHighlight();
	}

	/** Menu for one entry: highlight, rename (legend only or everywhere), hide. */
	private openMenu(evt: MouseEvent, query: string, withHighlight: boolean): void {
		const str = t();
		const s = this.plugin.settings;
		const menu = new Menu();
		if (withHighlight && s.highlight) {
			const pinned = this.pinnedQuery === query;
			menu.addItem((item) =>
				item
					.setTitle(pinned ? str.menuUnpin : str.menuPin)
					.setIcon(pinned ? "eye-off" : "sun")
					.onClick(() => this.togglePin(query)),
			);
			menu.addSeparator();
		}
		menu.addItem((item) =>
			item
				.setTitle(str.menuRenameLegend)
				.setIcon("pencil")
				.onClick(() => new EntryModal(this.plugin, query, "legend").open()),
		);
		const hasTags = extractTags(query).length > 0;
		menu.addItem((item) => {
			item.setTitle(hasTags ? str.menuRenameEverywhere : str.menuRenameEverywhereNoTags).setIcon("pencil-line");
			if (hasTags) item.onClick(() => new EntryModal(this.plugin, query, "tag").open());
			else item.setDisabled(true);
		});
		menu.addSeparator();
		const hidden = s.hidden.includes(query);
		menu.addItem((item) =>
			item
				.setTitle(hidden ? str.show : str.hide)
				.setIcon(hidden ? "eye" : "eye-off")
				.onClick(() => {
					if (hidden) s.hidden.remove(query);
					else s.hidden.push(query);
					if (this.pinnedQuery === query) this.pinnedQuery = null;
					void this.plugin.saveSettingsAndRefresh();
				}),
		);
		menu.showAtMouseEvent(evt);
	}

	private currentRgb(): number | null {
		if (!this.plugin.settings.highlight || this.editing) return null;
		const q = this.hoverQuery ?? this.pinnedQuery;
		if (q === null) return null;
		const g = this.groups.find((x) => x.query === q);
		return g ? g.rgb : null;
	}

	private applyHighlight(): void {
		this.setHighlight(this.currentRgb());
	}

	private reapplyHighlight(): void {
		if (this.currentRgb() === null) return;
		const r = getRenderer(this.view);
		if (r) this.plugin.highlighter.refresh(r);
	}

	private setHighlight(rgb: number | null): void {
		const r = getRenderer(this.view);
		if (!r) return;
		this.plugin.highlighter.set(r, rgb);
	}
}
