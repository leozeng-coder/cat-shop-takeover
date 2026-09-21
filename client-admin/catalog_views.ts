import { mapSettings } from "./map_editor";
import { escape as e } from "./editor";
import { icon } from "./navigation";
import type {
  Assets,
  CharacterAsset,
  Row,
  ThemeAsset,
  Workspace,
} from "./types";

export function characterPreview(character: CharacterAsset) {
  const clip =
    character.animations.idle ?? Object.values(character.animations)[0];
  if (!clip) return icon("cat");
  const [width, height] = character.frameSize;
  // Clip in frame coordinates. Clipping only the outer responsive viewport lets
  // neighbouring atlas frames show through its horizontal letterboxing.
  return `<svg class="sprite-thumbnail" viewBox="0 0 ${width} ${height}" aria-hidden="true"><svg width="${width}" height="${height}" overflow="hidden"><image href="${e(character.assetBaseUrl + clip.src)}" width="${width * clip.columns}" height="${height * Math.ceil(clip.frameCount / clip.columns)}"/></svg></svg>`;
}

export function themePreview(theme: ThemeAsset | undefined) {
  const image =
    theme?.assets.find((a) => a.id === "background") ?? theme?.assets[0];
  return image
    ? `<img loading="lazy" src="${e(image.src)}" alt="${e(theme?.name)}">`
    : icon("map");
}

export function mapsView(w: Workspace, assets: Assets, selected: number) {
  const data = w.draft.tables.map_generation as Row;
  const profiles = data.profiles as Row[];
  const index = Math.min(Math.max(selected, 0), profiles.length - 1);
  const profile = profiles[index];
  if (!profile) return '<div class="empty-state">暂无地图配置</div>';
  const theme = assets.themes.find((t) => t.id === profile.theme);
  return `<div class="map-layout"><aside class="map-list" aria-label="地图列表">${profiles.map((p, i) => `<button data-map-index="${i}" class="map-record ${i === index ? "selected" : ""}" aria-pressed="${i === index}"><div class="map-thumbnail">${themePreview(assets.themes.find((t) => t.id === p.theme))}</div><span><strong>${e(p.name)}</strong><small>${e(p.width)} × ${e(p.height)} 格</small></span></button>`).join("")}</aside><section class="panel"><div class="panel-heading"><h2>${e(profile.name)}</h2><span class="pill">${e(profile.min_rooms)}–${e(profile.max_rooms)} 间房</span></div><div class="map-summary"><div class="map-thumbnail">${themePreview(theme)}</div><div><span>主题</span><strong>${e(theme?.name ?? profile.theme)}</strong><button class="text-btn" data-nav="themes" data-select-theme="${e(profile.theme)}">查看贴图 →</button></div><div><span>面积</span><strong>${e(profile.width)} × ${e(profile.height)}</strong><small>网格</small></div><div><span>走廊宽度</span><strong>${e(profile.corridor_width)}</strong><small>格</small></div></div>${mapSettings(w.draft.tables, index)}</section></div>`;
}
