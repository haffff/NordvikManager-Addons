// The schemas addon authors point their JSON files at ($schema), so editors and AI
// assistants can check templates, views and actions before an install fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), "utf8").replace(/^﻿/, ""));

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCard = ajv.compile(readJson("schemas", "card.json"));
const validateAction = ajv.compile(readJson("schemas", "action.json"));
const validateInfo = ajv.compile(readJson("schemas", "addon.json"));

const errors = (validate, data) => (validate(data) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`));

const card = (over = {}) => ({
  $schema: "https://raw.githubusercontent.com/haffff/NordvikManager-Addons/refs/heads/main/schemas/card.json",
  name: "Character",
  description: "A character sheet",
  key: "myaddon_character",
  mainResource: "myaddon_index.html",
  additionalResources: ["myaddon_sheet.js", "myaddon_sheet.css"],
  hidden: false,
  genericPermission: 1,
  gmPermission: 31,
  properties: [
    { name: "hp", value: "10" },
    { name: "secret", value: "", isProtected: true },
  ],
  ...over,
});

const action = (over = {}) => ({
  $schema: "https://raw.githubusercontent.com/haffff/NordvikManager-Addons/refs/heads/main/schemas/action.json",
  name: "roll_check",
  prefix: "myaddon",
  hook: 0,
  isEnabled: true,
  gmPermission: 31,
  content: [
    { id: "s1", Type: "RollDice", Data: { DiceString: "1d20", PrintToChat: true } },
  ],
  ...over,
});

test("card schema accepts a full template", () => {
  assert.deepEqual(errors(validateCard, card()), []);
});

test("card schema accepts a minimal view", () => {
  assert.deepEqual(errors(validateCard, { name: "Tracker", mainResource: "myaddon_tracker.html" }), []);
});

// Card keys are unique in a game, whichever addon brought them, and cards find their template
// again by its key after an update: "<addon key>_<name>", never changed.
test("card schema: a key starts with the addon key and an underscore", () => {
  assert.notDeepEqual(errors(validateCard, card({ key: "character" })), []);
  assert.notDeepEqual(errors(validateCard, card({ key: "myaddon_" })), []);
  assert.notDeepEqual(errors(validateCard, card({ key: "My-Addon_character" })), []);
  assert.deepEqual(errors(validateCard, card({ key: "dnd5e_card_settings" })), []);
});

test("card schema requires a name", () => {
  const { name, ...noName } = card();
  assert.notDeepEqual(errors(validateCard, noName), []);
});

test("card schema catches unknown fields, such as a top-level token", () => {
  assert.notDeepEqual(errors(validateCard, card({ token: "myaddon_token.json" })), []);
  assert.notDeepEqual(errors(validateCard, card({ mainresource: "x" })), []);
});

test("card schema requires property values to be strings", () => {
  assert.notDeepEqual(errors(validateCard, card({ properties: [{ name: "hp", value: 10 }] })), []);
});

test("card schema rejects permissions outside the flags", () => {
  assert.notDeepEqual(errors(validateCard, card({ genericPermission: 32 })), []);
  assert.notDeepEqual(errors(validateCard, card({ genericPermission: "Read" })), []);
});

test("addon schema accepts a plain info.json: no releaseUrl or dependencies needed", () => {
  const info = { $schema: "x", key: "myaddon", name: "My Addon", version: "0.0.1", description: "", author: "me", license: "MIT", repositoryUrl: "https://github.com/me/my-addon" };
  assert.deepEqual(errors(validateInfo, info), []);
  assert.deepEqual(errors(validateInfo, { key: "myaddon", name: "My Addon", version: "0.0.1" }), []);
  assert.notDeepEqual(errors(validateInfo, { name: "My Addon", version: "0.0.1" }), []);
  assert.notDeepEqual(errors(validateInfo, { key: "My-Addon", name: "My Addon", version: "0.0.1" }), []);
});

test("addon names may use common punctuation, but not markup", () => {
  for (const name of ["Fifth Edition (SRD)", "Dungeon World: Basic", "Gm's Tools & Tables, v2.0"]) {
    assert.deepEqual(errors(validateInfo, { key: "myaddon", name, version: "0.0.1" }), [], name);
  }
  for (const name of ["<b>Bold</b>", "Name\nwith newline", ""]) {
    assert.notDeepEqual(errors(validateInfo, { key: "myaddon", name, version: "0.0.1" }), [], name);
  }
});

test("action schema accepts an action with steps", () => {
  assert.deepEqual(errors(validateAction, action()), []);
});

test("action schema accepts content as a JSON string", () => {
  assert.deepEqual(errors(validateAction, action({ content: "[]" })), []);
});

test("action schema requires name, hook and content", () => {
  for (const field of ["name", "hook", "content"]) {
    const { [field]: _, ...missing } = action();
    assert.notDeepEqual(errors(validateAction, missing), [], field);
  }
});

test("action schema catches unknown hooks, step fields and top-level fields", () => {
  assert.notDeepEqual(errors(validateAction, action({ hook: 99 })), []);
  assert.notDeepEqual(errors(validateAction, action({ content: [{ Type: "Log" }] })), []);
  assert.notDeepEqual(errors(validateAction, action({ content: [{ type: "Log", data: {} }] })), []);
  assert.notDeepEqual(errors(validateAction, action({ trigger: 1 })), []);
});

test("action schema: a Chat Command action names its commands in hookFilter", () => {
  assert.deepEqual(errors(validateAction, action({ hook: 19, hookFilter: "poll, vote" })), []);
  assert.deepEqual(errors(validateAction, action({ hook: 19, hookFilter: "/Poll vote" })), []);
  assert.notDeepEqual(errors(validateAction, action({ hook: 19 })), [], "required for Chat Command");
  assert.notDeepEqual(errors(validateAction, action({ hook: 19, hookFilter: " " })), [], "not empty");
  assert.notDeepEqual(errors(validateAction, action({ hook: 19, hookFilter: "cast!" })), [], "names only");
});

test("action schema: other hooks take no hookFilter yet", () => {
  assert.deepEqual(errors(validateAction, action({ hook: 11, hookFilter: "" })), []);
  assert.notDeepEqual(errors(validateAction, action({ hook: 11, hookFilter: "hp" })), []);
  assert.notDeepEqual(errors(validateAction, action({ hookFilter: "poll" })), []);
});

const templateDir = path.join(root, "template", "addon_files");
const jsonFiles = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f)) : [];

test("the starter template's files validate", () => {
  const info = path.join(templateDir, "info.json");
  assert.ok(fs.existsSync(info), "template/addon_files/info.json exists");
  assert.deepEqual(errors(validateInfo, readJson("template", "addon_files", "info.json")), []);

  const checks = [
    ["Templates", validateCard],
    ["Views", validateCard],
    ["Actions", validateAction],
  ];
  let count = 0;
  for (const [folder, validate] of checks) {
    for (const file of jsonFiles(path.join(templateDir, folder))) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.deepEqual(errors(validate, data), [], path.relative(root, file));
      assert.match(data.$schema ?? "", /schemas\/(card|action)\.json$/, `${path.relative(root, file)} has $schema`);
      count++;
    }
  }
  assert.ok(count >= 2, "the template has at least a template and an action");
});

const validateToken = ajv.compile(readJson("schemas", "token.json"));

const token = (over = {}) => ({
  $schema: "https://raw.githubusercontent.com/haffff/NordvikManager-Addons/refs/heads/main/schemas/token.json",
  name: "token",
  prefix: "token",
  size: 1,
  object: { type: "image" },
  editableProps: [
    { name: "hp", dtoProperty: "hp", label: "HP", source: "card", group: "hp" },
    { name: "maxhp", dtoProperty: "maxhp", label: "Max", source: "card", group: "hp" },
    { name: "show_bars", dtoProperty: "show_bars", label: "Show bars", source: "element", type: "boolean", default: true },
    { name: "portrait", dtoProperty: "tokenImage", label: "Image", source: "card", type: "image" },
  ],
  assignableIcons: [
    { id: "poisoned", label: "Poisoned", iconPack: "gi", iconName: "GiPoisonBottle", dtoProperty: "status_poisoned", source: "card" },
  ],
  additions: [
    {
      name: "status_poisoned",
      type: "reactIcon",
      iconPack: "gi",
      iconName: "GiPoisonBottle",
      tokenData: {
        anchor: "right-top",
        maskGroup: "conditions",
        label: "Conditions",
        propDeps: [{ dtoProperty: "status_poisoned", objectProperty: "visible", type: "bool", source: "card" }],
      },
    },
  ],
  ...over,
});

test("token schema accepts quick-edit fields, assignable icons and mask groups", () => {
  assert.deepEqual(errors(validateToken, token()), []);
});

test("token schema: an assignable icon needs id, icon and the property it toggles", () => {
  for (const field of ["id", "iconPack", "iconName", "dtoProperty", "source"]) {
    const { [field]: _, ...icon } = token().assignableIcons[0];
    assert.notDeepEqual(errors(validateToken, token({ assignableIcons: [icon] })), [], field);
  }
});

test("token schema: a quick-edit field needs a name, property and source of a known kind", () => {
  for (const field of ["name", "dtoProperty", "source"]) {
    const { [field]: _, ...prop } = token().editableProps[0];
    assert.notDeepEqual(errors(validateToken, token({ editableProps: [prop] })), [], field);
  }
  const bad = (over) => token({ editableProps: [{ ...token().editableProps[0], ...over }] });
  assert.notDeepEqual(errors(validateToken, bad({ type: "slider" })), [], "type");
  assert.notDeepEqual(errors(validateToken, bad({ source: "map" })), [], "the overlays read only token and card properties");
});

test("token schema: a mask group is a name that fits in a property name (mask_<group>_enabled)", () => {
  const part = (tokenData) => token({ additions: [{ name: "bar", type: "rect", tokenData }] });
  assert.deepEqual(errors(validateToken, part({ maskGroup: "hp", label: "HP Bar" })), []);
  assert.deepEqual(errors(validateToken, part({ maskGroup: "hp_bar-2" })), [], "label optional");
  assert.notDeepEqual(errors(validateToken, part({ maskGroup: "", label: "HP" })), [], "empty");
  assert.notDeepEqual(errors(validateToken, part({ maskGroup: "hp bar", label: "HP" })), [], "space");
  assert.notDeepEqual(errors(validateToken, part({ maskGroup: 3, label: "HP" })), [], "not a string");
});

test("token schema: the token's own settings live in the root tokenData", () => {
  const deps = [{ dtoProperty: "faded", objectProperty: "opacity", type: "number", source: "element" }];
  assert.deepEqual(errors(validateToken, token({ tokenData: { propDeps: deps, maxStatusIcons: 4 } })), []);
  assert.notDeepEqual(errors(validateToken, token({ tokenData: { maxStatusIcons: 0 } })), [], "at least one");
  assert.notDeepEqual(errors(validateToken, token({ tokenData: { propDeps: [{ dtoProperty: "x" }] } })), [], "a dep needs its fields");
});

test("token schema: clipShape is gone (it never cropped anything; a round picture does)", () => {
  assert.notDeepEqual(errors(validateToken, token({ object: { type: "image", clipShape: "circle" } })), []);
});

test("token schema: a part can fit the token (a ring around it)", () => {
  const ring = (fitToToken) => token({ additions: [{ name: "ring", type: "circle", tokenData: { anchor: "center", fitToToken } }] });
  assert.deepEqual(errors(validateToken, ring(true)), []);
  assert.notDeepEqual(errors(validateToken, ring("yes")), []);
});
