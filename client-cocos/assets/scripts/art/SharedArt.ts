import {
  AssetManager,
  Asset,
  JsonAsset,
  Rect,
  Size,
  SpriteFrame,
  Vec2,
  assetManager,
} from 'cc';
import type { CharacterSelection } from '../model/GameTypes';

interface ThemeAssetEntry {
  id: string;
  src: string;
}

interface SurfaceConfig {
  asset: string;
  tilesPerImage: number;
}

interface ThemeManifest {
  id: string;
  assets: ThemeAssetEntry[];
  rendering: {
    background: { asset: string; outsideTiles: number; clearColor: string };
    road: SurfaceConfig;
    wall: SurfaceConfig;
    floors: SurfaceConfig[];
    grid: { color: string; lineWidth: number };
    nightTint: string;
  };
}

interface AnimationEntry {
  src: string;
  columns: number;
  frameCount: number;
  durationsMs: number[];
  loop: boolean;
  mirrorForRight?: boolean;
}

interface CharacterManifest {
  id: string;
  profile?: 'cat' | 'shop_manager';
  skinAtlases: string;
  frameSize: [number, number];
  anchor: [number, number];
  referenceHeight: number;
  movementClips: Record<'left' | 'right' | 'up' | 'down', string>;
  retreatClips?: Record<'left' | 'right' | 'up' | 'down', string>;
  animations: Record<string, AnimationEntry>;
}

interface SkinAtlasManifest {
  skins: Record<string, Record<string, string>>;
}

interface ItemEntry {
  id: string;
  src: string;
  columns: number;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  frameDurationMs: number;
}

interface ItemManifest {
  items: ItemEntry[];
}

export interface AnimationClip {
  frames: SpriteFrame[];
  durationsMs: number[];
  loop: boolean;
  mirrorForRight: boolean;
}

export interface CharacterArt {
  id: string;
  profile: 'cat' | 'shop_manager';
  anchor: Vec2;
  frameSize: Size;
  referenceHeight: number;
  movementClips: CharacterManifest['movementClips'];
  retreatClips?: CharacterManifest['retreatClips'];
  clips: Record<string, AnimationClip>;
}

export interface ThemeArt {
  id: string;
  background: SpriteFrame;
  road: SpriteFrame;
  wall: SpriteFrame;
  floors: SpriteFrame[];
  outsideTiles: number;
  clearColor: string;
  nightTint: string;
  gridColor: string;
  gridLineWidth: number;
}

function withoutExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

function loadBundle(name: string): Promise<AssetManager.Bundle> {
  const loaded = assetManager.getBundle(name);
  if (loaded) return Promise.resolve(loaded);
  return new Promise((resolve, reject) => {
    assetManager.loadBundle(name, (error, bundle) => (error || !bundle ? reject(error) : resolve(bundle)));
  });
}

type AssetConstructor<T extends Asset> = new (...args: any[]) => T;

function loadAsset<T extends Asset>(bundle: AssetManager.Bundle, path: string, type: AssetConstructor<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    bundle.load(path, type, (error, asset) => (error || !asset ? reject(error) : resolve(asset)));
  });
}

async function loadJson<T>(bundle: AssetManager.Bundle, path: string): Promise<T> {
  const asset = await loadAsset(bundle, path, JsonAsset);
  return asset.json as T;
}

function loadSpriteFrame(bundle: AssetManager.Bundle, path: string): Promise<SpriteFrame> {
  return loadAsset(bundle, `${withoutExtension(path)}/spriteFrame`, SpriteFrame);
}

function sliceAtlas(source: SpriteFrame, columns: number, count: number, width: number, height: number): SpriteFrame[] {
  const texture = source.texture;
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const frame = new SpriteFrame();
    frame.reset({
      texture,
      rect: new Rect(column * width, texture.height - (row + 1) * height, width, height),
      originalSize: new Size(width, height),
      offset: Vec2.ZERO,
      isRotate: false,
    });
    return frame;
  });
}

