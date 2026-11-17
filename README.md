# Graph Color Legend

See at a glance what each color in your Obsidian graph means.

![The legend in the corner of the graph](screenshots/screenshot-legend.png)

## What it does

- Lists the graph's color groups in a small legend, with how many nodes each one colors. Works in the global and the local graph, on desktop and mobile.
- Point at an entry to highlight its notes. Click to keep it highlighted, or show only the highlighted nodes.
- Shows the tags and properties of the notes in the graph. Turn any of them into a color group in one step.
- Drag entries to reorder groups. A warning appears when a group above takes a group's notes.
- Rename an entry only in the legend, or rename a tag in all notes after a preview of every note that will change.
- Undo and redo every change, tag renames included.
- Search, resize and collapse the legend, save and apply sets of color groups. Follows your theme, available in 14 languages.

![Highlighting one group](screenshots/screenshot-highlight.png)

## Names in the legend

Each entry takes its name from the first of these that exists:

1. The name you gave it in the legend.
2. A note with the property `graph-legend: "<query>"`, where `<query>` is the group's query exactly as in the graph settings. The legend shows the note's title, and the entry's menu gets "Open page".
3. The query itself, made readable: `[status:done]` becomes `status: done`, `tag:#work tag:#meeting` becomes `#work #meeting`.

## Vaults kept by AI agents

**The problem.** If an AI agent (Claude Code, Codex, Cursor, Gemini and others) adds color groups to your vault, the new groups show up in the legend as raw queries, for example `#work #meeting` instead of "Meetings", or `path:Journal/Daily` instead of "Daily notes". The agent does not know that the legend needs a name.

**The fix.** Add this rule to the agent's instructions file (`AGENTS.md`, `CLAUDE.md` or similar):

```
When you add a color group to .obsidian/graph.json:
1. Find or create the note that describes the group.
2. In its front matter, add: graph-legend: "<query>"
3. Copy <query> from graph.json exactly, character for character.
4. Do not edit the Graph Color Legend plugin's data.json.
```

**Why a note property.** The agent already works with notes, so the rule is easy for it to follow. The name also survives sync and reinstalling the plugin, which names kept in the plugin's settings do not.

## Privacy

Everything runs inside Obsidian on your device. The plugin makes no network requests, sends nothing anywhere, collects no statistics and keeps no data outside your vault.

It reads the list of notes only for two features: renaming a tag in all notes, and taking entry names from notes with the `graph-legend` property. Notes are changed only after you confirm, and the change can be undone with the arrow in the legend.

Details: everything read from files is shown as plain text, settings are checked when loaded, and query parsing is length-capped, so a crafted `graph.json` or `data.json` in a shared vault cannot run code or freeze the app. The bundle imports nothing but the `obsidian` module.

<details>
<summary>All features in detail</summary>

