import { loadCharacterAnimations } from './animation.js';
import { loadPalettes, PaletteAtlases } from './palette-atlases.js';
import {
  characterKey,
  type AnimationConfig,
  type CharacterCard,
  type CharacterOption,
  type CharacterSelection,
  type Palettes,
} from './types';

type AtlasImage = ImageBitmap | HTMLCanvasElement;
interface CharacterResource {
  config: AnimationConfig;
  palettes: Palettes;
  tint: PaletteAtlases;
  sources: Map<string, Promise<ImageBitmap>>;
}
const ROOT = '/assets/characters/v1/';

// Presentation registry: shared atlases, palette cache and portraits, no player/game rules.
export class CharacterLibrary {
  private resources = new Map<string, Promise<CharacterResource>>();
  private loaded = new Map<string, CharacterResource>();
  private images = new Map<string, AtlasImage>();
  private pending = new Map<string, Promise<void>>();
  private cards = new Map<string, CharacterCard>();
  private index: Promise<{ characters: { id: string; manifest: string }[] }> | null = null;
  onChange: () => void = () => {};

  card(selection: CharacterSelection): CharacterCard | undefined {
    return this.cards.get(characterKey(selection));
  }
  config(id: string): AnimationConfig | undefined {
    return this.loaded.get(id)?.config;
  }
  image(selection: CharacterSelection, action: string): AtlasImage | undefined {
    return this.images.get(`${characterKey(selection)}:${action}`);
  }
  draw(
    context: CanvasRenderingContext2D,
    selection: CharacterSelection,
    action: string,
    index: number,
    x: number,
    y: number,
    height: number,
    mirror = false,
  ): boolean {
    const config = this.config(selection.character);
    const image = this.image(selection, action);
    if (!config || !image) return false;
    const atlas = config.atlases[config.clips[action].atlas];
    const frame = atlas.frames[index];
    const ratio = image.width / atlas.width;
    const scale = height / atlas.sourceBodyHeight;
    context.save();
    context.translate(x, y);
    context.scale(mirror ? -1 : 1, 1);
    context.drawImage(
      image,
      frame.rect[0] * ratio,
      frame.rect[1] * ratio,
      frame.rect[2] * ratio,
      frame.rect[3] * ratio,
      -frame.anchor[0] * scale,
      -frame.anchor[1] * scale,
      frame.rect[2] * scale,
      frame.rect[3] * scale,
    );
    context.restore();
    return true;
  }
  async loadOptions(options: CharacterOption[]): Promise<void> {
    // Serial palette jobs keep mobile peak memory bounded.
    for (const option of options) {
      for (const skin of option.skins) await this.prepare({ character: option.id, skin }, ['idle']);
    }
  }
  async prepare(selection: CharacterSelection, actions?: string[]): Promise<void> {
    const resource = await this.resource(selection.character);
    const palette = resource.palettes.skins.find((skin) => skin.id === selection.skin);
    if (!palette) throw new Error('角色毛色资源缺失：' + selection.skin);
    for (const action of actions ?? Object.keys(resource.config.clips)) {
      const key = `${characterKey(selection)}:${action}`;
      if (this.images.has(key)) continue;
      if (!this.pending.has(key)) {
        const job = (async () => {
          const source = await this.source(resource, action);
          const { image } = await resource.tint.get(action, source, palette);
          this.images.set(key, image);
          if (action === 'idle') {
            const atlas = resource.config.atlases[resource.config.clips.idle.atlas];
            const frame = atlas.frames[0];
            const crop = resource.config.portraitRect ?? [0, 0, frame.rect[2], frame.rect[3]];
            const ratio = image.width / atlas.width;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 160;
            canvas
              .getContext('2d')!
              .drawImage(
                image,
                (frame.rect[0] + crop[0]) * ratio,
                (frame.rect[1] + crop[1]) * ratio,
                crop[2] * ratio,
                crop[3] * ratio,
                0,
                0,
                160,
                160,
              );
            const blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('无法生成角色头像')))),
            );
            this.cards.set(characterKey(selection), {
              ...selection,
              name: palette.name,
              color: palette.fur,
              portrait: URL.createObjectURL(blob),
            });
            this.onChange();
          }
        })().finally(() => this.pending.delete(key));
        this.pending.set(key, job);
      }
      await this.pending.get(key);
    }
  }
  private resource(id: string): Promise<CharacterResource> {
    if (!this.resources.has(id)) {
      const pending = (async () => {
        this.index ??= this.readIndex();
        const entry = (await this.index).characters.find((entry) => entry.id === id);
        if (!entry) throw new Error('角色资源未登记：' + id);
        const config = await loadCharacterAnimations(ROOT + entry.manifest);
        const palettes = await loadPalettes(config.paletteUrl);
        const resource = {
          config,
          palettes,
          tint: new PaletteAtlases(palettes, palettes.skins.length * Object.keys(config.clips).length),
          sources: new Map<string, Promise<ImageBitmap>>(),
        };
        this.loaded.set(id, resource);
        return resource;
      })().catch((error) => {
        this.resources.delete(id);
        throw error;
      });
      this.resources.set(id, pending);
    }
    return this.resources.get(id)!;
  }
  private async readIndex() {
    const response = await fetch(ROOT + 'index.json', { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('无法读取角色资源目录');
    return response.json() as Promise<{ characters: { id: string; manifest: string }[] }>;
  }
  private source(resource: CharacterResource, action: string): Promise<ImageBitmap> {
    if (!resource.sources.has(action)) {
      const pending = (async () => {
        const atlas = resource.config.atlases[resource.config.clips[action].atlas];
        const response = await fetch(atlas.src, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('无法加载角色动作：' + action);
        const original = await createImageBitmap(await response.blob());
        if (original.width !== atlas.width || original.height !== atlas.height) {
          original.close();
          throw new Error('角色图集尺寸与配置不符');
        }
        // 160px per frame is sufficient at the closest game camera; previews retain full size.
        const ratio = Math.min(1, 160 / atlas.frames[0].rect[2]);
        try {
          return await createImageBitmap(original, {
            resizeWidth: Math.round(atlas.width * ratio),
            resizeHeight: Math.round(atlas.height * ratio),
            resizeQuality: 'high',
          });
        } finally {
          original.close();
        }
      })().catch((error) => {
        resource.sources.delete(action);
        throw error;
      });
      resource.sources.set(action, pending);
    }
    return resource.sources.get(action)!;
  }
}
export const characterLibrary = new CharacterLibrary();
