import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readZipEntry, readAddonInfo } from "./zip.mjs";

// A minimal zip: each file stored or deflated, a central directory and its end record.
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text, deflate } of files) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("reads stored and deflated entries by name", () => {
  const zip = makeZip([
    { name: "Resources/theme.css", text: "body{}", deflate: true },
    { name: "info.json", text: '{"key":"x","version":"1.2.3"}', deflate: true },
    { name: "README.md", text: "hello" },
  ]);
  assert.equal(readZipEntry(zip, "README.md").toString(), "hello");
  assert.deepEqual(readAddonInfo(zip), { key: "x", version: "1.2.3" });
  assert.equal(readZipEntry(zip, "missing.txt"), null);
});

test("an addon zip without info.json gives null; a non-zip throws", () => {
  assert.equal(readAddonInfo(makeZip([{ name: "a.txt", text: "a" }])), null);
  assert.throws(() => readZipEntry(Buffer.from("not a zip at all, definitely not"), "info.json"), /not a zip/);
});
