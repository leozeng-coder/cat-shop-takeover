import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { preparePalette, recolorPixels } from '../src/characters/palette-colors.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

// The repository-level assets directory is the only source for both clients.
function child(root, relative) {
  if (!relative || relative.includes('\\') || path.isAbsolute(relative)) {
    throw new Error(`Expected a relative asset path: ${relative}`);
  }
  const absolute = path.resolve(root, relative);
  const within = path.relative(path.resolve(root), absolute);
  if (!within || within.startsWith('..') || path.isAbsolute(within)) {
    throw new Error(`Asset path leaves its directory: ${relative}`);
  }
  return absolute;
}

async function readIfExists(filename) {
  try {
    return await fs.readFile(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertNoLinks(root, absolute) {
  const parts = path.relative(root, absolute).split(path.sep);
  let current = root;
  for (const part of ['', ...parts]) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`Asset synchronization requires regular files and directories: ${current}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function collect(root, prefix = '') {
  const files = new Map();
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Linked source asset is not supported: ${relative}`);
    if (entry.isDirectory()) {
      for (const [name, bytes] of await collect(root, relative)) files.set(name, bytes);
    } else if (['.png', '.json'].includes(path.extname(entry.name))) {
      files.set(relative, await fs.readFile(child(root, relative)));
    }
  }
  return files;
}

function readJson(files, name) {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`Missing asset configuration: ${name}`);
  return JSON.parse(bytes);
}

function relativeTo(directory, name) {
  child(directory || '.', name);
  return path.posix.join(directory, name);
}

function bakeCharacters(files, indexName) {
  const generated = new Map();
  const obsolete = new Set();
  const index = readJson(files, indexName);
  for (const entry of index.characters) {
    const manifestName = relativeTo(path.posix.dirname(indexName), entry.manifest);
    const manifest = readJson(files, manifestName);
    const directory = path.posix.dirname(manifestName);
    const palette = readJson(files, relativeTo(directory, manifest.palettes));
    const outputName = relativeTo(directory, manifest.skinAtlases);
    const oldIndex = files.has(outputName) ? readJson(files, outputName) : null;
    for (const actions of Object.values(oldIndex?.skins ?? {})) {
      for (const filename of Object.values(actions)) {
        // Only this reserved directory contains generated color variants.
        if (filename.startsWith('skins/')) obsolete.add(relativeTo(directory, filename));
      }
    }
    const skins = {};
    const ids = new Set();
    for (const skin of palette.skins) {
      if (!/^[a-z][a-z0-9_]*$/.test(skin.id) || ids.has(skin.id)) {
        throw new Error(`${entry.id}: invalid or duplicate skin ID`);
      }
      ids.add(skin.id);
      skins[skin.id] = {};
      preparePalette(skin, palette.source);
    }
    if (!ids.has(palette.default)) throw new Error(`${entry.id}: missing default skin`);
    for (const [action, animation] of Object.entries(manifest.animations)) {
      if (!/^[a-z][a-z0-9_]*$/.test(action)) throw new Error(`Invalid action ID: ${action}`);
      const bytes = files.get(relativeTo(directory, animation.src));
      if (!bytes) throw new Error(`${entry.id}/${action}: missing source atlas`);
      const source = PNG.sync.read(bytes);
      const [frameWidth, frameHeight] = manifest.frameSize;
      if (
        !Number.isInteger(animation.columns) ||
        animation.columns <= 0 ||
        !Number.isInteger(animation.frameCount) ||
        animation.frameCount <= 0 ||
        source.width !== frameWidth * animation.columns ||
        source.height !== frameHeight * Math.ceil(animation.frameCount / animation.columns)
      )
        throw new Error(`${entry.id}/${action}: atlas dimensions do not match the manifest`);
      for (const skin of palette.skins) {
        if (skin.original) {
          skins[skin.id][action] = animation.src;
          continue;
        }
        const filename = `skins/${skin.id}/${action}.png`;
        const pixels = Buffer.from(source.data);
        recolorPixels(pixels, preparePalette(skin, palette.source));
        generated.set(relativeTo(directory, filename), PNG.sync.write({ ...source, data: pixels }));
        skins[skin.id][action] = filename;
      }
    }
    generated.set(outputName, json({ version: 1, skins }));
  }
  for (const name of obsolete) files.delete(name);
  for (const [name, bytes] of generated) {
    files.set(name, bytes);
    obsolete.delete(name);
  }
  return { generated, obsolete };
}

export async function buildAssets({ root = projectRoot, check = false } = {}) {
  const config = JSON.parse(await fs.readFile(child(root, 'client/tools/asset-build.json')));
  const source = child(root, config.source);
  await assertNoLinks(root, source);
  const files = await collect(source);
  const { generated, obsolete } = bakeCharacters(files, config.characters);
  const writes = new Map();
  const removals = [];
  const differences = [];
  async function planWrite(filename, bytes) {
    await assertNoLinks(root, filename);
    const old = await readIfExists(filename);
    if (!old?.equals(bytes)) {
      writes.set(filename, bytes);
      differences.push(path.relative(root, filename));
    }
    return old;
  }
  for (const [name, bytes] of generated) await planWrite(child(source, name), bytes);
  for (const name of obsolete) {
    const filename = child(source, name);
    for (const stale of [filename, filename + '.meta']) {
      await assertNoLinks(root, stale);
      if (await readIfExists(stale)) {
        removals.push(stale);
        differences.push(path.relative(root, stale));
      }
    }
  }
  if (check && differences.length) {
    throw new Error(
      `Generated atlases are out of date. Run npm run assets:build.\n${differences.slice(0, 12).join('\n')}`,
    );
  }
  if (!check) {
    for (const [filename, bytes] of writes) {
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, bytes);
    }
    // Every removal is an individual, contained file recorded by the previous generation.
    for (const filename of removals) await fs.unlink(filename);
  }
  return { files: files.size, generated: generated.size, written: writes.size, removed: removals.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const invalid = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (invalid.length) throw new Error(`Unknown arguments: ${invalid.join(' ')}`);
  try {
    const check = process.argv.includes('--check');
    const result = await buildAssets({ check });
    console.log(
      `${check ? 'Verified' : 'Prepared'} ${result.files} shared assets; ${result.written} written, ${result.removed} removed.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
