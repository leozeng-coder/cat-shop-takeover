export type AudioCategory =
  "ui" | "character" | "item" | "door" | "match" | "music";
export interface AudioClip {
  id: string;
  name: string;
  category: AudioCategory;
  file: string;
  duration: number;
  bytes: number;
  enabled: boolean;
}
export interface AudioBinding {
  event: string;
  target: string;
  clip: string;
  enabled: boolean;
  volume: number;
  /** Older catalogs without this field play at the original speed. */
  playbackRate?: number;
  cooldownMs: number;
  maxVoices: number;
  range: number;
}
export interface AudioSettings {
  enabled: boolean;
  masterVolume: number;
  effectsVolume: number;
  musicVolume: number;
}
export interface AudioTables {
  clips: AudioClip[];
  bindings: AudioBinding[];
  settings: AudioSettings;
}
export interface AudioCatalog extends AudioTables {
  revision: string;
}
export interface AudioEventDefinition {
  id: string;
  name: string;
  category: AudioCategory;
}
export interface AudioWorkspace {
  current: AudioCatalog;
  draft: { revision: string; baseRevision: string; tables: AudioTables };
  events: AudioEventDefinition[];
  conflict: boolean;
}
export interface PresentationEvent {
  id: number;
  time: number;
  type: string;
  target: string;
  player: number;
  x: number;
  y: number;
}
