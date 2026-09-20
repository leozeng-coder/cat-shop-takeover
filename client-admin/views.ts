import { characterName, characterRole, type CharacterRole } from "./characters";
import { icon, locationFor, modules } from "./navigation";
import { characterPreview, themePreview } from "./catalog_views";
import { escape as e, differences, form, tableNames } from "./editor";
import { itemSettings, itemTabs, randomItemsTableView } from "./item_editor";
import type {
  Assets,
  ClientTarget,
  Json,
  Release,
  Row,
  Workspace,
} from "./types";

export function shell(page: string) {
  const active = locationFor(page);
  return `<div class="workbench">
    <aside class="sidebar">
      <a class="brand" href="#home" data-nav="home"><span class="brand-mark">${icon("cat")}</span><span>猫猫后台<small>猫猫夺店计划</small></span></a>
      <nav aria-label="模块导航">${modules
        .map((module, index) => {
          const selected = active.module.id === module.id;
          return `<button data-nav="${selected ? page : module.pages[0].id}" aria-label="${module.name}" class="nav-link ${selected ? "active" : ""}" ${selected ? 'aria-current="page"' : ""}><i>${icon(module.icon)}</i><span>${module.name}</span><small>${String(index + 1).padStart(2, "0")}</small></button>`;
        })
        .join("")}</nav>
      <div class="sidebar-note"><span class="local-status">本地工作区</span><a href="http://127.0.0.1:8787/" target="_blank" rel="noreferrer">打开游戏 ↗</a></div>
      <button class="logout" data-action="logout">退出登录</button>
    </aside>
    <div class="main">
      <header class="topbar"><div><div class="breadcrumb"><span>${active.module.name}</span><b>/</b>${active.page.group ? `<span>${active.module.groups?.find((g) => g.id === active.page.group)?.name}</span><b>/</b>` : ""}<span>${active.page.name}</span></div><h1>${active.module.name}</h1></div><div class="top-actions"><span id="save-status" class="save-status"></span><button class="button" data-action="save">保存草稿</button><button class="button" data-action="validate">校验</button><button class="button primary" data-action="publish">${page === "audio" ? "发布音效" : "发布"}</button></div></header>
      <div id="notice" class="notice" role="status" hidden></div><main id="content" data-module="${active.module.id}"></main>
    </div>
  </div><dialog id="confirm"><form method="dialog"><div id="dialog-content"></div><div class="dialog-actions"><button class="button" value="cancel">取消</button><button class="button primary" value="confirm">确认</button></div></form></dialog>`;
}

export function pageNavigation(page: string) {
  const active = locationFor(page);
  if (active.module.pages.length < 2) return "";
  const pages = active.module.pages.filter(
    (entry) => !active.module.groups || entry.group === active.page.group,
  );
  const roles = active.module.groups
    ? `<div class="role-switch" role="group" aria-label="角色类型">${active.module.groups
        .map(
          (group) =>
            `<button data-nav="${group.id === active.page.group ? page : group.page}" aria-pressed="${group.id === active.page.group}">${group.name}</button>`,
        )
        .join("")}</div>`
    : "";
  return `<nav class="page-navigation" aria-label="${active.module.name}分类">${roles}<div class="page-links">${pages
    .map(
      (entry) =>
        `<button data-nav="${entry.id}" ${entry.id === page ? 'aria-current="page"' : ""}>${entry.name}</button>`,
    )
    .join("")}</div></nav>`;
}

