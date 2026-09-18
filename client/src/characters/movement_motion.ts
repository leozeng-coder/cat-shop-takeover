// Track rendered movement, not destinations or packet frequency.
export class MovementMotion {
  private previous: { x: number; y: number } | null = null;
  private distance = 0;
  private direction: 'left' | 'right' | 'up' | 'down' = 'down';

  sample(pose: { x: number; y: number }, teleportDistance: number) {
    const dx = this.previous ? pose.x - this.previous.x : 0;
    const dy = this.previous ? pose.y - this.previous.y : 0;
    this.previous = { x: pose.x, y: pose.y };
    const distance = Math.hypot(dx, dy);
    const moving = distance > 0.001 && distance < teleportDistance;
    if (moving) {
      this.distance += distance;
      // Retain the current axis near diagonals to avoid flickering between views.
      const horizontal = this.direction === 'left' || this.direction === 'right';
      const keepHorizontal = horizontal
        ? Math.abs(dy) <= Math.abs(dx) * 1.15
        : Math.abs(dx) > Math.abs(dy) * 1.15;
      this.direction = keepHorizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    }
    return { moving, distance: this.distance, direction: this.direction };
  }
}
