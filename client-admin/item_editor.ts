import { escape as e, form } from "./editor";
import { randomRewardsView } from "./random_rewards";
import { pickupLevels } from "./pickup_editor";
import type { Row, Tables } from "./types";

const selectedSections = new Map<string, string>();
function sectionsFor(item: Row): readonly (readonly [string, string])[] {
  return item.behavior === "random_item"
    ? [
        ["basic", "基本信息"],
        ["purchase", "购买信息"],
        ["rewards", "随机奖池"],
      ]
    : [
        ["basic", "基本信息"],
        [
          "levels",
          item.behavior === "pickup"
            ? "等级与拾取"
            : item.buildable
              ? "等级与购买"
              : "效果配置",
        ],
      ];
}
function selectedSection(item: Row): string {
  const selected = selectedSections.get(String(item.id)) ?? "basic";
  return sectionsFor(item).some(([key]) => key === selected)
    ? selected
    : "basic";
}
export function itemTabs(item: Row): string {
  const source = String(item.id),
    selected = selectedSection(item);
  const id = encodeURIComponent(source);
  return `<div class="item-editor-tabs" role="tablist" aria-label="道具配置分类">${sectionsFor(
    item,
  )
    .map(
      ([key, name]) =>
        `<button type="button" role="tab" id="item-tab-${id}-${key}" aria-controls="item-section-${id}-${key}" aria-selected="${selected === key}" tabindex="${selected === key ? 0 : -1}" data-item-tab="${key}" data-item-source="${e(source)}">${name}</button>`,
    )
    .join("")}</div>`;
}
function selectItemSection(
  root: HTMLElement,
  source: string,
  section: string,
): void {
  selectedSections.set(source, section);
  root.querySelectorAll<HTMLElement>("[data-item-tab]").forEach((button) => {
    if (button.dataset.itemSource !== source) return;
    const active = button.dataset.itemTab === section;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll<HTMLElement>("[data-item-section]").forEach((panel) => {
    if (panel.dataset.itemSource === source)
      panel.hidden = panel.dataset.itemSection !== section;
  });
}
export function switchItemTab(button: HTMLElement, root: HTMLElement): boolean {
  const section = button.dataset.itemTab;
  if (!section || !["basic", "purchase", "rewards", "levels"].includes(section))
    return false;
  selectItemSection(root, button.dataset.itemSource!, section);
  return true;
}
export function revealItemField(field: HTMLElement, root: HTMLElement): void {
  const section = field.closest<HTMLElement>("[data-item-section]");
  if (section)
    selectItemSection(
      root,
      section.dataset.itemSource!,
      section.dataset.itemSection!,
    );
}
export function itemTabKeydown(
  event: KeyboardEvent,
  root: HTMLElement,
): boolean {
  const target = event.target as HTMLElement;
  if (
    !target.dataset.itemTab ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return false;
  const tabs = Array.from(
    target.parentElement!.querySelectorAll<HTMLElement>("[data-item-tab]"),
  );
  const index = tabs.indexOf(target);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) %
          tabs.length;
  event.preventDefault();
  switchItemTab(tabs[next], root);
  tabs[next].focus();
  return true;
}
export function itemSettings(tables: Tables, index: number): string {
  const item = (tables.items as Row[])[index];
  if (!item) return '<p class="error-text">对应道具不存在</p>';
  const source = String(item.id),
    id = encodeURIComponent(source);
  const { levels, ...basic } = item;
  if (item.behavior === "pickup") delete basic.buildable;
  const content: Record<string, string> = {
    basic:
      (item.behavior === "pickup"
        ? '<p class="pill">地图生成 · 不可购买</p>'
        : "") + form(basic, ["items", index], tables),
  };
  if (item.behavior === "random_item") {
    const ruleIndex = (tables.random_items as Row[]).findIndex(
      (rule) => rule.item === source,
    );
    const rule = (tables.random_items as Row[])[ruleIndex];
    const create = `<button class="button" data-reward-action="create" data-reward-source="${e(source)}">添加抽取配置</button>`;
    content.purchase = rule
      ? `<div class="purchase-heading"><h3>购买信息</h3><span class="pill">每局最多购买 ${(rule.purchase_costs as Row[]).length} 次</span></div>${form({ purchase_costs: rule.purchase_costs, reveal_duration_ms: rule.reveal_duration_ms }, ["random_items", ruleIndex], tables)}`
      : create;
    content.rewards = rule ? randomRewardsView(tables, ruleIndex) : create;
  } else if (item.behavior === "pickup") {
    content.levels = pickupLevels(tables, index);
  } else if (item.behavior === "obstacle") {
    content.levels =
      '<div class="item-effect-empty"><span>道具效果</span><strong>无</strong></div>';
  } else {
    // Keep field paths anchored to the original table; the panels only partition its presentation.
    const entries = (levels ?? []) as Row[];
    const visibleLevels = item.buildable
      ? entries
      : entries.map(({ cost, conditions, ...effect }) => effect);
    content.levels = form(visibleLevels, ["items", index, "levels"], tables);
  }
  const selected = selectedSection(item);
  return `<div class="item-editor-content">${sectionsFor(item)
    .map(
      ([key]) =>
        `<section role="tabpanel" id="item-section-${id}-${key}" aria-labelledby="item-tab-${id}-${key}" data-item-section="${key}" data-item-source="${e(source)}" ${selected === key ? "" : "hidden"}>${content[key]}</section>`,
    )
    .join("")}</div>`;
}
export function randomItemsTableView(tables: Tables): string {
  return (tables.random_items as Row[])
    .map((rule) => {
      const index = (tables.items as Row[]).findIndex(
        (item) => item.id === rule.item,
      );
      const item = (tables.items as Row[])[index];
      return `<div class="item-editor-group"><div class="panel-heading item-editor-header"><h3>${e(item?.name ?? rule.item)}</h3>${item ? itemTabs(item) : ""}</div>${itemSettings(tables, index)}</div>`;
    })
    .join("");
}
