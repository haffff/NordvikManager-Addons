// A stand-in for window.CardAPI, for running the card outside the app (`pnpm dev`).
// Same methods and the same rules as the real API: values are strings, your own Set
// comes back through Subscribe, and calls the app refuses reject with its messages.
// Everything lives in memory and is gone on reload.
//
// Keep it in step with the API your card uses: https://nordvikmanager.pl/addon-guide/cards/card-api
//
//   const Api = createApiMock({
//     properties: { hp: "10" },                 // this card's properties
//     globals: { "mock-game": { config: "{}" } }, // other entities' properties, by parentId
//     isGM: true,                               // what Game.GetIsGM answers
//     actions: { "myaddon/roll_check": (args, api) => api.SendChatMessage("rolled") },
//   });
//   Api.emit("chat_message", { ... });          // pretend a game event arrived
//   Api.sent;                                   // what the card sent to the server

const CARD_COMMANDS = ["Game.GetPlayers", "Game.GetCurrentPlayer", "Game.GetGameId", "Game.GetIsGM", "BattleMap.GetSelectedMap", "TurnOrder.GetState", "Chat.SendMessage"];
const API_GROUPS = { properties: "Properties", resources: "Resources", rolls: "Rolls" };
const ALLOWED_WS_COMMANDS = ["chat_push", "execute_action"];
const RESERVED_COMMANDS = ["id", "panel", "contextId", "onEvent"];

const asString = (value) => (value == null ? "" : String(value));
const isText = (mimeType) => /^text\//.test(mimeType) || mimeType === "application/json";

