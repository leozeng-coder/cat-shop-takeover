import type {
  AudioCategory,
  AudioWorkspace,
  AudioBinding,
} from "../shared/audio";
import type { Row, Tables, Assets } from "./types";
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
export function audioTargets(event: string, tables: Tables, assets: Assets) {
  let rows: { id: string; name: string }[] = [];
  if (event === "music.night" || event === "music.day")
    rows = ((tables.map_generation as Row).profiles as Row[]).map((p) => ({
      id: String(p.id),
      name: String(p.name),
    }));
  else if (event.startsWith("character."))
    rows = assets.characters
      .filter((c) => c.profile !== "shop_manager")
      .map((c) => ({ id: c.id, name: c.name ?? c.id }));
  else if (event.startsWith("item.")) {
    rows = (tables.items as Row[]).map((item) => ({
      id: String(item.id),
      name: String(item.name),
    }));
    if (event === "item.upgrade")
      rows.push({ id: "nest", name: "罐头窝" }, { id: "door", name: "店门" });
  } else if (event.startsWith("door.")) {
    rows = [
      ...new Map(
        (tables.doors as Row[]).map((door) => [
          String(door.appearance),
          {
            id: String(door.appearance),
            name: String(door.name ?? door.appearance),
          },
        ]),
      ).values(),
    ];
  }
  return [{ id: "*", name: "默认" }, ...rows];
}
function bindingOptions(w: AudioWorkspace, b: AudioBinding) {
  return options([{ id: "", name: "不播放" }, ...w.draft.tables.clips], b.clip);
}
export function audioView(
  w: AudioWorkspace,
  view: AudioViewState,
  tables: Tables,
  assets: Assets,
) {
  const draft = w.draft.tables;
  const current = {
    clips: w.current.clips,
    bindings: w.current.bindings,
    settings: w.current.settings,
  };
  const changed = (["clips", "bindings", "settings"] as const).some(
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
    const clips = draft.clips.filter((c) =>
      c.name.toLowerCase().includes(view.query.toLowerCase()),
    );
    const selected = draft.clips.find((c) => c.id === view.selected);
    html += `<div class="audio-library ${selected ? "has-selection" : ""}"><section class="panel audio-list"><div class="panel-heading"><h3>${clips.length} 段音频</h3><span class="muted">MP3 / WAV · ≤ 20 MB</span></div><input id="audio-search" type="search" placeholder="搜索音效" aria-label="搜索音效" value="${e(view.query)}"><div class="audio-records">${clips.length ? clips.map((c) => `<button class="audio-record ${selected?.id === c.id ? "selected" : ""}" data-audio="select" data-id="${e(c.id)}" aria-pressed="${selected?.id === c.id}" title="${e(c.name)}"><span class="audio-record-icon">${icon("audio")}</span><span><strong>${e(c.name)}</strong><small>${time(c.duration)}</small></span></button>`).join("") : '<div class="audio-empty">' + icon("audio") + (view.query ? "<strong>没有匹配的音频</strong>" : "<strong>还没有音频</strong><span>上传后即可试听和绑定</span>") + "</div>"}</div></section>`;
    if (selected) {
      const uses = draft.bindings.filter((b) => b.clip === selected.id);
      html += `<section class="panel audio-detail"><div class="panel-heading"><h2>音频详情</h2><button class="text-btn" data-audio="close-detail" aria-label="关闭音频详情">×</button></div><div class="audio-player"><button class="audio-play" data-audio="preview" data-id="${e(selected.id)}" aria-label="${view.playing === selected.id ? "停止试听" : "试听音效"}">${view.playing === selected.id ? "■" : "▶"}</button><div><strong>${e(selected.name)}</strong><small>${time(selected.duration)} · ${(selected.bytes / 1024).toFixed(0)} KB · ${selected.file.split(".").at(-1)?.toUpperCase()}</small></div></div><label class="field"><span>名称</span><input data-audio-clip="name" value="${e(selected.name)}" maxlength="60" required></label><div class="audio-file-actions"><button class="button" data-audio="replace" data-id="${e(selected.id)}">替换文件</button><button class="text-btn" data-audio="delete" data-id="${e(selected.id)}">删除</button></div><div class="audio-uses"><h3>已绑定 · ${uses.length}</h3>${uses.length ? uses.map((b) => `<span class="pill">${e(w.events.find((ev) => ev.id === b.event)?.name)}${b.target === "*" ? "" : " · " + e(audioTargets(b.event, tables, assets).find((t) => t.id === b.target)?.name ?? b.target)}</span>`).join("") : '<p class="muted">暂未绑定</p>'}<button class="text-btn" data-audio="mode" data-value="bindings">管理绑定 →</button></div></section>`;
    }
    html += "</div>";
  } else if (view.mode === "bindings") {
    html += `<section class="panel audio-bindings"><div class="panel-heading"><h3>${audioCategories[view.category]}</h3></div>${w.events
      .filter((ev) => ev.category === view.category)
      .map((event) => {
        const targets = audioTargets(event.id, tables, assets);
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
              }<label class="field"><span>音频</span><select data-audio-binding="clip" data-index="${index}" aria-label="${e(event.name)}音频">${bindingOptions(w, b)}</select></label><label class="field audio-volume"><span>音量（倍）</span><input type="number" min="0" max="4" step="0.05" data-audio-binding="volume" data-index="${index}" value="${b.volume}" aria-label="${e(event.name)}音量" title="0～4 倍，1 为默认音量"></label><label class="field audio-rate"><span>播放速度</span><div class="audio-rate-input"><input type="number" min="0.5" max="2" step="0.05" data-audio-binding="playbackRate" data-index="${index}" value="${b.playbackRate ?? 1}" aria-label="${e(event.name)}播放速度" title="0.5～2 倍，1 为原速"><span>×</span></div></label><button class="audio-preview-btn" data-audio="preview" data-id="${e(b.clip)}" data-index="${index}" aria-label="试听${event.name}" ${!b.clip ? "disabled" : ""}>${view.playing === "binding:" + index && b.clip ? "■" : "▶"}</button>${b.target !== "*" ? `<button class="text-btn" data-audio="remove-binding" data-index="${index}" aria-label="移除单独设置">×</button>` : ""}</div>`,
          )
          .join("")}</div>`;
      })
      .join("")}</section>`;
  }
  return html;
}
