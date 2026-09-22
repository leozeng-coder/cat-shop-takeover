export type MoveDirection = 'left' | 'right' | 'up' | 'down';

/** A continuous stride shared by all directions, independent of packet and render frequency. */
export class Locomotion {
  private previous: { x: number; y: number } | null = null;
  private distance = 0;
  private direction: MoveDirection = 'down';
  private lastMoved = -Infinity;

  sample(pose: { x: number; y: number }, now: number, teleportDistance: number) {
    const dx = this.previous ? pose.x - this.previous.x : 0;
    const dy = this.previous ? pose.y - this.previous.y : 0;
    this.previous = { x: pose.x, y: pose.y };
    const step = Math.hypot(dx, dy);
    const advanced = step > 0.001 && step < teleportDistance;
    if (advanced) {
      this.distance += step;
      this.lastMoved = now;
      const horizontal = this.direction === 'left' || this.direction === 'right';
      const keepHorizontal = horizontal ? Math.abs(dy) <= Math.abs(dx) * 1.15 : Math.abs(dx) > Math.abs(dy) * 1.15;
      this.direction = keepHorizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    } else if (step >= teleportDistance) this.lastMoved = -Infinity;
    // Hold the pose through a brief snapshot gap without resetting the idle/walk clocks.
    return { advanced, moving: now - this.lastMoved < 120, distance: this.distance, direction: this.direction };
  }
}
