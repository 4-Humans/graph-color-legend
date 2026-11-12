# Contributing to Graph Color Legend

Thank you for helping. Bug reports, ideas, translations and code are all welcome.

## Report a bug or ask for a feature

Open an [issue](https://github.com/4-Humans/graph-color-legend/issues) and include:

- your Obsidian version and platform (Windows, macOS, Linux, Android, iOS);
- what you did, what you expected and what happened;
- a screenshot if it helps, and the color group queries involved (Settings → Graph view → Groups).

You can also write to [support@4humans.io](mailto:support@4humans.io).

## Improve a translation

The interface strings are in `src/locales/`, one file per language; `en.ts` is the reference.
Translations other than English and Russian were made without a native speaker, so corrections are very welcome.
Keep the keys and the placeholders (`${name}`, `${n}`) as they are.

## Change the code

```bash
npm install
npm run dev     # rebuild on change
npm run build   # type check and production build
npx eslint .    # lint with the official Obsidian rules
npm test        # tests for tags, names and queries
```

To try your build, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/graph-color-legend/` and reload Obsidian.

Please keep to these rules, they are what the plugin promises its users:

- no network requests, no telemetry, no external runtime code;
- only the public Obsidian API, except for the graph view, whose internal state is read in `src/graph-internals.ts` with checks around every access;
- nothing newer than `minAppVersion` in `manifest.json`;
- text from notes and settings is shown as text, never as HTML;
- every change to notes or graph settings can be undone from the legend, and notes are changed only after the user confirms.

Open a pull request against `main` with a short description of what changes for the user. Run the build, lint and tests first.

## Releases

Releases are built by GitHub Actions (`.github/workflows/release.yml`): when a release is published, the workflow builds the plugin, signs the files with artifact attestations and attaches `main.js`, `manifest.json` and `styles.css`. The release tag must match the version in `manifest.json`.

## License

By contributing you agree that your contribution is released under the [MIT License](LICENSE).
