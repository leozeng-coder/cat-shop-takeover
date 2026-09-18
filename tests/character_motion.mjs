import assert from "node:assert/strict";
import fs from "node:fs";
import { CharacterMotion } from "../client/src/characters/character_motion.ts";
import {
  sampleClip,
  validateManifest,
} from "../client/src/characters/animation.js";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL(
      "../client/public/assets/characters/v1/cat_orange/manifest.json",
      import.meta.url,
    ),
  ),
);
const config = {
  strideWorldUnits: manifest.strideWorldUnits,
  movementClips: manifest.movementClips,
  clips: {},
  atlases: {},
};
for (const [name, clip] of Object.entries(manifest.animations)) {
  config.clips[name] = {
    ...clip,
    atlas: name,
    frames: Array.from({ length: clip.frameCount }, (_, i) => i),
  };
  config.atlases[name] = {
    width: clip.columns * 320,
    height: Math.ceil(clip.frameCount / clip.columns) * 320,
    frames: config.clips[name].frames.map((i) => ({
      rect: [
        (i % clip.columns) * 320,
        Math.floor(i / clip.columns) * 320,
        320,
        320,
      ],
      anchor: manifest.anchor,
    })),
  };
}
validateManifest(config);
const walk = (fps) => {
  const motion = new CharacterMotion();
  motion.sample(config, { x: 0, y: 0, sleeping: false }, 0, 96);
  let sample;
  for (let i = 1; i <= fps; i++)
    sample = motion.sample(
      config,
      { x: (20 * i) / fps, y: 0, sleeping: false },
      (i * 1000) / fps,
      96,
    );
  return { motion, sample };
};
assert.equal(
  walk(30).sample.index,
  walk(144).sample.index,
  "stride depends on distance, not frame rate",
);
const { motion, sample } = walk(60);
assert.equal(sample.mirror, true);
assert.equal(
  motion.sample(config, { x: 20, y: 0, sleeping: false }, 1050, 96).action,
  "idle",
  "no stationary stepping",
);
const continued = motion.sample(
  config,
  { x: 20.1, y: 0, sleeping: false },
  1100,
  96,
);
assert.equal(
  continued.index,
  sample.index,
  "new destination retains stride phase",
);
assert.equal(
  motion.sample(config, { x: 19.9, y: 0, sleeping: false }, 1150, 96).mirror,
  false,
);
assert.equal(
  motion.sample(config, { x: 500, y: 0, sleeping: false }, 1200, 96).action,
  "idle",
  "teleports do not advance footsteps",
);
const rest = new CharacterMotion();
assert.equal(
  rest.sample(config, { x: 0, y: 0, sleeping: true }, 0, 96).index,
  0,
);
assert.equal(
  rest.sample(config, { x: 0, y: 0, sleeping: true }, 2000, 96).index,
  0,
  "sleep holds the approved prone frame",
);
assert.equal(
  rest.sample(config, { x: 0, y: 0, sleeping: false }, 2100, 96).action,
  "wake",
);
assert.equal(
  rest.sample(config, { x: 0, y: 0, sleeping: false }, 2800, 96).action,
  "idle",
  "wake finishes standing",
);
rest.sample(config, { x: 0, y: 0, sleeping: true }, 3000, 96);
assert.equal(
  rest.sample(config, { x: 1, y: 0, sleeping: false }, 3016, 96).action,
  "move",
  "escaping immediately interrupts wake",
);
assert.equal(
  rest.sample(config, { x: 1, y: 0, sleeping: false }, 3032, 96).action,
  "idle",
  "stopping does not replay interrupted wake",
);
assert.equal(
  sampleClip(config, "idle", 2420).index,
  11,
  "idle preserves variable blink timings",
);
assert.equal(
  sampleClip(config, "wake", 5000).index,
  17,
  "one-shot clips hold the last frame",
);
const directions = new CharacterMotion();
directions.sample(config, { x: 0, y: 0, sleeping: false }, 0, 96);
const north = directions.sample(
  config,
  { x: 0, y: -6, sleeping: false },
  100,
  96,
);
assert.equal(north.action, "move_up", "walking up uses the back view");
assert.equal(north.mirror, false);
assert.equal(
  directions.sample(config, { x: 1, y: -7, sleeping: false }, 150, 96).action,
  "move_up",
  "diagonal jitter retains the previous axis",
);
const east = directions.sample(
  config,
  { x: 1.01, y: -7, sleeping: false },
  200,
  96,
);
assert.equal(east.action, "move");
assert.equal(east.mirror, true);
assert.equal(
  east.index,
  north.index,
  "turning preserves the shared stride phase",
);
assert.equal(
  directions.sample(config, { x: 1.01, y: -1, sleeping: false }, 300, 96)
    .action,
  "move_down",
  "walking down uses the front view",
);
const west = directions.sample(
  config,
  { x: -5, y: -1, sleeping: false },
  400,
  96,
);
assert.equal(west.action, "move");
assert.equal(west.mirror, false);
const invalidDirection = { ...config, movementClips: { up: "missing" } };
assert.throws(
  () => validateManifest(invalidDirection),
  /Invalid movement clip/,
);
console.log(
  "PASS character distance playback, four directions, turn phase, diagonal stability, rest and interruptible wake",
);
