#!/usr/bin/env node
// `pnpm run pack`: builds every card in card_sources/ and zips the addon into packed.zip.
//   1. copies addon_files/ to packed/
//   2. builds each card_sources/<card> (pnpm install + pnpm run build)
//   3. copies its dist/assets/*.js (and *.css) to packed/Resources/<card>.js (.css)
//   4. zips packed/ into packed.zip
// A template refers to the built files as "<addon key>_<card>.js", e.g. myaddon_myaddon-hpcard.js.
import archiver from 'archiver';
import { execSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packedDir = path.join(root, 'packed');
const resourcesDir = path.join(packedDir, 'Resources');
const cardSourcesRoot = path.join(root, 'card_sources');
const zipPath = path.join(root, 'packed.zip');

const run = (command, cwd) => execSync(command, { cwd, stdio: 'inherit' });

const cards = existsSync(cardSourcesRoot)
    ? readdirSync(cardSourcesRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(path.join(cardSourcesRoot, d.name, 'package.json')))
        .map((d) => d.name)
    : [];

// 1. start from a clean copy of addon_files, so no stale build output gets zipped
rmSync(packedDir, { recursive: true, force: true });
cpSync(path.join(root, 'addon_files'), packedDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });

for (const card of cards) {
    // 2. build
    console.log(`Building ${card}...`);
    const dir = path.join(cardSourcesRoot, card);
    run('pnpm install', dir);
    run('pnpm run build', dir);

    // 3. copy the bundle under a fixed name
    const assetsDir = path.join(dir, 'dist', 'assets');
    const files = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
    const js = files.filter((f) => f.endsWith('.js'));
    const css = files.filter((f) => f.endsWith('.css'));
    if (js.length !== 1) {
        throw new Error(`${card}: expected one .js file in dist/assets, found ${js.length}. The card must build to a single file (see vite.config.js).`);
    }
    cpSync(path.join(assetsDir, js[0]), path.join(resourcesDir, `${card}.js`));
    if (css.length) cpSync(path.join(assetsDir, css[0]), path.join(resourcesDir, `${card}.css`));
}

// 4. zip
rmSync(zipPath, { force: true });
await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(packedDir, false);
    archive.finalize();
});

console.log(`Packed ${cards.length} card(s) into packed.zip.`);
