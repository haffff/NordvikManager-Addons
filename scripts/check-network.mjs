#!/usr/bin/env node
// Checks an addon folder (what its zip holds: info.json, Actions/, Resources/, ...) against
// the "network" it declares in info.json: where its code connects outside NordvikManager.
// Run by the shared release workflow on the packed zip; no dependencies, node builtins only.
//
//   node scripts/check-network.mjs <addon folder>
//
// Errors (the release fails):
//   - info.json has no "network" ({} says nowhere)
//   - a Send Request / Download Resource step with a literal address whose origin isn't in
//     network.hosts, or with an address made from values ("%baseUrl%/...") when the addon
//     doesn't say it connects to an address the user enters (network.userHosts)
// Warnings (shown, the release goes on): what the card code seems to reach — literal origins
// not in network.hosts, and RTCPeerConnection / <iframe>, which cards can't use.
//
// It reads the files as text and can't see an address put together at run time: the GM
// server and the card's CSP hold the addon to its declaration whatever this finds.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { pathToFileURL } from "node:url";

const REQUEST_STEPS = new Set(["SendRequest", "DownloadResource"]);
const CODE_FILES = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".jsx", ".css", ".svg"]);
// Identifiers in markup and code, not places anything connects to.
const NOT_CONNECTIONS = new Set(["http://www.w3.org", "https://www.w3.org", "http://www.w3.org:80"]);
const LITERAL_ORIGIN = /\b(?:https?|wss?):\/\/[A-Za-z0-9.-]+(?::\d{1,5})?/g;

const originOf = (text) => {
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

// Every Send Request / Download Resource step, however deep (If, ForEach, ... hold steps).
function* requestSteps(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* requestSteps(item);
  } else if (node && typeof node === "object") {
    if (REQUEST_STEPS.has(node.Type)) yield node;
    for (const value of Object.values(node)) yield* requestSteps(value);
  }
}

function actionContent(action) {
  const content = action?.content ?? action?.Content;
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** @returns {{ errors: string[], warnings: string[] }} */
export function checkNetwork(dir) {
  const errors = [];
  const warnings = [];
  const info = JSON.parse(readFileSync(join(dir, "info.json"), "utf8"));
  const network = info.network;
  if (network === undefined || network === null || typeof network !== "object" || Array.isArray(network)) {
    errors.push('info.json has no "network": say where the addon connects outside NordvikManager ({} for nowhere, "hosts" for fixed origins, "userHosts" for an address the user enters).');
    return { errors, warnings };
  }
  const hosts = new Set((network.hosts ?? []).map((h) => originOf(h) ?? h));
  const userHosts = typeof network.userHosts === "string" && network.userHosts.length > 0;

  for (const path of files(dir)) {
    const name = relative(dir, path).replaceAll("\\", "/");
    const ext = extname(path).toLowerCase();

    if (ext === ".json" && name.toLowerCase().startsWith("actions/")) {
      let action;
      try {
        action = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        continue; // not ours to judge here: the schema check reports it
      }
      for (const step of requestSteps(actionContent(action))) {
        const url = String(step.Data?.TargetUrl ?? "");
        // scheme://host[:port], literal only when no %value% is part of it.
        const hostPart = url.match(/^[a-z]+:\/\/[^/?#]*/i)?.[0];
        const origin = hostPart && !hostPart.includes("%") ? originOf(hostPart) : null;
        if (!origin) {
          if (!userHosts)
            errors.push(`${name}: a ${step.Type} step's address "${url}" is made from values: set network.userHosts to say what address the user enters.`);
          continue;
        }
        if (!hosts.has(origin) && !userHosts)
          errors.push(`${name}: a ${step.Type} step reaches ${origin}, which is not in network.hosts.`);
      }
      continue;
    }

    if (!CODE_FILES.has(ext)) continue;
    const text = readFileSync(path, "utf8");
    const seen = new Set();
    for (const match of text.matchAll(LITERAL_ORIGIN)) {
      const origin = originOf(match[0]);
      if (!origin || NOT_CONNECTIONS.has(origin) || hosts.has(origin) || seen.has(origin)) continue;
      seen.add(origin);
      warnings.push(`${name}: mentions ${origin}, which is not in network.hosts (a card can only reach declared hosts the GM allows).`);
    }
    if (/\bRTCPeerConnection\b/.test(text))
      warnings.push(`${name}: uses RTCPeerConnection, which cards don't have.`);
    if (/<iframe\b/i.test(text))
      warnings.push(`${name}: has an <iframe>; cards can't create frames.`);
  }
  return { errors, warnings };
}

// As a script: print GitHub annotations, fail on errors.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/check-network.mjs <addon folder>");
    process.exit(2);
  }
  const { errors, warnings } = checkNetwork(dir);
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const e of errors) console.log(`::error::${e}`);
  if (errors.length) process.exit(1);
  console.log(`network: ${warnings.length} warning(s), no errors`);
}
