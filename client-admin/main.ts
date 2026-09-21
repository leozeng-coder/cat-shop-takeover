import "./map_editor.css";
import { pickupLevelAction } from "./pickup_editor";
import { isMapItemReference, validateDefaultMapItems } from "./item_choices";
import {
  editMapField,
  mapAction,
  mapTabKeydown,
  revealMapField,
  switchMapTab,
  validateMapSettings,
} from "./map_editor";
import "./style.css";
import "./workspace.css";
import "./audio.css";
import "./random_rewards.css";
import "./item_editor.css";
import "./resource_editor.css";
import { switchItemTab, itemTabKeydown, revealItemField } from "./item_editor";
import {
  editRandomReward,
  randomRewardAction,
  refreshRewardTotals,
  rememberRewardDisclosure,
  validateRandomRewards,
  validateMapRewards,
} from "./random_rewards";
import { AudioAdmin } from "./audio";
import type { AudioWorkspace } from "../shared/audio";
import { api, ApiError, setAccess } from "./api";
import { addEntry, differences, escape, readPath, setPath } from "./editor";
import { locationFor } from "./navigation";
import { mapsView } from "./catalog_views";
import {
  resources,
  resourcesView,
  visibleResources,
  ResourcePreview,
  drawCurve,
} from "./resource_editor";
import { DEFAULT_VISUAL, visual } from "../shared/presentation";
import type { CharacterRole } from "./characters";
import {
  charactersView,
  clientsView,
  diffView,
  historyView,
  home,
  itemsView,
  login,
  pageNavigation,
  shell,
  sharedArtBanner,
  tablesView,
  themesView,
} from "./views";
import type {
  Assets,
  ClientTarget,
  FieldPath,
  Json,
  Release,
  Row,
  Workspace,
} from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let workspace: Workspace;
let assets: Assets = {
  sourceRoot: "",
  urlPrefix: "/assets/",
  characters: [],
  themes: [],
  doors: [],
  items: [],
  presentation: { version: 1, entries: {} },
  presentationRevision: "",
};
let clients: ClientTarget[] = [];
let releases: Release[] = [];
let page = "home",
  table = "manager",
  theme = "snack_street";
const selectedCharacters: Record<CharacterRole, string> = {
  cats: "cat_orange",
  managers: "shop_manager",
};
let mapIndex = 0,
  assetKind = "all",
  resourceScene = "snack_street";
let selectedResource = "",
  resourceQuery = "",
  visualDirty = false;
const resourcePreview = new ResourcePreview();
let item = 0,
  query = "",
  raw = false,
  dirty = false,
  rawDirty = false,
  busy = false,
  checked = "";
