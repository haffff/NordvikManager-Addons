// The mock stands in for window.CardAPI while you run the card with `pnpm dev`, so it
// has to behave like the real one where it matters: string values, change echoes,
// refused calls rejecting with the same messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiMock } from "./ApiMock.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const quiet = () => createApiMock({ log: false });

test("cardId and additionalArguments come from the options", () => {
  const api = createApiMock({ log: false, cardId: "card-1", additionalArguments: '{"mode":"edit"}' });
  assert.equal(api.cardId, "card-1");
  assert.equal(api.additionalArguments, '{"mode":"edit"}');
});

test("properties are stored as strings, like on the server", async () => {
  const api = quiet();
  await api.Properties.Set("hp", 12);
  const hp = await api.Properties.Get("hp");
  assert.equal(hp.value, "12");
  assert.equal(hp.name, "hp");
  assert.equal(hp.parentId, api.cardId);
  assert.ok(hp.id);
});

test("seeded properties are strings too", async () => {
  const api = createApiMock({ log: false, properties: { hp: 7, name: "Aria" } });
  assert.equal((await api.Properties.Get("hp")).value, "7");
  assert.deepEqual((await api.Properties.GetProperties()).map((p) => p.name).sort(), ["hp", "name"]);
});

test("Get returns null for a missing property; GetMany leaves it out", async () => {
  const api = createApiMock({ log: false, properties: { hp: "5" } });
  assert.equal(await api.Properties.Get("nope"), null);
  assert.deepEqual((await api.Properties.GetMany(["hp", "nope"])).map((p) => p.name), ["hp"]);
});

test("Init creates only when missing", async () => {
  const api = createApiMock({ log: false, properties: { hp: "5" } });
  await api.Properties.Init("hp", "10");
  await api.Properties.InitMany([{ name: "hp", value: "1" }, { name: "maxhp", value: "10" }]);
  assert.equal((await api.Properties.Get("hp")).value, "5");
  assert.equal((await api.Properties.Get("maxhp")).value, "10");
});

test("Set echoes to subscribers, after the call returns", async () => {
  const api = quiet();
  const seen = [];
  api.Properties.Subscribe("hp", (p) => seen.push(p?.value));
  await api.Properties.Set("hp", "3");
  await tick();
  assert.deepEqual(seen, ["3"]);
});

test("Set with the same value does nothing", async () => {
  const api = createApiMock({ log: false, properties: { hp: "3" } });
  const seen = [];
  api.Properties.Subscribe("hp", (p) => seen.push(p));
  await api.Properties.Set("hp", 3);
  await tick();
  assert.deepEqual(seen, []);
});

test("Remove notifies null; Unsubscribe stops callbacks", async () => {
  const api = createApiMock({ log: false, properties: { hp: "3" } });
  const seen = [];
  const cb = (p) => seen.push(p);
  api.Properties.Subscribe("hp", cb);
  await api.Properties.Remove("hp");
  await tick();
  api.Properties.Unsubscribe("hp", cb);
  await api.Properties.Set("hp", "4");
  await tick();
  assert.deepEqual(seen, [null]);
});

test("List rows live in the property's JSON value", async () => {
  const api = quiet();
  await assert.rejects(api.Properties.List.Add("weapons", { name: "Axe" }), /call Properties.Init\(name, "\[\]"\) first/);
  await api.Properties.Init("weapons", "[]");
  await api.Properties.List.Add("weapons", { name: "Axe" }, "w1");
  await api.Properties.List.Add("weapons", { name: "Bow" });
  let rows = JSON.parse((await api.Properties.Get("weapons")).value);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: "w1", fields: { name: "Axe" } });
  const bowId = rows[1].id;
  assert.ok(bowId);

  await api.Properties.List.Update("weapons", "w1", { name: "Great Axe" });
  await api.Properties.List.Reorder("weapons", [bowId, "w1"]);
  await api.Properties.List.Remove("weapons", bowId);
  rows = JSON.parse((await api.Properties.Get("weapons")).value);
  assert.deepEqual(rows, [{ id: "w1", fields: { name: "Great Axe" } }]);
});

