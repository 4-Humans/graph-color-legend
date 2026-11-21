import { Modal, Setting } from "obsidian";
import type { RemovedGroup } from "./group-sync";
import { t } from "./i18n";
import { rgbToHex } from "./legend";
import type GraphColorLegendPlugin from "./main";

/**
 * Color groups that disappeared from graph.json outside Obsidian (an AI agent, sync, a text editor).
 * They stay on the graph until the person chooses here which to keep. Closing the window decides nothing.
 */
export class RemovedGroupsModal extends Modal {
	private keep = new Set<string>();

	constructor(
		private plugin: GraphColorLegendPlugin,
		private groups: RemovedGroup[],
		private onDone: () => void,
	) {
		super(plugin.app);
		for (const r of groups) this.keep.add(r.group.query);
	}

	onOpen(): void {
		const str = t();
		const { contentEl } = this;
		this.setTitle(str.removedTitle);
		contentEl.addClass("gcl-modal");
		contentEl.createEl("p", { cls: "gcl-modal-desc", text: str.removedDesc });

		for (const r of this.groups) {
			const setting = new Setting(contentEl).setName(this.plugin.displayName(r.group.query)).setDesc(r.group.query || "—");
			const sw = setting.nameEl.createSpan({ cls: "gcl-swatch gcl-settings-swatch" });
			sw.setCssProps({ "--gcl-color": rgbToHex(r.group.rgb) });
			setting.nameEl.prepend(sw);
			setting.addToggle((toggle) =>
				toggle
					.setTooltip(str.removedKeep)
					.setValue(true)
					.onChange((on) => {
						if (on) this.keep.add(r.group.query);
						else this.keep.delete(r.group.query);
					}),
			);
		}

		const actions = new Setting(contentEl);
		actions.addButton((b) => {
			b.setButtonText(str.removedDropAll).onClick(() => this.finish(new Set()));
			// The red look of a destructive button: setWarning is deprecated, setDestructive needs Obsidian 1.13.
			b.buttonEl.addClass("mod-warning");
		});
		actions.addButton((b) =>
			b
				.setButtonText(str.removedKeepChecked)
				.setCta()
				.onClick(() => this.finish(new Set(this.keep))),
		);
	}

	private finish(keep: Set<string>): void {
		this.close();
		void this.plugin.decideRemoved(
			this.groups.map((r) => r.group.query),
			keep,
		);
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDone();
	}
}
