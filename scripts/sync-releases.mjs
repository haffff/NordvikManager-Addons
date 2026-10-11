// Pulls new addon versions into addons.json:
//   node scripts/sync-releases.mjs [--dry-run] [--summary <file>]
// For every repository in the registry, reads the published releases (no drafts, no
// pre-releases), opens each .zip asset's info.json and keeps the newest version per addon
// key. An entry whose release is newer gets that version and the asset's link; every
// other field stays as the registry has it. Releases of keys the registry doesn't have
// are only reported: a new addon is added by hand.
// --summary writes the pull request body (markdown); the workflow opens or updates the PR.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAddonInfo } from "./zip.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryFile = path.join(root, "addons.json");

/** Semantic versions compared part by part (x.y.z). */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * The newest release per addon key among `releases` (GitHub release objects).
 * `readInfo(release, asset)` returns the asset's info.json, or null.
 */
export async function newestReleases(releases, readInfo) {
  const newest = new Map();
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    for (const asset of release.assets ?? []) {
      if (!asset.name.toLowerCase().endsWith(".zip")) continue;
      const info = await readInfo(release, asset);
      if (!info?.key || !info?.version) continue;
      const current = newest.get(info.key);
      if (!current || compareVersions(info.version, current.version) > 0) {
        newest.set(info.key, { version: info.version, releaseUrl: asset.browser_download_url });
      }
    }
  }
  return newest;
}

/** A copy of the registry with newer releases applied, the changes, and unknown keys. */
export function applyUpdates(registry, newest) {
  const updated = structuredClone(registry);
  const changes = [];
  const known = new Set();
  for (const entry of updated.repository) {
    known.add(entry.key);
    const release = newest.get(entry.key);
    if (!release || compareVersions(release.version, entry.version) <= 0) continue;
    changes.push({ key: entry.key, from: entry.version, to: release.version, releaseUrl: release.releaseUrl });
    entry.version = release.version;
    entry.releaseUrl = release.releaseUrl;
  }
  const unknown = [...newest].filter(([key]) => !known.has(key)).map(([key, release]) => ({ key, ...release }));
  return { registry: updated, changes, unknown };
}

/** The pull request body. */
export function describeChanges(changes, unknown) {
  const lines = ["New addon releases found by the daily registry sync.", ""];
  if (changes.length) {
    lines.push("| Addon | From | To | Release |", "|---|---|---|---|");
    for (const c of changes) lines.push(`| \`${c.key}\` | ${c.from} | ${c.to} | [${c.releaseUrl.split("/").pop()}](${c.releaseUrl}) |`);
  }
  if (unknown.length) {
    lines.push("", "Released but not in the registry (add them by hand if they should be listed):");
    for (const u of unknown) lines.push(`- \`${u.key}\` ${u.version}: ${u.releaseUrl}`);
  }
  lines.push("", "Checked by `scripts/validate-registry.mjs --fetch` before this PR was opened.");
  return lines.join("\n") + "\n";
}

const repoOf = (url) => url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)?.slice(1, 3).join("/");

async function downloadInfo(release, asset) {
  const response = await fetch(asset.browser_download_url, { redirect: "follow" });
  if (!response.ok) {
    console.warn(`skipped ${asset.browser_download_url}: ${response.status}`);
    return null;
  }
  try {
    return readAddonInfo(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.warn(`skipped ${asset.browser_download_url}: ${error.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const summaryAt = args.indexOf("--summary");
  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8").replace(/^﻿/, ""));

  const newest = new Map();
  const repos = [...new Set(registry.repository.map((e) => repoOf(e.repositoryUrl)).filter(Boolean))];
  for (const repo of repos) {
    const releases = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/releases?per_page=100`], { encoding: "utf8" }));
    for (const [key, release] of await newestReleases(releases, downloadInfo)) {
      const current = newest.get(key);
      if (!current || compareVersions(release.version, current.version) > 0) newest.set(key, release);
    }
    console.log(`${repo}: ${releases.length} release(s) read`);
  }

  const { registry: updated, changes, unknown } = applyUpdates(registry, newest);
  for (const c of changes) console.log(`${c.key}: ${c.from} -> ${c.to} (${c.releaseUrl})`);
  for (const u of unknown) console.log(`${u.key} ${u.version} is released but not in the registry`);
  if (!changes.length) console.log("Every addon is up to date.");

  if (!dryRun && changes.length) fs.writeFileSync(registryFile, JSON.stringify(updated, null, 4) + "\n");
  if (summaryAt >= 0) fs.writeFileSync(args[summaryAt + 1], describeChanges(changes, unknown));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
