import { getLanguage } from "obsidian";
import { en, Strings } from "./locales/en";
import { de } from "./locales/de";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { pl } from "./locales/pl";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { tr } from "./locales/tr";
import { uk } from "./locales/uk";
import { zh } from "./locales/zh";
import { zhTW } from "./locales/zh-tw";

export type { Strings };

/** Keys are Obsidian language codes, lower case. Unknown languages fall back to English. */
const LOCALES: Record<string, Strings> = {
	en, de, es, fr, it, ja, ko, pl, pt, ru, tr, uk, zh,
	"pt-br": pt,
	"zh-tw": zhTW,
	"zh-hk": zhTW,
};

/** Strings in the language of the Obsidian interface: exact code first, then the base language. */
export function t(): Strings {
	let lang = "en";
	try {
		lang = getLanguage() || "en";
	} catch {
		// Older Obsidian without getLanguage(): stay in English.
	}
	const code = lang.toLowerCase().replace("_", "-");
	return LOCALES[code] ?? LOCALES[code.split("-")[0] ?? "en"] ?? en;
}
