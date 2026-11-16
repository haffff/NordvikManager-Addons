import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNetwork } from "./check-network.mjs";

// An addon folder (what the zip holds: info.json, Actions/, Resources/, ...).
function addon({ network, actions = {}, resources = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nm-net-"));
  const info = { key: "myaddon", name: "My Addon", version: "0.0.1" };
  if (network !== undefined) info.network = network;
  writeFileSync(join(dir, "info.json"), JSON.stringify(info));
  mkdirSync(join(dir, "Actions"));
  mkdirSync(join(dir, "Resources"));
  for (const [name, content] of Object.entries(actions))
    writeFileSync(join(dir, "Actions", name), JSON.stringify({ name, hook: 0, content }));
  for (const [name, text] of Object.entries(resources)) writeFileSync(join(dir, "Resources", name), text);
  return dir;
}

const request = (TargetUrl, Type = "SendRequest") => ({ Type, Data: { TargetUrl, Output: "out" } });

test("an addon has to say where it connects", () => {
  assert.match(checkNetwork(addon()).errors.join("\n"), /no "network"/);
  assert.deepEqual(checkNetwork(addon({ network: {} })).errors, []);
});

test("an action's literal address has to be one of the declared hosts", () => {
  const actions = { "a.json": [request("https://api.example.com/v1/roll?x=1"), request("https://other.example.com/x", "DownloadResource")] };

  const { errors } = checkNetwork(addon({ network: { hosts: ["https://api.example.com"] }, actions }));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /a\.json.*DownloadResource.*https:\/\/other\.example\.com.*not in network\.hosts/);
});

test("steps nested in other steps and content given as a JSON string are checked too", () => {
  const nested = [{ Type: "If", Data: { Then: [request("https://deep.example.com/x")] } }];
  const actions = { "n.json": JSON.stringify(nested) };

  assert.match(checkNetwork(addon({ network: {}, actions })).errors.join("\n"), /deep\.example\.com/);
});

test("an address made from values needs userHosts", () => {
  const actions = { "t.json": [request("%baseUrl%/etapi/notes"), request("https://%host%/x")] };

  assert.equal(checkNetwork(addon({ network: {}, actions })).errors.length, 2);
  assert.match(checkNetwork(addon({ network: {}, actions })).errors[0], /made from values.*userHosts/);
  assert.deepEqual(checkNetwork(addon({ network: { userHosts: "Your Trilium server" }, actions })).errors, []);
});

test("a literal host followed by values is that host", () => {
  const actions = { "p.json": [request("https://api.example.com/%path%")] };

  assert.deepEqual(checkNetwork(addon({ network: { hosts: ["https://api.example.com"] }, actions })).errors, []);
  assert.equal(checkNetwork(addon({ network: {}, actions })).errors.length, 1);
});

test("card code: undeclared literal origins and outside-connection APIs are warnings, not errors", () => {
  const resources = {
    "index.html": '<svg xmlns="http://www.w3.org/2000/svg"></svg><iframe src="x"></iframe><script src="https://cdn.example.com/lib.js"></script>',
    "app.js": "const pc = new RTCPeerConnection(); fetch('https://api.example.com/x'); new WebSocket('wss://live.example.com');",
  };

  const { errors, warnings } = checkNetwork(addon({ network: { hosts: ["https://api.example.com"] }, resources }));

  assert.deepEqual(errors, []);
  const text = warnings.join("\n");
  assert.match(text, /index\.html.*https:\/\/cdn\.example\.com/);
  assert.match(text, /app\.js.*wss:\/\/live\.example\.com/);
  assert.doesNotMatch(text, /api\.example\.com/); // declared
  assert.doesNotMatch(text, /w3\.org/); // an XML namespace, not a connection
  assert.match(text, /RTCPeerConnection/);
  assert.match(text, /iframe/);
});

test("$schema addresses in JSON files are not connections", () => {
  const dir = addon({ network: {}, actions: { "s.json": [] } });

  assert.deepEqual(checkNetwork(dir), { errors: [], warnings: [] });
});

test("the starter template passes", async () => {
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(new URL("../template/addon_files", import.meta.url));

  assert.deepEqual(checkNetwork(dir).errors, []);
});
