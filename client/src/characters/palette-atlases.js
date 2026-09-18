import { preparePalette, recolorPixels } from './palette-colors.js';

export async function loadPalettes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('无法读取毛色配置');
  const config = await response.json();
  const ids = new Set();
  for (const skin of config.skins) {
    if (!skin.id || ids.has(skin.id)) throw new Error('毛色 ID 必须唯一');
    ids.add(skin.id);
    preparePalette(skin, config.source);
  }
  if (!ids.has(config.default)) throw new Error('缺少默认毛色');
  return config;
}

export class PaletteAtlases {
  constructor(palettes, capacity = 4) {
    this.palettes = palettes;
    this.capacity = capacity;
    this.cache = new Map();
    this.inflight = new Map();
    this.jobs = new Map();
    this.nextId = 0;
    this.pinned = '';
    this.worker = null;
    if (
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap !== 'undefined'
    ) {
      try {
        this.worker = new Worker(new URL('./palette-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => {
          const job = this.jobs.get(data.id);
          if (!job) {
            data.image?.close();
            return;
          }
          this.jobs.delete(data.id);
          if (data.error) job.reject(new Error(data.error));
          else job.resolve(data.image);
        };
        this.worker.onerror = (event) => {
          event.preventDefault();
          this.worker.terminate();
          this.worker = null;
          for (const job of this.jobs.values()) job.reject(new Error('换色工作线程不可用'));
          this.jobs.clear();
        };
      } catch {
        this.worker = null;
      }
    }
  }

  async tint(image, skin, rect) {
    if (this.worker) {
      try {
        const bitmap = rect ? await createImageBitmap(image, ...rect) : await createImageBitmap(image);
        if (!this.worker) {
          bitmap.close();
          throw new Error('Worker unavailable');
        }
        const id = ++this.nextId;
        return await new Promise((resolve, reject) => {
          this.jobs.set(id, { resolve, reject });
          try {
            this.worker.postMessage({ id, image: bitmap, skin, source: this.palettes.source }, [bitmap]);
          } catch (error) {
            this.jobs.delete(id);
            bitmap.close();
            reject(error);
          }
        });
      } catch {
        /* Same mapping in short batches on browsers without worker canvas support. */
      }
    }
    const [x, y, width, height] = rect || [0, 0, image.width, image.height];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const prepared = preparePalette(skin, this.palettes.source);
    const batch = width * 32 * 4;
    for (let offset = 0; offset < pixels.data.length; offset += batch) {
      recolorPixels(pixels.data, prepared, offset, Math.min(pixels.data.length, offset + batch));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  async get(action, image, skin) {
    const key = `${action}:${skin.id}`;
    if (skin.original) return { key, image };
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { key, image: cached };
    }
    if (!this.inflight.has(key)) {
      const pending = this.tint(image, skin)
        .then((result) => {
          this.cache.set(key, result);
          this.trim(key);
          return { key, image: result };
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return this.inflight.get(key);
  }

  pin(key) {
    this.pinned = key;
    this.trim(key);
  }

  trim(protectedKey) {
    for (const [key, image] of this.cache) {
      if (this.cache.size <= this.capacity) break;
      if (key === this.pinned || key === protectedKey) continue;
      image.close?.();
      this.cache.delete(key);
    }
  }

  dispose() {
    this.worker?.terminate();
    for (const job of this.jobs.values()) job.reject(new Error('预览已关闭'));
    this.jobs.clear();
    for (const image of this.cache.values()) image.close?.();
    this.cache.clear();
  }
}
