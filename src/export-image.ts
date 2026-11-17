import { App } from "obsidian";

/** One color group as it goes into the picture. */
export interface ImageEntry {
	name: string;
	rgb: number;
}

const SCALE = 2;
const MAX_NAME_PX = 600;

/**
 * A theme color as the browser resolves it (the theme's variables may point at other variables):
 * a hidden probe with a class from styles.css takes the color, and the computed value is read.
 */
function themeColor(host: HTMLElement, kind: "bg" | "text" | "faint" | "border", fallback: string): string {
	const probe = host.createSpan({ cls: `gcl-probe gcl-probe-${kind}` });
	const color = getComputedStyle(probe).color || fallback;
	probe.remove();
	return color;
}

function hex(rgb: number): string {
	return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** Cut a name so it fits into maxWidth, with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo) + "…";
}

/**
 * Draws the legend's color groups as a PNG: the title and one row per group, in the theme's
 * colors and font. Drawn from the data, not copied from the screen, so the picture is sharp
 * and has no buttons in it.
 */
export async function legendImage(host: HTMLElement, title: string, entries: ImageEntry[]): Promise<Blob> {
	const style = getComputedStyle(host);
	const fontSize = parseFloat(style.fontSize) || 13;
	const family = style.fontFamily || "sans-serif";
	const bg = themeColor(host, "bg", "#ffffff");
	const text = themeColor(host, "text", "#222222");
	const faint = themeColor(host, "faint", "#999999");
	const border = themeColor(host, "border", "#dddddd");

	const pad = Math.round(fontSize * 1.1);
	const rowH = Math.round(fontSize * 1.75);
	const dot = Math.round(fontSize * 0.9);
	const gap = Math.round(fontSize * 0.65);
	const regular = `${fontSize}px ${family}`;
	const bold = `600 ${fontSize}px ${family}`;

	// A detached canvas: createEl() without a parent does not put it into the page.
	const canvas = createEl("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");

	ctx.font = bold;
	const titleW = ctx.measureText(title).width;
	ctx.font = regular;
	const names = entries.map((e) => fit(ctx, e.name, MAX_NAME_PX));
	const nameW = names.reduce((w, n) => Math.max(w, ctx.measureText(n).width), 0);
	const width = Math.ceil(pad * 2 + Math.max(titleW, dot + gap + nameW, 120));
	const height = Math.ceil(pad * 2 + rowH * (1 + entries.length));

	canvas.width = width * SCALE;
	canvas.height = height * SCALE;
	ctx.scale(SCALE, SCALE);
	ctx.textBaseline = "middle";

	// Background card with a thin border, like the legend on the graph.
	const r = Math.round(fontSize * 0.6);
	ctx.beginPath();
	ctx.roundRect(0.5, 0.5, width - 1, height - 1, r);
	ctx.fillStyle = bg;
	ctx.fill();
	ctx.strokeStyle = border;
	ctx.lineWidth = 1;
	ctx.stroke();

	ctx.fillStyle = text;
	ctx.font = bold;
	ctx.fillText(title, pad, pad + rowH / 2);

	ctx.font = regular;
	entries.forEach((entry, i) => {
		const y = pad + rowH * (i + 1) + rowH / 2;
		const cx = pad + dot / 2;
		// Ring as in the legend, so white, black and pale colors stay visible.
		ctx.beginPath();
		ctx.arc(cx, y, dot / 2 + 1.5, 0, Math.PI * 2);
		ctx.fillStyle = faint;
		ctx.fill();
		ctx.beginPath();
		ctx.arc(cx, y, dot / 2 + 0.5, 0, Math.PI * 2);
		ctx.fillStyle = bg;
		ctx.fill();
		ctx.beginPath();
		ctx.arc(cx, y, dot / 2, 0, Math.PI * 2);
		ctx.fillStyle = hex(entry.rgb);
		ctx.fill();
		ctx.fillStyle = text;
		ctx.fillText(names[i] ?? "", pad + dot + gap, y);
	});

	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png");
	});
}

/** Puts the picture on the clipboard. False where the platform does not allow images there. */
export async function copyImage(blob: Blob): Promise<boolean> {
	try {
		if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
		await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
		return true;
	} catch {
		return false;
	}
}

/** Saves the picture where the vault keeps attachments; returns its path. */
export async function saveImage(app: App, blob: Blob): Promise<string> {
	const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
	const name = `Graph legend ${stamp}.png`;
	const source = app.workspace.getActiveFile()?.path ?? "";
	const path = await app.fileManager.getAvailablePathForAttachment(name, source);
	await app.vault.createBinary(path, await blob.arrayBuffer());
	return path;
}
