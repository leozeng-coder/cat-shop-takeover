import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { atlasRect, clipFrameIndex, fitExtent } from '../client-cocos/assets/scripts/art/SpriteLayout.ts';
import { Locomotion } from '../client-cocos/assets/scripts/game/Locomotion.ts';
import { battleHudLayout, doorUnderAttack, phaseClock, playerActivity } from '../client-cocos/assets/scripts/ui/BattleHudModel.ts';

test('eight-frame sheets read left to right, then top to bottom; wake stays on its final frame', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/characters/v1/cat_orange/manifest.json', import.meta.url)));
  const wake = manifest.animations.wake;
  const duration = wake.durationsMs.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  for (let i = 0; i < 8; ++i) {
    const frame = clipFrameIndex(wake.durationsMs, duration, false, elapsed + 0.01);
    assert.equal(frame, i);
    assert.deepEqual(atlasRect(frame, 4, 320, 320), [(i % 4) * 320, i < 4 ? 0 : 320, 320, 320]);
    elapsed += wake.durationsMs[i];
  }
  assert.equal(clipFrameIndex(wake.durationsMs, duration, false, duration + 500), 7);
  assert.equal(clipFrameIndex(wake.durationsMs, duration, true, duration), 0);
});

test('walking keeps the same gait distance at 30, 60 and 144 FPS and through turns', () => {
  for (const fps of [30, 60, 144]) {
    const motion = new Locomotion();
    motion.sample({ x: 0, y: 0 }, 0, 96);
    let state;
    for (let frame = 1; frame <= fps * 2; ++frame) {
      const seconds = frame / fps;
      state = motion.sample({ x: Math.min(seconds, 1) * 80, y: Math.max(seconds - 1, 0) * 80 }, seconds * 1000, 96);
    }
    assert.ok(Math.abs(state.distance - 160) < 0.0001);
    assert.equal(state.direction, 'down');
    assert.equal(state.moving, true);
    const held = motion.sample({ x: 80, y: 80 }, 2050, 96);
    assert.equal(held.distance, state.distance);
    assert.equal(held.moving, true);
    assert.equal(motion.sample({ x: 80, y: 80 }, 2200, 96).moving, false);
    assert.equal(motion.sample({ x: 800, y: 800 }, 2300, 96).distance, state.distance);
  }
});

test('diagonal noise does not flip facing on consecutive frames', () => {
  const motion = new Locomotion();
  motion.sample({ x: 0, y: 0 }, 0, 96);
  assert.equal(motion.sample({ x: 2, y: 0 }, 16, 96).direction, 'right');
  assert.equal(motion.sample({ x: 4, y: 2.1 }, 32, 96).direction, 'right');
  assert.equal(motion.sample({ x: 6, y: 4.05 }, 48, 96).direction, 'right');
  assert.equal(motion.sample({ x: 6, y: 6 }, 64, 96).direction, 'down');
});

test('every item crop fits inside every atlas frame and keeps the configured visible scale', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/item/v2/index.json', import.meta.url)));
  for (const entry of manifest.items) {
    const [x, y, width, height] = entry.rendering.bounds;
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0, entry.id);
    assert.ok(x + width <= entry.frameWidth && y + height <= entry.frameHeight, entry.id);
    const fitted = fitExtent(width, height, 32 * entry.rendering.sizeTiles);
    assert.ok(Math.abs(fitted.width / fitted.height - width / height) < 1e-8, entry.id);
    assert.ok(Math.abs(Math.max(fitted.width, fitted.height) - 32 * entry.rendering.sizeTiles) < 1e-8, entry.id);
    for (let i = 0; i < entry.frameCount; ++i) {
      const rect = atlasRect(i, entry.columns, entry.frameWidth, entry.frameHeight, entry.rendering.bounds);
      assert.equal(rect[0] % entry.frameWidth, x);
      assert.equal(rect[1] % entry.frameHeight, y);
    }
  }
});

test('HUD clock switches from preparation to defense and never shows negative time', () => {
  const state = { phase: 'preparing', preparation: 30, duration: 570, elapsed: 0 };
  assert.equal(phaseClock(state), '00:30');
  assert.equal(phaseClock({ ...state, elapsed: 29.5 }), '00:01');
  assert.equal(phaseClock({ ...state, phase: 'running', elapsed: 30 }), '09:30');
  assert.equal(phaseClock({ ...state, phase: 'running', elapsed: 605 }), '00:00');
});

test('the portrait attacker marks a door siege, never a chase or a captured cat', () => {
  const player = { id: 2, alive: true, escaping: false, room: 1, sleeping: true };
  const state = { phase: 'running', monster: { state: 'attacking', attackingPlayer: 2 } };
  assert.equal(doorUnderAttack(state, player), true);
  assert.equal(doorUnderAttack({ ...state, monster: { ...state.monster, state: 'chasing' } }, player), false);
  assert.equal(doorUnderAttack(state, { ...player, alive: false }), false);
  assert.equal(doorUnderAttack(state, { ...player, id: 3 }), false);
  assert.equal(playerActivity({ ...player, escaping: true }), '逃跑中');
  assert.equal(playerActivity({ ...player, alive: false }), '已被抱走');
});

test('HUD panels fit the safe viewport with centered time and transient notices', () => {
  for (const [width, height] of [[1280, 720], [720, 1558], [960, 443]]) {
    const boxes = battleHudLayout(width, height);
    for (const box of Object.values(boxes)) {
      assert.ok(box.x >= 0 && box.y >= 0);
      assert.ok(box.x + box.width <= width && box.y + box.height <= height);
    }
    assert.equal(boxes.toast.x + boxes.toast.width / 2, width / 2);
    assert.equal(boxes.toast.y + boxes.toast.height / 2, height / 2);
    const separated = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    assert.equal(boxes.phase.x + boxes.phase.width / 2, width / 2);
    assert.equal(boxes.team.x, 12);
    assert.equal(boxes.team.y, 12);
    for (const [a, b] of [['phase', 'team'], ['phase', 'wallet'], ['phase', 'exit'], ['wallet', 'exit']]) {
      assert.ok(separated(boxes[a], boxes[b]), `${width}: ${a} overlaps ${b}`);
    }
  }
});
