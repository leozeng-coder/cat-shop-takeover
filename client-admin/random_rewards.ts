import { escape as e } from "./editor";
import { itemChoices } from "./item_choices";
import type { Row, Tables } from "./types";

const expandedRewards = new Map<string, string>();
export function rememberRewardDisclosure(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-reward-pool]").forEach((pool) => {
    const opened = pool.querySelector<HTMLElement>(
      "details[data-reward-row][open]",
    );
    expandedRewards.set(
      pool.dataset.rewardSource!,
      opened?.dataset.rewardItem ?? "",
    );
  });
}

function eligible(tables: Tables, map = false): Row[] {
  return itemChoices(tables, map ? "map" : "installable");
}
function legacyWeights(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / total) * 10000);
  const points = exact.map(Math.floor);
  const fractions = exact.map((p, i) => p - points[i]);
  let remaining = 10000 - points.reduce((a, b) => a + b, 0);
  while (remaining-- > 0) {
    const best = fractions.indexOf(Math.max(...fractions));
    points[best]++;
    fractions[best] = -1;
  }
  return points;
}
function levelChances(item: Row, decay = 0.55): Row[] {
  const levels = item.levels as Row[];
  const chances = legacyWeights(levels.map((_, i) => decay ** i));
  return levels.map((level, i) => ({
    level: level.level,
    weight: chances[i],
  }));
}
function rewardFor(item: Row, weight = 1, decay = 0.55): Row {
  const levels = levelChances(item, decay);
  return {
    item: item.id,
    weight,
    min_level: levels[0].level,
    max_level: levels.at(-1)!.level,
    level_weights: levels,
  };
}
function rewards(tables: Tables, rule: Row): Row[] {
  if (Array.isArray(rule.rewards)) return rule.rewards as Row[];
  if ("rewards" in rule) return [];
  const items = eligible(tables);
  return items.map((item) =>
    rewardFor(item, 1, Number(rule.level_weight_decay)),
  );
}
function editable(tables: Tables, rule: Row): Row[] {
  rule.rewards = rewards(tables, rule);
  delete rule.level_weight_decay;
  return rule.rewards as Row[];
}
function total(rows: Row[]): number {
  return rows.reduce((sum, row) => sum + Number(row.weight), 0);
}
function validWeight(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1000000000
  );
}
function distributionError(rows: Row[]): string {
  if (!rows.length) return "请添加至少一项";
  if (rows.some((r) => !validWeight(r.weight)))
    return "权重须为 0～1000000000 的整数";
  return total(rows) > 0 ? "" : "至少一项的权重须大于 0";
}
function chance(rows: Row[], weight: unknown): string {
  if (distributionError(rows) || !validWeight(weight)) return "—";
  const percent = (Number(weight) / total(rows)) * 100;
  return percent > 0 && percent < 0.01
    ? "<0.01%"
    : `${Number(percent.toFixed(2))}%`;
}
function rewardError(tables: Tables, reward: Row, map = false): string {
  const item = eligible(tables, map).find((item) => item.id === reward.item);
  if (!item) return "道具不存在或不可抽取，请重新选择";
  const levels = (item.levels as Row[]).map((l) => Number(l.level));
  const min = Number(reward.min_level),
    max = Number(reward.max_level);
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min > max ||
    !levels.includes(min) ||
    !levels.includes(max)
  )
    return "等级范围已失效，请重新选择";
  const chances = Array.isArray(reward.level_weights)
    ? (reward.level_weights as Row[])
    : [];
  if (
    chances.length !== max - min + 1 ||
    new Set(chances.map((l) => l.level)).size !== chances.length ||
    chances.some(
      (l) =>
        typeof l.level !== "number" ||
        l.level < min ||
        l.level > max ||
        !levels.includes(l.level),
    )
  )
    return "等级权重须完整覆盖所选范围";
  return distributionError(chances);
}
function poolError(rows: Row[], rule?: Row, tables?: Tables): string {
  if (rule && tables) {
    if (!rows.length && rule.max_per_room === 0) return "";
    const active = rows.filter((r) => Number(r.weight) > 0);
    const items = eligible(tables, true);
    if (
      active.length &&
      active.every((r) => items.find((i) => i.id === r.item)?.unique) &&
      Number(rule.max_per_room) > active.length
    )
      return "唯一道具数量不足，请增加可重复道具或减少每房数量";
  }
  if (new Set(rows.map((r) => r.item)).size !== rows.length)
    return "奖池中存在重复道具";
  return distributionError(rows);
}
export function validateRandomRewards(tables: Tables): void {
  for (const rule of tables.random_items as Row[]) {
    const rows = rewards(tables, rule);
    const error =
      poolError(rows) || rows.map((r) => rewardError(tables, r)).find(Boolean);
    if (error) {
      const name =
        (tables.items as Row[]).find((item) => item.id === rule.item)?.name ??
        rule.item;
      throw new Error(`${name}：${error}`);
    }
  }
}
function mapRule(tables: Tables, index: number): Row {
  return ((tables.map_generation as Row).profiles as Row[])[index]
    .initial_items as Row;
}
function poolRule(pool: HTMLElement, tables: Tables): Row {
  const index = Number(pool.dataset.rewardPool);
  return pool.dataset.rewardContext === "map"
    ? mapRule(tables, index)
    : (tables.random_items as Row[])[index];
}
export function validateMapRewards(tables: Tables): void {
  for (const profile of (tables.map_generation as Row).profiles as Row[]) {
    const rule = profile.initial_items as Row | undefined;
    if (!rule) continue;
    const rows = rewards(tables, rule);
    const error =
      poolError(rows, rule, tables) ||
      rows.map((r) => rewardError(tables, r, true)).find(Boolean);
    if (error) throw new Error(`${profile.name}：${error}`);
  }
}
export function mapRewardsView(tables: Tables, index: number): string {
  return randomRewardsView(tables, index, true);
}
function weightInput(value: unknown, label: string, attrs: string): string {
  return `<label class="reward-chance"><input type="number" min="0" max="1000000000" step="1" required value="${e(value)}" aria-label="${e(label)}" ${attrs}></label>`;
}
function levelOptions(item: Row | undefined, selected: unknown): string {
  const levels = (item?.levels ?? []) as Row[];
  return `${levels.some((l) => l.level === selected) ? "" : `<option value="${e(selected)}">${e(selected)} 级（无效）</option>`}${levels.map((level) => `<option value="${e(level.level)}" ${level.level === selected ? "selected" : ""}>${e(level.level)} 级</option>`).join("")}`;
}
export function randomRewardsView(
  tables: Tables,
  index: number,
  map = false,
): string {
  const rule = map
    ? mapRule(tables, index)
    : (tables.random_items as Row[])[index];
  if (!rule) return "";
  const rows = rewards(tables, rule),
    items = eligible(tables, map);
  const source = (tables.items as Row[]).find((i) => i.id === rule.item);
  const sourceKey = map
    ? `map:${((tables.map_generation as Row).profiles as Row[])[index].id}`
    : String(rule.item);
  const errorForPool = poolError(rows, map ? rule : undefined, tables);
  const remaining = items.filter((i) => !rows.some((r) => r.item === i.id));
  return `<section class="reward-pool" data-reward-pool="${index}" data-reward-source="${e(sourceKey)}" data-reward-context="${map ? "map" : "random"}">
    <div class="reward-heading"><div><h3>${map ? "开局道具池" : `${e(source?.name ?? rule.item)} · 随机奖池`}</h3><small>先抽道具，再抽等级 · 权重越大越容易抽到，0 不参与</small></div><span class="reward-total" data-reward-total>${rows.length} 种道具</span></div>
    <p class="reward-error" data-reward-error>${e(errorForPool)}</p>
    <div class="reward-list"><div class="reward-list-heading" aria-hidden="true"><span>道具</span><span>等级范围</span><span>权重</span><span>抽中概率</span><span></span></div>${rows
      .map((row, i) => {
        const item = items.find((item) => item.id === row.item);
        const options = items.filter(
          (item) =>
            item.id === row.item || !rows.some((r) => r.item === item.id),
        );
        const levels = Array.isArray(row.level_weights)
          ? (row.level_weights as Row[])
          : [];
        const error = rewardError(tables, row, map);
        return `<details class="reward-row" data-reward-row="${i}" data-reward-item="${e(row.item)}" name="reward-pool-${e(sourceKey)}" ${expandedRewards.get(sourceKey) === row.item ? "open" : ""}>
        <summary class="reward-summary" aria-label="${e(item?.name ?? row.item)}配置"><span class="reward-name"><span class="reward-ordinal">${String(i + 1).padStart(2, "0")}</span><strong>${e(item?.name ?? row.item)}</strong><small class="reward-row-error" data-row-error ${error || !validWeight(row.weight) ? "" : "hidden"}>需检查</small></span><span class="reward-summary-range">${e(row.min_level)}${row.min_level === row.max_level ? "" : `–${e(row.max_level)}`} 级</span><span class="reward-summary-weight" data-summary-weight>${e(row.weight)}</span><strong class="reward-summary-chance" data-item-chance title="按当前完整奖池计算；唯一道具已${map ? "在房内生成" : "拥有"}时会被排除，并按剩余权重计算概率">${e(chance(rows, row.weight))}</strong><svg class="reward-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 5 5-5 5"/></svg></summary>
        <div class="reward-body"><div class="reward-card-heading"><label class="reward-item"><span>抽取道具</span><select data-reward-field="item" aria-label="第 ${i + 1} 项道具">${item ? "" : `<option value="${e(row.item)}">${e(row.item)}（无效）</option>`}${options.map((option) => `<option value="${e(option.id)}" ${option.id === row.item ? "selected" : ""}>${e(option.name)}</option>`).join("")}</select></label><div><span class="reward-label">道具权重</span>${weightInput(row.weight, `第 ${i + 1} 项道具权重`, 'data-reward-field="weight"')}</div><button class="text-btn danger" data-reward-action="remove" aria-label="移除第 ${i + 1} 项">移除</button></div>
        <div class="reward-range"><span>等级范围</span><select data-reward-field="min_level" aria-label="第 ${i + 1} 项最低等级">${levelOptions(item, row.min_level)}</select><span>—</span><select data-reward-field="max_level" aria-label="第 ${i + 1} 项最高等级">${levelOptions(item, row.max_level)}</select><span class="reward-level-total" data-level-total>${levels.length} 个等级</span></div>
        <div class="reward-levels">${levels.map((level, j) => `<div><span>${e(level.level)} 级权重</span>${weightInput(level.weight, `第 ${i + 1} 项 ${level.level} 级权重`, `data-reward-field="level_weight" data-level-index="${j}"`)}<small data-level-chance>${e(chance(levels, level.weight))}</small></div>`).join("")}</div>
        <div class="reward-card-footer"><span>${item?.unique ? (map ? "唯一道具 · 每房最多一个" : "唯一道具 · 已拥有时不再抽取") : ""}</span><button class="text-btn" data-reward-action="equal-levels">等级等权重</button><button class="text-btn" data-reward-action="decay-levels">高等级递减</button></div>
        <p class="reward-error" data-level-error>${e(error)}</p>
        </div></details>`;
      })
      .join("")}</div>
    <div class="reward-toolbar"><select data-reward-field="add" aria-label="添加奖池道具" ${remaining.length ? "" : "disabled"}><option value="">${remaining.length ? "＋ 添加道具" : "已添加全部可用道具"}</option>${remaining.map((item) => `<option value="${e(item.id)}">${e(item.name)}</option>`).join("")}</select><button class="text-btn" data-reward-action="equal-items" ${rows.length ? "" : "disabled"}>道具等权重</button></div>
  </section>`;
}
export function refreshRewardTotals(root: HTMLElement, tables: Tables): void {
  root.querySelectorAll<HTMLElement>("[data-reward-pool]").forEach((pool) => {
    const map = pool.dataset.rewardContext === "map";
    const rule = poolRule(pool, tables);
    const rows = rewards(tables, rule),
      error = poolError(rows, map ? rule : undefined, tables);
    const badge = pool.querySelector<HTMLElement>("[data-reward-total]")!;
    badge.textContent = `${rows.length} 种道具`;
    badge.classList.toggle("invalid", !!error);
    pool.querySelector<HTMLElement>("[data-reward-error]")!.textContent = error;
    pool
      .querySelectorAll<HTMLElement>("[data-reward-row]")
      .forEach((card, i) => {
        const levels = rows[i].level_weights as Row[];
        const message = rewardError(tables, rows[i], map);
        const badge = card.querySelector<HTMLElement>("[data-level-total]")!;
        badge.textContent = `${Array.isArray(levels) ? levels.length : 0} 个等级`;
        badge.classList.toggle("invalid", !!message);
        card.querySelector<HTMLElement>("[data-item-chance]")!.textContent =
          chance(rows, rows[i].weight);
        card.querySelector<HTMLElement>("[data-summary-weight]")!.textContent =
          String(rows[i].weight ?? "—");
        card.querySelector<HTMLElement>("[data-row-error]")!.hidden =
          !message && validWeight(rows[i].weight);
        card
          .querySelectorAll<HTMLElement>("[data-level-chance]")
          .forEach((label, j) => {
            label.textContent = chance(levels, levels[j].weight);
          });
        card.querySelector<HTMLElement>("[data-level-error]")!.textContent =
          message;
      });
  });
}
export function editRandomReward(
  target: HTMLInputElement | HTMLSelectElement,
  tables: Tables,
): boolean {
  const field = target.dataset.rewardField;
  if (!field) return false;
  const pool = target.closest<HTMLElement>("[data-reward-pool]")!;
  const map = pool.dataset.rewardContext === "map";
  const rule = poolRule(pool, tables);
  const rows = editable(tables, rule);
  if (field === "add") {
    const item = eligible(tables, map).find((i) => i.id === target.value);
    if (item && !rows.some((r) => r.item === item.id))
      rows.push(rewardFor(item));
    return true;
  }
  const index = Number(
    target.closest<HTMLElement>("[data-reward-row]")!.dataset.rewardRow,
  );
  const row = rows[index];
  if (field === "weight" || field === "level_weight") {
    const value = target.value === "" ? null : Number(target.value);
    if (field === "weight") row.weight = value;
    else
      (row.level_weights as Row[])[Number(target.dataset.levelIndex)].weight =
        value;
  } else if (field === "item") {
    const item = eligible(tables, map).find((i) => i.id === target.value);
    if (item) {
      rows[index] = rewardFor(item, Number(row.weight));
      target.closest<HTMLElement>("[data-reward-row]")!.dataset.rewardItem =
        String(item.id);
    }
  } else {
    row[field] = Number(target.value);
    if (Number(row.min_level) > Number(row.max_level))
      row[field === "min_level" ? "max_level" : "min_level"] = row[field];
    const old = row.level_weights as Row[];
    row.level_weights = Array.from(
      { length: Number(row.max_level) - Number(row.min_level) + 1 },
      (_, i) => {
        const level = Number(row.min_level) + i;
        return old.find((r) => r.level === level) ?? { level, weight: 0 };
      },
    );
  }
  return true;
}
export function randomRewardAction(
  button: HTMLElement,
  tables: Tables,
): boolean {
  const action = button.dataset.rewardAction;
  if (!action) return false;
  if (action === "create") {
    (tables.random_items as Row[]).push({
      item: button.dataset.rewardSource!,
      rewards: [],
      purchase_costs: [[{ currency: "cans", amount: 100 }]],
      reveal_duration_ms: 1200,
    });
    return true;
  }
  const pool = button.closest<HTMLElement>("[data-reward-pool]")!;
  const rows = editable(tables, poolRule(pool, tables));
  const index = Number(
    button.closest<HTMLElement>("[data-reward-row]")?.dataset.rewardRow,
  );
  if (action === "remove") rows.splice(index, 1);
  else {
    const entries =
      action === "equal-items" ? rows : (rows[index].level_weights as Row[]);
    const chances =
      action === "decay-levels"
        ? legacyWeights(entries.map((_, i) => 0.55 ** i))
        : entries.map(() => 1);
    entries.forEach((entry, i) => (entry.weight = chances[i]));
  }
  return true;
}
