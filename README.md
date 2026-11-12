# Graph Color Legend

Shows the color groups of the Obsidian graph view as a small legend in the corner of the graph, so you can see at a glance what each color means.

[Русская версия ниже](#graph-color-legend-по-русски)

## Features

- **Legend on the graph.** Every color group from the graph settings (Groups) is listed with its color. Works in the global graph and in the local graph.
- **Collapsible.** Collapse the legend to a small button; the state is remembered.
- **Readable names.** Names are made from the query automatically (`[stage:idea]` becomes `stage: idea`, `tag:#tools tag:#voice` becomes `#tools #voice`). Click an entry for its menu: keep it highlighted, rename it only in the legend, rename the tag everywhere, or hide it. Hidden entries come back through the pencil button in the legend header or the plugin settings. Names are stored by the plugin; your graph settings are never changed.
- **Rename a tag.** For entries built from tags, the menu offers two ways: a new name only in the legend, or renaming the tag itself in all notes (text and properties, nested tags included). Before anything changes you see the list of notes that will be edited and confirm it. The color group in the graph settings is updated to the new tag.
- **Highlight a group.** Point at an entry and the other nodes fade. Choose “Keep highlighted” in the entry's menu to keep it (on phones, where there is no pointing, this is the way to highlight).
- **Desktop and mobile.** No Node.js or Electron APIs. Touch targets are larger on phones.
- **Follows your theme.** Uses Obsidian's CSS variables.
- **Your language.** The plugin's menus follow the Obsidian interface language: English, Chinese (Simplified and Traditional), French, German, Italian, Japanese, Korean, Polish, Portuguese (Brazil), Russian, Spanish, Turkish and Ukrainian. Other languages fall back to English. Names and tags can be written in any script, and emoji work in tags too. Translations other than English and Russian were made without a native speaker; corrections are welcome as issues or pull requests (files in `src/locales/`).

## Settings

- Position: corner of the graph (top left by default).
- Font size and background opacity.
- Highlight on hover: on or off.
- Show in local graph: on or off. A local graph without its own color groups gets no legend.
- Entries: rename or hide each entry; reset all names.

## How it works and limits

Obsidian has no public API for the graph view. The plugin reads the color groups that the graph view itself shows (falling back to `.obsidian/graph.json`) and, for the highlight, lowers the opacity of the nodes outside the chosen group after the graph draws them. All of this is wrapped in checks: if a future Obsidian version changes the graph internals, the highlight switches itself off and the legend keeps working. Tested with Obsidian 1.15.0.

Groups that share exactly the same color are highlighted together, because nodes are matched by color.

Renaming a tag in notes uses Obsidian's own file API (`vault.process`, `fileManager.processFrontMatter`). Tags inside code blocks are not touched. A note is only edited if the tag is still exactly where Obsidian's index says it is; otherwise the note is skipped and listed. Obsidian may rewrite a `tags` property in list form when it saves properties. The change cannot be undone with one click, so keep a backup or use version control.

## Privacy and security

- No network requests, no telemetry, no external code. The bundle imports nothing but the `obsidian` module.
- Reads only the graph settings (`.obsidian/graph.json`) and its own `data.json`. Writes notes only when you confirm a tag rename.
- Everything from those files is shown as plain text (no `innerHTML`); settings are type-checked when loaded, so a crafted `graph.json` or `data.json` in a shared vault cannot run code or break the interface. Query parsing is linear-time and length-capped, so a crafted query cannot freeze the app.

## Installation

From Community plugins: search for "Graph Color Legend" (after it is published).

Manually: copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<your vault>/.obsidian/plugins/graph-color-legend/`, then enable the plugin in Settings → Community plugins.

## Development

```bash
npm install
npm run dev     # rebuild on change
npm run build   # type check and production build
npx eslint .    # lint with the official Obsidian rules
```

## License

MIT © 2026 4 Humans

---

# Graph Color Legend (по-русски)

Показывает цветовые группы графа Obsidian небольшой легендой в углу графа, чтобы сразу было видно, что означает каждый цвет.

## Возможности

- **Легенда на графе.** Все цветовые группы из настроек графа (раздел «Группы») с их цветами. Работает в общем и в локальном графе.
- **Сворачивается** в маленькую кнопку, состояние запоминается.
- **Переименование тега.** Для записей из тегов меню предлагает два варианта: имя только в легенде или переименование самого тега во всех заметках (в тексте и в свойствах, с вложенными тегами). Перед изменением показывается список заметок, которые будут изменены, и нужно подтверждение. Цветовая группа в настройках графа переходит на новый тег.
- **Понятные имена.** Имя строится из запроса само (`[stage:idea]` → `stage: idea`, `tag:#tools tag:#voice` → `#tools #voice`). Нажатие на запись открывает меню: закрепить подсветку, переименовать только в легенде, переименовать тег везде или скрыть. Скрытые записи возвращаются кнопкой с карандашом в заголовке легенды или в настройках плагина. Имена хранит плагин, настройки графа не меняются.
- **Подсветка группы.** Наведите на запись, и остальные узлы побледнеют. Пункт меню «Закрепить подсветку» оставляет её включённой (на телефоне подсветка включается так).
- **ПК и телефон.** Без Node.js и Electron. На телефоне кнопки крупнее.
- **Под тему оформления.** Цвета интерфейса берутся из темы Obsidian.
- **На вашем языке.** Меню плагина на языке интерфейса Obsidian: английский, испанский, итальянский, китайский (упрощённый и традиционный), корейский, немецкий, польский, португальский (Бразилия), русский, турецкий, украинский, французский, японский; для других языков английский. Имена и теги можно писать на любом языке, в тегах работают и эмодзи. Переводы, кроме английского и русского, сделаны без носителей языка; исправления приветствуются (файлы в `src/locales/`).

## Как устроено и ограничения

У графа Obsidian нет публичного API. Плагин читает цветовые группы, которые показывает сам граф (а если не получилось, то из `.obsidian/graph.json`), а для подсветки после отрисовки делает бледнее узлы вне выбранной группы. Всё это обёрнуто проверками: если новая версия Obsidian изменит устройство графа, подсветка отключится сама, а легенда продолжит работать. Проверено на Obsidian 1.15.0.

Группы с одинаковым цветом подсвечиваются вместе, потому что узлы находятся по цвету.

Переименование тега в заметках идёт через функции Obsidian для записи файлов. Теги в блоках кода не меняются. Заметка меняется, только если тег стоит ровно там, где его видит индекс Obsidian; иначе она пропускается и показывается в списке. Отменить переименование одной кнопкой нельзя, держите резервную копию.

## Приватность и безопасность

- Нет сетевых запросов, телеметрии и чужого кода. В сборке нет ничего, кроме модуля `obsidian`.
- Читает только настройки графа и свой `data.json`. Заметки меняет только после вашего подтверждения переименования тега.
- Всё из этих файлов выводится как обычный текст, настройки проверяются при загрузке, поэтому подделанный `graph.json` или `data.json` в чужом хранилище не может выполнить код или сломать интерфейс. Разбор запросов ограничен по длине и не может «подвесить» программу.

## Установка вручную

Скопируйте `main.js`, `manifest.json` и `styles.css` в `<хранилище>/.obsidian/plugins/graph-color-legend/` и включите плагин в «Настройки → Сторонние плагины».

## Лицензия

MIT © 2026 4 Humans
