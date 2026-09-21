import { visualTime } from '../../../shared/presentation';
import { DOOR_VISUAL_SCALE, drawGroundShadow, drawVisualImage } from '../../../shared/visual_canvas';
import { presentationStore } from './presentation_store';

interface ItemEntry {
  id: string;
  src: string;
  columns: number;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  frameDurationMs: number;
}
interface DoorEntry {
  id: string;
}

class VisualAssets {
  private doors = new Set<string>();
  private items = new Map<string, ItemEntry>();
  private images = new Map<string, HTMLImageElement>();

  constructor() {
    void this.load();
  }

  private async load() {
    const [doors, items] = await Promise.all([
      fetch('/assets/item/v2/door/index.json')
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
      fetch('/assets/item/v2/index.json')
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]);
    for (const door of (doors?.doors ?? []) as DoorEntry[]) this.doors.add(door.id);
    for (const item of (items?.items ?? []) as ItemEntry[]) {
      if (item.src && item.columns > 0 && item.frameCount > 0) this.items.set(item.id, item);
    }
  }

  private image(src: string): HTMLImageElement | undefined {
    if (!src) return undefined;
    let image = this.images.get(src);
    if (!image) {
      image = new Image();
      image.src = src;
      this.images.set(src, image);
    }
    return image.complete && image.naturalWidth ? image : undefined;
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    src: string,
    id: string,
    x: number,
    y: number,
    size: number,
    source?: readonly [number, number, number, number],
  ): boolean {
    const image = this.image(src);
    if (!image) return false;
    const settings = presentationStore.get(id);
    drawVisualImage(ctx, image, settings, x, y, size, source);
    return true;
  }

  item(
    ctx: CanvasRenderingContext2D,
    appearance: string,
    x: number,
    y: number,
    size: number,
    time: number,
  ): boolean {
    const item = this.items.get(appearance);
    if (!item) return false;
    const image = this.image(`/assets/item/v2/${item.src}`);
    if (!image) return false;
    const id = `items/prop/${appearance}`;
    const settings = presentationStore.get(id);
    const duration = Math.max(1, item.frameDurationMs);
    const phase = item.frameCount === 1 ? 0 : visualTime(time, item.frameCount * duration, settings) / duration;
    const index = Math.min(item.frameCount - 1, Math.floor(phase));
    const source = (frame: number): [number, number, number, number] => [
      (frame % item.columns) * item.frameWidth,
      Math.floor(frame / item.columns) * item.frameHeight,
      item.frameWidth,
      item.frameHeight,
    ];
    if (item.frameCount > 1) drawGroundShadow(ctx, settings, x, y, size);
    drawVisualImage(ctx, image, settings, x, y, size, source(index));
    return true;
  }

  door(
    ctx: CanvasRenderingContext2D,
    appearance: string,
    state: string,
    x: number,
    y: number,
    size: number,
  ): boolean {
    if (!this.doors.has(appearance)) return false;
    return this.draw(
      ctx,
      `/assets/item/v2/door/${appearance}/${state}.png`,
      `items/door/${appearance}/${state}`,
      x,
      y,
      size * DOOR_VISUAL_SCALE,
    );
  }
}

export const visualAssets = new VisualAssets();
