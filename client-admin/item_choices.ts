import type { FieldPath, Row, Tables } from "./types";

export type ItemChoiceKind = "installable" | "pickup" | "map";

// Read the current draft on each render; never keep a second catalog of item IDs.
export function itemChoices(tables: Tables, kind: ItemChoiceKind): Row[] {
  return (tables.items as Row[])
    .filter((item) => {
      if (!Array.isArray(item.levels) || !item.levels.length) return false;
      const installable =
        item.buildable === true && item.behavior !== "random_item";
      const pickup = item.behavior === "pickup";
      return kind === "pickup"
        ? pickup
        : kind === "map"
          ? installable || pickup
          : installable;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id), "en"));
}

export function isMapItemReference(path: FieldPath): boolean {
  return (
    path[0] === "map_items" &&
    ((path.length === 2 && path[1] === "pickup_item") ||
      (path.length === 3 && path[1] === "initial_items"))
  );
}

export function defaultItemChoices(tables: Tables, index = -1): Row[] {
  const selected = (tables.map_items as Row).initial_items as string[];
  return itemChoices(tables, "installable").filter(
    (item) => !selected.some((id, i) => i !== index && id === item.id),
  );
}

export function validateDefaultMapItems(tables: Tables): void {
  const rules = tables.map_items as Row;
  const selected = rules.initial_items as string[];
  if (!Array.isArray(selected) || selected.length === 0)
    throw new Error("默认开局物资：请至少选择一种安装道具");
  const available = itemChoices(tables, "installable");
  const missing = selected.find(
    (id) => !available.some((item) => item.id === id),
  );
  if (missing !== undefined)
    throw new Error(
      `默认开局物资：道具 ${missing} 不存在或已不可用于开局，请重新选择`,
    );
  if (new Set(selected).size !== selected.length)
    throw new Error("默认开局物资：不能重复选择同一道具");
  if (
    !itemChoices(tables, "pickup").some((item) => item.id === rules.pickup_item)
  )
    throw new Error(
      `默认开局物资：拾取道具 ${rules.pickup_item} 不存在或类型已改变，请重新选择`,
    );
}