test("Global properties are per parent and reach the card's own Subscribe", async () => {
  const api = createApiMock({ log: false, globals: { "game-1": { config: '{"a":1}' } } });
  assert.equal((await api.Properties.Global.Get("game-1", "config")).value, '{"a":1}');
  assert.equal(await api.Properties.Global.Get("game-2", "config"), null);

  const seen = [];
  api.Properties.Global.Subscribe("game-1", "config", (p) => seen.push(p?.value));
  await api.Properties.Global.Set("game-1", "config", '{"a":2}');
  await api.Properties.Global.Init("game-1", "config", "ignored");
  await tick();
  assert.deepEqual(seen, ['{"a":2}']);

  const own = [];
  api.Properties.Subscribe("hp", (p) => own.push(p?.value));
  await api.Properties.Global.Set(api.cardId, "hp", 9);
  await tick();
  assert.deepEqual(own, ["9"]);
});

test("Resources: create, read text, duplicate key, upsert, delete", async () => {
  const api = quiet();
  const id = await api.Resources.Create("notes", "hello");
  assert.ok(id);
  assert.equal(await api.Resources.Read("notes"), "hello");
  await assert.rejects(api.Resources.Create("notes", "again"), /already exists/);
  assert.equal(await api.Resources.Upsert("notes", "updated"), undefined);
  assert.equal(await api.Resources.Read("notes"), "updated");
  await api.Resources.Delete("notes");
  assert.equal(await api.Resources.Read("notes"), null);
});

test("Resources: non-text data reads back as a Blob; Global keys are separate", async () => {
  const api = quiet();
  await api.Resources.Create("img", new Uint8Array([1, 2, 3]), "img", "image/png");
  const blob = await api.Resources.Read("img");
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, "image/png");
  assert.equal(await api.Resources.Global.Read("img"), null);
  await api.Resources.Global.Create("shared.json", '{"x":1}', "shared", "application/json");
  assert.equal(await api.Resources.Global.Read("shared.json"), '{"x":1}');
});

test("ClientMediator answers the card commands from the options", async () => {
  const api = createApiMock({ log: false, gameId: "game-9", isGM: false });
  assert.equal(await api.ClientMediator.sendCommandAsync("Game", "GetGameId"), "game-9");
  assert.equal(await api.ClientMediator.sendCommandAsync("Game", "GetIsGM"), false);
  assert.ok(Array.isArray(await api.ClientMediator.sendCommandAsync("Game", "GetPlayers")));
  assert.ok(await api.ClientMediator.sendCommandAsync("Game", "GetCurrentPlayer"));
  assert.equal(await api.ClientMediator.sendCommand("TurnOrder", "GetState"), null);
});

test("ClientMediator refuses what the real API refuses, with the same messages", async () => {
  const api = quiet();
  await assert.rejects(api.ClientMediator.sendCommandAsync("Chat", "Clear"), /CardAPI: "Chat.Clear" is not available to cards/);
  await assert.rejects(api.ClientMediator.sendCommandAsync("Properties", "Get", {}), /use CardAPI.Properties instead/);
  await assert.rejects(api.ClientMediator.sendCommandAsync("resources", "Read", {}), /use CardAPI.Resources instead/);
});

test("Chat.SendMessage through the mediator is a chat message", async () => {
  const api = quiet();
  await api.ClientMediator.sendCommandAsync("Chat", "SendMessage", "hi");
  assert.deepEqual(api.sent, [{ command: "chat_push", data: "hi" }]);
});

test("register scopes the name to the card and routes calls to the handlers", async () => {
  const api = createApiMock({ log: false, cardId: "c1" });
  const name = await api.ClientMediator.register("addon_tracker", { Next: ({ by }) => by + 1 });
  assert.equal(name, "addon_c1_tracker");
  assert.equal(await api.ClientMediator.sendCommandAsync(name, "Next", { by: 1 }), 2);
  await assert.rejects(api.ClientMediator.sendCommandAsync(name, "Missing"), /has no command Missing/);
  assert.throws(() => api.ClientMediator.register("tracker", {}), /must start with "addon_"/);
  assert.equal(await api.ClientMediator.unregister("addon_tracker"), true);
  await assert.rejects(api.ClientMediator.sendCommandAsync(name, "Next", { by: 1 }), /no panel/);
});

