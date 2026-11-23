# Changelog

What changed in each version of Graph Color Legend, newest first. The same notes are on the [Releases](https://github.com/4-Humans/graph-color-legend/releases) page.

## 2.4.0 (2026-11-23)

Find any word from your notes right on the graph.

- **Search in note text.** The legend's search box now also looks in the text and names of your notes. It searches exactly what you type, like Find in a text editor: letter case does not matter, part of a word is enough.
- **On the graph or everywhere.** A switch under the results chooses where to look: in the notes shown on the graph (the default) or in all notes of the vault. The choice is remembered. The count line always tells how many notes with matches are on the other side.
- **Results in the legend.** A block under the box shows how many matches there are and in how many notes, then the notes with the lines where the text was found. The legend's own rows move down, and the legend gets wider and taller while results are shown.
- **Found notes on the graph.** Notes with matches stay bright, the rest fade. "Show only highlighted" leaves only them.
- **Go to the word.** Click a line to open the note at that place with the found text selected. Arrow keys move through the results, Enter opens.
- **For complex queries**, a button opens the same text in Obsidian's own search.
- New setting **Search in note text**, on by default. Notes are read on your device only; nothing is stored or sent.
- **Notes without a group.** Nodes that no color group colors (grey on the graph) now have their own last row, **No group**, with their count. Point at it or click it to highlight them, or list them from its menu. It is hidden when there are none, and a setting turns it off.
- **Fixed:** the search field showed a second grey frame inside its own.

## 2.3.0 (2026-11-21)

For vaults where an AI agent writes the notes and you read the graph.

- **Changes to graph.json appear at once.** Obsidian reads the graph's settings file only at startup. The plugin now looks at it every two seconds: color groups that an agent, sync or a text editor added, changed or reordered go to the graph without a restart, with a note in the legend and **Undo**. Only the groups are applied; nothing else in the file is touched.
- **Removed groups wait for you.** A group that disappears from the file stays on the graph until you decide. A window lists such groups with their colors and names, each with a switch (on by default): **Keep checked** puts them back into the file, **Remove all** removes them. It opens when a graph is on screen and you are not typing; closing it decides nothing, the legend keeps a **Review** bar, and the window returns at the next start. Groups removed while Obsidian was closed are found at startup. Removing can be undone with the arrow.

- **Names in notes.** A note can now give its color group a short name with the property `graph-legend-name`, next to `graph-legend`. Without it the legend uses the note's title, as before.
- **Rename once, seen everywhere.** When a color group has a describing note, renaming the entry in the legend writes the name into that note (`graph-legend-name`), so you and your AI agent see the same name. Groups without such a note keep the name in the plugin, as before; when a describing note appears later, the name moves into it. If that note is deleted, the name goes back to the plugin. Can be undone with the arrow.
- **Queries matched by meaning.** `graph-legend: "#work"` now finds the group `tag:#Work`: extra spaces, `tag:` or not, letter case of tags and properties, and the order of terms no longer matter.
- **Fixed: tag rename lost the name.** Renaming a tag in all notes now also updates the `graph-legend` property of the notes that describe a group with that tag. Before, the group fell back to its raw query.
- **Unnamed groups stand out.** A color group with no name shows its query in italics, its tooltip says so, and its menu offers "Give it a name".

## 2.2.0 (2026-11-19)

- **Hide empty groups.** A color group with no notes in the graph, for example one whose pages are all filtered out, is no longer listed as a faint row with 0. A new setting, on by default; turn it off to see every color, for example in a local graph. This includes a catch-all group kept last whose notes all go to groups above. Edit mode (with the warning) and search still show empty groups, so they can be found, renamed and moved. The legend picture leaves them out too.
- **Safety copy of the color groups.** The plugin keeps a copy of the global graph's color groups. If they all disappear, for example after "Restore default settings" in the graph's own settings (that button clears every group), the legend shows a bar with "Restore", which puts them back (and can be undone). "Not needed" drops the copy, for when you removed the groups on purpose.
- **Settings at hand.** A gear button in the legend header, next to the pencil, opens the plugin settings. The header's right-click menu has the same item.

## 2.1.2 (2026-11-18)

- Documentation only: added this changelog and a link to it in the README. The plugin itself is unchanged.

## 2.1.1 (2026-11-17)

- Fixed: the legend picture is now drawn with Obsidian's own `createEl` helper, as the plugin guidelines ask. Nothing changes for users.

## 2.1.0 (2026-11-17)

- **Legend anywhere on the graph.** Drag the legend by its title to any place on the graph; a short click on the title still collapses it. The place is kept separately for the global and the local graph and stays inside the graph when the window gets smaller. Right-click the header and choose "Back to the corner" to return it.
- **List or compact.** A new compact style with tight rows, for many groups and small screens. Switch in the settings, in the header's right-click menu or with a command.
- **Legend as a picture.** Copy the color groups as a PNG or save it where the vault keeps attachments, in your theme's colors and without buttons. From the header's right-click menu, the picture button in edit mode or two commands.
- README: how to name a new color group.

## 2.0.1 (2026-11-12)

- Plugin settings now show up in Obsidian's settings search (Obsidian 1.13 and later). Older versions keep the same settings as before.
- Fixes for two code review warnings.
- New CONTRIBUTING.md: how to report a bug, fix a translation or send code.
- Release files are now built and signed by GitHub Actions (artifact attestations), so you can check they were built from this repository.

## 2.0.0 (2026-11-12)

- **Drag to reorder.** Hold an entry and move it within its section. The order of color groups is saved in the graph settings; the order of tags and properties is kept by the plugin.
- **Undo and redo.** Arrows in the legend header (red and green) undo and redo the legend's changes, including tag renames in notes. After a change, a bar under the header offers Undo right where you work.
- **Counts and warnings.** Each color group shows how many nodes it colors, and warns when a group above takes its notes or when two groups share a color.
- **Tags and properties** of the notes in the graph, in two collapsible sections. Any of them can become a color group in one step.
- **Search** in the legend, **show notes** of an entry, **show only highlighted** nodes, **highlight linked notes**.
- **Three-state eye:** shown, highlighted, hidden; several entries can be highlighted at once.
- **Resizable legend**, kept apart for the global and the local graph.
- **Names from notes:** a note with `graph-legend: "<query>"` names an entry and gets "Open page" in its menu.
- **Group color** in the rename dialog; **sets of color groups**; **commands** for the main actions.
- 14 interface languages.

## 1.0.1 (2026-11-12)

- Works the same on every supported Obsidian version (1.8.7 and newer): the "destructive" buttons no longer rely on an API from Obsidian 1.13.
- Lighter CSS: the graph settings panel stays above the legend without the `:has` selector.
- README: support contacts (support@4humans.io) and links to the 4-Humans repository.

## 1.0.0 (2026-11-12)

First release.

- Collapsible legend of the graph's color groups (global and local graph).
- Rename or hide entries, rename a tag across all notes.
- Highlight a group on hover or tap.
- 14 interface languages.
