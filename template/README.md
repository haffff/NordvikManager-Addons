# NordvikManager addon template

A starting point for a NordvikManager addon: one card (an HP tracker built with Vite + React), one action, a pack script, a release workflow and a Card API mock for developing outside the app.

Docs: https://nordvikmanager.pl/addon-guide/

## Start

1. Copy this folder into a new repository.
2. In `addon_files/info.json`, set `key` (lowercase letters and digits, never changed after the first release), `name`, `description`, `author` and `repositoryUrl`.
3. Replace `myaddon` everywhere with your key: resource names in `Templates/hp_tracker.json`, the action name in `src/App.jsx`, the card folder `card_sources/myaddon-hpcard/` and `asset-name` in `.github/workflows/release.yml`.

```
pnpm install                      # pack script dependencies
cd card_sources/myaddon-hpcard
pnpm install
pnpm dev                          # the card in a browser tab, with ApiMock.js
```

```
pnpm test                         # ApiMock tests (add your own)
pnpm run pack                     # builds every card in card_sources/ and writes packed.zip
```

Install `packed.zip` in a game: *Addons → Addons → Install*. To install a new build of the same version, uninstall it first (*Installed* tab).

## Layout

```
addon_files/                 what goes into the zip
  info.json                  key, name, version
  Templates/hp_tracker.json  the card template: page, scripts, default properties
  Actions/roll_check.json    an action the card's button runs on the server
  Resources/index.html       the card's page; built scripts are added here by the pack script
card_sources/myaddon-hpcard/ the card's source (Vite + React)
  ApiMock.js                 stand-in for window.CardAPI in `pnpm dev`
  vite.config.js             builds one IIFE file: the app loads card scripts as classic <script> tags
scripts/pack.mjs             pnpm run pack
.github/workflows/release.yml
AGENTS.md, CLAUDE.md         guide for AI coding assistants (https://nordvikmanager.pl/ai/AGENTS.md)
```

Every JSON file starts with a `$schema` line, so editors check it against the schemas in https://github.com/haffff/NordvikManager-Addons/tree/main/schemas.

More cards: add another folder under `card_sources/` (with its own `package.json`); the pack script builds every one and copies it to `Resources/<folder>.js` and `.css`. List them in a template as `<key>_<folder>.js`.

## Release

1. Raise `version` in `addon_files/info.json` and merge it.
2. Run **Actions → Release → Run workflow**. It packs the addon and publishes a GitHub Release with the zip.
3. First release only: add your addon to the registry with a pull request to https://github.com/haffff/NordvikManager-Addons (`addons.json`). `releaseUrl` is the release asset link (`…/releases/download/<tag>/<file>.zip`), never GitHub's "Source code" zip. Later releases are picked up automatically.

Don't commit `packed/`, `packed.zip`, `dist/` or `node_modules/` (see `.gitignore`).
