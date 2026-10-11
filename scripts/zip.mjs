// Reads one file out of a zip held in memory (stored or deflated entries), enough to
// get an addon release's info.json without temp files or an unzip tool.
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The contents of `name` in the zip `buffer`, or null when the zip has no such file. */
export function readZipEntry(buffer, name) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(at) !== CENTRAL) throw new Error("broken zip directory");
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const entryName = buffer.toString("utf8", at + 46, at + 46 + nameLength).replace(/\\/g, "/");
    at += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;

    if (buffer.readUInt32LE(localAt) !== LOCAL) throw new Error("broken zip entry");
    const dataAt = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    const data = buffer.subarray(dataAt, dataAt + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`unsupported zip compression ${method}`);
  }
  return null;
}

/** info.json of an addon zip, parsed, or null when there is none. */
export function readAddonInfo(buffer) {
  const raw = readZipEntry(buffer, "info.json");
  return raw ? JSON.parse(raw.toString("utf8").replace(/^﻿/, "")) : null;
}
