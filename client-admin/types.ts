export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = Record<string, Json>;
export type Tables = Record<string, Json>;
export interface Workspace {
  current: {
    tables: Tables;
    revision: string;
    version: string;
    release: string;
  };
  draft: {
    tables: Tables;
    revision: string;
    baseRevision: string;
    updatedAt: string;
  };
  conflict: boolean;
}
export interface Release {
  id: string;
  version: string;
  createdAt: string;
  note: string;
  rollbackFrom: string;
}
export interface CharacterAsset {
  id: string;
  profile: string;
  frameSize: number[];
  animations: Record<
    string,
    { frameCount: number; durationsMs: number[]; loop: boolean; facing: string }
  >;
  movementClips: Record<string, string>;
  retreatClips?: Record<string, string>;
  palettes: { skins: { id: string; name: string; fur: string }[] };
}
export interface ThemeAsset {
  id: string;
  name: string;
  assets: {
    id: string;
    name: string;
    src: string;
    width: number;
    height: number;
  }[];
}
export interface Assets {
  sourceRoot: string;
  urlPrefix: string;
  characters: CharacterAsset[];
  themes: ThemeAsset[];
}
export interface ClientTarget {
  id: string;
  name: string;
  assetRoot: string;
  available: boolean;
  sourceMatches: boolean;
  integration: string;
  configPath: string;
  problem: string;
}
export type FieldPath = (string | number)[];
