export async function loadPalettes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('无法读取毛色配置');
  const config = await response.json();
  if (!Array.isArray(config.skins)) throw new Error('毛色配置缺少列表');
  const ids = new Set();
  for (const skin of config.skins) {
    if (!skin.id || ids.has(skin.id)) throw new Error('毛色 ID 必须唯一');
    ids.add(skin.id);
    if (![skin.fur, skin.stripe, skin.highlight, skin.white].every((color) => /^#[\da-f]{6}$/i.test(color)))
      throw new Error('毛色颜色配置无效：' + skin.id);
  }
  if (!ids.has(config.default)) throw new Error('缺少默认毛色');
  return config;
}

export async function loadSkinAtlases(config, palettes) {
  const response = await fetch(config.skinAtlasesUrl, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('无法读取预生成角色图集，请先同步资源');
  const index = await response.json();
  if (index.version !== 1 || !index.skins || typeof index.skins !== 'object')
    throw new Error('预生成角色图集配置无效');
  const skins = Object.create(null);
  for (const skin of palettes.skins) {
    const actions = Object.create(null);
    for (const action of Object.keys(config.clips)) {
      const src = index.skins[skin.id]?.[action];
      if (typeof src !== 'string' || !src) throw new Error(`缺少预生成角色图集：${skin.id}/${action}`);
      actions[action] = new URL(src, config.manifestUrl).href;
    }
    skins[skin.id] = actions;
  }
  return { version: 1, skins };
}

export function skinAtlasUrl(atlases, skin, action) {
  const src = atlases.skins[skin]?.[action];
  if (!src) throw new Error(`缺少预生成角色图集：${skin}/${action}`);
  return src;
}

// Full-resolution preview cache. Images evicted during a pending selection remain
// usable by that caller until its revision check discards the result.
export class BakedAtlases {
  constructor(config, atlases, capacity = 4) {
    this.config = config;
    this.atlases = atlases;
    this.capacity = capacity;
    this.cache = new Map();
    this.inflight = new Map();
    this.pinned = '';
  }

  async get(action, skin) {
    const key = `${skin}:${action}`;
    if (this.cache.has(key)) {
      const image = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, image);
      return { key, image };
    }
    if (!this.inflight.has(key)) {
      const pending = (async () => {
        const src = skinAtlasUrl(this.atlases, skin, action);
        const atlas = this.config.atlases[this.config.clips[action].atlas];
        const response = await fetch(src, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`无法加载角色图集：${skin}/${action}`);
        const url = URL.createObjectURL(await response.blob());
        const image = new Image();
        try {
          image.src = url;
          await image.decode();
        } finally {
          URL.revokeObjectURL(url);
        }
        if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height)
          throw new Error('角色图集尺寸与配置不符');
        this.cache.set(key, image);
        this.trim(key);
        return { key, image };
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return this.inflight.get(key);
  }

  pin(key) {
    this.pinned = key;
    this.trim(key);
  }

  trim(protectedKey) {
    for (const key of this.cache.keys()) {
      if (this.cache.size <= this.capacity) break;
      if (key !== this.pinned && key !== protectedKey) this.cache.delete(key);
    }
  }
}
