/**
 * Fades the nodes that are not in the highlighted color group.
 *
 * The graph redraws every node and link with their own render() method each frame.
 * We wrap those methods once (on the shared prototype) and, after the original
 * drawing, lower the alpha of everything outside the chosen group. The original
 * methods are put back when the plugin unloads.
 */
import { GraphLink, GraphNode, GraphRenderer, nodeRgb } from "./graph-internals";

const DIM_ALPHA = 0.1;

type RenderFn = (this: unknown) => void;

interface Patch {
	proto: { render: RenderFn };
	original: RenderFn;
	patched: RenderFn;
	/** Switched off on unload; the wrapper then only calls the original. */
	state: { on: boolean };
}

/** What stays bright: nodes of these group colors, plus these notes (by node id = file path). */
export interface HighlightSpec {
	rgbs: number[];
	ids: string[];
	/** "Only highlighted": the other nodes disappear instead of fading. */
	hideOthers?: boolean;
}

interface ActiveSpec {
	rgbs: Set<number>;
	ids: Set<string>;
	alpha: number;
	key: string;
}

function specKey(spec: HighlightSpec): string {
	return JSON.stringify([[...spec.rgbs].sort((a, b) => a - b), [...spec.ids].sort(), spec.hideOthers === true]);
}

function keeps(spec: ActiveSpec, node: GraphNode): boolean {
	const own = nodeRgb(node);
	return (own !== null && spec.rgbs.has(own)) || spec.ids.has(node.id);
}

export class Highlighter {
	/** Highlight per renderer. */
	private active = new WeakMap<GraphRenderer, ActiveSpec>();
	private patches: Patch[] = [];
	private nodeProtoPatched = false;
	private linkProtoPatched = false;

	/** Highlight in this renderer; null or an empty spec clears it. Returns false if not supported. */
	set(renderer: GraphRenderer, spec: HighlightSpec | null): boolean {
		if (!spec || (spec.rgbs.length === 0 && spec.ids.length === 0)) {
			if (this.active.has(renderer)) {
				this.active.delete(renderer);
				this.safeChanged(renderer);
			}
			return true;
		}
		if (!this.ensurePatched(renderer)) return false;
		const key = specKey(spec);
		// Same highlight as now: no redraw (the legend re-checks it on every tick).
		if (this.active.get(renderer)?.key === key) return true;
		this.active.set(renderer, {
			rgbs: new Set(spec.rgbs),
			ids: new Set(spec.ids),
			alpha: spec.hideOthers ? 0 : DIM_ALPHA,
			key,
		});
		this.safeChanged(renderer);
		return true;
	}

	/** Re-apply after the graph has new nodes (their prototype may have been unpatched before). */
	refresh(renderer: GraphRenderer): void {
		if (!this.active.has(renderer)) return;
		if (this.nodeProtoPatched && this.linkProtoPatched) return;
		this.ensurePatched(renderer);
		this.safeChanged(renderer);
	}

	destroy(): void {
		for (const p of this.patches) {
			p.state.on = false;
			// Put the original back only if nobody wrapped render() after us;
			// otherwise our wrapper stays as a plain pass-through so their wrapper keeps working.
			if (p.proto.render === p.patched) p.proto.render = p.original;
		}
		this.patches = [];
		this.nodeProtoPatched = false;
		this.linkProtoPatched = false;
	}

	private safeChanged(renderer: GraphRenderer): void {
		try {
			renderer.changed();
		} catch {
			// ignore
		}
	}

	private ensurePatched(renderer: GraphRenderer): boolean {
		const active = this.active;
		if (!this.nodeProtoPatched) {
			const node = renderer.nodes[0];
			if (!node) return false;
			const proto = Object.getPrototypeOf(node) as { render?: unknown } | null;
			if (!proto || typeof proto.render !== "function") return false;
			const original = proto.render as RenderFn;
			const state = { on: true };
			const patched = function (this: GraphNode): void {
				original.call(this);
				if (!state.on) return;
				try {
					const spec = active.get(this.renderer);
					if (spec === undefined || keeps(spec, this)) return;
					if (this.circle) this.circle.alpha = Math.min(this.circle.alpha, spec.alpha);
					if (this.text) this.text.alpha = Math.min(this.text.alpha, spec.alpha);
				} catch {
					// never break the graph's own drawing
				}
			};
			this.patches.push({ proto: proto as Patch["proto"], original, patched: patched as RenderFn, state });
			(proto as Patch["proto"]).render = patched as RenderFn;
			this.nodeProtoPatched = true;
		}
		if (!this.linkProtoPatched) {
			const link = renderer.links[0];
			if (link) {
				const proto = Object.getPrototypeOf(link) as { render?: unknown } | null;
				if (proto && typeof proto.render === "function") {
					const original = proto.render as RenderFn;
					const state = { on: true };
					const patched = function (this: GraphLink): void {
						original.call(this);
						if (!state.on) return;
						try {
							const spec = active.get(this.renderer);
							if (spec === undefined) return;
							if (keeps(spec, this.source) && keeps(spec, this.target)) return;
							if (this.line) this.line.alpha = Math.min(this.line.alpha, spec.alpha);
							if (this.arrow) this.arrow.alpha = Math.min(this.arrow.alpha, spec.alpha);
						} catch {
							// ignore
						}
					};
					this.patches.push({ proto: proto as Patch["proto"], original, patched: patched as RenderFn, state });
					(proto as Patch["proto"]).render = patched as RenderFn;
					this.linkProtoPatched = true;
				}
			}
		}
		return true;
	}
}
