export interface CharacterSelection {
  character: string;
  skin: string;
}
export interface CharacterOption {
  id: string;
  skins: string[];
}
export interface CharacterCard extends CharacterSelection {
  name: string;
  color: string;
  portrait: string;
}
export interface Palette {
  id: string;
  name: string;
  original?: boolean;
  fur: string;
  stripe: string;
  highlight: string;
  white: string;
}
export interface Palettes {
  default: string;
  skins: Palette[];
  source: Record<string, number[]>;
}
export interface AnimationConfig {
  manifestUrl: string;
  skinAtlasesUrl: string;
  profile?: 'cat' | 'shop_manager';
  portraitRect?: [number, number, number, number];
  strideWorldUnits: number;
  movementClips?: Partial<Record<'left' | 'right' | 'up' | 'down', string>>;
  retreatClips?: Partial<Record<'left' | 'right' | 'up' | 'down', string>>;
  paletteUrl: string;
  atlases: Record<
    string,
    {
      src: string;
      width: number;
      height: number;
      sourceBodyHeight: number;
      frames: { rect: [number, number, number, number]; anchor: [number, number] }[];
    }
  >;
  clips: Record<
    string,
    {
      atlas: string;
      frames: number[];
      durationsMs: number[];
      loop: boolean;
      facing: string;
      mirrorForRight: boolean;
    }
  >;
}
export interface SkinAtlases {
  version: 1;
  skins: Record<string, Record<string, string>>;
}
export function characterKey(selection: CharacterSelection): string {
  return `${selection.character}:${selection.skin}`;
}
