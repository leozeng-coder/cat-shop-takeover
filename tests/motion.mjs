import assert from "node:assert/strict";
import { MotionTrack } from "../client/src/render/motion_track.ts";
const map = { width: 4, height: 4, tileSize: 32 };
const straight = new MotionTrack();
straight.push(1, 100, { x: 16, y: 16, path: [1, 2] });
straight.push(2, 200, { x: 32, y: 16, path: [1, 2] });
straight.push(3, 300, { x: 48, y: 16, path: [2] });
let previous = 16;
for (let now = 250; now <= 440; now += 10) {
  const point = straight.sample(now, map);
  assert.ok(point.x >= previous, "display time cannot move backwards");
  assert.ok(
    Math.abs(point.x - previous - 1.6) < 0.00001,
    "movement uses constant speed between snapshots",
  );
  previous = point.x;
}
const corner = new MotionTrack();
corner.push(1, 100, { x: 40, y: 16, path: [1, 5] });
corner.push(2, 200, { x: 48, y: 24, path: [5] });
assert.deepEqual(
  corner.sample(290, map),
  { x: 48, y: 16 },
  "follow the actual grid corner, not a diagonal",
);
const command = new MotionTrack();
command.push(1, 100, { x: 16, y: 16, path: [] });
command.push(1, 130, { x: 16, y: 16, path: [1] });
command.push(2, 200, { x: 32, y: 16, path: [1] });
assert.deepEqual(
  command.sample(290, map),
  { x: 24, y: 16 },
  "same-tick commands must not insert a stationary animation interval",
);
console.log(
  "PASS motion interpolation: continuous speed, grid corners and duplicate-tick commands",
);
