import "./style.css";
import { api, ApiError, setAccess } from "./api";
import { addEntry, differences, escape, readPath, setPath } from "./editor";
import {
  charactersView,
  clientsView,
  diffView,
  historyView,
  home,
  itemsView,
  login,
  managerView,
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
};
let clients: ClientTarget[] = [];
let releases: Release[] = [];
let page = "home",
  table = "manager",
  character = "cat_orange",
  theme = "snack_street";
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
  applyRaw();
  const invalid = app.querySelector<HTMLInputElement>("input:invalid");
  if (invalid) {
    invalid.reportValidity();
    throw new Error("请先填写有效的数值");
  }
  if (!dirty) return;
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
  const changedPage = renderedPage !== page;
  renderedPage = page;
  app.innerHTML = shell(page);
  const content = el("content");
  if (page === "home") content.innerHTML = home(workspace, assets);
  else if (page === "items")
    content.innerHTML = itemsView(workspace, item, query);
  else if (page === "manager") content.innerHTML = managerView(workspace);
  else if (page === "tables")
    content.innerHTML = tablesView(workspace, table, raw);
  else if (page === "characters")
    content.innerHTML =
      sharedArtBanner(assets) + charactersView(assets, character);
  else if (page === "themes")
    content.innerHTML = sharedArtBanner(assets) + themesView(assets, theme);
  else if (page === "history")
    content.innerHTML = historyView(workspace, releases);
  else if (page === "clients") content.innerHTML = clientsView(assets, clients);
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
  const [value, info, targets] = await Promise.all([
    api<Workspace>("workspace"),
    api<Assets>("assets"),
    api<ClientTarget[]>("clients"),
  ]);
  accept(value);
  assets = info;
  clients = targets;
  render();
}
app.addEventListener("submit", (event) => {
  if ((event.target as HTMLElement).id !== "login-form") return;
  event.preventDefault();
  const token = new FormData(event.target as HTMLFormElement).get(
    "access",
  ) as string;
  void run(() => connect(token.trim()));
});
app.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
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
app.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "button,a[data-action],a[data-nav]",
  );
  if (!button || busy) return;
  if (button.dataset.nav) {
    event.preventDefault();
    try {
      applyRaw();
    } catch (error) {
      notice(String(error), true);
      return;
    }
    page = button.dataset.nav;
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
    character = button.dataset.character;
    render();
    return;
  }
  if (button.dataset.theme) {
    theme = button.dataset.theme;
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
  if (action === "save")
    void run(async () => {
      await save();
      render();
      notice("草稿已保存，正式对局不受影响。");
    });
  else if (action === "validate")
    void run(async () => {
      await save();
      await api("validate", { revision: workspace.draft.revision });
      checked = workspace.draft.revision;
      notice("14 张配表整包校验通过，等级、货币和前置条件引用有效。");
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
      notice("JSON 已应用到本地草稿，点击保存后持久化。");
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
      const [info, targets] = await Promise.all([
        api<Assets>("assets"),
        api<ClientTarget[]>("clients"),
      ]);
      assets = info;
      clients = targets;
      render();
      notice("已重新读取共享美术资源与客户端接入配置。");
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
    notice("没有需要发布的修改。");
    return;
  }
  const revision = workspace.draft.revision;
  if (
    !(await dialog(
      "发布新的数值版本",
      `<p>本次修改将用于新对局。已经开始的对局继续使用原配置。</p>${diffView(workspace)}<label class="field"><span>发布备注</span><input id="release-note" maxlength="500" placeholder="例如：降低冰箱升级价格"></label>`,
      "发布到新对局",
    ))
  )
    return;
  const note = el<HTMLInputElement>("release-note").value;
  void run(async () => {
    accept(await api<Workspace>("publish", { revision, note }));
    render();
    notice("发布成功。新建或重新开始的对局将使用这个版本。");
  });
}
async function rollback(id: string) {
  const release = releases.find((r) => r.id === id)!;
  const revision = workspace.draft.revision,
    currentRevision = workspace.current.revision;
  if (
    !(await dialog(
      "回滚到历史版本",
      `<p>将恢复 <strong>${escape(release.version)}</strong> 的数值并生成新版本。</p><p>${escape(release.note)}</p><p class="error-text">当前草稿也会被替换。如需保留，请取消并先导出草稿。</p>`,
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
    notice("已恢复历史配置，并保留了本次回滚记录。");
  });
}
async function reset() {
  if (
    !(await dialog(
      "从正式版重新载入",
      "<p>这会替换当前草稿，包括尚未保存的修改。需要保留时请先导出草稿。</p>",
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
    (dirty || rawDirty) &&
    !(await dialog(
      "退出工作台",
      "<p>还有未保存的修改。确认退出后，这些修改不会保存。</p>",
      "退出",
    ))
  )
    return;
  remember("");
  dirty = false;
  rawDirty = false;
  app.innerHTML = login();
}
window.addEventListener("beforeunload", (event) => {
  if (dirty || rawDirty) {
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
