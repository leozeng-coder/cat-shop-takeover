import { Camera, Vec3, view } from 'cc';
import type { GridMap } from '../model/GameTypes';

const OUTSIDE_TILES = 4;
const FOLLOW_FREQUENCY = 12;
const INITIAL_MAP_RATIO = 0.3;

export class FollowCamera {
  private map: GridMap | null = null;
  private center = { x: 0, y: 0 };
  private velocity = { x: 0, y: 0 };
  private dragging = false;

  constructor(private readonly camera: Camera) {}

  reset(map: GridMap, target: { x: number; y: number }): void {
    this.map = map;
    this.camera.orthoHeight = this.focusOrthoHeight(map);
    this.center = this.bound(target);
    this.velocity = { x: 0, y: 0 };
    this.dragging = false;
    this.apply();
  }

  beginDrag(): void {
    this.dragging = true;
    this.velocity = { x: 0, y: 0 };
  }

  dragBy(previous: { x: number; y: number }, current: { x: number; y: number }): void {
    if (!this.map || !this.dragging) return;
    const from = this.camera.screenToWorld(new Vec3(previous.x, previous.y, 0));
    const to = this.camera.screenToWorld(new Vec3(current.x, current.y, 0));
    this.center = this.bound({
      x: this.center.x - (to.x - from.x),
      y: this.center.y + (to.y - from.y),
    });
    this.apply();
  }

  endDrag(): void {
    this.dragging = false;
    this.velocity = { x: 0, y: 0 };
  }

  update(target: { x: number; y: number }, seconds: number, followPlayer: boolean): void {
    if (!this.map || this.dragging || !followPlayer) return;
    const end = this.bound(target);
    const dt = Math.max(0, Math.min(seconds, 0.1));
    const decay = Math.exp(-FOLLOW_FREQUENCY * dt);
    for (const axis of ['x', 'y'] as const) {
      const offset = this.center[axis] - end[axis];
      const step = (this.velocity[axis] + FOLLOW_FREQUENCY * offset) * dt;
      this.center[axis] = end[axis] + (offset + step) * decay;
      this.velocity[axis] = (this.velocity[axis] - FOLLOW_FREQUENCY * step) * decay;
    }
    const bounded = this.bound(this.center);
    if (bounded.x !== this.center.x) this.velocity.x = 0;
    if (bounded.y !== this.center.y) this.velocity.y = 0;
    this.center = bounded;
    this.apply();
  }

  private focusOrthoHeight(map: GridMap): number {
    const viewport = view.getVisibleSize();
    const shortWorld = Math.min(map.width, map.height) * map.tileSize * INITIAL_MAP_RATIO;
    const verticalWorld = viewport.width <= viewport.height ? shortWorld * (viewport.height / viewport.width) : shortWorld;
    const overview = (map.height * map.tileSize + OUTSIDE_TILES * map.tileSize * 2) / 2;
    return Math.min(overview, verticalWorld / 2);
  }

  private bound(point: { x: number; y: number }) {
    if (!this.map) return point;
    const viewport = view.getVisibleSize();
    const halfHeight = this.camera.orthoHeight;
    const halfWidth = halfHeight * (viewport.width / viewport.height);
    const mapWidth = this.map.width * this.map.tileSize;
    const mapHeight = this.map.height * this.map.tileSize;
    const margin = OUTSIDE_TILES * this.map.tileSize;
    const clamp = (value: number, halfView: number, size: number) => {
      const inset = halfView - margin;
      return inset * 2 >= size ? size / 2 : Math.max(inset, Math.min(size - inset, value));
    };
    return { x: clamp(point.x, halfWidth, mapWidth), y: clamp(point.y, halfHeight, mapHeight) };
  }

  private apply(): void {
    if (!this.map) return;
    const width = this.map.width * this.map.tileSize;
    const height = this.map.height * this.map.tileSize;
    this.camera.node.setPosition(new Vec3(this.center.x - width / 2, height / 2 - this.center.y, 1000));
  }
}
