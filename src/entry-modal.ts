import { ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { t } from "./i18n";
import { labelFromQuery } from "./labels";
import type GraphColorLegendPlugin from "./main";
import { countNotesWithTag, findTagUsage, renameTagInNotes, TagUsage } from "./tag-rename";
import { bareTag, extractTags, validateTag } from "./tags";

const MAX_LISTED = 200;

/**
 * Rename a legend entry: either only its name in the legend, or (for entries
 * built from tags) the tag itself in every note, after a preview and confirmation.
 */
export class EntryModal extends Modal {
	private oldTag = "";
	private newTag = "";
	private usage: TagUsage[] | null = null;
	private previewEl: HTMLElement | null = null;
	private running = false;

	constructor(
		private plugin: GraphColorLegendPlugin,
		private query: string,
		private mode: "legend" | "tag",
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const str = t();
		const s = this.plugin.settings;
		const { contentEl } = this;
		this.setTitle(this.mode === "legend" ? str.menuRenameLegend : str.menuRenameEverywhere);
		contentEl.addClass("gcl-modal");

		new Setting(contentEl).setName(str.query).setDesc(this.query || "—");
		if (this.mode === "tag") {
			this.buildTagSection();
			return;
		}

		// Name shown only in the legend.
		contentEl.createEl("p", { cls: "gcl-modal-desc", text: str.renameDesc });
		let name = s.names[this.query] ?? "";
		new Setting(contentEl)
			.addText((text) => {
				text.setPlaceholder(labelFromQuery(this.query)).setValue(name);
				text.onChange((v) => (name = v));
				text.inputEl.addClass("gcl-rename-input");
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void this.saveName(name);
					}
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			})
			.addButton((b) => b.setButtonText(str.save).setCta().onClick(() => void this.saveName(name)));
	}

	/** Rename the tag in the notes (only for entries that use tags). */
	private buildTagSection(): void {
		const str = t();
		const s = this.plugin.settings;
		const { contentEl } = this;
		const tags = extractTags(this.query);
		if (tags.length === 0) return;
		// Preselect the tag that is most specific to this entry: the one used by the fewest groups
		// (for "tag:#tools tag:#voice" that is #voice, not the shared #tools).
		const uses = (tag: string) =>
			s.knownQueries.filter((q) => extractTags(q).some((x) => x.toLowerCase() === tag.toLowerCase())).length;
		this.oldTag = [...tags].sort((a, b) => uses(a) - uses(b))[0] ?? "";

		contentEl.createEl("p", { cls: "gcl-modal-desc", text: str.tagDesc });
		if (tags.length > 1) {
			new Setting(contentEl).setName(str.tagWhich).addDropdown((d) => {
				for (const tag of tags) d.addOption(tag, "#" + tag);
				d.setValue(this.oldTag).onChange((v) => {
					this.oldTag = v;
					this.clearPreview();
				});
			});
		} else {
			new Setting(contentEl).setName(str.tagWhich).setDesc("#" + this.oldTag);
		}
		new Setting(contentEl)
			.setName(str.tagNew)
			.addText((text) => {
				text.setPlaceholder(str.tagNewPlaceholder);
				window.setTimeout(() => text.inputEl.focus(), 0);
				text.onChange((v) => {
					this.newTag = v;
					this.clearPreview();
				});
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.preview();
					}
				});
			})
			.addButton((b) => b.setButtonText(str.tagFind).onClick(() => this.preview()));
		this.previewEl = contentEl.createDiv({ cls: "gcl-preview" });
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async saveName(value: string): Promise<void> {
		const s = this.plugin.settings;
		const v = value.trim();
		if (v) s.names[this.query] = v;
		else delete s.names[this.query];
		this.close();
		await this.plugin.saveSettingsAndRefresh();
	}

	private clearPreview(): void {
		this.usage = null;
		this.previewEl?.empty();
	}

	private preview(): void {
		const str = t();
		const el = this.previewEl;
		if (!el || this.running) return;
		el.empty();
		this.usage = null;

		const next = bareTag(this.newTag);
		const problem = validateTag(next);
		if (problem) {
			el.createDiv({ cls: "gcl-preview-error", text: str.tagInvalid[problem] });
			return;
		}
		if (next === this.oldTag) {
			el.createDiv({ cls: "gcl-preview-error", text: str.tagSame });
			return;
		}

		const usage = findTagUsage(this.app, this.oldTag);
		this.usage = usage;
		if (usage.length === 0) {
			el.createDiv({ text: str.tagNoNotes(this.oldTag) });
			return;
		}

		el.createDiv({ cls: "gcl-preview-summary", text: str.tagSummary(this.oldTag, next, usage.length) });
		if (next.toLowerCase() !== this.oldTag.toLowerCase()) {
			const existing = countNotesWithTag(this.app, next);
			if (existing > 0) el.createDiv({ cls: "gcl-preview-warning", text: str.tagMerge(next, existing) });
		}
		const list = el.createEl("ul", { cls: "gcl-preview-list" });
		for (const u of usage.slice(0, MAX_LISTED)) {
			const li = list.createEl("li");
			li.createSpan({ cls: "gcl-preview-path", text: u.file.path });
			li.createSpan({ cls: "gcl-preview-count", text: str.tagCounts(u.inline, u.properties) });
		}
		if (usage.length > MAX_LISTED) {
			list.createEl("li", { cls: "gcl-preview-more", text: str.tagMore(usage.length - MAX_LISTED) });
		}
		el.createDiv({ cls: "gcl-preview-warning", text: str.tagWarning });

		const actions = new Setting(el);
		actions.addButton((b) => b.setButtonText(str.cancel).onClick(() => this.close()));
		actions.addButton((b) => {
			b.setButtonText(str.tagConfirm(usage.length));
			b.buttonEl.addClass("mod-warning");
			b.onClick(() => void this.run(b, next));
		});
	}

	private async run(button: ButtonComponent, next: string): Promise<void> {
		const str = t();
		const usage = this.usage;
		if (!usage || this.running) return;
		this.running = true;
		button.setDisabled(true);
		const old = this.oldTag;
		const result = await renameTagInNotes(this.app, usage, old, next, (done, total) => {
			button.setButtonText(`${done} / ${total}`);
		});
		const graphUpdated = await this.plugin.renameTagInGraphGroups(old, next);
		this.running = false;
		this.close();

		new Notice(str.tagDone(old, next, result.changed), 6000);
		if (!graphUpdated) new Notice(str.tagGraphNotUpdated, 10000);
		if (result.failed.length) {
			const paths = result.failed.map((f) => f.path).join("\n");
			new Notice(`${str.tagFailed(result.failed.length)}\n${paths}`, 0);
			console.warn("Graph Color Legend: tag rename skipped some notes", result.failed);
		}
	}
}
