import type { AnimationConfig, Palettes, SkinAtlases } from './types';
export function loadPalettes(url: string): Promise<Palettes>;
export function loadSkinAtlases(config: AnimationConfig, palettes: Palettes): Promise<SkinAtlases>;
export function skinAtlasUrl(atlases: SkinAtlases, skin: string, action: string): string;
export class BakedAtlases {
  constructor(config: AnimationConfig, atlases: SkinAtlases, capacity?: number);
  get(action: string, skin: string): Promise<{ key: string; image: HTMLImageElement }>;
  pin(key: string): void;
}
