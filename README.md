# NordvikManager addon registry

`addons.json` lists the addons a NordvikManager backend can install. Each entry points at an addon's GitHub repository and at the release zip that gets installed. `schemas/` holds the JSON schemas for the registry, for an addon's `info.json` and for tokens.

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

## Registry workflows

- **Validate registry** runs on every pull request and on pushes to `main`, using `scripts/validate-registry.mjs --fetch`. It checks `addons.json` against this checkout's schemas, plus:
  - unique keys;
  - known categories and dependencies;
  - release links that are real release assets (`…/releases/download/<tag>/<file>.zip`, never a zipball or `/archive/` link);
  - each release zip's `info.json` matching its entry.
- **Sync addon releases** runs daily at 06:00 UTC, and on demand.
  - It reads the published releases of every addon repository in the registry, and keeps the newest version per addon key (read from the `info.json` inside each zip).
  - It opens or updates one pull request, `registry-sync`, that moves entries to their newest version and link.
  - Releases of keys that aren't in the registry are listed in that PR. Add a new addon by hand.

## Scripts

```
npm ci
npm test                                         # script tests
node scripts/validate-registry.mjs [--fetch]     # check addons.json (and its releases)
node scripts/sync-releases.mjs --dry-run         # show which addons have newer releases (needs gh)
```
