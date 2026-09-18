interface Point {
  x: number;
  y: number;
}
interface MapSize {
  width: number;
  height: number;
  tileSize: number;
}
type CameraMode = 'follow' | 'free' | 'overview';
const OUTSIDE_TILES = 4;
const FOLLOW_FREQUENCY = 12;

/** Client-only camera, measured in world units and CSS pixels (independent of DPR). */
export class GameCamera {
  private width = 0;
  private height = 0;
  private worldWidth = 44 * 32;
  private worldHeight = 36 * 32;
  private tileSize = 32;
  private scale = 1;
  private center: Point = { x: 0, y: 0 };
  private velocity: Point = { x: 0, y: 0 };
  private mode: CameraMode = 'follow';
  private automaticScale = true;

  get following() {
    return this.mode === 'follow';
  }
  reset(map: MapSize, target: Point) {
    this.worldWidth = map.width * map.tileSize;
    this.worldHeight = map.height * map.tileSize;
    this.tileSize = map.tileSize;
    this.follow(target);
  }
  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.hold();
    if (this.mode === 'overview') this.fit();
    else {
      this.scale = this.automaticScale ? this.focusScale() : this.limitScale(this.scale);
      this.center = this.bounded(this.center);
    }
  }
  follow(target: Point) {
    this.mode = 'follow';
    this.automaticScale = true;
    this.scale = this.focusScale();
    this.center = this.bounded(target);
    this.hold();
  }
  track(target: Point, seconds: number) {
    if (!this.following) return;
    const end = this.bounded(target);
    const dt = Math.max(0, Math.min(seconds, 0.1));
    if (!dt) return;
    // Exact critically damped spring: preserve velocity through starts/stops and turns.
    const decay = Math.exp(-FOLLOW_FREQUENCY * dt);
    for (const axis of ['x', 'y'] as const) {
      const offset = this.center[axis] - end[axis];
      const step = (this.velocity[axis] + FOLLOW_FREQUENCY * offset) * dt;
      this.center[axis] = end[axis] + (offset + step) * decay;
      this.velocity[axis] = (this.velocity[axis] - FOLLOW_FREQUENCY * step) * decay;
      if (Math.abs(this.center[axis] - end[axis]) < 0.01 && Math.abs(this.velocity[axis]) < 0.01) {
        this.center[axis] = end[axis];
        this.velocity[axis] = 0;
      }
    }
    const bounded = this.bounded(this.center);
    if (bounded.x !== this.center.x) this.velocity.x = 0;
    if (bounded.y !== this.center.y) this.velocity.y = 0;
    this.center = bounded;
  }
  hold() {
    this.velocity = { x: 0, y: 0 };
  }
  fit() {
    this.mode = 'overview';
    this.automaticScale = false;
    this.scale = this.overviewScale();
    this.center = { x: this.worldWidth / 2, y: this.worldHeight / 2 };
    this.hold();
  }
  drag(dx: number, dy: number) {
    this.mode = 'free';
    this.hold();
    this.center = this.bounded({
      x: this.center.x - dx / this.scale,
      y: this.center.y - dy / this.scale,
    });
  }
  zoomAt(factor: number, x: number, y: number) {
    // In follow mode the cat remains the zoom anchor; free browsing uses the pointer.
    if (this.following) {
      x = this.width / 2;
      y = this.height / 2;
    } else this.mode = 'free';
    const anchor = this.toWorld(x, y);
    this.hold();
    this.automaticScale = false;
    this.scale = this.limitScale(this.scale * factor);
    this.center = this.bounded({
      x: anchor.x - (x - this.width / 2) / this.scale,
      y: anchor.y - (y - this.height / 2) / this.scale,
    });
  }
  transform() {
    return {
      scale: this.scale,
      x: this.width / 2 - this.center.x * this.scale,
      y: this.height / 2 - this.center.y * this.scale,
    };
  }
  toWorld(x: number, y: number) {
    const t = this.transform();
    return { x: (x - t.x) / t.scale, y: (y - t.y) / t.scale };
  }
  private outsideMargin() {
    return OUTSIDE_TILES * this.tileSize;
  }
  private overviewScale() {
    const margin = this.outsideMargin() * 2;
    // Fit the complete playfield and its artwork border on wide and portrait viewports.
    return Math.max(
      0.05,
      Math.min(this.width / (this.worldWidth + margin), this.height / (this.worldHeight + margin)),
    );
  }
  private focusScale() {
    const compact = this.width <= 760;
    const shortSide = Math.min(this.width, this.height);
    const tilePixels = compact
      ? Math.max(28, Math.min(38, shortSide / 12))
      : Math.max(36, Math.min(48, shortSide / 18));
    return Math.max(tilePixels / this.tileSize, this.overviewScale());
  }
  private limitScale(scale: number) {
    return Math.max(
      this.overviewScale(),
      Math.min(Math.max(this.focusScale() * 2, 96 / this.tileSize), scale),
    );
  }
  private bounded(point: Point) {
    const axis = (value: number, viewport: number, world: number) => {
      const inset = viewport / (2 * this.scale) - this.outsideMargin();
      return inset * 2 >= world ? world / 2 : Math.max(inset, Math.min(world - inset, value));
    };
    return { x: axis(point.x, this.width, this.worldWidth), y: axis(point.y, this.height, this.worldHeight) };
  }
}
