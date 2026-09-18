import type { AnimationConfig } from './types';
export function loadCharacterAnimations(url: string): Promise<AnimationConfig>;
export function clipDuration(clip: AnimationConfig['clips'][string]): number;
export function sampleClip(
  config: AnimationConfig,
  name: string,
  time: number,
): { atlas: AnimationConfig['atlases'][string]; frame: number; index: number };
export function walkTime(config: AnimationConfig, distance: number, action?: string): number;
export function validateManifest(config: AnimationConfig): void;
