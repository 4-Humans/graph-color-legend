/**
 * Undo and redo for what the legend changes: the order and colors of color groups, new groups,
 * sets, names, hidden entries, the order of tags and properties, and tag renames in notes.
 * Kept in memory until Obsidian restarts.
 */

/** Tag renames larger than this (total size of the notes) cannot be undone: the texts are kept in memory. */
export const MAX_UNDO_BYTES = 20 * 1024 * 1024;

const MAX_STEPS = 50;
/** Changes of the same thing this close together are one step (a color picker sends many). */
const MERGE_MS = 3000;

/** What an undo or redo reports back, for the message in the legend. */
export interface StepResult {
	message?: string;
	/** Notes that were left alone because they changed after the plugin wrote them. */
	skipped?: string[];
}

export interface Step {
	/** Shown on the arrows: "Undo: <label>". */
	label: string;
	undo: () => Promise<StepResult | void>;
	redo: () => Promise<StepResult | void>;
	/** Steps with the same key that follow each other quickly are merged. */
	mergeKey?: string;
	/** Extra line for the tooltip, for example "available until Obsidian restarts". */
	note?: string;
}

interface Entry extends Step {
	time: number;
}

export class History {
	private done: Entry[] = [];
	private undone: Entry[] = [];
	private busy = false;
	/** Changes on every push, undo and redo; legends compare it to know when to redraw the arrows. */
	version = 0;

	constructor(private onChange: () => void) {}

	push(step: Step): void {
		const now = Date.now();
		const last = this.done[this.done.length - 1];
		if (step.mergeKey && last && last.mergeKey === step.mergeKey && now - last.time < MERGE_MS) {
			// Keep the first "undo", take the newest "redo".
			last.redo = step.redo;
			last.label = step.label;
			last.time = now;
		} else {
			this.done.push({ ...step, time: now });
			if (this.done.length > MAX_STEPS) this.done.shift();
		}
		this.undone = [];
		this.changed();
	}

	get canUndo(): boolean {
		return !this.busy && this.done.length > 0;
	}

	get canRedo(): boolean {
		return !this.busy && this.undone.length > 0;
	}

	peekUndo(): Step | null {
		return this.done[this.done.length - 1] ?? null;
	}

	peekRedo(): Step | null {
		return this.undone[this.undone.length - 1] ?? null;
	}

	async undo(): Promise<{ step: Step; result: StepResult } | null> {
		const step = this.busy ? undefined : this.done.pop();
		if (!step) return null;
		this.busy = true;
		this.changed();
		try {
			const result = (await step.undo()) ?? {};
			this.undone.push(step);
			return { step, result };
		} catch (e) {
			console.error("Graph Color Legend: undo failed", e);
			return { step, result: { message: String(e) } };
		} finally {
			this.busy = false;
			this.changed();
		}
	}

	async redo(): Promise<{ step: Step; result: StepResult } | null> {
		const step = this.busy ? undefined : this.undone.pop();
		if (!step) return null;
		this.busy = true;
		this.changed();
		try {
			const result = (await step.redo()) ?? {};
			step.time = 0; // never merge into a redone step
			this.done.push(step);
			return { step, result };
		} catch (e) {
			console.error("Graph Color Legend: redo failed", e);
			return { step, result: { message: String(e) } };
		} finally {
			this.busy = false;
			this.changed();
		}
	}

	clear(): void {
		this.done = [];
		this.undone = [];
		this.changed();
	}

	private changed(): void {
		this.version++;
		this.onChange();
	}
}
