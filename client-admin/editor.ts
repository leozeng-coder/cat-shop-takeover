import type { FieldPath, Json, Row, Tables } from "./types";
export const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const tableNames: Record<string, string> = {
  items: "道具",
  manager: "店长",
  doors: "店门",
  nests: "罐头窝",
  currencies: "货币",
  match: "对局规则",
  random_items: "神奇垃圾桶",
  repair: "手动修门",
  cat_ai: "猫猫 AI",
  manager_ai: "店长 AI",
  map_generation: "地图生成",
  map_items: "开局物资",
  characters: "可选角色",
  manifest: "版本信息",
};
const labels: Record<string, string> = {
  id: "标识",
  name: "名称",
  description: "道具描述",
  category: "道具分类",
  behavior: "行为类型",
  appearance: "外观标识",
  currency: "货币",
  buildable: "允许购买",
  unique: "每位玩家只能放置一个",
  levels: "等级配置",
  level: "等级",
  next_level: "下一等级（0 为满级）",
  cost: "升级 / 购买价格",
  conditions: "升级前置条件",
  amount: "数值",
  interval_ms: "间隔（毫秒）",
  range: "射程（世界单位）",
  max_hp: "最大生命值",
  door_damage: "单次敲门伤害",
  speed: "移动速度",
  next_rage: "升级所需怒气",
  level_up_announcement: "升级播报",
  time_rage: "每秒怒气",
  door_rage: "敲门怒气",
  damage_rage_multiplier: "受伤怒气倍率",
  level_up_heal_percent: "升级回血（%）",
  attack_interval_ms: "攻击间隔（毫秒）",
  capture_range: "抓猫距离",
  rest_duration_ms: "休息时间（毫秒）",
  recovery_duration_ms: "恢复时间（毫秒）",
  retreat_reward: "击退奖励",
  stage: "阶段",
  display_level: "展示等级",
  next_stage: "下一阶段",
  health: "门耐久",
  type: "条件类型",
  initial: "初始数量",
  limit: "上限",
  symbol: "货币图标",
  width: "地图宽度（格）",
  height: "地图高度（格）",
  min_rooms: "最少房间",
  max_rooms: "最多房间",
  min_room_area: "最小房间面积",
  max_room_area: "最大房间面积",
  corridor_width: "走廊宽度",
  layout_complexity: "布局复杂度",
  theme: "地图主题",
  weight: "权重",
  profiles: "配置方案",
  purchase_costs: "每次购买价格",
  level_weight_decay: "等级权重衰减",
  reveal_duration_ms: "揭晓时间（毫秒）",
  version: "版本标识",
  schema_version: "配表格式版本",
};
export const label = (key: string) => labels[key] ?? key;
const encoded = (path: FieldPath) => escape(JSON.stringify(path));
const choices: Record<string, [string, string][]> = {
  category: [
    ["attack", "基础 / 攻击"],
    ["currency", "经济"],
    ["utility", "功能 / 地图物件"],
  ],
  behavior: [
    ["single_attack", "单体攻击"],
    ["currency_producer", "货币产出"],
    ["door_repair", "修复店门"],
    ["door_attack_delay", "延后敲门"],
    ["random_item", "随机道具"],
    ["pickup", "拾取物"],
    ["obstacle", "障碍物"],
  ],
};
function options(
  key: string,
  path: FieldPath,
  tables: Tables,
): [string, string][] | undefined {
  if (key === "currency")
    return [
      ["", "无"],
      ...(tables.currencies as Row[]).map(
        (r) => [String(r.id), String(r.name)] as [string, string],
      ),
    ];
  if (key === "id" && path.includes("conditions")) {
    const condition = readPath(tables, path.slice(0, -1)) as Row;
    if (condition.type === "door_stage")
      return (tables.doors as Row[]).map((r) => [
        String(r.id),
        `${r.name} ${r.display_level} 级`,
      ]);
  }
  return choices[key];
}
function field(
  value: Json,
  path: FieldPath,
  tables: Tables,
  compact = false,
): string {
  const key = String(path.at(-1));
  const title = label(key);
  const attrs = `data-path="${encoded(path)}" aria-label="${escape(title)}"`;
  let input: string;
  if (typeof value === "boolean")
    input = `<input type="checkbox" ${attrs} ${value ? "checked" : ""}>`;
  else if (typeof value === "number")
    input = `<input type="number" step="any" ${attrs} value="${value}">`;
  else {
    const values = options(key, path, tables);
    if (values) {
      if (!values.some(([id]) => id === value))
        values.unshift([String(value), String(value)]);
      input = `<select ${attrs}>${values.map(([id, text]) => `<option value="${escape(id)}" ${id === value ? "selected" : ""}>${escape(text)}</option>`).join("")}</select>`;
    } else if (key === "description")
      input = `<textarea rows="3" ${attrs}>${escape(value)}</textarea>`;
    else input = `<input type="text" ${attrs} value="${escape(value)}">`;
  }
  return compact
    ? input
    : `<label class="field ${typeof value === "boolean" ? "check-field" : ""} ${key === "description" ? "wide-field" : ""}"><span>${escape(title)}</span>${input}</label>`;
}
export function form(value: Json, path: FieldPath, tables: Tables): string {
  if (Array.isArray(value)) {
    const key = String(path.at(-1));
    const table = path[0] === "manager" && key === "levels";
    const content =
      table && value.length
        ? levelTable(value as Row[], path, tables)
        : value
            .map((entry, index) => {
              const row =
                entry && typeof entry === "object" && !Array.isArray(entry)
                  ? (entry as Row)
                  : null;
              const heading = row
                ? row.name ||
                  row.id ||
                  (row.level ? `${row.level} 级` : `第 ${index + 1} 项`)
                : `第 ${index + 1} 项`;
              return `<details class="entry" ${value.length <= 3 || index === 0 ? "open" : ""}><summary><span>${escape(heading)}</span><button type="button" class="text-btn danger" data-remove="${encoded([...path, index])}">移除</button></summary><div class="entry-body">${form(entry, [...path, index], tables)}</div></details>`;
            })
            .join("");
    return `<section class="collection"><div class="section-title"><h3>${escape(label(key))}<small>${value.length} 项</small></h3><button type="button" class="text-btn" data-add="${encoded(path)}">＋ 添加一项</button></div>${content || '<p class="muted">暂无条目</p>'}</section>`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    return `<div class="form-grid">${entries
      .filter(([, v]) => v === null || typeof v !== "object")
      .map(([k, v]) => field(v, [...path, k], tables))
      .join("")}</div>${entries
      .filter(([, v]) => v !== null && typeof v === "object")
      .map(
        ([k, v]) =>
          `<div class="nested">${form(v, [...path, k], tables)}</div>`,
      )
      .join("")}`;
  }
  return field(value, path, tables);
}
function levelTable(rows: Row[], path: FieldPath, tables: Tables) {
  const preferred = [
    "level",
    "max_hp",
    "door_damage",
    "speed",
    "next_rage",
    "level_up_announcement",
  ];
  const keys = [
    ...preferred.filter((key) => key in rows[0]),
    ...Object.keys(rows[0]).filter((key) => !preferred.includes(key)),
  ];
  return `<div class="table-scroll"><table class="levels-table"><thead><tr>${keys.map((k) => `<th>${escape(label(k))}</th>`).join("")}<th></th></tr></thead><tbody>${rows.map((row, i) => `<tr>${keys.map((k) => `<td ${k === "level_up_announcement" ? 'class="announcement-cell"' : ""}>${field(row[k], [...path, i, k], tables, true)}</td>`).join("")}<td><button class="text-btn danger" data-remove="${encoded([...path, i])}" aria-label="移除第 ${i + 1} 级">×</button></td></tr>`).join("")}</tbody></table></div>`;
}
export function readPath(root: Json, path: FieldPath): Json {
  let value = root;
  for (const key of path) value = (value as Record<string, Json>)[key];
  return value;
}
export function setPath(root: Json, path: FieldPath, value: Json) {
  (readPath(root, path.slice(0, -1)) as Record<string, Json>)[path.at(-1)!] =
    value;
}
export function addEntry(tables: Tables, path: FieldPath) {
  const rows = readPath(tables, path) as Json[];
  const key = path.at(-1);
  let value: Json = rows.length ? structuredClone(rows.at(-1)!) : {};
  if (key === "cost" || key === "retreat_reward" || key === "reserve")
    value = { currency: (tables.currencies as Row[])[0].id, amount: 0 };
  else if (key === "conditions")
    value = { type: "door_stage", id: (tables.doors as Row[])[0].id };
  else if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.level === "number") {
      value.level++;
      if ("next_level" in value) value.next_level = 0;
    }
    if (typeof value.id === "string") value.id += "_copy";
  }
  rows.push(value);
}
export interface Difference {
  path: string;
  before: Json | undefined;
  after: Json | undefined;
}
export function differences(
  before: Json | undefined,
  after: Json | undefined,
  path = "",
): Difference[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    const a = before as Record<string, Json>,
      b = after as Record<string, Json>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      differences(a[key], b[key], path ? `${path}.${key}` : key),
    );
  }
  return [{ path, before, after }];
}