export function createApiMock(options = {}) {
  const {
    cardId = "mock-card",
    additionalArguments = null,
    gameId = "mock-game",
    isGM = true,
    players = [{ id: "mock-player", name: "Game Master", color: "#c0392b" }],
    selectedMap = null,
    turnOrder = null,
    actions = {},
    log = true,
  } = options;

  let nextId = 1;
  const newId = (kind) => `mock-${kind}-${nextId++}`;
  const say = (...args) => { if (log) console.log("[ApiMock]", ...args); };

  // parentId → Map(name → property). This card's own properties are parent cardId.
  const store = new Map();
  const parentStore = (parentId) => {
    if (!store.has(parentId)) store.set(parentId, new Map());
    return store.get(parentId);
  };
  const seed = (parentId, values) => {
    for (const [name, value] of Object.entries(values ?? {})) {
      parentStore(parentId).set(name, { id: newId("prop"), name, value: asString(value), parentId });
    }
  };
  seed(cardId, options.properties);
  for (const [parentId, values] of Object.entries(options.globals ?? {})) seed(parentId, values);

  // Subscriptions, keyed "parentId|name". Changes are delivered after the call returns,
  // like the server's broadcast.
  const subs = new Map();
  const subKey = (parentId, name) => `${parentId}|${name}`;
  const subscribe = (parentId, name, cb) => {
    const key = subKey(parentId, name);
    if (!subs.has(key)) subs.set(key, []);
    subs.get(key).push(cb);
  };
  const unsubscribe = (parentId, name, cb) => {
    const arr = subs.get(subKey(parentId, name));
    const i = arr ? arr.indexOf(cb) : -1;
    if (i !== -1) arr.splice(i, 1);
  };
  const notify = (parentId, name, property) => {
    const callbacks = [...(subs.get(subKey(parentId, name)) ?? [])];
    setTimeout(() => {
      for (const cb of callbacks) {
        try { cb(property ? { ...property } : null); }
        catch (err) { console.error(`CardAPI: subscriber error for "${name}"`, err); }
      }
    }, 0);
  };

  const get = (parentId, name) => {
    const p = store.get(parentId)?.get(name);
    return p ? { ...p } : null;
  };
  const getMany = (parentId, names) =>
    (Array.isArray(names) ? names : [names]).map((n) => get(parentId, n)).filter(Boolean);
  const set = (parentId, name, value) => {
    const props = parentStore(parentId);
    const existing = props.get(name);
    const text = asString(value);
    if (existing && existing.value === text) return;
    const property = existing ? { ...existing, value: text } : { id: newId("prop"), name, value: text, parentId };
    props.set(name, property);
    notify(parentId, name, property);
  };
  const init = (parentId, name, value) => {
    if (!store.get(parentId)?.has(name)) set(parentId, name, value);
  };
  const remove = (parentId, name) => {
    if (store.get(parentId)?.delete(name)) notify(parentId, name, null);
  };

  const listEdit = (name, edit) => {
    const property = get(cardId, name);
    if (!property) return;
    const rows = JSON.parse(property.value || "[]");
    set(cardId, name, JSON.stringify(edit(rows)));
  };

  // key → { id, data, mimeType }; card keys are stored as "<cardId>/<key>", like the app does.
  const resources = new Map();
  const resourceApi = (scope) => {
    const api = {
      Create: async (key, data, name, mimeType) => {
        const k = scope(key);
        if (resources.has(k)) throw new Error("Resource with that key already exists.");
        const id = newId("resource");
        resources.set(k, { id, data, mimeType: mimeType ?? (data instanceof Blob ? data.type : typeof data === "string" ? "text/plain" : "application/octet-stream") });
        return id;
      },
      Read: async (key) => {
        const r = resources.get(scope(key));
        if (!r) return null;
        if (isText(r.mimeType)) return typeof r.data === "string" ? r.data : await new Blob([r.data]).text();
        return r.data instanceof Blob ? r.data : new Blob([r.data], { type: r.mimeType });
      },
      Update: async (key, data, mimeType) => {
        const r = resources.get(scope(key));
        if (!r) throw new Error("Failed to update resource.");
        resources.set(scope(key), { ...r, data, mimeType: mimeType ?? r.mimeType });
      },
      Delete: async (key) => { resources.delete(scope(key)); },
      Upsert: async (key, data, name, mimeType) => {
        if (!resources.has(scope(key))) return api.Create(key, data, name, mimeType);
        await api.Update(key, data, mimeType);
        return undefined;
      },
    };
    return api;
  };

  // Addon panels registered with ClientMediator.register, by scoped name.
  const panels = new Map();
  const scopedName = (name) => {
    if (typeof name !== "string" || !name.startsWith("addon_") || name === "addon_") {
      throw new Error(`CardAPI: panel name must start with "addon_" — got "${name}"`);
    }
    return `addon_${cardId}_${name.slice("addon_".length)}`;
  };

  const rolls = new Map();
  const rollFormula = (formula) => {
    const text = String(formula).replace(/\s+/g, "");
    if (!/^([+-]?(\d*d\d+|\d+))+$/i.test(text)) throw new Error(`Invalid roll formula: ${formula}`);
    let result = 0;
    const dices = [];
    for (const [, sign, count, sides, flat] of text.matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/gi)) {
      const mult = sign === "-" ? -1 : 1;
      if (flat) { result += mult * Number(flat); continue; }
      for (let i = 0; i < Number(count || 1); i++) {
        const value = 1 + Math.floor(Math.random() * Number(sides));
        dices.push({ diceValue: Number(sides), result: value, kept: true });
        result += mult * value;
      }
    }
    return { result, dices };
  };

  const wsSubs = [];
  const sent = [];
  const sendToServer = (command, data) => {
    if (!ALLOWED_WS_COMMANDS.includes(command)) {
      throw new Error(`CardAPI: cards may not send "${command}" to the server`);
    }
    sent.push({ command, data });
    say("send", command, data);
    if (command === "execute_action" && typeof actions[data?.action] === "function") {
      setTimeout(() => actions[data.action](data.args, api), 0);
    }
  };

  const api = {
    get cardId() { return cardId; },
    get additionalArguments() { return additionalArguments; },

    Properties: {
      Get: async (name) => get(cardId, name),
      GetMany: async (names) => getMany(cardId, names),
      GetProperties: async () => [...parentStore(cardId).values()].map((p) => ({ ...p })),
      Set: async (name, value) => set(cardId, name, value),
      SetMany: async (props) => { for (const p of props) set(cardId, p.name, p.value); },
      Init: async (name, value) => init(cardId, name, value),
      InitMany: async (props) => { for (const p of props) init(cardId, p.name, p.value); },
      Remove: async (name) => remove(cardId, name),
      Subscribe: (name, cb) => subscribe(cardId, name, cb),
      Unsubscribe: (name, cb) => unsubscribe(cardId, name, cb),

      List: {
        Add: async (name, fields, itemId) => {
          if (!get(cardId, name)) {
            throw new Error(`Properties.List.Add: property "${name}" does not exist — call Properties.Init(name, "[]") first`);
          }
          listEdit(name, (rows) => {
            const id = itemId ?? newId("row");
            if (rows.some((r) => r.id === id)) throw new Error(`List item "${id}" already exists.`);
            return [...rows, { id, fields }];
          });
        },
        Remove: async (name, itemId) => listEdit(name, (rows) => rows.filter((r) => r.id !== itemId)),
        Update: async (name, itemId, fields) => listEdit(name, (rows) => rows.map((r) => (r.id === itemId ? { ...r, fields } : r))),
        Reorder: async (name, orderedItemIds) =>
          listEdit(name, (rows) => orderedItemIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean)),
      },

      Global: {
        Get: async (parentId, name) => get(parentId, name),
        GetMany: async (parentId, names) => getMany(parentId, names),
        GetByNames: async (parentId, names) => getMany(parentId, names),
        GetProperties: async (parentId) => [...(store.get(parentId)?.values() ?? [])].map((p) => ({ ...p })),
        Set: async (parentId, name, value) => set(parentId, name, value),
        SetMany: async (parentId, props) => { for (const p of props) set(parentId, p.name, p.value); },
        Init: async (parentId, name, value) => init(parentId, name, value),
        InitMany: async (parentId, props) => { for (const p of props) init(parentId, p.name, p.value); },
        Remove: async (parentId, name) => remove(parentId, name),
        Subscribe: (parentId, name, cb) => subscribe(parentId, name, cb),
        Unsubscribe: (parentId, name, cb) => unsubscribe(parentId, name, cb),
      },
    },

    Resources: {
      ...resourceApi((key) => `${cardId}/${key}`),
      Global: resourceApi((key) => key),
    },

    ClientMediator: {
      sendCommandAsync: async (panel, command, data) => {
        const key = `${panel}.${command}`;
        const group = API_GROUPS[String(panel).toLowerCase()];
        if (group) throw new Error(`CardAPI: "${key}" — use CardAPI.${group} instead`);
        if (CARD_COMMANDS.includes(key)) {
          switch (key) {
            case "Game.GetGameId": return gameId;
            case "Game.GetIsGM": return isGM;
            case "Game.GetPlayers": return players.map((p) => ({ ...p }));
            case "Game.GetCurrentPlayer": return players[0] ? { ...players[0] } : null;
            case "BattleMap.GetSelectedMap": return selectedMap;
            case "TurnOrder.GetState": return turnOrder;
            case "Chat.SendMessage": api.SendChatMessage(data); return undefined;
          }
        }
        if (typeof panel === "string" && panel.startsWith("addon_") && !RESERVED_COMMANDS.includes(command)) {
          const handlers = panels.get(panel);
          if (!handlers) throw new Error(`CardAPI: no panel "${panel}"`);
          if (typeof handlers[command] !== "function") throw new Error(`CardAPI: ${panel} has no command ${command}`);
          return handlers[command](data);
        }
        throw new Error(`CardAPI: "${key}" is not available to cards`);
      },
      sendCommand: (panel, command, data) => api.ClientMediator.sendCommandAsync(panel, command, data),
      register: (name, handlers) => {
        const scoped = scopedName(name);
        panels.set(scoped, { ...handlers });
        return Promise.resolve(scoped);
      },
      unregister: (name) => Promise.resolve(panels.delete(scopedName(name))),
    },

    SendChatMessage: (message) => sendToServer("chat_push", message),
    FireAction: (action, args) => {
      const safeArgs = args && typeof args === "object" ? args : {};
      sendToServer("execute_action", { action, args: { ...safeArgs, cardId } });
    },
    SendCustomCommandToServer: (command, data) => sendToServer(command, data),
    Close: () => say("Close() — the app would close this card's panel"),

    Rolls: {
      Start: async (formulas) => {
        const results = formulas.map(({ key, formula }) => ({ key, roll: rollFormula(formula) }));
        const rollId = newId("roll");
        rolls.set(rollId, results);
        return { rollId, results };
      },
      Finish: async ({ rollId, html, title, cssResourceKey } = {}) => {
        if (!rolls.has(rollId)) throw new Error("Unknown or expired roll.");
        say("roll posted to chat", { title, html, cssResourceKey, results: rolls.get(rollId) });
        rolls.delete(rollId);
      },
    },

    SubscribeWebSocket: (cb) => { wsSubs.push(cb); },
    UnsubscribeWebSocket: (cb) => {
      const i = wsSubs.indexOf(cb);
      if (i !== -1) wsSubs.splice(i, 1);
    },

    // ── Mock only ──────────────────────────────────────────────────────────────
    /** Pretend a game event arrived (chat_*, turnorder_*, action_*, property_*, custom_*). */
    emit: (command, data) => {
      for (const cb of [...wsSubs]) {
        try { cb({ command, data }); }
        catch (err) { console.error("CardAPI WS subscriber error", err); }
      }
    },
    /** Everything sent to the server (chat messages, actions), oldest first. */
    sent,
  };

  return api;
}

export const ApiMock = createApiMock();
