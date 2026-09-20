import { escape as e, form } from "./editor";
import type { Row, Tables } from "./types";

export function pickupLevels(tables: Tables, index: number): string {
  const item = (tables.items as Row[])[index];
  const levels = item.levels as Row[];
  return `<section class="collection" data-pickup-item="${index}"><div class="section-title"><h3>拾取等级<small>${levels.length} 级</small></h3><button class="text-btn" data-pickup-action="add" ${levels.length >= 64 ? "disabled" : ""}>＋ 添加等级</button></div>${levels
    .map((level, i) => {
      const fields: Row = { amount: level.amount };
      if (level.name !== undefined) fields.name = level.name;
      if (level.appearance !== undefined) fields.appearance = level.appearance;
      return `<details class="entry"><summary><span>${e(level.level)} 级</span><button class="text-btn danger" data-pickup-action="remove" data-pickup-level="${i}" aria-label="移除第 ${i + 1} 级" ${levels.length <= 1 ? "disabled" : ""}>移除</button></summary><div class="entry-body">${form(fields, ["items", index, "levels", i], tables)}</div></details>`;
    })
    .join("")}</section>`;
}

export function pickupLevelAction(
  button: HTMLElement,
  tables: Tables,
): boolean {
  const action = button.dataset.pickupAction;
  if (!action) return false;
  const container = button.closest<HTMLElement>("[data-pickup-item]")!;
  const item = (tables.items as Row[])[Number(container.dataset.pickupItem)];
  if (item.behavior !== "pickup") return false;
  const levels = item.levels as Row[];
  if (action === "add" && levels.length < 64) {
    const last = levels.at(-1);
    levels.push(
      last
        ? structuredClone(last)
        : {
            level: 1,
            next_level: 0,
            cost: [],
            conditions: [],
            amount: 35,
            interval_ms: 1000,
            range: 0,
          },
    );
  } else if (action === "remove" && levels.length > 1) {
    levels.splice(Number(button.dataset.pickupLevel), 1);
  }
  // These are spawn tiers, not purchasable upgrades. Keep shared level metadata valid.
  levels.forEach((level, i) => {
    level.level = i + 1;
    level.next_level = i + 1 < levels.length ? i + 2 : 0;
  });
  return true;
}
