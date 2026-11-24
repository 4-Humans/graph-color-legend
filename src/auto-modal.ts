import { App, Modal, Setting } from "obsidian";
import { assign, AutoItem, AutoMode, AutoOption, bestOption, defaultChosen, listed, nextColor } from "./auto-groups";
import type { ColorGroup } from "./graph-internals";
import { t } from "./i18n";
import { hexOf, PALETTE, parseHex } from "./modals";

export interface AutoContext {
	/** Notes that have no color yet (all notes of the graph when it has no groups). */
	freeNotes: number;
	/** The graph already has color groups: the new ones are added after them. */
	hasGroups: boolean;
	/** Colors of the groups the graph already has. */
	used: number[];
	/** The graph's background, to leave out colors that would not show on it. */
	background: number;
	/** Name of an entry as the legend shows it. */
	name: (query: string) => string;
}

/** Rows listed at first; "show more" opens the rest. */
const ROWS_SHOWN = 12;

/**
 * "Color the graph": pick a way to group the notes (folders, tags, a property), look at the suggested
 * color groups, switch some off or change a color, and create them in one step.
 */
export class AutoGroupsModal extends Modal {
	private option: AutoOption | null;
	/** Chosen queries, kept per option so switching the way back and forth loses nothing. */
	private chosen = new Map<AutoOption, Set<string>>();
	private colors = new Map<string, number>();
	/** Colors the person picked by hand: kept as they are, even when two groups end up with the same one. */
	private manual = new Set<string>();
	private expanded = false;
	private listEl: HTMLElement | null = null;
	private summaryEl: HTMLElement | null = null;
	private applyEl: HTMLButtonElement | null = null;
	private rows = new Map<string, { count: HTMLElement; color: HTMLInputElement; row: HTMLElement }>();

	constructor(
		app: App,
		private options: AutoOption[],
		private ctx: AutoContext,
		private onApply: (groups: ColorGroup[]) => void,
	) {
		super(app);
		this.option = bestOption(options);
	}

