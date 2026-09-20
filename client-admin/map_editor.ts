import { escape as e, form } from "./editor";
import { mapRewardsView } from "./random_rewards";
import type { Row, Tables } from "./types";

const selectedSections = new Map<string, string>();
const sections = [
  ["terrain", "地形布局"],
  ["match", "对局规则"],
  ["items", "开局道具"],
] as const;
function profiles(tables: Tables): Row[] {
  return (tables.map_generation as Row).profiles as Row[];
}
function timing(profile: Row, tables: Tables): Row {
  return (profile.match ?? tables.match) as Row;
}
function numberField(
  label: string,
  field: string,
  value: unknown,
  min: number,
  max: number,
  step = 1,
): string {
  return `<label class="field"><span>${label}</span><input type="number" required min="${min}" max="${max}" step="${step}" value="${e(value)}" data-map-field="${field}"></label>`;
}
export function mapSettings(tables: Tables, index: number): string {
  const profile = profiles(tables)[index];
  const { match, initial_items, ...terrain } = profile;
  const source = String(profile.id),
    id = encodeURIComponent(source);
  const selected = selectedSections.get(source) ?? "terrain";
  const rules = timing(profile, tables);
  const night = Number(rules.preparation_ms) / 1000;
  const day = Number(rules.duration_ms) / 1000;
  const initial = initial_items as Row | undefined;
  const limit = Math.min(64, Number(profile.min_room_area) - 1);
  const content: Record<string, string> = {
    terrain: form(terrain, ["map_generation", "profiles", index], tables),
    match: `<div class="panel-heading"><h3>对局时长</h3><span class="pill" data-map-timing-state>${match ? "地图自定义" : "使用全局设置"}</span></div><div class="map-rule-fields">${numberField("夜晚时长（秒）", "night", night, 0, 3600, 0.001)}${numberField("整局时长（秒）", "total", night + day, 1, 7200, 0.001)}</div><div class="map-rule-footer"><span data-map-day>白天防守 ${day} 秒 · 整局包含夜晚</span><button class="text-btn" data-map-action="reset-match" ${match ? "" : "hidden"}>恢复全局时长</button></div>`,
    items: `<div class="panel-heading"><h3>每房初始道具</h3><span class="pill">${initial ? "地图自定义" : "使用全局设置"}</span></div>${
      initial
        ? `<div class="map-rule-fields">${numberField("最少数量", "min_per_room", initial.min_per_room, 0, limit)}${numberField("最多数量", "max_per_room", initial.max_per_room, 0, limit)}</div><div class="map-rule-footer"><span>不包含罐头窝 · 设为 0 可关闭生成</span><button class="text-btn" data-map-action="reset-items">恢复全局道具</button></div>${mapRewardsView(tables, index)}`
        : `<div class="map-rule-inherited"><div><strong>每房 1～2 个道具</strong><p>沿用默认物资规则，每房另有一个罐头窝。</p></div><button class="button" data-map-action="custom-items">自定义开局道具</button></div>`
    }`,
  };
  return `<div class="map-editor" data-map-editor="${index}" data-map-source="${e(source)}"><div class="item-editor-tabs" role="tablist" aria-label="地图配置分类">${sections.map(([key, name]) => `<button type="button" role="tab" id="map-tab-${id}-${key}" aria-controls="map-section-${id}-${key}" aria-selected="${selected === key}" tabindex="${selected === key ? 0 : -1}" data-map-tab="${key}">${name}</button>`).join("")}</div><div class="item-editor-content">${sections.map(([key]) => `<section role="tabpanel" id="map-section-${id}-${key}" aria-labelledby="map-tab-${id}-${key}" data-map-section="${key}" ${selected === key ? "" : "hidden"}>${content[key]}</section>`).join("")}</div></div>`;
}
function selectSection(editor: HTMLElement, key: string): void {
  selectedSections.set(editor.dataset.mapSource!, key);
  editor.querySelectorAll<HTMLElement>("[data-map-tab]").forEach((tab) => {
    const active = tab.dataset.mapTab === key;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  editor
    .querySelectorAll<HTMLElement>("[data-map-section]")
    .forEach((panel) => {
      panel.hidden = panel.dataset.mapSection !== key;
    });
}
export function switchMapTab(button: HTMLElement): boolean {
  const key = button.dataset.mapTab;
  if (!sections.some(([name]) => name === key)) return false;
  selectSection(button.closest<HTMLElement>("[data-map-editor]")!, key!);
  return true;
}
export function mapTabKeydown(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  if (
    !target.dataset.mapTab ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return false;
  const tabs = Array.from(
    target.parentElement!.querySelectorAll<HTMLElement>("[data-map-tab]"),
  );
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (tabs.indexOf(target) +
            (event.key === "ArrowLeft" ? -1 : 1) +
            tabs.length) %
          tabs.length;
  event.preventDefault();
  switchMapTab(tabs[next]);
  tabs[next].focus();
  return true;
}
export function revealMapField(field: HTMLElement): void {
  const section = field.closest<HTMLElement>("[data-map-section]");
  if (section)
    selectSection(
      section.closest<HTMLElement>("[data-map-editor]")!,
      section.dataset.mapSection!,
    );
}
export function editMapField(
  target: HTMLInputElement,
  tables: Tables,
): boolean {
  const field = target.dataset.mapField;
  if (!field) return false;
  const editor = target.closest<HTMLElement>("[data-map-editor]")!;
  const profile = profiles(tables)[Number(editor.dataset.mapEditor)];
  if (field === "night" || field === "total") {
    const night = editor.querySelector<HTMLInputElement>(
      '[data-map-field="night"]',
    )!;
    const total = editor.querySelector<HTMLInputElement>(
      '[data-map-field="total"]',
    )!;
    const preparation =
      night.value === "" ? null : Math.round(Number(night.value) * 1000);
    const duration =
      total.value === "" || preparation === null
        ? null
        : Math.round(Number(total.value) * 1000) - preparation;
    profile.match = { preparation_ms: preparation, duration_ms: duration };
    total.setCustomValidity(
      duration === null || duration < 1000 || duration > 3600000
        ? "白天防守时间须为 1～3600 秒；整局时长需大于夜晚时长"
        : "",
    );
    editor.querySelector<HTMLElement>("[data-map-day]")!.textContent =
      duration === null || duration < 1000
        ? "请设置有效的白天防守时长"
        : `白天防守 ${duration / 1000} 秒 · 整局包含夜晚`;
    editor.querySelector<HTMLElement>("[data-map-timing-state]")!.textContent =
      "地图自定义";
    editor.querySelector<HTMLElement>(
      '[data-map-action="reset-match"]',
    )!.hidden = false;
  } else {
    const initial = profile.initial_items as Row;
    initial[field] = target.value === "" ? null : Number(target.value);
    editor
      .querySelector<HTMLInputElement>('[data-map-field="max_per_room"]')!
      .setCustomValidity(
        Number(initial.max_per_room) < Number(initial.min_per_room)
          ? "最多数量不能小于最少数量"
          : "",
      );
  }
  return true;
}
export function mapAction(button: HTMLElement, tables: Tables): boolean {
  const action = button.dataset.mapAction;
  if (!action) return false;
  const editor = button.closest<HTMLElement>("[data-map-editor]")!;
  const profile = profiles(tables)[Number(editor.dataset.mapEditor)];
  if (action === "reset-match") delete profile.match;
  else if (action === "reset-items") delete profile.initial_items;
  else if (action === "custom-items") {
    const legacy = tables.map_items as Row;
    const initial = legacy.initial_items as string[];
    const ids = [...new Set([...initial, String(legacy.pickup_item)])];
    profile.initial_items = {
      min_per_room: 1,
      max_per_room: 2,
      rewards: ids.map((item) => ({
        item,
        weight: item === legacy.pickup_item ? initial.length : 2,
        min_level: 1,
        max_level: 1,
        level_weights: [{ level: 1, weight: 1 }],
      })),
    };
  }
  return true;
}
export function validateMapSettings(tables: Tables): void {
  for (const profile of profiles(tables)) {
    const rules = timing(profile, tables);
    const night = rules.preparation_ms,
      day = rules.duration_ms;
    if (
      typeof night !== "number" ||
      !Number.isInteger(night) ||
      night < 0 ||
      night > 3600000 ||
      typeof day !== "number" ||
      !Number.isInteger(day) ||
      day < 1000 ||
      day > 3600000
    )
      throw new Error(
        `${profile.name}：请检查夜晚和整局时长，白天防守须为 1～3600 秒`,
      );
    const initial = profile.initial_items as Row | undefined;
    if (!initial) continue;
    const min = initial.min_per_room,
      max = initial.max_per_room;
    if (
      typeof min !== "number" ||
      typeof max !== "number" ||
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      min < 0 ||
      max < min ||
      max > Math.min(64, Number(profile.min_room_area) - 1)
    )
      throw new Error(
        `${profile.name}：请检查每房道具数量，需为罐头窝留出一格`,
      );
  }
}
