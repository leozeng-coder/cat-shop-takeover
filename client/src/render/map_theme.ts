interface ThemeAsset {
  id: string;
  src: string;
}
interface ThemeManifest {
  version: number;
  id: string;
  assets: ThemeAsset[];
  rendering: ThemeRendering;
}
interface ThemeIndex {
  version: number;
  themes: { id: string; manifest: string }[];
}
interface SurfaceConfig {
  asset: string;
  tilesPerImage: number;
}
interface ThemeRendering {
  background: { asset: string; outsideTiles: number; clearColor: string };
  road: SurfaceConfig;
  wall: SurfaceConfig;
  floors: SurfaceConfig[];
  grid: { color: string; lineWidth: number };
  nightTint: string;
}
export interface TileSurface {
  image: ImageBitmap;
  tilesPerImage: number;
}

const FALLBACK_RENDERING: ThemeRendering = {
  background: { asset: 'background', outsideTiles: 4, clearColor: '#becbb4' },
  road: { asset: 'road', tilesPerImage: 1 },
  wall: { asset: 'wall', tilesPerImage: 1 },
  floors: [],
  grid: { color: '#6d65432e', lineWidth: 0.65 },
  nightTint: '#33495d1a',
};

const THEME_ROOT = '/assets/themes/v1/';
const TILE_TEXTURE_SIZE = 256;

// Presentation assets are independent of game state, collision and network snapshots.
export class MapTheme {
  ready: Promise<void>;
  rendering = FALLBACK_RENDERING;
  private readonly index: Promise<ThemeIndex | null>;
  private textures = new Map<string, ImageBitmap>();
  private floors: (TileSurface | undefined)[] = [];
  private surfaces: { road?: TileSurface; wall?: TileSurface } = {};
  private selectedSeed: number | null = null;
  private loadedTheme = '';
  private generation = 0;

  constructor() {
    this.index = this.loadIndex().catch((error: unknown) => {
      console.warn('Theme index unavailable; using procedural art.', error);
      return null;
    });
    this.ready = this.index.then(() => {});
  }

  select(seed: number): void {
    if (seed === this.selectedSeed) return;
    this.selectedSeed = seed;
    const generation = ++this.generation;
    this.ready = this.index.then(async (index) => {
      if (!index || generation !== this.generation) return;
      // Peers derive the same appearance from authoritative map data and the asset index.
      const entry = index.themes[(seed >>> 0) % index.themes.length];
      if (entry.id === this.loadedTheme) return;
      try {
        await this.load(entry, generation);
      } catch (error) {
        if (generation !== this.generation) return;
        this.replace(new Map(), FALLBACK_RENDERING, '');
        console.warn('Map theme unavailable; using procedural art.', error);
      }
    });
  }

  get background(): ImageBitmap | undefined {
    return this.textures.get(this.rendering.background.asset);
  }

  surface(kind: 'road' | 'wall'): TileSurface | undefined {
    return this.surfaces[kind];
  }

  floor(seed: number, room: number): TileSurface | undefined {
    if (!this.floors.length) return undefined;
    return this.floors[((seed >>> 0) + room) % this.floors.length];
  }

  private async loadIndex(): Promise<ThemeIndex> {
    const indexResponse = await fetch(THEME_ROOT + 'index.json', { signal: AbortSignal.timeout(12000) });
    if (!indexResponse.ok) throw new Error('Theme index: ' + indexResponse.status);
    const index = (await indexResponse.json()) as ThemeIndex;
    if (index.version !== 1 || !Array.isArray(index.themes) || !index.themes.length)
      throw new Error('Invalid theme index');
    return index;
  }

  private replace(textures: Map<string, ImageBitmap>, rendering: ThemeRendering, id: string): void {
    for (const bitmap of this.textures.values()) bitmap.close();
    this.textures = textures;
    this.rendering = rendering;
    const surface = (config: SurfaceConfig): TileSurface | undefined => {
      const image = textures.get(config.asset);
      return image ? { image, tilesPerImage: config.tilesPerImage } : undefined;
    };
    this.floors = rendering.floors.map(surface);
    this.surfaces = { road: surface(rendering.road), wall: surface(rendering.wall) };
    this.loadedTheme = id;
  }

  private async load(entry: ThemeIndex['themes'][number], generation: number): Promise<void> {
    const manifestUrl = new URL(THEME_ROOT + entry.manifest, location.href);
    const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Theme manifest: ' + response.status);
    const manifest = (await response.json()) as ThemeManifest;
    if (manifest.version !== 1 || manifest.id !== entry.id || !Array.isArray(manifest.assets))
      throw new Error('Invalid theme manifest');
    const rendering = manifest.rendering;
    if (!rendering || !Array.isArray(rendering.floors) || !rendering.floors.length)
      throw new Error('Theme requires a floor palette');
    const surfaceConfigs = [rendering.road, rendering.wall, ...rendering.floors];
    const ids = new Set(manifest.assets.map((asset) => asset.id));
    if (
      surfaceConfigs.some(
        (surface) =>
          !surface ||
          !ids.has(surface.asset) ||
          !Number.isInteger(surface.tilesPerImage) ||
          surface.tilesPerImage < 1 ||
          surface.tilesPerImage > 8,
      )
    )
      throw new Error('Invalid surface reference or tilesPerImage (expected 1..8)');
    if (
      !rendering.background ||
      !ids.has(rendering.background.asset) ||
      !Number.isFinite(rendering.background.outsideTiles) ||
      rendering.background.outsideTiles < 0 ||
      !rendering.grid ||
      !Number.isFinite(rendering.grid.lineWidth) ||
      rendering.grid.lineWidth < 0 ||
      !CSS.supports('color', rendering.grid.color) ||
      !CSS.supports('color', rendering.nightTint) ||
      !CSS.supports('color', rendering.background.clearColor)
    )
      throw new Error('Invalid background, grid or lighting settings');
    const used = new Set([rendering.background.asset, ...surfaceConfigs.map((surface) => surface.asset)]);
    const assets = manifest.assets.filter((asset) => used.has(asset.id));
    const textures = new Map<string, ImageBitmap>();
    let next = 0;
    // Bound simultaneous decodes on mobile; only the chosen theme is requested.
    const worker = async () => {
      while (next < assets.length && generation === this.generation) {
        const asset = assets[next++];
        try {
          const imageResponse = await fetch(new URL(asset.src, manifestUrl), {
            signal: AbortSignal.timeout(12000),
          });
          if (!imageResponse.ok) throw new Error('HTTP ' + imageResponse.status);
          const blob = await imageResponse.blob();
          const bitmap = await createImageBitmap(
            blob,
            asset.id === rendering.background.asset
              ? {}
              : { resizeWidth: TILE_TEXTURE_SIZE, resizeHeight: TILE_TEXTURE_SIZE, resizeQuality: 'high' },
          );
          textures.set(asset.id, bitmap);
        } catch (error) {
          console.warn('Map asset unavailable: ' + asset.id, error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, assets.length) }, worker));
    if (generation !== this.generation) {
      for (const bitmap of textures.values()) bitmap.close();
      return;
    }
    this.replace(textures, rendering, entry.id);
  }
}