export function login() {
  return `<main class="login-page"><form id="login-form" class="login-card">
    <h1>猫猫后台</h1>
    <label class="field"><span>访问密钥</span><input name="access" type="password" autocomplete="off" required placeholder="输入本机密钥"></label>
    <details class="login-help"><summary>登录帮助</summary><p>双击 <code>start-admin.cmd</code> 自动登录，或读取 <code>.run/admin-access.key</code>。</p></details>
    <p id="login-error" class="error-text" role="alert"></p><button class="button primary" type="submit">登录</button>
  </form></main>`;
}
function shortVersion(version: string) {
  return e(version.length > 26 ? version.slice(0, 26) + "…" : version);
}
export function home(w: Workspace, assets: Assets) {
  const changes = differences(w.current.tables, w.draft.tables);
  const profiles = (w.draft.tables.map_generation as Row).profiles as Row[];
  const counts = [
    ["characters", "角色管理", assets.characters.length, "套角色", "cat"],
    ["maps", "地图管理", profiles.length, "张地图", "map"],
    [
      "items",
      "道具管理",
      (w.draft.tables.items as Row[]).length,
      "种道具",
      "box",
    ],
    [
      "tables",
      "总表管理",
      Object.keys(w.draft.tables).length,
      "张配表",
      "table",
    ],
  ];
  return `<div class="stats">${counts.map(([page, label, count, unit, symbol]) => `<button data-nav="${page}" class="stat-card stat-${page}"><span class="stat-icon">${icon(String(symbol))}</span><span>${label}</span><strong>${count}<small>${unit}</small></strong><i>${icon("arrow")}</i></button>`).join("")}</div>
    <div class="home-layout"><section class="panel character-overview"><div class="panel-heading"><h3>角色预览</h3><button class="text-btn" data-nav="characters">管理 →</button></div><div class="character-cards">${assets.characters.map((c) => `<button class="character-card ${c.profile === "shop_manager" ? "manager-card" : ""}" data-nav="${characterRole(c) === "managers" ? "manager-characters" : "characters"}" data-select-character="${e(c.id)}"><div class="portrait-stage">${characterPreview(c)}</div><strong>${e(characterName(c))}</strong><span>${c.palettes.skins.length} 配色 · ${Object.keys(c.animations).length} 动作</span><div class="palette-dots">${c.palettes.skins.map((skin) => `<i title="${e(skin.name)}" style="--swatch:${/^#[0-9a-f]{6}$/i.test(skin.fur) ? skin.fur : "#bdc7b5"}"></i>`).join("")}</div></button>`).join("")}</div></section>
    <section class="panel map-overview"><div class="panel-heading"><h3>地图预览</h3><button class="text-btn" data-nav="maps">管理 →</button></div><div class="map-previews">${profiles.map((p, i) => `<button class="map-preview-card" data-nav="maps" data-select-map="${i}"><div class="map-preview-art">${themePreview(assets.themes.find((t) => t.id === p.theme))}</div><span><strong>${e(p.name)}</strong><small>${e(p.width)} × ${e(p.height)} 格</small></span></button>`).join("")}</div></section>
    <section class="panel version-panel"><div class="panel-heading"><h3>配置状态</h3><span class="pill ${w.conflict ? "warn" : ""}">${w.conflict ? "版本冲突" : changes.length ? "待发布" : "已同步"}</span></div><div class="version-line"><span>版本</span><code title="${e(w.current.version)}">${shortVersion(w.current.version)}</code></div><div class="version-line"><span>草稿</span><strong>${changes.length} 处修改</strong></div><div class="inline-actions"><button class="button" data-action="diff">查看差异</button><button class="text-btn" data-nav="history">发布历史</button><button class="text-btn" data-action="export">导出</button></div></section>
    <section class="panel quick-panel"><div class="panel-heading"><h3>快捷导航</h3></div><div class="quick-links">${modules
      .filter((m) => m.id !== "home")
      .map(
        (m) =>
          `<button data-nav="${m.pages[0].id}">${icon(m.icon)}<span>${m.name}</span>${icon("arrow")}</button>`,
      )
      .join("")}</div></section></div>`;
}
export function itemsView(w: Workspace, selected: number, query: string) {
  const items = w.draft.tables.items as Row[];
  const item = items[selected];
  const category = { attack: "攻击", currency: "经济", utility: "功能" };
  return `<div class="editor-layout"><aside class="record-list"><input id="item-search" type="search" placeholder="搜索道具" value="${e(query)}" aria-label="搜索道具"><div id="item-records">${items.map((r, i) => `<button data-item="${i}" data-search="${e(String(r.name) + String(r.id))}" class="record ${i === selected ? "selected" : ""}" ${!(String(r.name) + String(r.id)).toLowerCase().includes(query.toLowerCase()) ? "hidden" : ""}><span class="record-icon" aria-hidden="true">${r.category === "attack" ? "✦" : r.category === "currency" ? "◉" : "◇"}</span><span><strong>${e(r.name)}</strong><small>${e(r.id)}</small></span></button>`).join("")}</div></aside>
    <section class="panel editor-panel"><div class="panel-heading item-editor-header"><h2>${e(item?.name ?? "暂无道具")}</h2>${item ? itemTabs(item) : ""}<div class="heading-actions"><span class="pill">${e(category[String(item?.category) as keyof typeof category] ?? item?.category)}</span><button class="button" data-action="clone-item" ${item ? "" : "disabled"}>复制道具</button></div></div>${item ? itemSettings(w.draft.tables, selected) : ""}</section></div>`;
}
export function managerView(w: Workspace) {
  return `<section class="panel">${form(w.draft.tables.manager, ["manager"], w.draft.tables)}</section>`;
}
export function tablesView(
  w: Workspace,
  selected: string,
  raw: boolean,
  fixed = false,
) {
  return `<section class="panel"><div class="table-toolbar">${
    fixed
      ? `<h3>${e(tableNames[selected])}</h3>`
      : `<label>配表 <select id="table-select">${Object.entries(tableNames)
          .map(
            ([id, name]) =>
              `<option value="${id}" ${selected === id ? "selected" : ""}>${name} · ${id}.json</option>`,
          )
          .join("")}</select></label>`
  }<button class="button" data-action="toggle-raw">${raw ? "表单" : "JSON"}</button><button class="text-btn" data-action="reset">重置草稿</button></div>${raw ? `<textarea id="raw-json" class="json-editor" spellcheck="false" aria-label="配表 JSON">${e(JSON.stringify(w.draft.tables[selected], null, 2))}</textarea><button class="button primary" data-action="apply-json">应用</button>` : selected === "random_items" ? randomItemsTableView(w.draft.tables) : form(w.draft.tables[selected], [selected], w.draft.tables)}</section>`;
}
const motionNames: Record<string, string> = {
  idle: "待机",
  move: "横向移动",
  move_left: "向左",
  move_right: "向右",
  move_up: "向上",
  move_down: "向下",
  attack: "攻击",
  sleep: "睡眠",
  wake: "起身",
  retreat: "撤退",
};
export function charactersView(
  assets: Assets,
  selected: string,
  role: CharacterRole,
) {
  const characters = assets.characters.filter((c) => characterRole(c) === role);
  const character = characters.find((c) => c.id === selected) ?? characters[0];
  if (!character) return '<p class="muted">暂无角色</p>';
  const mapped = new Set([
    ...Object.values(character.movementClips),
    ...Object.values(character.retreatClips ?? {}),
    "idle",
    "attack",
    "sleep",
    "wake",
  ]);
  return `<div class="page-tools"><div class="tabs">${characters.map((c) => `<button data-character="${e(c.id)}" title="${e(c.id)}" class="${c.id === character.id ? "active" : ""}">${e(characterName(c))}</button>`).join("")}</div><a class="button" href="/preview/index.html?character=${encodeURIComponent(character.id)}" target="_blank" rel="noreferrer">独立预览 ↗</a></div>
    <div class="preview-layout"><section class="panel preview-panel"><iframe title="角色动作小剧场" src="/preview/index.html?character=${encodeURIComponent(character.id)}&embedded=1"></iframe></section><aside class="panel asset-details"><h3>图集信息</h3><div class="version-line"><span>尺寸</span><b>${character.frameSize.join(" × ")}</b></div><div class="version-line"><span>配色</span><b>${character.palettes.skins.length}</b></div><h4>动作 · ${Object.keys(character.animations).length}</h4>${Object.entries(
      character.animations,
    )
      .map(
        ([name, a]) =>
          `<div class="animation-record"><b title="${e(name)}">${e(motionNames[name] ?? name)}</b><span class="pill ${mapped.has(name) ? "" : "muted-pill"}">${mapped.has(name) ? "已绑定" : "未绑定"}</span><small>${a.frameCount} 帧 · ${a.durationsMs.reduce((x, y) => x + y, 0)} ms · ${a.loop ? "循环" : "单次"}</small></div>`,
      )
      .join("")}</aside></div>`;
}
export function themesView(assets: Assets, selected: string) {
  const theme =
    assets.themes.find((t) => t.id === selected) ?? assets.themes[0];
  if (!theme) return '<p class="muted">暂无地图素材</p>';
  return `<div class="tabs">${assets.themes.map((t) => `<button data-theme="${e(t.id)}" class="${theme.id === t.id ? "active" : ""}">${e(t.name)}</button>`).join("")}</div><div class="asset-grid">${theme.assets.map((a) => `<a class="asset-card" href="${e(a.src)}" title="${e(a.id)}" target="_blank" rel="noreferrer"><div class="asset-image ${a.id === "background" ? "background-image" : ""}"><img loading="lazy" src="${e(a.src)}" alt="${e(a.name ?? a.id)}"></div><div><strong>${e(a.name ?? a.id)}</strong><span>${a.width} × ${a.height} px</span></div></a>`).join("")}</div>`;
}
export function sharedArtBanner(assets: Assets) {
  return `<div class="shared-art-banner"><span class="pill">共享资源 · 只读</span><code title="${e(assets.sourceRoot)}">${e(assets.sourceRoot)}</code><button class="button" data-action="refresh-assets">刷新</button></div>`;
}
export function clientsView(assets: Assets, clients: ClientTarget[]) {
  return `${sharedArtBanner(assets)}<div class="client-grid">${clients.map((c) => `<section class="panel client-card"><div class="panel-heading"><h2>${c.id === "web" ? "Web" : "Cocos Creator"}</h2><span class="pill ${c.available ? "" : "warn"}">${c.available ? "路径一致" : "接入异常"}</span></div><div class="version-line"><span>接入方式</span><b>${e(c.integration)}</b></div><details class="connection-details" ${c.available ? "" : "open"}><summary>接入详情</summary><label>资源目录</label><code class="path-code">${e(c.assetRoot || "未配置")}</code><label>配置文件</label><code class="path-code">${e(c.configPath)}</code><p class="muted">${c.id === "web" ? "源图更新后，已打包的游戏需重新构建。" : "实际导入与渲染请在 Creator 中确认。"}</p></details>${c.problem ? `<p class="error-text">${e(c.problem)}</p>` : ""}</section>`).join("")}</div><div class="inline-actions"><button class="button" data-nav="characters">角色动作 · ${assets.characters.length}</button><button class="button" data-nav="themes">地图主题 · ${assets.themes.length}</button></div>`;
}
export function historyView(w: Workspace, history: Release[]) {
  return `<section class="panel"><div class="panel-heading"><code title="${e(w.current.version)}">${shortVersion(w.current.version)}</code><button class="button" data-action="refresh">刷新</button></div>${history.length ? `<div class="table-scroll"><table class="history-table"><thead><tr><th>版本</th><th>时间</th><th>备注</th><th>状态</th><th></th></tr></thead><tbody>${history.map((r) => `<tr><td><code title="${e(r.version)}">${shortVersion(r.version)}</code></td><td>${e(new Date(r.createdAt).toLocaleString("zh-CN"))}</td><td>${e(r.note)}${r.rollbackFrom ? "<small>回滚版本</small>" : ""}</td><td>${r.id === w.current.release ? '<span class="pill">当前</span>' : "历史"}</td><td><button class="button" data-rollback="${e(r.id)}" ${r.id === w.current.release ? "disabled" : ""}>回滚</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">暂无发布记录</div>'}</section>`;
}
export function diffView(w: Workspace) {
  const changes = differences(w.current.tables, w.draft.tables);
  const text = (value: Json | undefined) =>
    value === undefined ? "（不存在）" : JSON.stringify(value);
  return `<p class="muted">${changes.length} 处修改</p><div class="diff-list">${changes.map((d) => `<article><code>${e(d.path)}</code><div><del>${e(text(d.before))}</del><ins>${e(text(d.after))}</ins></div></article>`).join("") || "<p>无差异</p>"}</div>`;
}
