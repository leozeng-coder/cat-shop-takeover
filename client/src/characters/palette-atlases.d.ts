import type { Palettes, Palette } from './types';
export function loadPalettes(url: string): Promise<Palettes>;
export class PaletteAtlases {
  constructor(palettes: Palettes, capacity?: number);
  get(
    action: string,
    image: ImageBitmap,
    skin: Palette,
  ): Promise<{ key: string; image: ImageBitmap | HTMLCanvasElement }>;
  dispose(): void;
}
