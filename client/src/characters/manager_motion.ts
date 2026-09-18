import { clipDuration, sampleClip, walkTime } from './animation.js';
import { MovementMotion } from './movement_motion.ts';
import type { AnimationConfig, CharacterSelection } from './types';

export const MANAGER_CHARACTER: CharacterSelection = { character: 'shop_manager', skin: 'original' };

// The server owns movement and damage. This controller only selects visual frames.
export class ManagerMotion {
  private movement = new MovementMotion();
  private attackSequence: number | null = null;
  private attackAt = -Infinity;
  private action: string | null = null;
  private actionAt = 0;

  sample(
    config: AnimationConfig,
    pose: { x: number; y: number; state: string; attackSequence: number },
    now: number,
    teleportDistance: number,
    active = true,
  ) {
    const { moving, distance, direction } = this.movement.sample(pose, teleportDistance);
    const returning = pose.state === 'retreating' || pose.state === 'defeated';
    const resting = pose.state === 'resting' || pose.state === 'waiting';
    // A new/reconnected view starts from its snapshot without replaying historical hits.
    const hit = this.attackSequence !== null && pose.attackSequence > this.attackSequence;
    this.attackSequence = pose.attackSequence;
    if (hit) this.attackAt = now;
    if (!active || returning || resting) {
      this.attackAt = -Infinity;
    }
    const attacking = now - this.attackAt < clipDuration(config.clips.attack);
    const action =
      !active || resting
        ? 'idle'
        : returning
          ? moving
            ? 'retreat'
            : 'idle'
          : attacking
            ? 'attack'
            : moving
              ? config.movementClips![direction]!
              : 'idle';
    if (action !== this.action) this.actionAt = now;
    this.action = action;
    const time =
      action === 'attack'
        ? now - this.attackAt
        : action === config.movementClips?.[direction]
          ? walkTime(config, distance, action)
          : now - this.actionAt;
    // Separate authored directions preserve the net hand; never mirror this actor.
    return { action, ...sampleClip(config, action, time), mirror: false };
  }
}
