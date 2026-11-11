// Checks addons.json before it reaches any backend:
//   node scripts/validate-registry.mjs           schemas + registry rules
//   node scripts/validate-registry.mjs --fetch   also downloads every release and checks
//                                                its info.json key and version, and each readme
// The schemas are read from this checkout (not their raw.githubusercontent URLs), so a
// pull request that changes a schema is checked against its own version.
import Ajv from "ajv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAddonInfo } from "./zip.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const ADDON_SCHEMA_URL = "https://raw.githubusercontent.com/haffff/NordvikManager-Addons/refs/heads/main/schemas/addon.json";

// A release asset (…/releases/download/<tag>/<file>.zip), never a zipball or /archive/ link:
// those hold the source tree, not the packed addon.
const RELEASE_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.zip$/;
const REPOSITORY_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+?(\.git)?\/?$/;

// Addons that ship with every NordvikManager server, so they may be depended on without a
// registry entry (the server installs its own copy).
export const BUILT_IN_KEYS = ["basics"];

/** Each circle of dependencies once, as its keys in order, e.g. ["a", "b", "a"]. */
export function dependencyCircles(addons) {
  const byKey = new Map(addons.map((a) => [a.key, a]));
  const circles = [];
  const seen = new Set();
  const done = new Set();
  const walk = (key, chain) => {
    if (chain.includes(key)) {
      const circle = [...chain.slice(chain.indexOf(key)), key];
      const id = [...new Set(circle)].sort().join(",");
      if (!seen.has(id)) {
        seen.add(id);
        circles.push(circle);
      }
      return;
    }
    if (done.has(key)) return;
    for (const dependency of byKey.get(key)?.dependencies ?? []) walk(dependency.key, [...chain, key]);
    done.add(key);
  };
  for (const addon of addons) walk(addon.key, []);
  return circles;
}

export function loadSchemas(dir = path.join(root, "schemas")) {
  return {
    repository: readJson(path.join(dir, "repositorySchema.json")),
    addon: readJson(path.join(dir, "addon.json")),
    token: readJson(path.join(dir, "token.json")),
  };
}

/** Every problem in a registry, as readable lines (empty when it is valid). */
export function validateRegistry(registry, schemas) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(schemas.addon, ADDON_SCHEMA_URL);
  ajv.compile(schemas.token); // a broken token schema fails here
  const validate = ajv.compile(schemas.repository);

  const addons = Array.isArray(registry.repository) ? registry.repository : [];
  const label = (index) => `[${addons[index]?.key ?? `#${index}`}]`;
  const errors = [];

  if (!validate(registry)) {
    for (const error of validate.errors) {
      const match = error.instancePath.match(/^\/repository\/(\d+)(.*)$/);
      errors.push(match
        ? `${label(Number(match[1]))} ${match[2] || "/"} ${error.message}`
        : `${error.instancePath || "/"} ${error.message}`);
    }
  }

  const categories = new Set((registry.categories ?? []).map((c) => c.key));
  const keys = addons.map((a) => a.key);
  const seen = new Set();
  addons.forEach((addon, index) => {
    const at = label(index);
    if (seen.has(addon.key)) errors.push(`${at} duplicate key "${addon.key}"`);
    seen.add(addon.key);
    for (const category of addon.categories ?? []) {
      if (!categories.has(category)) errors.push(`${at} unknown category "${category}"`);
    }
    for (const dependency of addon.dependencies ?? []) {
      if (!keys.includes(dependency.key) && !BUILT_IN_KEYS.includes(dependency.key)) {
        errors.push(`${at} depends on "${dependency.key}", which is not in the registry`);
      }
    }
    if (typeof addon.releaseUrl === "string" && !RELEASE_URL.test(addon.releaseUrl)) {
      errors.push(`${at} releaseUrl must be a GitHub release asset (…/releases/download/<tag>/<file>.zip): ${addon.releaseUrl}`);
    }
    if (typeof addon.repositoryUrl === "string" && !REPOSITORY_URL.test(addon.repositoryUrl)) {
      errors.push(`${at} repositoryUrl must be a GitHub repository: ${addon.repositoryUrl}`);
    }
  });
  for (const circle of dependencyCircles(addons)) {
    errors.push(`[${circle[0]}] dependencies form a circle, which can't be installed: ${circle.join(" → ")}`);
  }
  return errors;
}

