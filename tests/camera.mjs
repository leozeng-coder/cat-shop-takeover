import assert from 'node:assert/strict';
import { GameCamera } from '../client/src/render/game_camera.ts';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
for (const [width, height] of [
  [44, 36],
  [52, 40],
  [48, 44],
]) {
  for (const [vw, vh, initial, closest] of [
    [1280, 526, 0.3, 0.15],
    [390, 626, 0.24, 0.12],
  ]) {
    const map = { width, height, tileSize: 32 };
    const camera = new GameCamera();
    camera.resize(vw, vh);
    camera.reset(map, { x: width * 16, y: height * 16 });
    const visibleTiles = () => Math.min(vw, vh) / camera.transform().scale / 32;
    close(visibleTiles(), Math.min(width, height) * initial);
    camera.zoomAt(1000, vw / 2, vh / 2);
    close(visibleTiles(), Math.min(width, height) * closest);
    // Following the corner allows only the configured four-cell decorative border.
    for (let frame = 0; frame < 240; frame++) camera.track({ x: 16, y: 16 }, 1 / 60);
    assert.ok(camera.toWorld(0, 0).x >= -4 * 32 && camera.toWorld(0, 0).y >= -4 * 32);
    camera.drag(100000, 100000);
    close(camera.toWorld(0, 0).x, -4 * 32);
    close(camera.toWorld(0, 0).y, -4 * 32);
    camera.fit();
    const overview = Math.min(vw / ((width + 8) * 32), vh / ((height + 8) * 32));
    close(camera.transform().scale, overview);
    camera.zoomAt(0.001, 0, 0);
    close(camera.transform().scale, overview);
    // Manual zoom preserves the grid coverage when the viewport changes proportionally.
    camera.follow({ x: width * 16, y: height * 16 });
    camera.zoomAt(1.2, vw / 2, vh / 2);
    const before = camera.transform().scale;
    camera.resize(vw * 1.1, vh * 1.1);
    close(camera.transform().scale, before * 1.1);
  }
}
console.log('PASS grid-relative default/closest camera, full-map overview, border limits and resize');