export function sampleClip(clip: AnimationClip, elapsedMs: number): SpriteFrame {
  const total = clip.durationsMs.reduce((sum, value) => sum + value, 0);
  let remaining = clip.loop ? ((elapsedMs % total) + total) % total : Math.min(Math.max(elapsedMs, 0), total - 0.001);
  let frame = 0;
  while (frame < clip.frames.length - 1 && remaining >= clip.durationsMs[frame]) {
    remaining -= clip.durationsMs[frame++];
  }
  return clip.frames[frame];
}

export class SharedArt {
  private readonly bundles = new Map<string, Promise<AssetManager.Bundle>>();
  private readonly themes = new Map<string, Promise<ThemeArt>>();
  private readonly themeBackdrops = new Map<string, Promise<SpriteFrame>>();
  private readonly characters = new Map<string, Promise<CharacterArt>>();
  private readonly characterPortraits = new Map<string, Promise<SpriteFrame>>();
  private readonly items = new Map<string, Promise<AnimationClip>>();
  private readonly doors = new Map<string, Promise<SpriteFrame>>();
  private itemManifest: Promise<ItemManifest> | null = null;

  theme(id: string): Promise<ThemeArt> {
    let result = this.themes.get(id);
    if (!result) {
      result = this.loadTheme(id);
      this.themes.set(id, result);
    }
    return result;
  }

  themeBackdrop(id: string): Promise<SpriteFrame> {
    let result = this.themeBackdrops.get(id);
    if (!result) {
      result = this.bundle('game-themes').then((bundle) =>
        loadSpriteFrame(bundle, `v1/${id}/background.png`),
      );
      this.themeBackdrops.set(id, result);
    }
    return result;
  }

  character(selection: CharacterSelection): Promise<CharacterArt> {
    const key = `${selection.character}:${selection.skin}`;
    let result = this.characters.get(key);
    if (!result) {
      result = this.loadCharacter(selection);
      this.characters.set(key, result);
    }
    return result;
  }

  characterPortrait(selection: CharacterSelection): Promise<SpriteFrame> {
    const key = `${selection.character}:${selection.skin}`;
    let result = this.characterPortraits.get(key);
    if (!result) {
      result = this.loadCharacterPortrait(selection);
      this.characterPortraits.set(key, result);
    }
    return result;
  }

  item(appearance: string): Promise<AnimationClip> {
    let result = this.items.get(appearance);
    if (!result) {
      result = this.loadItem(appearance);
      this.items.set(appearance, result);
    }
    return result;
  }

  door(appearance: string, state: 'closed' | 'open' | 'damaged_1' | 'damaged_2'): Promise<SpriteFrame> {
    const key = `${appearance}:${state}`;
    let result = this.doors.get(key);
    if (!result) {
      result = this.bundle('game-items').then((bundle) =>
        loadSpriteFrame(bundle, `v2/door/${appearance}/${state}.png`),
      );
      this.doors.set(key, result);
    }
    return result;
  }

  private bundle(name: string): Promise<AssetManager.Bundle> {
    let result = this.bundles.get(name);
    if (!result) {
      result = loadBundle(name);
      this.bundles.set(name, result);
    }
    return result;
  }

  private async loadTheme(id: string): Promise<ThemeArt> {
    const bundle = await this.bundle('game-themes');
    const manifest = await loadJson<ThemeManifest>(bundle, `v1/${id}/theme`);
    if (!manifest || manifest.id !== id || !manifest.rendering?.floors?.length) throw new Error(`Invalid theme: ${id}`);
    const byId = new Map(manifest.assets.map((asset) => [asset.id, asset.src]));
    const load = (asset: string) => {
      const src = byId.get(asset);
      if (!src) throw new Error(`Missing theme asset: ${asset}`);
      return loadSpriteFrame(bundle, `v1/${id}/${src}`);
    };
    const [background, road, wall, ...floors] = await Promise.all([
      load(manifest.rendering.background.asset),
      load(manifest.rendering.road.asset),
      load(manifest.rendering.wall.asset),
      ...manifest.rendering.floors.map((entry) => load(entry.asset)),
    ]);
    return {
      id,
      background,
      road,
      wall,
      floors,
      outsideTiles: manifest.rendering.background.outsideTiles,
      clearColor: manifest.rendering.background.clearColor,
      nightTint: manifest.rendering.nightTint,
      gridColor: manifest.rendering.grid.color,
      gridLineWidth: manifest.rendering.grid.lineWidth,
    };
  }