export const MAX_README_BYTES = 512 * 1024;

const RETRY_DELAYS_MS = [2000, 5000];
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTransient = (status) => status === 429 || status >= 500;

/**
 * fetch, asked again (up to 3 attempts) after a 5xx, a 429 or a network error: GitHub's
 * download servers sometimes answer 504 for a release that is there. Other answers,
 * such as a 404, come back at once. After the last attempt its answer or error counts.
 */
export async function fetchWithRetry(url, { fetchImpl = fetch, sleep = sleepMs } = {}) {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_DELAYS_MS.length;
    try {
      const response = await fetchImpl(url, { redirect: "follow" });
      if (last || !isTransient(response.status)) return response;
    } catch (error) {
      if (last) throw error;
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

/** Problems with a downloaded readme ({ status, size } of the response). */
export function checkReadme(entry, { status, size }) {
  const at = `[${entry.key}]`;
  if (status !== 200) return [`${at} readme answers ${status}: ${entry.readme}`];
  if (size > MAX_README_BYTES) return [`${at} readme is over 512 KB (${Math.round(size / 1024)} KB)`];
  return [];
}

async function fetchReadmeErrors(entry) {
  try {
    const response = await fetchWithRetry(entry.readme);
    const size = response.ok ? (await response.arrayBuffer()).byteLength : 0;
    return checkReadme(entry, { status: response.status, size });
  } catch (error) {
    return [`[${entry.key}] could not read the readme: ${error.message}`];
  }
}

/** Problems between a registry entry and the info.json inside its release zip. */
export function checkReleaseInfo(entry, info) {
  const at = `[${entry.key}]`;
  if (!info) return [`${at} the release zip has no info.json at its root`];
  const errors = [];
  if (info.key !== entry.key) errors.push(`${at} the release holds key "${info.key}"`);
  if (info.version !== entry.version) errors.push(`${at} the release holds version ${info.version}, the registry says ${entry.version}`);
  const listed = (dependencies) => (dependencies ?? []).map((d) => (d.version ? `${d.key} ${d.version}` : d.key)).sort();
  const inRelease = listed(info.dependencies);
  const inRegistry = listed(entry.dependencies);
  if (inRelease.join(",") !== inRegistry.join(",")) {
    errors.push(`${at} the release's dependencies are [${inRelease.join(", ")}], the registry says [${inRegistry.join(", ")}]`);
  }
  return errors;
}

async function fetchReleaseErrors(entry) {
  try {
    const response = await fetchWithRetry(entry.releaseUrl);
    if (!response.ok) return [`[${entry.key}] releaseUrl answers ${response.status}`];
    return checkReleaseInfo(entry, readAddonInfo(Buffer.from(await response.arrayBuffer())));
  } catch (error) {
    return [`[${entry.key}] could not read the release: ${error.message}`];
  }
}

async function main() {
  const registry = readJson(path.join(root, "addons.json"));
  const errors = validateRegistry(registry, loadSchemas());
  if (process.argv.includes("--fetch") && errors.length === 0) {
    for (const entry of registry.repository) {
      errors.push(...(await fetchReleaseErrors(entry)));
      if (entry.readme) errors.push(...(await fetchReadmeErrors(entry)));
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(`::error file=addons.json::${error}`);
    console.error(`${errors.length} problem(s) in addons.json`);
    process.exit(1);
  }
  console.log(`addons.json is valid (${registry.repository.length} addons)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