let renderedPage = "";
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const audioAdmin = new AudioAdmin({
  render,
  status,
  notice,
  run,
  dialog,
  tables: () => workspace.draft.tables,
});
function remember(token: string) {
  setAccess(token);
  try {
    token
      ? sessionStorage.setItem("admin-access", token)
      : sessionStorage.removeItem("admin-access");
  } catch {
    /* Storage is optional. */
  }
}
function status() {
  const label = document.getElementById("save-status");
  if (label && page === "resources") {
    label.textContent = visualDirty ? "● 展示参数未保存" : "✓ 展示参数已保存";
    return;
  }
  if (label && page === "audio") {
    label.textContent = audioAdmin.dirty
      ? "● 音效有未保存修改"
      : audioAdmin.checked
        ? "✓ 音效校验通过"
        : "✓ 音效草稿已保存";
    return;
  }
  if (label)
    label.textContent =
      dirty || rawDirty
        ? "● 有未保存修改"
        : checked === workspace?.draft.revision
          ? "✓ 校验通过"
          : "✓ 草稿已保存";
}
function notice(message: string, error = false) {
  const target = document.getElementById("notice");
  if (!target) {
    const loginError = document.getElementById("login-error");
    if (loginError) loginError.textContent = message;
    return;
  }
  target.hidden = false;
  target.classList.toggle("error", error);
  target.textContent = message;
}
async function run(job: () => Promise<void>) {
  if (busy) return;
  busy = true;
  app.inert = true;
  document.body.classList.add("is-busy");
  try {
    await job();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      remember("");
      app.innerHTML = login();
    }
    notice(error instanceof Error ? error.message : String(error), true);
  } finally {
    busy = false;
    app.inert = false;
    document.body.classList.remove("is-busy");
    status();
  }
}
function accept(value: Workspace) {
  workspace = value;
  dirty = false;
  rawDirty = false;
  checked = "";
}
function applyRaw() {
  if (!rawDirty) return;
  const parsed: Json = JSON.parse(el<HTMLTextAreaElement>("raw-json").value);
  const list = Array.isArray(workspace.current.tables[table]);
  if (
    list
      ? !Array.isArray(parsed) ||
        parsed.some(
          (row) =>
            row === null || typeof row !== "object" || Array.isArray(row),
        )
      : parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
  ) {
    throw new Error(
      list ? "这张配表必须是对象数组" : "这张配表必须是 JSON 对象",
    );
  }
  workspace.draft.tables[table] = parsed;
  rawDirty = false;
  dirty = true;
  checked = "";
}
async function save() {
  if (page === "audio") {
    await audioAdmin.save();
    return;
  }
  applyRaw();
  const invalid = app.querySelector<HTMLInputElement>("input:invalid");
  if (invalid) {
    revealItemField(invalid, app);
    revealMapField(invalid);
    for (
      let parent = invalid.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    invalid.reportValidity();
    throw new Error("请先填写有效的数值");
  }
  if (!dirty) return;
  validateRandomRewards(workspace.draft.tables);
  validateDefaultMapItems(workspace.draft.tables);
  validateMapSettings(workspace.draft.tables);
  validateMapRewards(workspace.draft.tables);
  accept(
    await api<Workspace>("draft", {
      revision: workspace.draft.revision,
      tables: workspace.draft.tables,
    }),
  );
}
async function dialog(
  title: string,
  body: string,
  confirm = "确认操作",
): Promise<boolean> {
  const target = el<HTMLDialogElement>("confirm");
  el("dialog-content").innerHTML = `<h2>${escape(title)}</h2>${body}`;
  target.querySelector<HTMLButtonElement>(
    'button[value="confirm"]',
  )!.textContent = confirm;
  target.returnValue = "";
  target.showModal();
  return new Promise((resolve) =>
    target.addEventListener(
      "close",
      () => resolve(target.returnValue === "confirm"),
      { once: true },
    ),
  );
}
function render() {
  rememberRewardDisclosure(app);
  resourcePreview.stop();
  const active = locationFor(page);
  const changedPage = renderedPage !== page;
  renderedPage = page;
  app.innerHTML = shell(page);
  const content = el("content");
  if (page === "home") content.innerHTML = home(workspace, assets);
  else if (page === "audio") content.innerHTML = audioAdmin.render();
  else if (page === "items")
    content.innerHTML = itemsView(workspace, item, query);
  else if (active.page.table)
    content.innerHTML = tablesView(workspace, active.page.table, raw, true);
  else if (page === "tables")
    content.innerHTML = tablesView(workspace, table, raw);
  else if (page === "characters" || page === "manager-characters") {
    const role = active.page.group as CharacterRole;
    content.innerHTML =
      sharedArtBanner(assets) +
      charactersView(assets, selectedCharacters[role], role);
  } else if (page === "maps")
    content.innerHTML = mapsView(workspace, assets, mapIndex);
  else if (page === "resources")
    content.innerHTML =
      sharedArtBanner(assets, true) +
      resourcesView(
        assets,
        workspace,
        assetKind,
        resourceScene,
        selectedResource,
        resourceQuery,
      );
  else if (page === "themes")
    content.innerHTML = sharedArtBanner(assets) + themesView(assets, theme);
  else if (page === "history")
    content.innerHTML = historyView(workspace, releases);
  else if (page === "clients") content.innerHTML = clientsView(assets, clients);
  content.insertAdjacentHTML("afterbegin", pageNavigation(page));
  if (page === "audio") audioAdmin.afterRender();
  if (page === "resources") {
    if (!assets.themes.some((theme) => theme.id === resourceScene))
      resourceScene = assets.themes[0]?.id ?? "";
    const all = visibleResources(
      resources(assets, workspace),
      assetKind,
      resourceScene,
      resourceQuery,
    );
    const chosen = all.find((asset) => asset.id === selectedResource) ?? all[0];
    if (chosen) {
      selectedResource = chosen.id;
      resourcePreview.start(
        chosen,
        () => visual(assets.presentation, chosen.id),
        assets,
        resourceScene,
      );
      drawCurve(visual(assets.presentation, chosen.id));
    }
  }
  refreshRewardTotals(content, workspace.draft.tables);
  if (changedPage) window.scrollTo(0, 0);
  status();
  if (workspace.conflict)
    notice(
      "正式配置已变化。请导出当前草稿保留修改，再从正式版重新载入。",
      true,
    );
}
async function connect(token: string) {
  remember(token);
  const [value, info, targets, sounds] = await Promise.all([
    api<Workspace>("workspace"),
    api<Assets>("assets"),
    api<ClientTarget[]>("clients"),
    api<AudioWorkspace>("audio"),
  ]);
  accept(value);
  assets = info;
  clients = targets;
  audioAdmin.accept(sounds);
  render();
}
app.addEventListener("submit", (event) => {
  if ((event.target as HTMLElement).id === "audio-group-form") {
    event.preventDefault();
    if (!busy) audioAdmin.saveGroup();
    return;
  }
  if ((event.target as HTMLElement).id !== "login-form") return;
  event.preventDefault();
  const token = new FormData(event.target as HTMLFormElement).get(
    "access",
  ) as string;
  void run(() => connect(token.trim()));
});
app.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (audioAdmin.input(target)) return;
  if (page === "resources" && target instanceof HTMLInputElement) {
    if (target.id === "resource-search") {
      resourceQuery = target.value;
      app
        .querySelectorAll<HTMLElement>("[data-resource-id]")
        .forEach((card) => {
          card.hidden =
            !card.textContent
              ?.toLowerCase()
              .includes(resourceQuery.toLowerCase()) &&
            !card.dataset.resourceId
              ?.toLowerCase()
              .includes(resourceQuery.toLowerCase());
        });
      return;
    }
    if (
      target.dataset.visualField ||
      target.dataset.visualCurve !== undefined
    ) {
      const value = Number(target.value);
      if (!target.validity.valid || !Number.isFinite(value)) return;
      const settings =
        assets.presentation.entries[selectedResource] ??
        (assets.presentation.entries[selectedResource] =
          structuredClone(DEFAULT_VISUAL));
      if (target.dataset.visualCurve !== undefined)
        settings.curve[Number(target.dataset.visualCurve)] = value;
      else
        (settings as unknown as Record<string, number>)[
          target.dataset.visualField!
        ] = value;
      visualDirty = true;
      drawCurve(settings);
      resourcePreview.invalidate();
      status();
      return;
    }
  }
  if (
    target instanceof HTMLInputElement &&
    target.dataset.mapField &&
    editMapField(target, workspace.draft.tables)
  ) {
    dirty = true;
    checked = "";
    refreshRewardTotals(app, workspace.draft.tables);
    status();
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.rewardField) {
    editRandomReward(target, workspace.draft.tables);
    dirty = true;
    checked = "";
    refreshRewardTotals(app, workspace.draft.tables);
    status();
    return;
  }
  if (target.id === "item-search") {
    query = target.value;
    app
      .querySelectorAll<HTMLElement>("[data-search]")
      .forEach(
        (row) =>
          (row.hidden = !row.dataset
            .search!.toLowerCase()
            .includes(query.toLowerCase())),
      );
    return;
  }
  if (target.id === "raw-json") {
    rawDirty = true;
    status();
    return;
  }
  if (!target.dataset.path) return;
  const path = JSON.parse(target.dataset.path) as FieldPath;
  let value: Json = target.value;
  if (target.type === "checkbox") value = (target as HTMLInputElement).checked;
  else if (target.type === "number") {
    if (target.value === "" || !Number.isFinite(Number(target.value))) {
      target.setCustomValidity("请输入有效数值");
      status();
      return;
    }
    target.setCustomValidity("");
    value = Number(target.value);
  }
  setPath(workspace.draft.tables, path, value);
  dirty = true;
  checked = "";
  status();
});
app.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target instanceof HTMLSelectElement && target.dataset.path) {
    const path = JSON.parse(target.dataset.path) as FieldPath;
    if (isMapItemReference(path)) {
      setPath(workspace.draft.tables, path, target.value);
      dirty = true;
      checked = "";
      render();
      return;
    }
  }
  if (
    target instanceof HTMLSelectElement &&
    editRandomReward(target, workspace.draft.tables)
  ) {
    dirty = true;
    checked = "";
    render();
    return;
  }
  if (target.id === "audio-upload") {
    void audioAdmin.upload(event.target as HTMLInputElement);
    return;
  }
  if (target.id === "table-select") {
    try {
      applyRaw();
      table = target.value;
      render();
    } catch (error) {
      target.value = table;
      notice(String(error), true);
    }
  }
});
for (const type of [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "lostpointercapture",
] as const) {
  app.addEventListener(type, (event) => {
    if (!busy) audioAdmin.drag(event);
  });
}
app.addEventListener("dblclick", (event) => {
  if (busy) return;
  const card = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-audio-card]",
  );
  if (card) void audioAdmin.click(card);
});
app.addEventListener("keydown", (event) => {
  if (!busy && (itemTabKeydown(event, app) || mapTabKeydown(event))) return;
  if (busy || (event.key !== "Enter" && event.key !== " ")) return;
  const card = event.target as HTMLElement;
  if (!card.matches("[data-audio-card]")) return;
  event.preventDefault();
  void audioAdmin.click(card);
});
app.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "button,a[data-action],a[data-nav]",
  );
  if (!button || busy) return;
  if (switchItemTab(button, app) || switchMapTab(button)) return;
  if (
    button.dataset.pickupAction &&
    pickupLevelAction(button, workspace.draft.tables)
  ) {
    dirty = true;
    checked = "";
    render();
    return;
  }
  if (button.dataset.mapAction && mapAction(button, workspace.draft.tables)) {
    dirty = true;
    checked = "";
    render();
    return;
  }
  if (
    button.dataset.rewardAction &&
    randomRewardAction(button, workspace.draft.tables)
  ) {
    dirty = true;
    checked = "";
    render();
    return;
  }
  if (button.dataset.audio) {
    void audioAdmin.click(button);
    return;
  }
  if (button.dataset.nav) {
    event.preventDefault();
    try {
      applyRaw();
    } catch (error) {
      notice(String(error), true);
      return;
    }
    const next = locationFor(button.dataset.nav);
    if (page === "audio" && next.page.id !== "audio") audioAdmin.stop();
    if (page !== next.page.id) raw = false;
    page = next.page.id;
    if (next.page.table) table = next.page.table;
    if (button.dataset.selectCharacter && next.page.group)
      selectedCharacters[next.page.group as CharacterRole] =
        button.dataset.selectCharacter;
    if (button.dataset.selectTheme) theme = button.dataset.selectTheme;
    if (button.dataset.selectMap !== undefined)
      mapIndex = Number(button.dataset.selectMap);
    if (page === "history")
      void run(async () => {
        releases = await api<Release[]>("history");
        render();
      });
    else render();
    return;
  }
  if (button.dataset.item !== undefined) {
    item = Number(button.dataset.item);
    render();
    return;
  }
  if (button.dataset.character) {
    const role = locationFor(page).page.group as CharacterRole;
    selectedCharacters[role] = button.dataset.character;
    render();
    return;
  }
  if (button.dataset.theme) {
    theme = button.dataset.theme;
    render();
    return;
  }
  if (button.dataset.mapIndex !== undefined) {
    mapIndex = Number(button.dataset.mapIndex);
    render();
    return;
  }
  if (button.dataset.assetKind) {
    assetKind = button.dataset.assetKind;
    render();
    return;
  }
  if (button.dataset.resourceScene) {
    resourceScene = button.dataset.resourceScene;
    render();
    return;
  }
  if (button.dataset.resourceId) {
    selectedResource = button.dataset.resourceId;
    render();
    return;
  }
  if (button.dataset.add || button.dataset.remove) {
    event.preventDefault();
    if (button.dataset.add)
      addEntry(workspace.draft.tables, JSON.parse(button.dataset.add));
    else {
      const path = JSON.parse(button.dataset.remove!) as FieldPath;
      (readPath(workspace.draft.tables, path.slice(0, -1)) as Json[]).splice(
        Number(path.at(-1)),
        1,
      );
    }
    dirty = true;
    checked = "";
    render();
    return;
  }
  const action = button.dataset.action;
  if (
    page === "resources" &&
    (action === "save-presentation" || action === "save")
  ) {
    void run(async () => {
      const invalid = app.querySelector<HTMLInputElement>(
        ".resource-inspector input:invalid",
      );
      if (invalid) {
        invalid.reportValidity();
        throw new Error("请填写有效的展示参数");
      }
      if (!visualDirty) return;
      const saved = await api<
        Pick<Assets, "presentation" | "presentationRevision">
      >("presentation-save", {
        revision: assets.presentationRevision,
        entries: assets.presentation.entries,
      });
      assets.presentation = saved.presentation;
      assets.presentationRevision = saved.presentationRevision;
      visualDirty = false;
      render();
      notice("展示参数已保存，刷新游戏页面后生效");
    });
    return;
  }
  if (
    page === "audio" &&
    ["save", "validate", "publish"].includes(action ?? "")
  ) {
    void run(async () => {
      if (action === "publish") await audioAdmin.publish();
      else if (action === "validate") {
        await audioAdmin.validate();
        notice("音效校验通过");
      } else {
        await audioAdmin.save();
        render();
        notice("音效草稿已保存");
      }
    });
    return;
  }
  if (action === "save")
    void run(async () => {
      await save();
      render();
      notice("草稿已保存");
    });
  else if (action === "validate")
    void run(async () => {
      await save();
      await api("validate", { revision: workspace.draft.revision });
      checked = workspace.draft.revision;
      notice("校验通过");
    });
  else if (action === "publish") void publish();
  else if (button.dataset.rollback) void rollback(button.dataset.rollback);
  else if (action === "diff") {
    try {
      applyRaw();
      void dialog("草稿修改对比", diffView(workspace), "关闭");
    } catch (error) {
      notice(String(error), true);
    }
  } else if (action === "toggle-raw") {
    try {
      applyRaw();
      raw = !raw;
      render();
    } catch (error) {
      notice(String(error), true);
    }
  } else if (action === "apply-json") {
    try {
      applyRaw();
      status();
      notice("已应用，待保存");
    } catch (error) {
      notice("JSON 格式错误：" + String(error), true);
    }
  } else if (action === "export") {
    try {
      applyRaw();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(workspace.draft.tables, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "cat-shop-draft.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notice(String(error), true);
    }
  } else if (action === "clone-item") {
    const rows = workspace.draft.tables.items as Row[];
    const copy = structuredClone(rows[item]);
    copy.id = String(copy.id) + "_copy_" + Date.now().toString(36);
    copy.name = String(copy.name) + "（副本）";
    rows.push(copy);
    item = rows.length - 1;
    dirty = true;
    render();
  } else if (action === "refresh-assets")
    void run(async () => {
      if (visualDirty) {
        notice("先保存展示参数，再刷新资源", true);
        return;
      }
      const [info, targets] = await Promise.all([
        api<Assets>("assets"),
        api<ClientTarget[]>("clients"),
      ]);
      assets = info;
      clients = targets;
      render();
      notice("资源已刷新");
    });
  else if (action === "refresh")
    void run(async () => {
      releases = await api<Release[]>("history");
      const latest = await api<Workspace>("workspace");
      if (!dirty && !rawDirty) accept(latest);
      render();
    });
  else if (action === "reset") void reset();
  else if (action === "logout") void logout();
});
async function publish() {
  await run(async () => {
    await save();
    await api("validate", { revision: workspace.draft.revision });
    checked = workspace.draft.revision;
  });
  if (checked !== workspace.draft.revision) return;
  if (!differences(workspace.current.tables, workspace.draft.tables).length) {
    notice("无待发布修改");
    return;
  }
  const revision = workspace.draft.revision;
  if (
    !(await dialog(
      "发布新的数值版本",
      `<p>仅对新对局生效。</p>${diffView(workspace)}<label class="field"><span>发布备注</span><input id="release-note" maxlength="500" placeholder="例如：降低冰箱升级价格"></label>`,
      "发布到新对局",
    ))
  )
    return;
  const note = el<HTMLInputElement>("release-note").value;
  void run(async () => {
    accept(await api<Workspace>("publish", { revision, note }));
    render();
    notice("已发布，新对局生效");
  });
}
async function rollback(id: string) {
  const release = releases.find((r) => r.id === id)!;
  const revision = workspace.draft.revision,
    currentRevision = workspace.current.revision;
  if (
    !(await dialog(
      "回滚到历史版本",
      `<p>恢复版本 <strong>${escape(release.version)}</strong></p><p class="error-text">将覆盖当前草稿，生成新版本。仅对新对局生效。</p>`,
      "确认回滚",
    ))
  )
    return;
  void run(async () => {
    accept(
      await api<Workspace>("rollback", {
        release: id,
        revision,
        currentRevision,
      }),
    );
    releases = await api<Release[]>("history");
    render();
    notice("回滚成功");
  });
}
async function reset() {
  if (
    !(await dialog(
      "从正式版重新载入",
      "<p>以正式版覆盖草稿，未发布的修改将丢失。</p>",
      "重新载入",
    ))
  )
    return;
  void run(async () => {
    accept(
      await api<Workspace>("reset", { revision: workspace.draft.revision }),
    );
    render();
  });
}
async function logout() {
  if (
    (dirty || rawDirty || audioAdmin.dirty) &&
    !(await dialog("退出工作台", "<p>退出将丢弃未保存的修改。</p>", "退出"))
  )
    return;
  remember("");
  audioAdmin.stop();
  dirty = false;
  rawDirty = false;
  app.innerHTML = login();
}
window.addEventListener("beforeunload", (event) => {
  if (dirty || rawDirty || audioAdmin.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "s" && workspace) {
    event.preventDefault();
    void run(async () => {
      await save();
      notice("草稿已保存");
    });
  }
});
app.innerHTML = login();
let token = new URLSearchParams(location.hash.slice(1)).get("access") ?? "";
if (token) history.replaceState(null, "", location.pathname);
if (!token)
  try {
    token = sessionStorage.getItem("admin-access") ?? "";
  } catch {
    /* Optional. */
  }
if (token) void run(() => connect(token));
