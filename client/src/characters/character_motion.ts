import { sampleClip, walkTime } from './animation.js';
import { MovementMotion } from './movement_motion.ts';
import { presentationStore } from '../render/presentation_store';
import type { AnimationConfig } from './types';

// One controller per actor, independent of packets, destinations and gameplay rules.
export class CharacterMotion {
  private movement = new MovementMotion();
  private sleeping = false;
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
    const { moving, distance, direction } = this.movement.sample(pose, teleportDistance);
    if (pose.sleeping && !this.sleeping) {
      this.sleepAt = now;
      this.wakeAt = -Infinity;
    }
    if (this.sleeping && !pose.sleeping) this.wakeAt = now;
    this.sleeping = pose.sleeping;
    if (moving) {
      // Movement always wins, including escape. Never replay wake after stopping.
      this.wakeAt = -Infinity;
    }
    const wakeDuration =
      config.clips.wake.durationsMs.reduce((a, b) => a + b, 0) /
      presentationStore.get(`characters/${config.id}/wake`).speed;
    const action = pose.sleeping
      ? 'sleep'
      : moving
        ? (config.movementClips?.[direction] ?? 'move')
        : now - this.wakeAt < wakeDuration
          ? 'wake'
          : 'idle';
    if (action === 'idle' && this.action !== 'idle') this.idleAt = now;
    this.action = action;
    const time = pose.sleeping
      ? now - this.sleepAt
      : moving
        ? walkTime(config, distance, action)
        : action === 'wake'
          ? now - this.wakeAt
          : now - this.idleAt;
    return {
      action,
      ...sampleClip(config, action, time),
      mirror: direction === 'right' && config.clips[action].mirrorForRight,
    };
  }
}
