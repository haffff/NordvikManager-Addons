// The daily sync: newest published release per addon key (read from the info.json in
// each release zip), written into addons.json as version + releaseUrl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, newestReleases, applyUpdates, describeChanges } from "./sync-releases.mjs";

test("versions compare as numbers", () => {
  assert.ok(compareVersions("0.0.10", "0.0.9") > 0);
  assert.ok(compareVersions("1.0.0", "0.9.9") > 0);
  assert.equal(compareVersions("0.0.2", "0.0.2"), 0);
  assert.ok(compareVersions("0.0.1", "0.1.0") < 0);
});

const asset = (name) => ({ name, browser_download_url: `https://github.com/o/r/releases/download/t/${name}` });

test("the newest published version of each key wins; drafts, pre-releases and non-zips are skipped", async () => {
  const releases = [
    { tag_name: "fifth-edition-0.0.2", draft: false, prerelease: false, assets: [asset("fifth-edition.zip")] },
    { tag_name: "0.0.1", draft: false, prerelease: false, assets: [asset("imperium-maledictum.zip"), asset("notes.txt")] },
    { tag_name: "fifth-edition-0.0.1", draft: false, prerelease: false, assets: [asset("fifth-edition.zip")] },
    { tag_name: "x-9.9.9", draft: true, prerelease: false, assets: [asset("draft.zip")] },
    { tag_name: "x-9.9.8", draft: false, prerelease: true, assets: [asset("pre.zip")] },
  ];
  const infos = {
    "fifth-edition-0.0.2/fifth-edition.zip": { key: "fiftheditiontheme", version: "0.0.2" },
    "fifth-edition-0.0.1/fifth-edition.zip": { key: "fiftheditiontheme", version: "0.0.1" },
    "0.0.1/imperium-maledictum.zip": { key: "imperiummaledictumtheme", version: "0.0.1" },
  };
  const read = [];
  const newest = await newestReleases(releases, async (release, a) => {
    read.push(a.name);
    return infos[`${release.tag_name}/${a.name}`] ?? null;
  });

  assert.deepEqual([...newest.keys()].sort(), ["fiftheditiontheme", "imperiummaledictumtheme"]);
  assert.equal(newest.get("fiftheditiontheme").version, "0.0.2");
  assert.match(newest.get("fiftheditiontheme").releaseUrl, /fifth-edition\.zip$/);
  assert.ok(!read.includes("draft.zip") && !read.includes("pre.zip") && !read.includes("notes.txt"));
});

test("only newer versions update an entry; other fields stay as the registry has them", () => {
  const registry = {
    repository: [
      { key: "a", name: "Registry Name", version: "0.0.1", releaseUrl: "old-a" },
      { key: "b", version: "0.0.3", releaseUrl: "old-b" },
      { key: "c", version: "0.0.1", releaseUrl: "old-c" },
    ],
  };
  const newest = new Map([
    ["a", { version: "0.0.2", releaseUrl: "new-a" }],
    ["b", { version: "0.0.2", releaseUrl: "older-b" }],
    ["z", { version: "1.0.0", releaseUrl: "new-z" }],
  ]);

  const { registry: updated, changes, unknown } = applyUpdates(registry, newest);
  assert.deepEqual(updated.repository[0], { key: "a", name: "Registry Name", version: "0.0.2", releaseUrl: "new-a" });
  assert.deepEqual(updated.repository[1], registry.repository[1]);
  assert.deepEqual(changes, [{ key: "a", from: "0.0.1", to: "0.0.2", releaseUrl: "new-a" }]);
  assert.deepEqual(unknown, [{ key: "z", version: "1.0.0", releaseUrl: "new-z" }]);
  assert.equal(registry.repository[0].version, "0.0.1", "the input is not changed");
});

test("the pull request body lists every change and the releases not in the registry", () => {
  const body = describeChanges(
    [{ key: "a", from: "0.0.1", to: "0.0.2", releaseUrl: "https://x/a.zip" }],
    [{ key: "z", version: "1.0.0", releaseUrl: "https://x/z.zip" }],
  );
  assert.match(body, /\| `a` \| 0\.0\.1 \| 0\.0\.2 \| \[a\.zip\]\(https:\/\/x\/a\.zip\) \|/);
  assert.match(body, /`z` 1\.0\.0/);
});

test("a readme pinned to the old release's tag moves to the new tag; other refs stay", () => {
  const registry = {
    repository: [
      { key: "poll", version: "0.1.0", releaseUrl: "https://github.com/h/Extras/releases/download/poll-0.1.0/poll.zip",
        readme: "https://raw.githubusercontent.com/h/Extras/poll-0.1.0/poll/README.md" },
      { key: "dnd5e", version: "0.0.7", releaseUrl: "https://github.com/h/5E/releases/download/0.0.7/nm_5e_0.0.7.zip",
        readme: "https://raw.githubusercontent.com/h/5E/main/README.md" },
    ],
  };
  const newest = new Map([
    ["poll", { version: "0.1.1", releaseUrl: "https://github.com/h/Extras/releases/download/poll-0.1.1/poll.zip" }],
    ["dnd5e", { version: "0.0.8", releaseUrl: "https://github.com/h/5E/releases/download/0.0.8/nm_5e_0.0.8.zip" }],
  ]);
  const { registry: updated } = applyUpdates(registry, newest);
  assert.equal(updated.repository[0].readme, "https://raw.githubusercontent.com/h/Extras/poll-0.1.1/poll/README.md");
  assert.equal(updated.repository[1].readme, "https://raw.githubusercontent.com/h/5E/main/README.md");
});

