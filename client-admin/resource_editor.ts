import {
  DEFAULT_VISUAL,
  visual,
  visualEase,
  type VisualSettings,
} from "../shared/presentation";
import { DOOR_VISUAL_SCALE, drawGroundShadow, drawVisualImage } from "../shared/visual_canvas";
import { escape as e } from "./editor";
import { characterName } from "./characters";
import type { Assets, Row, Workspace } from "./types";

export interface ResourceAsset {
  id: string;
  name: string;
  group: "characters" | "scenes" | "items";
  sceneId?: string;
  src: string;
  frames: string[];
  columns: number;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  durations: number[];
  loop: boolean;
  anchor?: [number, number];
  referenceHeight?: number;
}

export function resources(
  assets: Assets,
  workspace: Workspace,
): ResourceAsset[] {
  const list: ResourceAsset[] = [];
  for (const character of assets.characters) {
    for (const [action, clip] of Object.entries(character.animations)) {
      list.push({
        id: `characters/${character.id}/${action}`,
        name: `${characterName(character)} · ${action}`,
        group: "characters",
        src: character.assetBaseUrl + clip.src,
        frames: [],
        columns: clip.columns,
        frameCount: clip.frameCount,
        frameWidth: character.frameSize[0],
        frameHeight: character.frameSize[1],
        durations: clip.durationsMs,
        loop: clip.loop,
        anchor: [character.anchor[0], character.anchor[1]],
        referenceHeight: character.referenceHeight,
      });
    }
  }
  for (const theme of assets.themes)
    for (const asset of theme.assets) {
      list.push({
        id: `scenes/${theme.id}/${asset.id}`,
        name: `${theme.name} · ${asset.name}`,
        group: "scenes",
        sceneId: theme.id,
        src: asset.src,
        frames: [],
        columns: 1,
        frameCount: 1,
        frameWidth: asset.width,
        frameHeight: asset.height,
        durations: [],
        loop: false,
      });
    }
  for (const door of assets.doors) {
    const state = door.id.split("/").at(-1);
    const labels: Record<string, string> = {
      closed: "关门",
      open: "开门",
      damaged_1: "轻度损坏",
      damaged_2: "重度损坏",
      broken: "破门",
    };
    list.push({
      id: `items/door/${door.id}`,
      name: state
        ? door.name.replace(state, labels[state] ?? state)
        : door.name,
      group: "items",
      src: door.src,
      frames: [],
      columns: 1,
      frameCount: 1,
      frameWidth: 256,
      frameHeight: 256,
      durations: [],
      loop: false,
    });
  }
  const indexed = new Map(assets.items.map((item) => [item.id, item]));
  const appearances = new Map<string, string>();
  for (const item of workspace.draft.tables.items as Row[]) {
    appearances.set(String(item.appearance), String(item.name));
    for (const level of item.levels as Row[]) {
      if (level.appearance)
        appearances.set(
          String(level.appearance),
          String(level.name ?? item.name),
        );
    }
  }
  appearances.set("nest", "罐头窝");
  for (const [appearance, name] of appearances) {
    const entry = indexed.get(appearance);
    const frameCount = entry?.frameCount ?? 1;
    list.push({
      id: `items/prop/${appearance}`,
      name: entry?.name ?? name,
      group: "items",
      src: entry?.src ?? "",
      frames: [],
      columns: entry?.columns ?? 1,
      frameCount,
      frameWidth: entry?.frameWidth ?? 256,
      frameHeight: entry?.frameHeight ?? 256,
      durations: Array.from({ length: frameCount }, () => entry?.frameDurationMs ?? 150),
      loop: frameCount > 1,
    });
  }
  return list;
}

const categories = [
  ["all", "全部"],
  ["characters", "人物"],
  ["scenes", "场景"],
  ["items", "物品"],
];
const isDoor = (asset: ResourceAsset) => asset.id.startsWith("items/door/");

