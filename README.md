# NordvikManager addon registry

`addons.json` lists the addons a NordvikManager backend can install. Each entry points at an addon's GitHub repository and at the release zip that gets installed. `schemas/` holds the JSON schemas for the registry, for an addon's `info.json` and for tokens.

## Starting a new addon

Copy [`template/`](template/): one card (Vite + React) with a Card API mock, one action, the pack script, the release workflow and an `AGENTS.md` for AI coding assistants. Its README walks through the rest. Docs: https://nordvikmanager.pl/addon-guide/

## Schemas

Addon files point at these with a `$schema` line, so editors check them:

| Schema | For |
|---|---|
| `schemas/addon.json` | an addon's `info.json` |
| `schemas/card.json` | files in `Templates/` and `Views/` |
| `schemas/action.json` | files in `Actions/` |
| `schemas/token.json` | token files in `Resources/` |
| `schemas/repositorySchema.json` | this registry's `addons.json`: each entry is an `addon.json` plus the fields the registry needs (`releaseUrl`, `dependencies`, …) |

Use `https://raw.githubusercontent.com/haffff/NordvikManager-Addons/refs/heads/main/schemas/<file>`. `npm test` checks the schemas and the template's files against them.

## Releasing an addon

Every addon repository has a **Release** workflow (Actions → Release → Run workflow):

1. Bump `version` in the addon's `addon_files/info.json` and merge it as usual.
2. Run **Release** on that branch. In the themes repository, also pick the theme.

The workflow then:
- reads the key and version from `info.json`;
- stops if that version is already released;
- packs the addon and checks that the zip's `info.json` matches;
- publishes a GitHub Release with the zip.

The steps live in [`.github/workflows/release-addon.yml`](.github/workflows/release-addon.yml), a reusable workflow that each addon repository calls with its pack command, zip path, asset name and tag.

## The readme of an entry

An entry may have a `readme`: the raw URL of a markdown file, shown in the game's Addons panel (Browse, Installed) and on [nordvikmanager.pl/addons](https://nordvikmanager.pl/addons). Pin it to the release's tag, so it describes the version people install:

```
"readme": "https://raw.githubusercontent.com/haffff/NordvikManager-Extras/poll-0.1.0/poll/README.md"
```

It must be a `.md` file on `raw.githubusercontent.com`. Relative links and images in it are resolved against its folder. The short `description` stays the one-line summary in lists.

## Registry workflows

- **Validate registry** runs on every pull request and on pushes to `main`, using `scripts/validate-registry.mjs --fetch`. It checks `addons.json` against this checkout's schemas, plus:
  - unique keys;
  - known categories and dependencies;
  - release links that are real release assets (`…/releases/download/<tag>/<file>.zip`, never a zipball or `/archive/` link);
  - each release zip's `info.json` matching its entry;
  - each `readme` answering, at most 512 KB.
- **Sync addon releases** runs daily at 06:00 UTC, and on demand.
  - It reads the published releases of every addon repository in the registry, and keeps the newest version per addon key (read from the `info.json` inside each zip).
  - It opens or updates one pull request, `registry-sync`, that moves entries to their newest version and link. A `readme` pinned to the old release's tag moves to the new tag.
  - Releases of keys that aren't in the registry are listed in that PR. Add a new addon by hand.

## Scripts

```
npm ci
npm test                                         # script, schema and template (ApiMock) tests
node scripts/validate-registry.mjs [--fetch]     # check addons.json (and its releases)
node scripts/sync-releases.mjs --dry-run         # show which addons have newer releases (needs gh)
```
