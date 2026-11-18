# Changelog

What changed in each version of Graph Color Legend, newest first. The same notes are on the [Releases](https://github.com/4-Humans/graph-color-legend/releases) page.

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