	onOpen(): void {
		const str = t();
		const { contentEl } = this;
		this.setTitle(str.autoButton);
		contentEl.addClass("gcl-modal", "gcl-auto");
		contentEl.createEl("p", { cls: "gcl-modal-desc", text: this.ctx.hasGroups ? str.autoDescMore : str.autoDesc });

		if (!this.option) {
			contentEl.createEl("p", { text: this.ctx.hasGroups ? str.autoNothingMore : str.autoNothing });
			new Setting(contentEl).addButton((b) => b.setButtonText(str.dismiss).onClick(() => this.close()));
			return;
		}

		const modes = contentEl.createDiv({ cls: "gcl-auto-modes" });
		const names: Record<AutoMode, string> = { folders: str.autoByFolders, tags: str.autoByTags, property: str.autoByProperty };
		for (const mode of ["folders", "tags", "property"] as const) {
			const first = this.options.find((o) => o.mode === mode);
			const btn = modes.createEl("button", { cls: "gcl-auto-mode", text: names[mode] });
			btn.dataset.mode = mode;
			if (!first) {
				btn.disabled = true;
				btn.setAttr("aria-label", str.autoNoneMode);
				continue;
			}
			btn.addEventListener("click", () => {
				if (this.option?.mode === mode) return;
				this.option = first;
				this.expanded = false;
				this.draw();
			});
		}
		contentEl.createDiv({ cls: "gcl-auto-key" });
		this.listEl = contentEl.createDiv({ cls: "gcl-auto-list" });
		this.summaryEl = contentEl.createDiv({ cls: "gcl-auto-summary" });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(str.cancel).onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText(str.autoApply)
					.setCta()
					.onClick(() => this.apply());
				this.applyEl = b.buttonEl;
			});
		this.draw();
	}

	private chosenOf(option: AutoOption): Set<string> {
		let set = this.chosen.get(option);
		if (!set) this.chosen.set(option, (set = defaultChosen(option)));
		return set;
	}

	/** Colors already taken: the graph's own groups and the other chosen suggestions of the option shown. */
	private takenColors(option: AutoOption, except: AutoItem): number[] {
		const chosen = this.chosenOf(option);
		const out = [...this.ctx.used];
		for (const item of option.items) {
			const c = this.colors.get(item.query);
			if (c !== undefined && item !== except && chosen.has(item.query)) out.push(c);
		}
		return out;
	}

	/**
	 * A chosen item keeps its color while other items are switched on and off. It gets a new one only
	 * when it has none yet, or when another item took its color while it was switched off.
	 */
	private colorOf(option: AutoOption, item: AutoItem): number {
		const taken = this.takenColors(option, item);
		let c = this.colors.get(item.query);
		if (c === undefined || (taken.includes(c) && !this.manual.has(item.query))) {
			c = nextColor(PALETTE, taken, this.ctx.background);
			this.colors.set(item.query, c);
		}
		return c;
	}

	/** The whole list again: after the way of grouping changed, or "show more". */
	private draw(): void {
		const str = t();
		const option = this.option;
		const list = this.listEl;
		if (!option || !list) return;
		for (const btn of Array.from(this.contentEl.querySelectorAll<HTMLElement>(".gcl-auto-mode"))) {
			btn.toggleClass("is-active", btn.dataset.mode === option.mode);
		}

		const keyEl = this.contentEl.querySelector<HTMLElement>(".gcl-auto-key");
		if (keyEl) {
			keyEl.empty();
			const props = this.options.filter((o) => o.mode === "property");
			if (option.mode === "property" && props.length > 1) {
				new Setting(keyEl).setName(str.autoProperty).addDropdown((d) => {
					for (const o of props) d.addOption(o.key, o.key);
					d.setValue(option.key).onChange((key) => {
						this.option = props.find((o) => o.key === key) ?? option;
						this.expanded = false;
						this.draw();
					});
				});
			} else if (option.mode === "folders" && option.key) {
				keyEl.createDiv({ cls: "gcl-auto-note", text: str.autoInside(option.key) });
			}
		}

		list.empty();
		this.rows.clear();
		const chosen = this.chosenOf(option);
		const items = listed(option);
		// The first color goes to the largest group, the next to the second largest, and so on.
		for (const item of items) if (chosen.has(item.query)) this.colorOf(option, item);
		const shown = this.expanded ? items : items.slice(0, ROWS_SHOWN);
		for (const item of shown) this.drawRow(list, option, item);
		if (items.length > shown.length) {
			const more = list.createEl("button", { cls: "gcl-auto-more", text: str.autoMore(items.length - shown.length) });
			more.addEventListener("click", () => {
				this.expanded = true;
				this.draw();
			});
		}
		this.refresh();
	}

	private drawRow(list: HTMLElement, option: AutoOption, item: AutoItem): void {
		const str = t();
		const chosen = this.chosenOf(option);
		const row = list.createEl("label", { cls: "gcl-auto-row" });
		const box = row.createEl("input", { type: "checkbox" });
		box.checked = chosen.has(item.query);
		// The dot is drawn by the plugin, like the legend's own; the system color box lies over it, unseen.
		const dot = row.createSpan({ cls: "gcl-swatch gcl-auto-swatch" });
		const color = dot.createEl("input", { cls: "gcl-auto-color", type: "color" });
		color.setAttr("aria-label", str.groupColor);
		const show = (rgb: number) => {
			color.value = hexOf(rgb);
			dot.setCssProps({ "--gcl-color": hexOf(rgb) });
		};
		show(this.colors.get(item.query) ?? 0x888888);
		// The color box sits inside the row's label: a click on it must not also flip the checkbox.
		color.addEventListener("click", (e) => e.stopPropagation());
		color.addEventListener("input", () => {
			const rgb = parseHex(color.value);
			if (rgb === null) return;
			this.colors.set(item.query, rgb);
			this.manual.add(item.query);
			dot.setCssProps({ "--gcl-color": hexOf(rgb) });
		});
		row.createSpan({ cls: "gcl-auto-name", text: this.ctx.name(item.query) });
		const count = row.createSpan({ cls: "gcl-count" });
		this.rows.set(item.query, { count, color, row });
		box.addEventListener("change", () => {
			if (box.checked) {
				chosen.add(item.query);
				show(this.colorOf(option, item));
			} else chosen.delete(item.query);
			this.refresh();
		});
	}

	/** Counts, the summary and the button, after an item was switched on or off. */
	private refresh(): void {
		const str = t();
		const option = this.option;
		if (!option) return;
		const chosen = this.chosenOf(option);
		const { counts, total } = assign(option, chosen);
		for (const item of option.items) {
			const r = this.rows.get(item.query);
			if (!r) continue;
			const on = chosen.has(item.query);
			r.row.toggleClass("is-off", !on);
			// Switched on: the notes it will really color. Switched off: the notes it matches.
			r.count.setText(String(on ? (counts.get(item.query) ?? 0) : item.ids.length));
		}
		this.summaryEl?.setText(
			this.ctx.hasGroups ? str.autoSummaryMore(total, this.ctx.freeNotes) : str.autoSummary(total, this.ctx.freeNotes),
		);
		if (this.applyEl) this.applyEl.disabled = chosen.size === 0;
	}

	private apply(): void {
		const option = this.option;
		if (!option) return;
		const chosen = this.chosenOf(option);
		// Writing order, not the listed one: it decides which group a note with two matches goes to.
		const groups: ColorGroup[] = option.items
			.filter((i) => chosen.has(i.query))
			.map((i) => ({ query: i.query, rgb: this.colorOf(option, i), alpha: 1 }));
		if (groups.length === 0) return;
		this.close();
		this.onApply(groups);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
