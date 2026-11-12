import * as T from "./tags.bundle.mjs";
import { labelFromQuery } from "./labels.bundle.mjs";
const alphabet = ['[', ']', ':', ' ', '#', 'tag:', 'path:', 'file:', '"', '(', ')', '/', 'OR', 'a', 'я', '\n', '\\', '.', '*'];
let worst = 0;
for (let i = 0; i < 300; i++) {
  const n = 2000 + Math.floor(Math.random() * 20000);
  let s = ''; for (let j = 0; j < n; j++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  const t0 = performance.now();
  labelFromQuery(s); const tags = T.extractTags(s);
  T.replaceTagInQuery(s, tags[0] ?? 'a', 'b'); T.renameFrontmatterTags({ tags: s }, 'a', 'b'); T.validateTag(s);
  worst = Math.max(worst, performance.now() - t0);
}
// repeated-token worst cases
for (const tok of ['[', 'tag:', ' ', '#', 'path:"', '(', 'a/']) {
  const s = tok.repeat(100000);
  const t0 = performance.now(); labelFromQuery(s); T.extractTags(s); T.replaceTagInQuery(s, 'a', 'b'); T.renameFrontmatterTags({ tag: s }, 'a', 'b');
  worst = Math.max(worst, performance.now() - t0);
}
console.log('worst ms', worst.toFixed(1));
