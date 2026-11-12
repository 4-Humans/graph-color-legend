/** Longer queries are cut before building a name: a legend name never needs more. */
const MAX_QUERY = 500;
const MAX_LABEL = 120;

/**
 * Builds a short, readable name from a graph search query.
 * Examples:
 *   "[stage:idea]"              -> "stage: idea"
 *   "tag:#tools tag:#voice"     -> "#tools #voice"
 *   "path:wiki/science"         -> "science"
 *   "a OR b"                    -> "a | b"
 * All patterns are simple (no nested or overlapping repeats), and the input is
 * capped, so a crafted query in a shared vault cannot freeze the app.
 */
export function labelFromQuery(query: string): string {
	let s = query.trim().slice(0, MAX_QUERY);
	if (!s) return "";

	// [property:value] -> property: value
	s = s.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
		const i = inner.indexOf(":");
		if (i < 0) return inner.trim();
		const k = inner.slice(0, i).trim();
		const v = inner.slice(i + 1).trim();
		return v ? `${k}: ${v}` : k;
	});
	// tag:#x or tag:x -> #x
	s = s.replace(/\btag:#?([^\s()]+)/g, "#$1");
	// path:"a/b c" or path:a/b -> last folder name
	s = s.replace(/\bpath:(?:"([^"]*)"|(\S+))/g, (_m, q1?: string, q2?: string) => {
		const p = (q1 ?? q2 ?? "").replace(/\/+$/, "");
		const parts = p.split("/");
		return parts[parts.length - 1] || p;
	});
	// file:"x" / file:x -> x
	s = s.replace(/\bfile:(?:"([^"]*)"|(\S+))/g, (_m, q1?: string, q2?: string) => q1 ?? q2 ?? "");
	// OR -> |
	s = s.replace(/ OR /g, " | ");
	// drop parentheses and quotes that only add noise, squeeze spaces
	s = s.replace(/[()"]/g, "").split(/\s+/).filter(Boolean).join(" ");
	if (s.length > MAX_LABEL) s = s.slice(0, MAX_LABEL - 1) + "…";
	return s || query.trim().slice(0, MAX_LABEL);
}
