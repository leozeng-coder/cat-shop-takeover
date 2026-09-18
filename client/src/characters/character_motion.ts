import { sampleClip, walkTime } from './animation.js';
import type { AnimationConfig } from './types';

// One controller per actor, independent of packets, destinations and gameplay rules.
export class CharacterMotion {
  private previous: { x: number; y: number; sleeping: boolean } | null = null;
  private distance = 0;
  private direction: 'left' | 'right' | 'up' | 'down' = 'down';
  private wakeAt = -Infinity;
  private sleepAt = 0;
  private idleAt = 0;
  private action: string | null = null;

  sample(
    config: AnimationConfig,
    pose: { x: number; y: number; sleeping: boolean },
    now: number,
    teleportDistance: number,
  ) {
    const previous = this.previous;
    this.previous = { ...pose };
    const dx = previous ? pose.x - previous.x : 0;
    const dy = previous ? pose.y - previous.y : 0;
    const distance = Math.hypot(dx, dy);
    const moving = distance > 0.001 && distance < teleportDistance;
    if (pose.sleeping && !previous?.sleeping) {
      this.sleepAt = now;
      this.wakeAt = -Infinity;
    }
    if (previous?.sleeping && !pose.sleeping) this.wakeAt = now;
    if (moving) {
      this.distance += distance;
      // Retain the current axis near diagonals to avoid flickering between views.
      const horizontal = this.direction === 'left' || this.direction === 'right';
      const keepHorizontal = horizontal
        ? Math.abs(dy) <= Math.abs(dx) * 1.15
        : Math.abs(dx) > Math.abs(dy) * 1.15;
      this.direction = keepHorizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      // Movement always wins, including escape. Never replay wake after stopping.
      this.wakeAt = -Infinity;
    }
    const wakeDuration = config.clips.wake.durationsMs.reduce((a, b) => a + b, 0);
    const action = pose.sleeping
      ? 'sleep'
      : moving
        ? (config.movementClips?.[this.direction] ?? 'move')
        : now - this.wakeAt < wakeDuration
          ? 'wake'
          : 'idle';
    if (action === 'idle' && this.action !== 'idle') this.idleAt = now;
    this.action = action;
    const time = pose.sleeping
      ? now - this.sleepAt
      : moving
        ? walkTime(config, this.distance, action)
        : action === 'wake'
          ? now - this.wakeAt
          : now - this.idleAt;
    return {
      action,
      ...sampleClip(config, action, time),
      mirror: this.direction === 'right' && config.clips[action].mirrorForRight,
    };
  }
}