export function visibleResources(
  all: ResourceAsset[],
  kind: string,
  sceneId: string,
  query: string,
): ResourceAsset[] {
  const text = query.toLowerCase();
  return all.filter(
    (asset) =>
      (kind === "all" ||
        (kind === "scenes" && (asset.sceneId === sceneId || isDoor(asset))) ||
        (kind === "items" && asset.group === "items" && !isDoor(asset)) ||
        (kind === "characters" && asset.group === "characters")) &&
      `${asset.name} ${asset.id}`.toLowerCase().includes(text),
  );
}
function resourceCards(list: ResourceAsset[], current?: ResourceAsset) {
  return list.map((asset) =>
    `<button class="resource-card ${current?.id === asset.id ? "selected" : ""}" data-resource-id="${e(asset.id)}" title="${e(asset.id)}"><div class="resource-card-image">${asset.src ? `<img loading="lazy" src="${e(asset.src)}" alt="">` : "<span>空图</span>"}</div><strong>${e(asset.name)}</strong><small>${asset.frameCount > 1 ? `${asset.frameCount} 帧` : "静态"}</small></button>`,
  ).join("");
}
const field = (
  name: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
) =>
  `<label class="resource-field"><span>${label}</span><input data-visual-field="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;

export function resourcesView(
  assets: Assets,
  workspace: Workspace,
  kind: string,
  sceneId: string,
  selected: string,
  query: string,
) {
  const all = resources(assets, workspace);
  const activeScene = assets.themes.some((theme) => theme.id === sceneId)
    ? sceneId
    : assets.themes[0]?.id ?? "";
  const filtered = visibleResources(all, kind, activeScene, query);
  const current =
    filtered.find((asset) => asset.id === selected) ?? filtered[0];
  const settings = current
    ? visual(assets.presentation, current.id)
    : DEFAULT_VISUAL;
  const animated = current && current.frameCount > 1;
  const sceneEntries = filtered.filter((asset) => asset.sceneId === activeScene);
  const doorEntries = filtered.filter(isDoor);
  const grid = kind === "scenes"
    ? `${sceneEntries.length ? `<div class="resource-section-title">场景素材 <small>${sceneEntries.length}</small></div><div class="resource-grid">${resourceCards(sceneEntries, current)}</div>` : ""}${doorEntries.length ? `<div class="resource-section-title shared">通用门贴图 <small>${doorEntries.length} · 所有场景共用</small></div><div class="resource-grid">${resourceCards(doorEntries, current)}</div>` : ""}`
    : `<div class="resource-grid">${resourceCards(filtered, current)}</div>`;
  return `<div class="resource-toolbar"><div class="tabs" aria-label="资源分类">${categories
    .map(
      ([id, label]) =>
        `<button data-asset-kind="${id}" class="${id === kind ? "active" : ""}" aria-pressed="${id === kind}">${label}<small>${id === "all" ? all.length : id === "scenes" ? all.filter((a) => a.group === "scenes" || isDoor(a)).length : id === "items" ? all.filter((a) => a.group === "items" && !isDoor(a)).length : all.filter((a) => a.group === id).length}</small></button>`,
    )
    .join(
      "",
    )}</div><input id="resource-search" type="search" placeholder="搜索资源" value="${e(query)}" aria-label="搜索资源"></div>
  ${kind === "scenes" ? `<nav class="resource-scene-nav" aria-label="选择场景">${assets.themes.map((theme) => `<button data-resource-scene="${e(theme.id)}" class="${theme.id === activeScene ? "active" : ""}" aria-pressed="${theme.id === activeScene}"><span>${e(theme.name)}</span><small>${all.filter((asset) => asset.sceneId === theme.id).length} 项场景素材</small></button>`).join("")}</nav><div class="resource-scene-title">${e(assets.themes.find((theme) => theme.id === activeScene)?.name ?? "场景")}<span>地砖 · 路面 · 墙体 · 背景 · 门</span></div>` : ""}
  <div class="resource-layout"><section class="panel">${grid || '<p class="muted">没有匹配的资源</p>'}</section>
  <aside class="panel resource-inspector">${
    current
      ? `<h3>${e(current.name)}</h3><code>${e(current.id)}</code><div class="resource-preview"><canvas id="resource-preview" width="320" height="280" aria-label="${current.group === "items" ? "六格游戏场景实时预览" : "游戏场景实时预览"}"></canvas><span class="resource-preview-label">${current.group === "items" ? "游戏内比例 · 3 × 2 格" : "游戏内比例 · 实时预览"}</span></div>
  <div class="resource-fields">${field("scale", "大小 · 倍率", settings.scale, 0.1, 4, 0.05)}${field("offsetX", "水平位置 · 像素", settings.offsetX, -128, 128, 1)}${field("offsetY", "垂直位置 · 像素", settings.offsetY, -128, 128, 1)}${field("opacity", "透明度", settings.opacity, 0, 1, 0.05)}</div>
  ${animated ? `<div class="resource-motion"><h4>动画播放</h4>${field("speed", "速度 · 倍率", settings.speed, 0.1, 4, 0.05)}<span class="muted">时间曲线 · 贝塞尔控制点</span><svg id="resource-curve" viewBox="0 0 200 120" aria-label="播放曲线"></svg><div class="resource-fields">${settings.curve.map((n, i) => `<label class="resource-field"><span>${["x₁", "y₁", "x₂", "y₂"][i]}</span><input data-visual-curve="${i}" type="number" min="0" max="1" step="0.05" value="${n}"></label>`).join("")}</div></div>` : '<div class="resource-motion-empty">— 无逐帧动画</div>'}
  <button class="button primary resource-save" data-action="save-presentation">保存展示参数</button>`
      : '<p class="muted">选择一项资源</p>'
  }</aside></div>`;
}

export class ResourcePreview {
  private frame = 0;
  private generation = 0;
  private cache = new Map<string, HTMLImageElement>();
  private renderNow: (() => void) | undefined;

  stop() {
    cancelAnimationFrame(this.frame);
    ++this.generation;
    this.renderNow = undefined;
  }

  invalidate() {
    this.renderNow?.();
  }

  start(asset: ResourceAsset | undefined, settings: () => VisualSettings, assets: Assets, sceneId: string) {
    this.stop();
    const canvas =
      document.querySelector<HTMLCanvasElement>("#resource-preview");
    if (!canvas || !asset) return;
    const ctx = canvas.getContext("2d")!;
    const generation = this.generation;
    const started = performance.now();
    const themeId = asset.sceneId ?? sceneId;
    const theme = assets.themes.find((entry) => entry.id === themeId);
    const floorSrc = theme?.assets.find((entry) => entry.id === "floors/cream_ceramic")?.src
      ?? theme?.assets.find((entry) => entry.id.startsWith("floors/"))?.src;
    const wallSrc = theme?.assets.find((entry) => entry.id === "wall")?.src;
    const isDoor = asset.id.startsWith("items/door/");
    const scenePart = asset.group === "scenes" ? asset.id.split("/").slice(2).join("/") : "";
    const tile = 32;
    const zoom = 2.5;
    const originX = (canvas.width - 3 * tile * zoom) / 2;
    const originY = 50;
    const paintTile = (
      src: string | undefined,
      x: number,
      y: number,
      fallback: string,
      tileStyle?: VisualSettings,
    ) => {
      ctx.fillStyle = fallback;
      ctx.fillRect(x * tile, y * tile, tile, tile);
      const image = this.image(src);
      if (image?.complete && image.naturalWidth) {
        if (tileStyle)
          drawVisualImage(ctx, image, tileStyle, x * tile + tile / 2, y * tile + tile / 2, tile);
        else ctx.drawImage(image, x * tile, y * tile, tile, tile);
      }
      ctx.strokeStyle = "#6d65432e";
      ctx.lineWidth = 0.65;
      ctx.strokeRect(x * tile, y * tile, tile, tile);
    };
    const draw = (now: number) => {
      if (generation !== this.generation) return;
      cancelAnimationFrame(this.frame);
      const style = settings();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#d0dac8";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(zoom, zoom);
      ctx.beginPath();
      ctx.rect(0, 0, 3 * tile, 2 * tile);
      ctx.clip();
      const isBackground = scenePart === "background";
      const selectedSurface = asset.group === "scenes" && !isBackground && scenePart !== "wall";
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 3; x++) {
          const surface = selectedSurface ? asset.src : floorSrc;
          paintTile(surface, x, y, "#f5edda", selectedSurface ? style : undefined);
        }
      if (isDoor || scenePart === "wall")
        for (const x of scenePart === "wall" ? [0, 1, 2] : [0, 2])
          paintTile(scenePart === "wall" ? asset.src : wallSrc, x, 0, "#e1e8d3", scenePart === "wall" ? style : undefined);
      if (isBackground) {
        const background = this.image(asset.src);
        if (background?.complete && background.naturalWidth) {
          ctx.save();
          ctx.globalAlpha *= style.opacity;
          ctx.translate(48 + style.offsetX, 32 + style.offsetY);
          ctx.scale(style.scale, style.scale);
          ctx.drawImage(background, -48, -32, 96, 64);
          ctx.restore();
        }
      }
      const frame = this.frameAt(asset, now - started, style);
      const src = asset.frames[frame] ?? asset.src;
      const image = this.image(src);
      if (!selectedSurface && !isBackground && scenePart !== "wall" && image?.complete && image.naturalWidth) {
        const count = asset.frames.length ? 1 : asset.columns;
        const sx = asset.frames.length ? 0 : (frame % count) * asset.frameWidth;
        const sy = asset.frames.length
          ? 0
          : Math.floor(frame / count) * asset.frameHeight;
        const sw = asset.frames.length ? image.naturalWidth : asset.frameWidth;
        const sh = asset.frames.length
          ? image.naturalHeight
          : asset.frameHeight;
        const targetX = 48;
        const targetY = isDoor ? 16 : 48;
        if (asset.group === "characters") {
          const bodyScale = (asset.id.includes("shop_manager") ? 40 : 28) / (asset.referenceHeight || 200);
          const [anchorX, anchorY] = asset.anchor ?? [sw / 2, sh * 0.85];
          ctx.save();
          ctx.globalAlpha *= style.opacity;
          ctx.translate(targetX + style.offsetX, targetY + 10 + style.offsetY);
          ctx.scale(style.scale, style.scale);
          ctx.drawImage(image, sx, sy, sw, sh,
            -anchorX * bodyScale, -anchorY * bodyScale,
            sw * bodyScale, sh * bodyScale);
          ctx.restore();
        } else {
          // The game uses the same world-space transform and one-tile sprite size.
          if (asset.id.startsWith("items/prop/") && asset.frameCount > 1)
            drawGroundShadow(ctx, style, targetX, targetY, tile);
          drawVisualImage(ctx, image, style, targetX, targetY,
            tile * (isDoor ? DOOR_VISUAL_SCALE : 1), [sx, sy, sw, sh]);
        }
      } else if (!src && asset.group === "items") {
        ctx.fillStyle = "#66765f";
        ctx.textAlign = "center";
        ctx.font = "6px sans-serif";
        ctx.fillText("空图", 48, isDoor ? 18 : 50);
      }
      ctx.restore();
      ctx.strokeStyle = "#a4b397";
      ctx.strokeRect(originX - 0.5, originY - 0.5, 3 * tile * zoom + 1, 2 * tile * zoom + 1);
      if (asset.frameCount > 1) this.frame = requestAnimationFrame(draw);
    };
    this.renderNow = () => draw(performance.now());
    draw(started);
  }

  private frameAt(
    asset: ResourceAsset,
    elapsed: number,
    settings: VisualSettings,
  ) {
    if (asset.frameCount <= 1) return 0;
    const total = asset.durations.reduce((sum, duration) => sum + duration, 0);
    if (total <= 0) return 0;
    const t = Math.max(0, elapsed * settings.speed);
    let remaining =
      visualEase(
        (asset.loop ? t % total : Math.min(t, total)) / total,
        settings.curve,
      ) * total;
    for (let i = 0; i < asset.frameCount - 1; i++) {
      if (remaining < asset.durations[i]) return i;
      remaining -= asset.durations[i];
    }
    return asset.frameCount - 1;
  }

  private image(src: string | undefined) {
    if (!src) return undefined;
    let image = this.cache.get(src);
    if (!image) {
      image = new Image();
      image.onload = () => this.invalidate();
      image.src = src;
      this.cache.set(src, image);
    }
    return image;
  }
}

export function drawCurve(settings: VisualSettings) {
  const svg = document.querySelector<SVGSVGElement>("#resource-curve");
  if (!svg) return;
  const [x1, y1, x2, y2] = settings.curve;
  svg.innerHTML = `<path d="M10 110H190M10 110V10" stroke="#c9d7c0" fill="none"/><path d="M10 110 C ${10 + 180 * x1} ${110 - 100 * y1}, ${10 + 180 * x2} ${110 - 100 * y2}, 190 10" stroke="#416751" stroke-width="3" fill="none"/><circle cx="${10 + 180 * x1}" cy="${110 - 100 * y1}" r="5" fill="#dbab72"/><circle cx="${10 + 180 * x2}" cy="${110 - 100 * y2}" r="5" fill="#dbab72"/>`;
}
