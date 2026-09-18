import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { ManagerMotion } from "../client/src/characters/manager_motion.ts";
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
  assert.deepEqual(manager.portraitRect, [96, 64, 128, 128]);
  const badPortrait = structuredClone(manager);
  badPortrait.portraitRect = [300, 0, 128, 128];
  assert.throws(() => validateManifest(badPortrait), /portrait rectangle/);

  const pose = { x: 0, y: 0, state: "hunting", attackSequence: 7 };
  const motion = new ManagerMotion();
  const sample = (now, changes = {}, active = true) => {
    Object.assign(pose, changes);
    return motion.sample(manager, pose, now, 96, active);
  };
  assert.equal(
    sample(5000).action,
    "idle",
    "joining never replays historical hits",
  );
  for (const [direction, dx, dy] of [
    ["right", 10, 0],
    ["left", -10, 0],
    ["up", 0, -10],
    ["down", 0, 10],
  ]) {
    const frame = sample(5016, { x: pose.x + dx, y: pose.y + dy });
    assert.equal(frame.action, "move_" + direction);
    assert.equal(frame.mirror, false);
  }
  assert.equal(
    sample(5100, { state: "attacking" }).action,
    "idle",
    "standing at a door does not invent attacks while its cooldown is delayed",
  );
  assert.equal(sample(5200, { attackSequence: 8 }).action, "attack");
  assert.equal(
    sample(5540).index,
    3,
    "identical snapshots do not reset the knock",
  );
  assert.equal(sample(5999).index, 7);
  assert.equal(sample(6000).action, "idle", "a knock plays only once");
  assert.equal(
    sample(6800).action,
    "idle",
    "fridge delay leaves the manager waiting",
  );
  assert.equal(
    sample(7000, { attackSequence: 11 }).index,
    0,
    "coalesced hits play the newest attack, not a stale backlog",
  );
  assert.equal(sample(7300).action, "attack");
  assert.equal(sample(7320, { state: "retreating", x: 10 }).action, "retreat");
  assert.equal(
    sample(7480, { x: 20 }).index,
    2,
    "retreat uses its authored timing",
  );
  assert.equal(
    sample(7496, { state: "defeated", x: 25 }).action,
    "retreat",
    "zero HP means fleeing home, not a death pose",
  );
  assert.equal(sample(8000, { state: "resting" }).action, "idle");
  assert.equal(
    sample(8100, { state: "attacking", attackSequence: 12 }).action,
    "attack",
  );
  assert.equal(
    sample(8150, {}, false).action,
    "idle",
    "round end cancels an attack",
  );
  assert.equal(
    sample(8300, { state: "chasing", attackSequence: 13 }).action,
    "attack",
    "the door-breaking hit still plays when the server already switched to chasing",
  );
  assert.equal(sample(9100, { x: 30 }).action, "move_right");
  assert.equal(
    sample(9200, { x: 1000 }).action,
    "idle",
    "teleports do not run the gait",
  );
  const gait = (fps) => {
    const controller = new ManagerMotion();
    let result;
    for (let frame = 0; frame <= fps; ++frame) {
      result = controller.sample(
        manager,
        { x: (107 * frame) / fps, y: 0, state: "hunting", attackSequence: 0 },
        (1000 * frame) / fps,
        96,
      );
    }
    return result;
  };
  assert.equal(
    gait(30).index,
    gait(144).index,
    "gait is independent of render FPS",
  );
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
    "PASS shopkeeper assets, movement, authoritative attacks, retreat, portraits and legacy cats",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalLocation === undefined) delete globalThis.location;
  else globalThis.location = originalLocation;
}