  private async loadCharacter(selection: CharacterSelection): Promise<CharacterArt> {
    const bundle = await this.bundle('game-characters');
    const root = `v1/${selection.character}`;
    const manifest = await loadJson<CharacterManifest>(bundle, `${root}/manifest`);
    const skins = await loadJson<SkinAtlasManifest>(bundle, `${root}/${withoutExtension(manifest.skinAtlases)}`);
    const skin = skins.skins[selection.skin] ?? skins.skins[Object.keys(skins.skins)[0]];
    if (!skin) throw new Error(`Unknown character skin: ${selection.character}/${selection.skin}`);
    const clips: Record<string, AnimationClip> = {};
    await Promise.all(
      Object.entries(manifest.animations).map(async ([name, animation]) => {
        const source = await loadSpriteFrame(bundle, `${root}/${skin[name] ?? animation.src}`);
        clips[name] = {
          frames: sliceAtlas(
            source,
            animation.columns,
            animation.frameCount,
            manifest.frameSize[0],
            manifest.frameSize[1],
          ),
          durationsMs: animation.durationsMs,
          loop: animation.loop,
          mirrorForRight: animation.mirrorForRight === true,
        };
      }),
    );
    return {
      id: manifest.id,
      profile: manifest.profile ?? 'cat',
      anchor: new Vec2(manifest.anchor[0] / manifest.frameSize[0], 1 - manifest.anchor[1] / manifest.frameSize[1]),
      frameSize: new Size(manifest.frameSize[0], manifest.frameSize[1]),
      referenceHeight: manifest.referenceHeight,
      movementClips: manifest.movementClips,
      retreatClips: manifest.retreatClips,
      clips,
    };
  }

  private async loadCharacterPortrait(selection: CharacterSelection): Promise<SpriteFrame> {
    const bundle = await this.bundle('game-characters');
    const root = `v1/${selection.character}`;
    const manifest = await loadJson<CharacterManifest>(bundle, `${root}/manifest`);
    const skins = await loadJson<SkinAtlasManifest>(bundle, `${root}/${withoutExtension(manifest.skinAtlases)}`);
    const path = skins.skins[selection.skin]?.idle;
    const idle = manifest.animations.idle;
    if (!path || !idle) throw new Error(`Missing cat portrait: ${selection.character}/${selection.skin}`);
    const atlas = await loadSpriteFrame(bundle, `${root}/${path}`);
    return sliceAtlas(atlas, idle.columns, 1, manifest.frameSize[0], manifest.frameSize[1])[0];
  }

  private async loadItem(appearance: string): Promise<AnimationClip> {
    const bundle = await this.bundle('game-items');
    this.itemManifest ??= loadJson<ItemManifest>(bundle, 'v2/index');
    const manifest = await this.itemManifest;
    const entry = manifest.items.find((item) => item.id === appearance);
    if (!entry) throw new Error(`Unknown item appearance: ${appearance}`);
    const source = await loadSpriteFrame(bundle, `v2/${entry.src}`);
    return {
      frames: sliceAtlas(source, entry.columns, entry.frameCount, entry.frameWidth, entry.frameHeight),
      durationsMs: Array.from({ length: entry.frameCount }, () => Math.max(1, entry.frameDurationMs)),
      loop: entry.frameCount > 1,
      mirrorForRight: false,
    };
  }
}
