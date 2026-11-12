import { App, Modal, Setting, SuggestModal, TFile } from "obsidian";
import { openGlobalSearch } from "./graph-internals";
import { t } from "./i18n";

/** Colors offered for a new group: the first one not used yet is preselected. */
const PALETTE = [
	0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0xbfef45, 0xfabed4, 0x469990,
	0xdcbeff, 0x9a6324, 0x800000, 0xaaffc3, 0x808000, 0x000075,
];

export function hexOf(rgb: number): string {
	return "#" + (rgb & 0xffffff).toString(16).padStart(6, "0");
}

export function parseHex(value: string): number | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
	return m ? parseInt(m[1] ?? "0", 16) : null;
}

export function freeColor(used: number[]): number {
	return PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length] ?? 0x4363d8;
}

/** "Make a color group" for a tag or a property: pick the color and where the group goes. */
export class NewGroupModal extends Modal {
	constructor(
		app: App,
		private name: string,
		private query: string,
		private rgb: number,
		private onCreate: (rgb: number, first: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const str = t();
		const { contentEl } = this;
		this.setTitle(str.makeGroupTitle(this.name));
		contentEl.addClass("gcl-modal");
		new Setting(contentEl).setName(str.query).setDesc(this.query);
		contentEl.createEl("p", { cls: "gcl-modal-desc", text: str.makeGroupDesc });
		let rgb = this.rgb;
		let first = true;
		new Setting(contentEl).setName(str.groupColor).addColorPicker((c) =>
			c.setValue(hexOf(rgb)).onChange((v) => {
				rgb = parseHex(v) ?? rgb;
			}),
		);
		new Setting(contentEl)
			.setName(str.groupPlace)
			.setDesc(str.groupPlaceDesc)
			.addDropdown((d) =>
				d
					.addOptions({ first: str.groupFirst, last: str.groupLast })
					.setValue("first")
					.onChange((v) => (first = v === "first")),
			);
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(str.cancel).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(str.makeGroupButton)
					.setCta()
					.onClick(() => {
						this.close();
						this.onCreate(rgb, first);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Name for a new set of color groups. Saving under an existing name replaces that set. */
export class PresetNameModal extends Modal {
	constructor(
		app: App,
		private existing: string[],
		private onSave: (name: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const str = t();
		const { contentEl } = this;
		this.setTitle(str.presetSave);
		contentEl.addClass("gcl-modal");
		contentEl.createEl("p", { cls: "gcl-modal-desc", text: str.presetSaveDesc });
		let name = "";
		const warn = contentEl.createDiv({ cls: "gcl-preview-warning is-hidden" });
		const save = () => {
			const v = name.trim().slice(0, 100);
			if (!v) return;
			this.close();
			this.onSave(v);
		};
		new Setting(contentEl)
			.addText((text) => {
				text.setPlaceholder(str.presetNamePlaceholder);
				text.inputEl.addClass("gcl-rename-input");
				text.onChange((v) => {
					name = v;
					const clash = this.existing.includes(v.trim());
					warn.setText(clash ? str.presetReplace(v.trim()) : "");
					warn.toggleClass("is-hidden", !clash);
				});
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						save();
					}
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			})
			.addButton((b) => b.setButtonText(str.save).setCta().onClick(save));
		contentEl.appendChild(warn);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const MAX_NOTES = 500;

/** The notes of one legend entry, as the graph shows them now. */
export class NotesModal extends Modal {
	constructor(
		app: App,
		private name: string,
		private query: string,
		private files: TFile[],
		private shared: boolean,
	) {
		super(app);
	}

	onOpen(): void {
		const str = t();
		const { contentEl } = this;
		this.setTitle(this.name);
		contentEl.addClass("gcl-modal");
		const files = [...this.files].sort((a, b) => a.path.localeCompare(b.path));
		contentEl.createDiv({ cls: "gcl-preview-summary", text: str.notesCount(files.length) });
		if (this.shared) contentEl.createDiv({ cls: "gcl-modal-desc", text: str.notesShared });
		let filter = "";
		new Setting(contentEl).addSearch((s) => {
			s.setPlaceholder(str.search).onChange((v) => {
				filter = v.trim().toLowerCase();
				draw();
			});
			window.setTimeout(() => s.inputEl.focus(), 0);
		});
		const list = contentEl.createEl("ul", { cls: "gcl-preview-list gcl-notes-list" });
		const draw = () => {
			list.empty();
			const shown = filter ? files.filter((f) => f.path.toLowerCase().includes(filter)) : files;
			for (const f of shown.slice(0, MAX_NOTES)) {
				const li = list.createEl("li");
				const a = li.createEl("a", { cls: "gcl-note-link", text: f.basename, href: "#" });
				li.createSpan({ cls: "gcl-preview-count", text: f.parent?.path && f.parent.path !== "/" ? f.parent.path : "" });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					const newTab = e.ctrlKey || e.metaKey;
					void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(f);
					this.close();
				});
			}
			if (shown.length > MAX_NOTES) list.createEl("li", { cls: "gcl-preview-more", text: str.tagMore(shown.length - MAX_NOTES) });
			if (shown.length === 0) list.createEl("li", { cls: "gcl-preview-more", text: str.noMatches });
		};
		draw();
		if (this.query) {
			new Setting(contentEl).addButton((b) =>
				b.setButtonText(str.openInSearch).onClick(() => {
					if (openGlobalSearch(this.app, this.query)) this.close();
					else b.setDisabled(true).setButtonText(str.searchOff);
				}),
			);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** A plain list of note paths (for example notes an undo had to leave alone). */
export class PathsModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private paths: string[],
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.addClass("gcl-modal");
		const list = this.contentEl.createEl("ul", { cls: "gcl-preview-list gcl-notes-list" });
		for (const path of this.paths) {
			const li = list.createEl("li");
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				const a = li.createEl("a", { cls: "gcl-note-link", text: path, href: "#" });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					void this.app.workspace.getLeaf("tab").openFile(file);
				});
			} else {
				li.createSpan({ cls: "gcl-preview-path", text: path });
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export interface PresetChoice {
	name: string;
	count: number;
}

/** Command palette: pick a set of color groups to apply. */
export class PresetSuggestModal extends SuggestModal<PresetChoice> {
	constructor(
		app: App,
		private presets: PresetChoice[],
		private onChoose: (name: string) => void,
	) {
		super(app);
		this.setPlaceholder(t().presetApply);
	}

	getSuggestions(query: string): PresetChoice[] {
		const q = query.trim().toLowerCase();
		return this.presets.filter((p) => p.name.toLowerCase().includes(q));
	}

	renderSuggestion(p: PresetChoice, el: HTMLElement): void {
		el.createDiv({ text: p.name });
		el.createEl("small", { cls: "gcl-preview-count", text: t().presetGroups(p.count) });
	}

	onChooseSuggestion(p: PresetChoice): void {
		this.onChoose(p.name);
	}
}