test("FireAction sends execute_action with this card's id and runs a mock handler", async () => {
  const calls = [];
  const api = createApiMock({
    log: false,
    cardId: "c1",
    actions: { "myaddon/roll_check": (args) => calls.push(args) },
  });
  api.FireAction("myaddon/roll_check", { attribute: "str" });
  await tick();
  assert.deepEqual(api.sent, [{ command: "execute_action", data: { action: "myaddon/roll_check", args: { attribute: "str", cardId: "c1" } } }]);
  assert.deepEqual(calls, [{ attribute: "str", cardId: "c1" }]);
});

test("SendCustomCommandToServer allows only chat_push and execute_action", () => {
  const api = quiet();
  api.SendCustomCommandToServer("chat_push", "x");
  assert.throws(() => api.SendCustomCommandToServer("custom_panel_update", {}), /cards may not send "custom_panel_update" to the server/);
});

test("Rolls.Start rolls each formula; Finish needs a known rollId", async () => {
  const api = quiet();
  const { rollId, results } = await api.Rolls.Start([
    { key: "attack", formula: "1d20+5" },
    { key: "damage", formula: "2d6-1" },
  ]);
  assert.ok(rollId);
  const attack = results.find((r) => r.key === "attack").roll;
  assert.ok(attack.result >= 6 && attack.result <= 25);
  assert.equal(attack.dices.length, 1);
  assert.equal(attack.dices[0].diceValue, 20);
  assert.equal(results.find((r) => r.key === "damage").roll.dices.length, 2);

  await api.Rolls.Finish({ rollId, html: "<b data-roll-key=\"attack\"></b>", title: "Sword" });
  await assert.rejects(api.Rolls.Finish({ rollId: "nope", html: "" }), /Unknown or expired roll/);
  await assert.rejects(api.Rolls.Start([{ key: "x", formula: "fireball" }]), /Invalid roll formula/);
});

test("emit delivers events to SubscribeWebSocket callbacks", () => {
  const api = quiet();
  const seen = [];
  const cb = (m) => seen.push(m.command);
  api.SubscribeWebSocket(cb);
  api.emit("chat_message", { text: "hi" });
  api.UnsubscribeWebSocket(cb);
  api.emit("chat_message", { text: "again" });
  assert.deepEqual(seen, ["chat_message"]);
});

test("the mock has every member the real CardAPI has", () => {
  const api = quiet();
  const members = {
    "": ["Properties", "Resources", "ClientMediator", "SendChatMessage", "FireAction", "SendCustomCommandToServer", "Close", "Rolls", "SubscribeWebSocket", "UnsubscribeWebSocket"],
    Properties: ["Get", "GetMany", "GetProperties", "Set", "SetMany", "Init", "InitMany", "Remove", "Subscribe", "Unsubscribe", "List", "Global"],
    "Properties.List": ["Add", "Remove", "Update", "Reorder"],
    "Properties.Global": ["Get", "GetMany", "GetByNames", "GetProperties", "Set", "SetMany", "Init", "InitMany", "Remove", "Subscribe", "Unsubscribe"],
    Resources: ["Create", "Read", "Update", "Delete", "Upsert", "Global"],
    "Resources.Global": ["Create", "Read", "Update", "Delete", "Upsert"],
    ClientMediator: ["sendCommand", "sendCommandAsync", "register", "unregister"],
    Rolls: ["Start", "Finish"],
  };
  for (const [path, names] of Object.entries(members)) {
    const target = path ? path.split(".").reduce((o, k) => o[k], api) : api;
    for (const name of names) assert.ok(name in target, `${path || "CardAPI"}.${name}`);
  }
});
