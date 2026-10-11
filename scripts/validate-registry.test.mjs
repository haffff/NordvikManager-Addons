// The registry check run on every pull request: addons.json against the local schemas,
// plus what a schema can't say (unique keys, known categories and dependencies, release
// links that are real release assets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSchemas, validateRegistry, checkReleaseInfo } from "./validate-registry.mjs";

const schemas = loadSchemas();

const addon = (over = {}) => ({
  name: "Some Addon",
  key: "someaddon",
  dependencies: [],
  categories: ["theme"],
  description: "",
  version: "0.0.1",
  author: "haffff",
  repositoryUrl: "https://github.com/haffff/Some-Addon",
  releaseUrl: "https://github.com/haffff/Some-Addon/releases/download/0.0.1/some.zip",
  license: "MIT",
  ...over,
});

const registry = (...repository) => ({
  name: "Test",
  description: "",
  categories: [{ key: "theme", name: "Themes" }],
  repository,
});

const messages = (reg) => validateRegistry(reg, schemas);

test("the registry in this repo is valid", async () => {
  const fs = await import("node:fs");
  const reg = JSON.parse(fs.readFileSync(new URL("../addons.json", import.meta.url), "utf8"));
  assert.deepEqual(messages(reg), []);
});

test("a valid registry has no errors", () => {
  assert.deepEqual(messages(registry(addon(), addon({ key: "other" }))), []);
});

test("schema violations are reported with the addon's key", () => {
  const errors = messages(registry(addon({ name: "Fifth Edition (SRD)" })));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /someaddon/);
  assert.match(errors[0], /name/);
});

test("a key may appear only once", () => {
  assert.match(messages(registry(addon(), addon())).join("\n"), /duplicate key "someaddon"/);
});

test("categories must be listed in the registry's categories", () => {
  assert.match(messages(registry(addon({ categories: ["game-system"] }))).join("\n"), /unknown category "game-system"/);
});

test("dependencies must be addons in the registry", () => {
  const errors = messages(registry(addon({ dependencies: [{ key: "missing" }] })));
  assert.match(errors.join("\n"), /depends on "missing"/);
  assert.deepEqual(messages(registry(addon({ dependencies: [{ key: "other" }] }), addon({ key: "other" }))), []);
});

test("the release link must be a release asset, never a source archive", () => {
  for (const releaseUrl of [
    "https://api.github.com/repos/haffff/Some-Addon/zipball/0.0.1",
    "https://github.com/haffff/Some-Addon/archive/refs/tags/0.0.1.zip",
    "https://github.com/haffff/Some-Addon/releases/download/0.0.1/some.tar.gz",
    "https://example.com/some.zip",
  ]) {
    assert.match(messages(registry(addon({ releaseUrl }))).join("\n"), /releaseUrl/, releaseUrl);
  }
});

test("the repository link must be a GitHub repository", () => {
  assert.match(messages(registry(addon({ repositoryUrl: "https://example.com/x" }))).join("\n"), /repositoryUrl/);
});

test("a downloaded release must hold the entry's key and version", () => {
  const entry = addon();
  assert.deepEqual(checkReleaseInfo(entry, { key: "someaddon", version: "0.0.1" }), []);
  assert.match(checkReleaseInfo(entry, { key: "someaddon", version: "0.0.2" }).join(), /version 0\.0\.2/);
  assert.match(checkReleaseInfo(entry, { key: "other", version: "0.0.1" }).join(), /key "other"/);
  assert.match(checkReleaseInfo(entry, null).join(), /no info\.json/);
});
