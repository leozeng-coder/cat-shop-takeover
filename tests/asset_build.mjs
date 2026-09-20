import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { buildAssets } from "../client/tools/build-assets.mjs";

const require = createRequire(
  new URL("../client/package.json", import.meta.url),
);
const { PNG } = require("pngjs");
const temporaryDirectory = await fs.realpath(os.tmpdir());
const root = await fs.mkdtemp(
  path.join(temporaryDirectory, "cat-shop-asset-build-"),
);
const source = path.join(root, "assets");
const character = "characters/v1/cat_test";
const originalName = `${character}/idle.png`;
const skinName = `${character}/skins/blue_gray/idle.png`;

async function write(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, bytes);
}

async function writeJson(filename, value) {
  await write(filename, JSON.stringify(value, null, 2) + "\n");
}

// Include timestamps so a dry run or no-op cannot pass by rewriting equal bytes.
async function snapshot(directory, prefix = "") {
  const files = {};
  const entries = await fs.readdir(path.join(directory, prefix), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await snapshot(directory, relative));
    } else {
      const filename = path.join(directory, relative);
      files[relative] = {
        hash: createHash("sha256")
          .update(await fs.readFile(filename))
          .digest("hex"),
        modified: (await fs.stat(filename)).mtimeMs,
      };
    }
  }
  return files;
}

async function missing(filename) {
  await assert.rejects(fs.stat(filename), { code: "ENOENT" });
}

const palettes = {
  version: 1,
  default: "orange",
  source: {
    hueRange: [18, 54],
    hueFeather: 5,
    furSaturation: [0.28, 0.46],
    outlineLightness: [0.29, 0.44],
    furLightness: [0.53, 0.7, 0.86],
    paleLightness: [0.64, 0.84],
    paleSaturation: [0.03, 0.31],
  },
  skins: [
    {
      id: "orange",
      original: true,
      fur: "#ffb868",
      stripe: "#df8040",
      highlight: "#ffdbad",
      white: "#fff1df",
    },
    {
      id: "blue_gray",
      fur: "#94a9c6",
      stripe: "#5c7195",
      highlight: "#cbd7e8",
      white: "#f7f8fc",
    },
  ],
};