- **Legend on the graph.** Every color group from the graph settings (Groups) is listed with its color. Works in the global graph and in the local graph.
- **Tags and properties.** Below the color groups, two collapsible sections list the tags and the property values (for example `status: done`) of the notes that the graph shows, with the number of notes. They can be highlighted like groups; the notes keep their own colors. Both sections can be turned off in the settings.
- **Collapsible and resizable.** Collapse the legend to a small button; the state is remembered. Drag the free edge or corner of the legend to make it wider or taller (double-click the edge to go back to the automatic size). The size is kept separately for the global and the local graph; long lists scroll.
- **Search.** The magnifier next to the pencil opens a search box that filters all entries by name or query as you type. The cross inside the box clears it, the cross next to it (or Esc) closes it; pressing the magnifier again selects the text so you can type a new search.
- **Readable names.** A name is taken, in this order, from: the name you gave it in the legend; a note that describes the entry with the property `graph-legend: "<query>"` (the note's title is used, and the menu gets “Open page”); or the query itself (`[status:done]` becomes `status: done`, `tag:#work tag:#meeting` becomes `#work #meeting`).
- **Menu and edit mode.** Right-click an entry (long-press on phones) for its menu: highlight it, open its page, rename it only in the legend, rename the tag everywhere, or hide it. In edit mode (the pencil button in the legend header) each entry has an eye button with three states: grey — shown, blue — highlighted, crossed out — hidden. The eye in the header goes the same round for all entries at once (highlight all → hide all → show all), and the cross clears all highlights. Hidden entries come back there or in the plugin settings.
- **Rename a tag.** For entries built from tags, the menu offers two ways: a new name only in the legend, or renaming the tag itself in all notes (text and properties, nested tags included). Before anything changes you see the list of notes that will be edited and confirm it, and the rename can be undone with the arrow in the legend. The color group in the graph settings is updated to the new tag. The same window lets you change the group's color; it is saved in the graph settings, so the graph and the legend always show the same color.
- **Highlight.** Point at an entry and the other nodes fade. Click it to keep it highlighted, click again to turn it off; several entries can be highlighted at once. Highlights reset when Obsidian restarts.
- **Only highlighted.** With something highlighted, the target button in the header hides all other nodes instead of fading them. A bar under the header says that the mode is on and has a “Show all” button; the target button (also in the collapsed legend) and a command turn it off too.
- **Linked notes.** Optionally, highlighting an entry also keeps the notes linked to it bright (setting or command).
- **Counts and warnings.** Each color group shows how many nodes the graph draws in its color. A note gets the color of the first group that matches it, so a group can lose some or all of its notes to a group above; a warning sign then names that group. Groups that share one color are marked too, because they are highlighted together. The check understands simple queries (tags, properties, `path:`, `file:`, `-` to exclude); for other queries the legend shows only the count.
- **Drag to reorder.** Hold an entry with the mouse and move it: a see-through copy follows the pointer and the other entries make room. An entry moves only within its own section (color groups, tags or properties); outside it, or with Esc, it goes back. The order of color groups is saved in the graph settings (it decides which color a note gets); the order of tags and properties is kept by the plugin only (right-click a section title for the default order). On phones, use the grip in edit mode, since a long press opens the menu.
- **Undo and redo.** Arrows in the legend header undo and redo the legend's changes: order, new groups, sets, colors, hidden entries, names, and tag renames in notes. A tag rename is undone note by note, and only in notes that were not edited after it, so later edits are never lost. After each change a short bar under the header offers Undo right where you work. The history lasts until Obsidian restarts (up to 50 steps); renames of more than 20 MB of notes cannot be undone, and the dialog says so before you confirm.
- **Tag or property → color group.** The menu of a tag or a property has “Make a color group”: pick a color and whether the group goes first or last.
- **Show notes.** The menu of any entry lists its notes in the graph, with a filter; click a note to open it, or open the same query in Obsidian's search.
- **Sets of color groups.** In edit mode, the palette button saves the current groups (queries, colors, order) as a named set and applies saved sets, for example “by status” and “by topic”. Applying a set can be undone. Sets are renamed or deleted in the plugin settings. A local graph has its own groups, so there a set changes only that graph.
- **Commands.** Undo and redo, show or hide the legend, search the legend, clear all highlights, show only highlighted nodes, highlight linked notes, apply a set. No hotkeys are set by default; add your own in Settings → Hotkeys.
- **Desktop and mobile.** No Node.js or Electron APIs. Touch targets are larger on phones.
- **Follows your theme.** Uses Obsidian's CSS variables.
- **Your language.** The plugin's menus follow the Obsidian interface language: English, Chinese (Simplified and Traditional), French, German, Italian, Japanese, Korean, Polish, Portuguese (Brazil), Russian, Spanish, Turkish and Ukrainian. Other languages fall back to English. Names and tags can be written in any script, and emoji work in tags too. Translations other than English and Russian were made without a native speaker; corrections are welcome as issues or pull requests (files in `src/locales/`).

</details>

<details>
<summary>Settings</summary>

- Position: corner of the graph (top left by default).
- Font size and background opacity.
- Highlight on hover: on or off.
- Show in local graph: on or off. A local graph without its own color groups gets no legend.
- Show tags, show properties: on or off.
- Highlight linked notes: on or off.
- Show the legend: on or off (also a command).
- Sets of color groups: rename or delete.
- Entries: rename or hide each entry; reset all names.

</details>

<details>
<summary>How it works and limits</summary>

Obsidian has no public API for the graph view. The plugin reads the color groups that the graph view itself shows (falling back to `.obsidian/graph.json`) and, for the highlight, lowers the opacity of the nodes outside the chosen group after the graph draws them. All of this is wrapped in checks: if a future Obsidian version changes the graph internals, the highlight switches itself off and the legend keeps working. Tested with Obsidian 1.15.0.

Groups that share exactly the same color are highlighted together, because nodes are matched by color.

Renaming a tag in notes uses Obsidian's own file API (`vault.process`, `fileManager.processFrontMatter`). Tags inside code blocks are not touched. A note is only edited if the tag is still exactly where Obsidian's index says it is; otherwise the note is skipped and listed. Obsidian may rewrite a `tags` property in list form when it saves properties. The undo keeps the texts in memory until Obsidian restarts; for anything older, keep a backup or use version control.

</details>

## Installation

From Community plugins: search for "Graph Color Legend".

Manually: copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<your vault>/.obsidian/plugins/graph-color-legend/`, then enable the plugin in Settings → Community plugins.

## Development

```bash
npm install
npm run dev     # rebuild on change
npm run build   # type check and production build
npx eslint .    # lint with the official Obsidian rules
```

Releases are built and signed by GitHub Actions; see [CONTRIBUTING.md](CONTRIBUTING.md) for how to help with code or translations.

## Support

Found a bug or have a question? [Open an issue](https://github.com/4-Humans/graph-color-legend/issues) or write to [support@4humans.io](mailto:support@4humans.io).

If the plugin helps you, a star on GitHub helps other people find it.

## License

MIT © 2026 4 Humans
