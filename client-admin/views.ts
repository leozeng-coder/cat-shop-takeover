import { escape as e, differences, form, tableNames } from "./editor";
import type {
  Assets,
  ClientTarget,
  Json,
  Release,
  Row,
  Workspace,
} from "./types";
export const nav = [
  ["home", "⌂", "工作台"],
  ["items", "▦", "道具配置"],
  ["manager", "♙", "店长配置"],
  ["tables", "☷", "全部配表"],
  ["clients", "◎", "客户端"],
  ["characters", "♧", "角色动作"],
  ["themes", "▧", "地图素材"],
  ["history", "↶", "发布历史"],
];
export function shell(page: string) {
  return `<div class="workbench"><aside class="sidebar"><a class="brand" href="#home" data-nav="home"><span class="brand-mark">♧</span><span>猫猫开发工作台<small>SNACK SHOP STUDIO</small></span></a><div class="workspace-label">开发空间 <span>LOCAL</span></div><nav>${nav.map(([id, icon, name]) => `<button data-nav="${id}" class="nav-link ${page === id ? "active" : ""}"><i>${icon}</i>${name}${page === id ? "<b>›</b>" : ""}</button>`).join("")}</nav><div class="sidebar-note"><span class="status-dot"></span> 本机管理服务<p>每一点调整，<br>都让猫街更有趣。</p><a href="http://127.0.0.1:8787/" target="_blank" rel="noreferrer">打开游戏 ↗</a></div><button class="logout" data-action="logout">退出工作台</button></aside><div class="main"><header class="topbar"><div><span class="breadcrumb">猫猫夺店计划 <b>/</b> ${nav.find((n) => n[0] === page)?.[2]}</span><h1>${nav.find((n) => n[0] === page)?.[2]}</h1></div><div class="top-actions"><span id="save-status" class="save-status"></span><button class="button" data-action="save">保存草稿</button><button class="button" data-action="validate">校验配置</button><button class="button primary" data-action="publish">发布版本 ↗</button></div></header><div id="notice" class="notice" role="status" hidden></div><main id="content"></main><footer class="workbench-footer">编辑草稿 · 校验配置 · 发布到新对局 <span>工作台 v0.1</span></footer></div></div><dialog id="confirm"><form method="dialog"><div id="dialog-content"></div><div class="dialog-actions"><button class="button" value="cancel">取消</button><button class="button primary" value="confirm">确认操作</button></div></form></dialog>`;
}
export function login() {
  return `<main class="login-page"><div class="login-art"><div class="brand-mark">♧</div><p>SNACK SHOP STUDIO</p><h1>让每一条猫街，<br>都有新鲜的故事。</h1><div class="login-orbits"><span>数值</span><span>角色</span><span>地图</span></div></div><form id="login-form" class="login-card"><span class="eyebrow">猫猫开发工作台</span><h2>欢迎回来。</h2><p class="muted">管理局内数值，检查角色动作，准备下一次更新。</p><label class="field"><span>本机访问密钥</span><input name="access" type="password" autocomplete="off" required placeholder="粘贴本机管理密钥"></label><p class="login-help">双击项目中的 <code>start-admin.cmd</code> 可自动登录。<br>也可以从 <code>.run/admin-access.key</code> 读取密钥。</p><p id="login-error" class="error-text" role="alert"></p><button class="button primary" type="submit">进入工作台 →</button><small>本机工作空间 · 草稿不会立即影响游戏</small></form></main>`;
}
function shortVersion(version: string) {
  return e(version.length > 26 ? version.slice(0, 26) + "…" : version);
}
export function home(w: Workspace, assets: Assets) {
  const changes = differences(w.current.tables, w.draft.tables);
  const items = w.draft.tables.items as Row[];
  return `<section class="welcome"><div><span class="eyebrow">今晚，也来做一点有趣的调整</span><h2>猫街的下一次更新，<br>从这里开始。</h2><p>数值、角色与美术资源，都在同一个工作空间里。</p><button class="button primary" data-nav="items">开始调整道具 →</button></div><div class="welcome-art"><span class="tiny-star">✦</span><div class="can">SNACK<br><b>猫</b><small>SHOP</small></div><span class="art-note">SMALL CHANGES.<br>HAPPY CATS.</span></div></section><div class="stats"><article><span>数值配表</span><strong>14<small>张</small></strong><p>独立分表，统一校验</p></article><article><span>局内道具</span><strong>${items.length}<small>种</small></strong><p>攻击 · 经济 · 功能</p></article><article><span>角色资源</span><strong>${assets.characters.length}<small>套</small></strong><p>图集、配色与逐帧动作</p></article><article><span>地图主题</span><strong>${assets.themes.length}<small>套</small></strong><p>背景、地面与墙体素材</p></article></div><div class="overview-grid"><section class="panel"><div class="panel-heading"><h3>当前工作区</h3><span class="pill ${w.conflict ? "warn" : ""}">${w.conflict ? "存在版本冲突" : "草稿与正式版分离"}</span></div><div class="version-line"><span>正式版本</span><code title="${e(w.current.version)}">${shortVersion(w.current.version)}</code></div><div class="version-line"><span>草稿修改</span><strong>${changes.length} 处</strong></div><div class="version-line"><span>最近保存</span><span>${e(new Date(w.draft.updatedAt).toLocaleString("zh-CN"))}</span></div><p class="muted">发布后，新建或重新开始的对局使用新配置。进行中的对局继续使用原来的版本。</p><div class="inline-actions"><button class="button" data-action="diff">查看修改对比</button><button class="text-btn" data-action="export">导出草稿 JSON</button></div></section><section class="panel"><div class="panel-heading"><h3>从预览开始</h3><span class="muted">ART & MOTION</span></div><button class="shortcut" data-nav="characters"><i>♧</i><span><strong>角色动作小剧场</strong><small>慢放、逐帧与四向移动检查</small></span><b>↗</b></button><button class="shortcut" data-nav="themes"><i>▧</i><span><strong>猫街美术素材</strong><small>查看背景、地砖和墙体资源</small></span><b>↗</b></button><button class="shortcut" data-nav="history"><i>↶</i><span><strong>发布与回滚</strong><small>保留每一次版本快照</small></span><b>↗</b></button></section></div>`;
}
export function itemsView(w: Workspace, selected: number, query: string) {
  const items = w.draft.tables.items as Row[];
  const item = items[selected];
  return `<div class="page-intro"><div><h2>小道具，大作用。</h2><p>调整产出、攻击、价格与升级条件，组合出更有趣的守店策略。</p></div><button class="button" data-action="clone-item">复制为新道具</button></div><div class="editor-layout"><aside class="record-list"><input id="item-search" type="search" placeholder="搜索名称或标识" value="${e(query)}" aria-label="搜索道具"><div id="item-records">${items.map((r, i) => `<button data-item="${i}" data-search="${e(String(r.name) + String(r.id))}" class="record ${i === selected ? "selected" : ""}" ${!(String(r.name) + String(r.id)).toLowerCase().includes(query.toLowerCase()) ? "hidden" : ""}><span class="record-icon">${r.category === "attack" ? "✦" : r.category === "currency" ? "◉" : "◇"}</span><span><strong>${e(r.name)}</strong><small>${e(r.id)}</small></span><b>›</b></button>`).join("")}</div></aside><section class="panel editor-panel"><div class="panel-heading"><div><span class="eyebrow">ITEM CONFIGURATION</span><h2>${e(item?.name ?? "没有道具")}</h2></div><span class="pill">${e(item?.category)}</span></div><p class="editor-hint">数值由行为类型解释：攻击为伤害，经济为产出，冰箱为延迟毫秒数。价格与前置条件在各等级内编辑。</p>${item ? form(item, ["items", selected], w.draft.tables) : ""}</section></div>`;
}
export function managerView(w: Workspace) {
  return `<div class="page-intro"><div><h2>让店长的脾气，刚刚好。</h2><p>管理成长曲线、怒气与升级播报；寻路和撤退策略在「全部配表 → 店长 AI」中调整。</p></div><span class="pill">后端权威数值</span></div><section class="panel">${form(w.draft.tables.manager, ["manager"], w.draft.tables)}</section>`;
}
export function tablesView(w: Workspace, selected: string, raw: boolean) {
  return `<div class="page-intro"><div><h2>每张表，各司其职。</h2><p>统一管理 14 张数值表。高级 JSON 编辑与表单编辑使用同一份草稿。</p></div></div><section class="panel"><div class="table-toolbar"><label>选择配表 <select id="table-select">${Object.entries(
    tableNames,
  )
    .map(
      ([id, name]) =>
        `<option value="${id}" ${selected === id ? "selected" : ""}>${name} · ${id}.json</option>`,
    )
    .join(
      "",
    )}</select></label><button class="button" data-action="toggle-raw">${raw ? "返回表单" : "高级 JSON"}</button><button class="text-btn" data-action="reset">从正式版重新载入</button></div>${raw ? `<textarea id="raw-json" class="json-editor" spellcheck="false" aria-label="配表 JSON">${e(JSON.stringify(w.draft.tables[selected], null, 2))}</textarea><button class="button primary" data-action="apply-json">应用到草稿</button>` : form(w.draft.tables[selected], [selected], w.draft.tables)}</section>`;
}
export function charactersView(assets: Assets, selected: string) {
  const character =
    assets.characters.find((c) => c.id === selected) ?? assets.characters[0];
  if (!character) return "<p>没有已登记的角色资源。</p>";
  const mapped = new Set([
    ...Object.values(character.movementClips),
    ...Object.values(character.retreatClips ?? {}),
    "idle",
    "attack",
    "sleep",
    "wake",
  ]);
  return `<div class="page-intro"><div><h2>动作，在这里看仔细。</h2><p>查看 Web 与 Cocos 共用的真实图集；当前版本提供资源检查，上传和参数编辑将在后续接入。</p></div><a class="button" href="/preview/index.html?character=${encodeURIComponent(character.id)}" target="_blank">独立打开 ↗</a></div><div class="tabs">${assets.characters.map((c) => `<button data-character="${e(c.id)}" class="${c.id === character.id ? "active" : ""}">${c.profile === "shop_manager" ? "店长" : "猫猫"} <small>${e(c.id)}</small></button>`).join("")}</div><div class="preview-layout"><section class="panel preview-panel"><iframe title="角色动作小剧场" src="/preview/index.html?character=${encodeURIComponent(character.id)}&embedded=1"></iframe></section><aside class="panel asset-details"><h3>资源信息</h3><p class="muted">${character.frameSize.join(" × ")} px / 帧</p><div class="version-line"><span>配色</span><b>${character.palettes.skins.length} 套</b></div><div class="version-line"><span>动作</span><b>${Object.keys(character.animations).length} 套</b></div><h4>动作清单</h4>${Object.entries(
    character.animations,
  )
    .map(
      ([name, a]) =>
        `<div class="animation-record"><b>${e(name)}</b><small>${a.frameCount} 帧 · ${a.durationsMs.reduce((x, y) => x + y, 0)} ms · ${a.loop ? "循环" : "单次"}</small><span class="pill ${mapped.has(name) ? "" : "muted-pill"}">${mapped.has(name) ? "已绑定" : "未绑定到游戏"}</span></div>`,
    )
    .join(
      "",
    )}<p class="muted">资源保留与游戏启用是两件事。未绑定的动作仍可在小剧场中检查。</p></aside></div>`;
}
export function themesView(assets: Assets, selected: string) {
  const theme =
    assets.themes.find((t) => t.id === selected) ?? assets.themes[0];
  if (!theme) return "<p>没有已登记的地图资源。</p>";
  return `<div class="page-intro"><div><h2>为猫街，挑一种气氛。</h2><p>查看共享美术库中的地图素材。主题绑定和生成参数可在「全部配表 → 地图生成」调整。</p></div><span class="pill">资源预览</span></div><div class="tabs">${assets.themes.map((t) => `<button data-theme="${e(t.id)}" class="${theme.id === t.id ? "active" : ""}">${e(t.name)}</button>`).join("")}</div><div class="asset-grid">${theme.assets.map((a) => `<a class="asset-card" href="${e(a.src)}" target="_blank"><div class="asset-image ${a.id === "background" ? "background-image" : ""}"><img loading="lazy" src="${e(a.src)}" alt="${e(a.name ?? a.id)}"></div><div><strong>${e(a.name ?? a.id)}</strong><small>${e(a.id)}</small><span>${a.width} × ${a.height} px ↗</span></div></a>`).join("")}</div>`;
}
export function sharedArtBanner(assets: Assets) {
  return `<div class="shared-art-banner"><span class="pill">共享美术库</span><div><strong>Web 与 Cocos 共用一份资源</strong><code>${e(assets.sourceRoot)}</code></div><button class="button" data-action="refresh-assets">刷新资源</button></div>`;
}
export function clientsView(assets: Assets, clients: ClientTarget[]) {
  return `<div class="page-intro"><div><h2>一份美术，两端共用。</h2><p>统一查看角色、图集和地图素材，检查客户端是否指向同一个美术目录。</p></div><span class="pill">client-admin</span></div>${sharedArtBanner(assets)}<div class="client-grid">${clients.map((c) => `<section class="panel client-card"><span class="client-symbol">${c.id === "web" ? "◉" : "◇"}</span><span class="pill ${c.available ? "" : "warn"}">${c.available ? "已连接共享资源" : "需要检查接入"}</span><h2>${e(c.name)}</h2><p class="muted">${e(c.integration)}</p><label>配置指向</label><code class="path-code">${e(c.assetRoot || "未配置")}</code><p class="integration-detail">${c.id === "web" ? "开发时读取共享目录；构建时将资源打包到 client/dist/assets。修改源图后，已构建的游戏需要重新构建。" : "通过 shared-game-assets 扩展挂载共享目录，由 Creator 导入资源。这里显示配置接入状态，实际引擎效果以 Creator 为准。"}</p><label>接入配置</label><code class="path-code">${e(c.configPath)}</code>${c.problem ? `<p class="error-text">${e(c.problem)}</p>` : ""}</section>`).join("")}</div><section class="panel architecture-note"><h3>统一预览，统一维护</h3><p>共享库现有 ${assets.characters.length} 套角色、${assets.themes.length} 套地图主题。工作台直接读取源文件，角色动作预览和地图素材不再按客户端拆分。</p><div class="inline-actions"><button class="button primary" data-nav="characters">查看角色与动作 →</button><button class="button" data-nav="themes">查看地图素材</button></div><p class="muted">本版支持资源浏览与动作检查；素材上传、替换和动画配置编辑尚未开放。数值配表仍通过同一个 C++ 后端发布。</p></section>`;
}
export function historyView(w: Workspace, history: Release[]) {
  return `<div class="page-intro"><div><h2>每次更新，都有来路。</h2><p>回滚会生成一个新的正式版本，并把草稿切换到该版本；已有对局继续使用原配置。</p></div><button class="button" data-action="refresh">刷新记录</button></div><section class="panel"><div class="panel-heading"><h3>版本快照</h3><span class="pill">当前：${shortVersion(w.current.version)}</span></div>${history.length ? `<div class="table-scroll"><table class="history-table"><thead><tr><th>版本</th><th>创建时间</th><th>备注</th><th>状态</th><th></th></tr></thead><tbody>${history.map((r) => `<tr><td><code title="${e(r.version)}">${shortVersion(r.version)}</code></td><td>${e(new Date(r.createdAt).toLocaleString("zh-CN"))}</td><td>${e(r.note)}${r.rollbackFrom ? "<small>由历史版本恢复</small>" : ""}</td><td>${r.id === w.current.release ? '<span class="pill">当前正式版</span>' : "历史快照"}</td><td><button class="button" data-rollback="${e(r.id)}" ${r.id === w.current.release ? "disabled" : ""}>回滚到此版本</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><span>↶</span><h3>还没有发布记录</h3><p>第一次发布时，会自动保留当前原始配置，之后每个版本都可在这里查看和回滚。</p></div>'}</section>`;
}
export function diffView(w: Workspace) {
  const changes = differences(w.current.tables, w.draft.tables);
  const text = (value: Json | undefined) =>
    value === undefined ? "（不存在）" : JSON.stringify(value);
  return `<p class="muted">共 ${changes.length} 处修改。路径中的数组序号从 0 开始。</p><div class="diff-list">${changes.map((d) => `<article><code>${e(d.path)}</code><div><del>${e(text(d.before))}</del><ins>${e(text(d.after))}</ins></div></article>`).join("") || "<p>草稿与正式版一致。</p>"}</div>`;
}