try {
  await writeJson(path.join(root, "client/tools/asset-build.json"), {
    source: "assets",
    characters: "characters/v1/index.json",
  });
  await writeJson(path.join(source, "characters/v1/index.json"), {
    characters: [{ id: "cat_test", manifest: "cat_test/manifest.json" }],
  });
  await writeJson(path.join(source, character, "manifest.json"), {
    id: "cat_test",
    palettes: "palettes.json",
    skinAtlases: "skin-atlases.json",
    frameSize: [2, 2],
    animations: { idle: { src: "idle.png", columns: 2, frameCount: 2 } },
  });
  await writeJson(path.join(source, character, "palettes.json"), palettes);
  const pixels = Buffer.from([
    255, 184, 104, 255, 255, 184, 104, 128, 255, 184, 104, 0, 50, 90, 200, 255,
    223, 128, 64, 255, 255, 219, 173, 200, 10, 10, 10, 255, 255, 184, 104, 1,
  ]);
  const original = PNG.sync.write({ width: 4, height: 2, data: pixels });
  await write(path.join(source, originalName), original);
  await write(path.join(source, originalName + ".meta"), "Cocos metadata");
  await write(
    path.join(source, "notes.txt"),
    "Preserve files not owned by the generator",
  );

  const initial = await buildAssets({ root });
  assert.ok(initial.written > 0);
  const bakedBytes = await fs.readFile(path.join(source, skinName));
  const baked = PNG.sync.read(bakedBytes);
  assert.deepEqual(
    [baked.width, baked.height],
    [4, 2],
    "atlas geometry stays intact",
  );
  assert.notDeepEqual(
    baked.data.subarray(0, 3),
    pixels.subarray(0, 3),
    "warm fur changes color",
  );
  assert.ok(
    baked.data[2] > baked.data[0],
    "the blue-gray palette produces cooler fur",
  );
  for (let index = 3; index < pixels.length; index += 4) {
    assert.equal(
      baked.data[index],
      pixels[index],
      "all alpha values survive offline tinting",
    );
  }
  assert.deepEqual(
    baked.data.subarray(8, 12),
    pixels.subarray(8, 12),
    "transparent pixels stay untouched",
  );
  assert.deepEqual(
    baked.data.subarray(12, 16),
    pixels.subarray(12, 16),
    "non-fur colors stay untouched",
  );
  assert.deepEqual(
    await fs.readFile(path.join(source, originalName)),
    original,
    "source PNG remains byte-identical",
  );
  const index = JSON.parse(
    await fs.readFile(path.join(source, character, "skin-atlases.json")),
  );
  assert.equal(
    index.skins.orange.idle,
    "idle.png",
    "original skin reuses accepted source art",
  );
  assert.equal(index.skins.blue_gray.idle, "skins/blue_gray/idle.png");
  await missing(path.join(root, "client/public/assets"));
  await missing(path.join(root, "client-cocos/assets/resources/game"));

  const beforeNoop = await snapshot(root);
  const noOp = await buildAssets({ root });
  assert.equal(noOp.written, 0);
  assert.equal(noOp.removed, 0);
  assert.deepEqual(
    await snapshot(root),
    beforeNoop,
    "second generation does not write",
  );
  await buildAssets({ root, check: true });

  const metadata = Buffer.from(
    '{"uuid":"keep-this-cocos-uuid","userData":{"filter":"linear"}}\n',
  );
  await write(path.join(source, originalName + ".meta"), metadata);
  await write(path.join(source, skinName + ".meta"), metadata);
  const changedPixels = Buffer.from(pixels);
  changedPixels.set([240, 170, 70], 0);
  const changedOriginal = PNG.sync.write({
    width: 4,
    height: 2,
    data: changedPixels,
  });
  await write(path.join(source, originalName), changedOriginal);
  const beforeCheck = await snapshot(root);
  await assert.rejects(buildAssets({ root, check: true }), /out of date/);
  assert.deepEqual(
    await snapshot(root),
    beforeCheck,
    "check reports drift without writing anything",
  );
  await buildAssets({ root });
  const changedSkin = await fs.readFile(path.join(source, skinName));
  assert.notDeepEqual(
    changedSkin,
    bakedBytes,
    "source updates regenerate the colored atlas",
  );
  assert.deepEqual(
    await fs.readFile(path.join(source, originalName)),
    changedOriginal,
  );
  assert.deepEqual(
    await fs.readFile(path.join(source, originalName + ".meta")),
    metadata,
  );
  assert.deepEqual(
    await fs.readFile(path.join(source, skinName + ".meta")),
    metadata,
  );

  const manualName = path.join(source, "manual/extra.json");
  const manualBytes = Buffer.from('{"ownedBy":"Cocos"}\n');
  await write(manualName, manualBytes);
  await write(manualName + ".meta", metadata);
  palettes.skins = palettes.skins.filter((skin) => skin.original);
  await writeJson(path.join(source, character, "palettes.json"), palettes);
  await buildAssets({ root });
  await missing(path.join(source, skinName));
  await missing(path.join(source, skinName + ".meta"));
  assert.deepEqual(
    await fs.readFile(manualName),
    manualBytes,
    "manual Cocos assets are retained",
  );
  assert.deepEqual(await fs.readFile(manualName + ".meta"), metadata);
  assert.deepEqual(
    await fs.readFile(path.join(source, originalName + ".meta")),
    metadata,
  );
  await buildAssets({ root, check: true });
  console.log(
    "Shared assets: palette baking, alpha, geometry, no-op, metadata, cleanup and dry-run checks passed.",
  );
} finally {
  const resolved = await fs.realpath(root);
  assert.equal(
    path.dirname(resolved),
    temporaryDirectory,
    "cleanup stays inside the known temporary directory",
  );
  assert.ok(path.basename(resolved).startsWith("cat-shop-asset-build-"));
  assert.ok(!(await fs.lstat(root)).isSymbolicLink());
  await fs.rm(resolved, { recursive: true, force: true });
}
