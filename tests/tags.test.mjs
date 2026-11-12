import assert from "node:assert/strict";
import * as T from "./tags.bundle.mjs";
import { labelFromQuery } from "./labels.bundle.mjs";
const eq = (a, b, m) => assert.deepEqual(a, b, m);
// extractTags
eq(T.extractTags("tag:#tools tag:#voice"), ["tools", "voice"]);
eq(T.extractTags("[stage:idea]"), []);
eq(T.extractTags("#a OR (tag:b) path:x#y"), ["b", "a"]);
eq(T.extractTags("tag:#Проекты/ИИ"), ["Проекты/ИИ"]);
// replaceTagInQuery
eq(T.replaceTagInQuery("tag:#tools tag:#voice", "tools", "инструменты"), "tag:#инструменты tag:#voice");
eq(T.replaceTagInQuery("tag:#toolsbox", "tools", "x"), "tag:#toolsbox", "prefix must not match");
eq(T.replaceTagInQuery("tag:#tools/ai", "tools", "x"), "tag:#x/ai", "nested");
eq(T.replaceTagInQuery("(tag:#Tools) OR #tools", "tools", "x"), "(tag:#x) OR #x", "case-insensitive, bare");
eq(T.replaceTagInQuery("path:a#tools", "tools", "x"), "path:a#tools", "not inside other tokens");
eq(T.replaceTagInQuery("tag:#a.b", "a.b", "c"), "tag:#c", "regex chars escaped");
eq(T.replaceTagInQuery("tag:#axb", "a.b", "c"), "tag:#axb", "dot is literal");
// renameTagValue
eq(T.renameTagValue("#tools/ai", "tools", "x"), "#x/ai");
eq(T.renameTagValue("tools", "#tools", "#x"), "x");
eq(T.renameTagValue("#toolsbox", "tools", "x"), null);
// validateTag
eq(T.validateTag("новый-тег"), null);
eq(T.validateTag("a b"), "chars");
eq(T.validateTag("123"), "digits");
eq(T.validateTag("a/"), "slash");
eq(T.validateTag("#"), "empty");
eq(T.validateTag("<img src=x>"), "chars");
eq(T.validateTag("😀"), null, "emoji");
eq(T.validateTag("книги📚/👍🏽"), null, "emoji with skin tone, nested");
eq(T.validateTag("👨‍👩‍👧"), "chars", "ZWJ sequence: Obsidian cuts the tag at the joiner");
eq(T.validateTag("🇰🇷"), null, "flag");
eq(T.validateTag("❤️"), null, "variation selector");
eq(T.validateTag("한국어"), null);
eq(T.validateTag("日本語"), null);
eq(T.validateTag("中文/繁體"), null);
eq(T.validateTag("a;b"), "chars");
// frontmatter
let fm = { tags: ["tools", "#tools/ai", "x", 5], title: "t" };
eq(T.countFrontmatterTags(fm, "tools"), 2);
eq(T.renameFrontmatterTags(fm, "tools", "x"), 2);
eq(fm.tags, ["x", "#x/ai", 5], "dedupe after merge");
fm = { tag: "tools, other #tools/sub" };
eq(T.renameFrontmatterTags(fm, "tools", "new"), 2);
eq(fm.tag, "new, other #new/sub");
fm = { tags: ["a", "a"] };
eq(T.renameFrontmatterTags(fm, "tools", "x"), 0);
eq(fm.tags, ["a", "a"], "untouched when nothing renamed");
eq(T.countFrontmatterTags(null, "x"), 0);
eq(T.countFrontmatterTags({ tags: { evil: 1 } }, "x"), 0);
// labels
eq(labelFromQuery("[stage:idea]"), "stage: idea");
eq(labelFromQuery("tag:#tools tag:#voice"), "#tools #voice");
eq(labelFromQuery("path:\"wiki/my folder/\""), "my folder");
eq(labelFromQuery(""), "");
console.log("all tag/label tests passed");
