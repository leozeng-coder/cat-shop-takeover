import type {
  AudioCategory,
  AudioWorkspace,
  AudioBinding,
} from "../shared/audio";
import type { Row, Tables } from "./types";
import { escape as e } from "./editor";
import { icon } from "./navigation";

export const audioCategories: Record<AudioCategory, string> = {
  ui: "界面交互",
  character: "角色交互",
  item: "道具音效",
  door: "门与战斗",
  match: "对局提示",
  music: "环境与音乐",
};
export interface AudioViewState {
  mode: "library" | "bindings";
  category: AudioCategory;
  selected: string;
  playing: string;
  query: string;
  bindEvent: string;
  bindTarget: string;
  group: string;
  groupEditor: { id: string; name: string } | null;
}
const time = (seconds: number) =>
  seconds < 60
    ? seconds.toFixed(1) + " 秒"
    : Math.floor(seconds / 60) + " 分 " + Math.round(seconds % 60) + " 秒";
function options(rows: { id: string; name: string }[], value: string) {
  return rows
    .map(
      (row) =>
        `<option value="${e(row.id)}" ${row.id === value ? "selected" : ""}>${e(row.name)}</option>`,
    )
    .join("");
}
export function audioTargets(event: string, tables: Tables) {
  let rows: { id: string; name: string }[] = [];
  if (event === "music.night" || event === "music.day")
    rows = ((tables.map_generation as Row).profiles as Row[]).map((p) => ({
      id: String(p.id),
      name: String(p.name),
    }));
  return [{ id: "*", name: "默认" }, ...rows];
}
function bindingOptions(w: AudioWorkspace, b: AudioBinding) {
  return options([{ id: "", name: "不播放" }, ...w.draft.tables.clips], b.clip);
}
function groupNavigation(w: AudioWorkspace, view: AudioViewState) {
  const { clips, groups = [] } = w.draft.tables;
  const current = groups.find((group) => group.id === view.group);
  const entries = [
    { id: "*", name: "全部" },
    { id: "", name: "未分类" },
    ...groups,
  ];
  return `<div class="audio-group-bar"><div class="audio-groups" aria-label="音频分类">${entries.map((group) => `<button class="audio-group" data-audio="filter-group" data-id="${e(group.id)}" ${group.id === "*" ? "" : `data-audio-drop="${e(group.id)}"`} aria-pressed="${view.group === group.id}" title="${e(group.name)}${group.id === "*" ? "" : " · 拖入音频归类"}"><span>${e(group.name)}</span><small>${clips.filter((clip) => group.id === "*" || (clip.group ?? "") === group.id).length}</small></button>`).join("")}<button class="text-btn audio-new-group" data-audio="new-group">＋ 新建分类</button></div>${current ? `<div class="audio-group-actions"><button class="text-btn" data-audio="rename-group" data-id="${e(current.id)}">重命名</button><button class="text-btn" data-audio="delete-group" data-id="${e(current.id)}">删除分类</button></div>` : ""}</div>`;
}
function groupEditor(view: AudioViewState) {
  if (!view.groupEditor) return "";
  return `<dialog id="audio-group-dialog" class="audio-group-dialog" aria-labelledby="audio-group-title"><form id="audio-group-form"><div class="audio-dialog-heading"><h2 id="audio-group-title">${view.groupEditor.id ? "重命名分类" : "新建分类"}</h2><button type="button" class="text-btn" data-audio="close-group" aria-label="关闭分类弹窗">×</button></div><label class="field"><span>分类名称</span><input id="audio-group-name" aria-label="分类名称" value="${e(view.groupEditor.name)}" maxlength="32" required autofocus autocomplete="off" placeholder="例如：猫叫、战斗、音乐"></label><div class="audio-dialog-footer"><button type="button" class="button" data-audio="close-group">取消</button><button class="button primary" type="submit">${view.groupEditor.id ? "保存名称" : "创建分类"}</button></div></form></dialog>`;
}
function audioDetails(w: AudioWorkspace, view: AudioViewState, tables: Tables) {
  const clip = w.draft.tables.clips.find((entry) => entry.id === view.selected);
  if (!clip) return "";
  const uses = w.draft.tables.bindings
    .map((binding, index) => ({ binding, index }))
    .filter(({ binding }) => binding.clip === clip.id);
  const targets = audioTargets(view.bindEvent, tables);
  const existing = w.draft.tables.bindings.find(
    (binding) =>
      binding.event === view.bindEvent && binding.target === view.bindTarget,
  );
  const currentClip = w.draft.tables.clips.find(
    (entry) => entry.id === existing?.clip,
  );
  const alreadyBound = existing?.clip === clip.id;
  const bindingLabel = (binding: AudioBinding) =>
    (w.events.find((event) => event.id === binding.event)?.name ??
      binding.event) +
    (binding.target === "*"
      ? ""
      : " · " +
        (audioTargets(binding.event, tables).find(
          (target) => target.id === binding.target,
        )?.name ?? binding.target));
  return `<dialog id="audio-detail-dialog" class="audio-detail-dialog" aria-labelledby="audio-detail-title">
    <div class="audio-dialog-heading"><div><span class="muted">音频详情</span><h2 id="audio-detail-title">${e(clip.name)}</h2></div><button class="text-btn" data-audio="close-detail" aria-label="关闭音频详情" autofocus>×</button></div>
    <p class="audio-file-meta">${time(clip.duration)} · ${(clip.bytes / 1024).toFixed(0)} KB · ${e(clip.file.split(".").at(-1)?.toUpperCase())}</p>
    <section class="audio-detail-bindings"><h3>已绑定 <span>${uses.length}</span></h3><div class="audio-bound-list">${uses.length ? uses.map(({ binding, index }) => `<div class="audio-bound-row"><div><strong>${e(bindingLabel(binding))}</strong><small>音量 ${binding.volume}× · 速度 ${binding.playbackRate ?? 1}× · 延迟 ${(binding.delayMs ?? 0) / 1000} 秒</small></div><button class="text-btn" data-audio="unbind" data-index="${index}" aria-label="解绑${e(bindingLabel(binding))}">解绑</button></div>`).join("") : '<p class="muted">暂未绑定事件</p>'}</div></section>
    <section class="audio-add-binding"><h3>继续绑定</h3><div class="audio-bind-controls"><label class="field"><span>事件</span><select id="audio-bind-event" aria-label="绑定事件">${Object.entries(
      audioCategories,
    )
      .map(
        ([category, name]) =>
          `<optgroup label="${name}">${options(
            w.events
              .filter((event) => event.category === category)
              .map((event) => ({ id: event.id, name: event.name })),
            view.bindEvent,
          )}</optgroup>`,
      )
      .join(
        "",
      )}</select></label>${targets.length > 1 ? `<label class="field"><span>地图</span><select id="audio-bind-target" aria-label="绑定地图">${options(targets, view.bindTarget)}</select></label>` : ""}<button class="button primary" data-audio="bind" ${alreadyBound ? "disabled" : ""}>${alreadyBound ? "已绑定" : currentClip ? "替换绑定" : "绑定"}</button></div>${currentClip && !alreadyBound ? `<p class="audio-binding-replacement">将替换「${e(currentClip.name)}」</p>` : ""}</section>
    <details class="audio-file-info"><summary>文件信息</summary><label class="field"><span>名称</span><input data-audio-clip="name" value="${e(clip.name)}" maxlength="60" required aria-label="音频名称"></label><label class="field"><span>分类</span><select data-audio-clip="group" aria-label="音频所属分类">${options([{ id: "", name: "未分类" }, ...(w.draft.tables.groups ?? [])], clip.group ?? "")}</select></label><button class="button" data-audio="replace" data-id="${e(clip.id)}">替换文件</button></details>
    <div class="audio-dialog-footer"><button class="button" data-audio="close-detail">完成</button></div>
  </dialog>`;
}
export function audioView(
  w: AudioWorkspace,
  view: AudioViewState,
  tables: Tables,
) {
  const draft = w.draft.tables;
  const current = {
    clips: w.current.clips,
    bindings: w.current.bindings,
    settings: w.current.settings,
    groups: w.current.groups,
  };
  const changed = (["clips", "bindings", "settings", "groups"] as const).some(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(draft[key]),
  );
  let html = `<div class="audio-toolbar"><div class="tabs" aria-label="音效页面">${[
    ["library", "音效库"],
    ["bindings", "事件绑定"],
  ]
    .map(
      ([id, name]) =>
        `<button data-audio="mode" data-value="${id}" aria-pressed="${view.mode === id}" class="${view.mode === id ? "active" : ""}">${name}</button>`,
    )
    .join(
      "",
    )}</div><div class="inline-actions"><span class="pill ${w.conflict ? "warn" : ""}">${w.conflict ? "版本冲突" : changed ? "待发布" : "已同步"}</span><button class="button" data-audio="reload">刷新</button><button class="button primary" data-audio="upload">＋ 上传音频</button></div></div><input type="file" id="audio-upload" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden>`;
  if (view.mode === "bindings")
    html += `<div class="audio-categories" aria-label="事件分类">${Object.entries(
      audioCategories,
    )
      .map(
        ([id, name]) =>
          `<button data-audio="category" data-value="${id}" aria-pressed="${view.category === id}">${name}</button>`,
      )
      .join("")}</div>`;
  if (view.mode === "library") {
    const clips = draft.clips.filter(
      (c) =>
        c.name.toLowerCase().includes(view.query.toLowerCase()) &&
        (view.group === "*" || (c.group ?? "") === view.group),
    );
    const showUngroupZone = !!view.group && view.group !== "*";
    html += `<div class="audio-library-layout ${showUngroupZone ? "has-ungroup-zone" : ""}">${showUngroupZone ? '<aside class="audio-ungroup-zone" data-audio-drop="" aria-label="取消分类" title="拖入并松开，移回未分类"><span>取消分类</span></aside>' : ""}`;
    html += `<section class="panel audio-list"><div class="panel-heading audio-library-heading"><h3>${clips.length} 段音频</h3>${groupNavigation(w, view)}<span class="muted audio-drag-hint">双击试听 · 拖到分类归类</span></div><input id="audio-search" type="search" placeholder="搜索音效" aria-label="搜索音效" value="${e(view.query)}"><div class="audio-records">${clips.length ? clips.map((c) => `<article class="audio-record ${view.playing === c.id ? "playing" : ""}"><div class="audio-card-face" data-audio-card data-audio="preview" data-id="${e(c.id)}" role="button" tabindex="0" aria-label="试听${e(c.name)}" aria-pressed="${view.playing === c.id}" title="${e(c.name)} · 双击试听 / 拖动归类"><span class="audio-record-icon">${icon("audio")}</span><strong>${e(c.name)}</strong><small>${view.playing === c.id ? "正在试听" : time(c.duration)}</small></div><div class="audio-card-actions"><button class="text-btn" data-audio="details" data-id="${e(c.id)}" aria-label="${e(c.name)}详情">详情</button><button class="text-btn" data-audio="delete" data-id="${e(c.id)}" aria-label="删除${e(c.name)}">删除</button></div></article>`).join("") : '<div class="audio-empty">' + icon("audio") + (view.query ? "<strong>没有匹配的音频</strong>" : view.group !== "*" ? "<strong>这个分类还没有音频</strong><span>从全部音频拖入，或直接上传</span>" : "<strong>还没有音频</strong><span>上传后即可试听和绑定</span>") + "</div>"}</div></section>`;
    html += "</div>";
    html += audioDetails(w, view, tables);
    html += groupEditor(view);
  } else if (view.mode === "bindings") {
    html += `<section class="panel audio-bindings"><div class="panel-heading"><h3>${audioCategories[view.category]}</h3></div>${w.events
      .filter((ev) => ev.category === view.category)
      .map((event) => {
        const targets = audioTargets(event.id, tables);
        const entries = draft.bindings
          .map((b, index) => ({ b, index }))
          .filter(({ b }) => b.event === event.id);
        const available = targets.filter(
          (t) => !entries.some(({ b }) => b.target === t.id),
        );
        return `<div class="audio-event"><div class="audio-event-heading"><strong>${event.name}</strong>${available.length ? `<button class="text-btn" data-audio="override" data-id="${e(event.id)}">＋ 单独设置</button>` : ""}</div>${entries
          .map(
            ({ b, index }) =>
              `<div class="audio-binding">${
                b.target === "*"
                  ? ""
                  : `<label class="field audio-target"><span>${event.category === "music" ? "地图" : "对象"}</span><select data-audio-binding="target" data-index="${index}">${options(
                      targets.filter(
                        (t) =>
                          t.id === b.target ||
                          !entries.some(
                            ({ b: other }) => other.target === t.id,
                          ),
                      ),
                      b.target,
                    )}</select></label>`
              }<label class="field"><span>音频</span><select data-audio-binding="clip" data-index="${index}" aria-label="${e(event.name)}音频">${bindingOptions(w, b)}</select></label><label class="field audio-volume"><span>音量（倍）</span><input type="number" min="0" max="4" step="0.05" data-audio-binding="volume" data-index="${index}" value="${b.volume}" aria-label="${e(event.name)}音量" title="0～4 倍，1 为默认音量"></label><label class="field audio-rate"><span>播放速度</span><div class="audio-rate-input"><input type="number" min="0.5" max="2" step="0.05" data-audio-binding="playbackRate" data-index="${index}" value="${b.playbackRate ?? 1}" aria-label="${e(event.name)}播放速度" title="0.5～2 倍，1 为原速"><span>×</span></div></label><label class="field audio-delay"><span>延迟（秒）</span><input type="number" min="0" max="10" step="0.05" data-audio-binding="delayMs" data-index="${index}" value="${(b.delayMs ?? 0) / 1000}" aria-label="${e(event.name)}延迟" title="0～10 秒，0 为立即播放"></label><button class="audio-preview-btn" data-audio="preview" data-id="${e(b.clip)}" data-index="${index}" aria-label="试听${event.name}" ${!b.clip ? "disabled" : ""}>${view.playing === "binding:" + index && b.clip ? "■" : "▶"}</button>${b.target !== "*" ? `<button class="text-btn" data-audio="remove-binding" data-index="${index}" aria-label="移除单独设置">×</button>` : ""}</div>`,
          )
          .join("")}</div>`;
      })
      .join("")}</section>`;
  }
  return html;
}
