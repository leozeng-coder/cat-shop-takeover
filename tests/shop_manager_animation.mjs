import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  loadCharacterAnimations,
  sampleClip,
  validateManifest,
} from "../client/src/characters/animation.js";

// Exercise the actual loader with local files, without a running game server.
const root = new URL("../client/public/assets/characters/v1/", import.meta.url);
const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;
globalThis.location = { href: root.href };
globalThis.fetch = async (url) => new Response(await fs.readFile(new URL(url)));
try {
  const manager = await loadCharacterAnimations(
    new URL("shop_manager/manifest.json", root),
  );
  assert.equal(manager.profile, "shop_manager");
  assert.equal(Object.keys(manager.clips).length, 7);
  for (const clip of Object.values(manager.clips)) {
    assert.equal(clip.frames.length, 8);
    assert.equal(clip.mirrorForRight, false, "the net must not change hands");
    const atlas = manager.atlases[clip.atlas];
    const png = await fs.readFile(new URL(atlas.src));
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), atlas.width);
    assert.equal(png.readUInt32BE(20), atlas.height);
  }
  assert.equal(new Set(Object.values(manager.movementClips)).size, 4);
  assert.equal(sampleClip(manager, "attack", 10000).index, 7);
  assert.equal(sampleClip(manager, "retreat", 640).index, 0);
  const mirrored = structuredClone(manager);
  mirrored.clips.move_right.mirrorForRight = true;
  assert.throws(() => validateManifest(mirrored), /preserve the net hand/);
  const sameDirection = structuredClone(manager);
  sameDirection.movementClips.right = sameDirection.movementClips.left;
  assert.throws(() => validateManifest(sameDirection), /preserve the net hand/);
  const missingAttack = structuredClone(manager);
  delete missingAttack.clips.attack;
  assert.throws(
    () => validateManifest(missingAttack),
    /Invalid character clip/,
  );
  const cat = await loadCharacterAnimations(
    new URL("cat_orange/manifest.json", root),
  );
  assert.equal(
    cat.profile,
    "cat",
    "existing manifests retain the cat contract",
  );
  assert.equal(cat.clips.wake.loop, false);
  assert.equal(cat.clips.sleep.loop, true);
  console.log(
    "PASS shopkeeper assets, independent directions, playback and legacy cat loading",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalLocation === undefined) delete globalThis.location;
  else globalThis.location = originalLocation;
}
