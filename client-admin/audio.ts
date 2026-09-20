import type { AudioWorkspace } from "../shared/audio";
import type { Tables } from "./types";
import { api, audioPreview, uploadAudio } from "./api";
import { audioTargets, audioView, type AudioViewState } from "./audio_views";
import { escape as e } from "./editor";

interface Hooks {
  render(): void;
  status(): void;
  notice(message: string, error?: boolean): void;
  run(job: () => Promise<void>): Promise<void>;
  dialog(title: string, body: string, confirm?: string): Promise<boolean>;
  tables(): Tables;
}
export class AudioAdmin {
  workspace: AudioWorkspace | null = null;
  dirty = false;
  checked = false;
  private player = new Audio();
  private context: AudioContext | null = null;
  private previewGain: GainNode | null = null;
  private previewUrl = "";
  private previewGeneration = 0;
  private previewBinding: number | null = null;
  private previewTimer: number | null = null;
  private draggedClip = "";
  private dragPreview: HTMLElement | null = null;
  private dragOrigin: {
    id: string;
    x: number;
    y: number;
    pointerId: number;
    card: HTMLElement;
    offsetX: number;
    offsetY: number;
  } | null = null;
  private view: AudioViewState = {
    mode: "library",
    category: "ui",
    selected: "",
    playing: "",
    query: "",
    bindEvent: "ui.click",
    bindTarget: "*",
    group: "*",
    groupEditor: null,
  };
  constructor(private hooks: Hooks) {
    this.player.preservesPitch = false;
    this.player.onended = () => {
      this.stop();
      if (!this.draggedClip) this.hooks.render();
    };
    window.addEventListener("blur", () => this.cancelDrag());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.dragOrigin) {
        event.preventDefault();
        this.cancelDrag();
      }
    });
  }
  accept(value: AudioWorkspace) {
    this.workspace = value;
    this.dirty = false;
    this.checked = false;
    if (
      this.view.group &&
      this.view.group !== "*" &&
      !value.draft.tables.groups?.some((group) => group.id === this.view.group)
    ) {
      this.view.group = "*";
    }
  }
  render() {
    this.clearDrag();
    return this.workspace
      ? audioView(this.workspace, this.view, this.hooks.tables())
      : '<div class="empty-state">音效加载中…</div>';
  }
  afterRender() {
    const dialog = document.getElementById(
      this.view.groupEditor ? "audio-group-dialog" : "audio-detail-dialog",
    ) as HTMLDialogElement | null;
    if (!dialog) return;
    dialog.showModal();
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeModal();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        this.closeModal();
    });
  }
  private closeModal() {
    if (this.view.groupEditor) {
      const action = this.view.groupEditor.id ? "rename-group" : "new-group";
      this.view.groupEditor = null;
      this.hooks.render();
      document
        .querySelector<HTMLButtonElement>(`[data-audio="${action}"]`)
        ?.focus();
    } else this.closeDetails();
  }
  saveGroup() {
    const editor = this.view.groupEditor;
    if (!editor || !this.workspace) return;
    const input = document.getElementById(
      "audio-group-name",
    ) as HTMLInputElement;
    const name = input.value.trim();
    const groups = this.workspace.draft.tables.groups ?? [];
    const error =
      !name || name.length > 32
        ? "请输入 1～32 字的分类名称"
        : ["全部", "未分类"].includes(name) ||
            groups.some(
              (group) => group.id !== editor.id && group.name === name,
            )
          ? "这个分类名称已存在"
          : !editor.id && groups.length >= 64
            ? "最多创建 64 个分类"
            : "";
    input.setCustomValidity(error);
    if (error) {
      input.reportValidity();
      return;
    }
    if (editor.id) {
      const group = groups.find((entry) => entry.id === editor.id);
      if (!group) return;
      group.name = name;
    } else groups.push({ id: "group_" + crypto.randomUUID(), name });
    this.workspace.draft.tables.groups = groups;
    this.dirty = true;
    this.checked = false;
    this.closeModal();
  }
  drag(event: PointerEvent) {
    if (event.type === "pointerdown") {
      const card =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-audio-card]")
          : null;
      if (!card || event.button !== 0 || !event.isPrimary) return;
      const bounds = card.closest(".audio-record")!.getBoundingClientRect();
      this.dragOrigin = {
        id: card.dataset.id ?? "",
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        card,
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
      };
      card.setPointerCapture(event.pointerId);
      return;
    }
    const origin = this.dragOrigin;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const target = hit?.closest<HTMLElement>("[data-audio-drop]");
    const tables = this.workspace?.draft.tables;
    const clip = tables?.clips.find((entry) => entry.id === origin.id);
    if (event.type === "pointermove") {
      if (
        !this.draggedClip &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 8
      )
        return;
      event.preventDefault();
      this.draggedClip = origin.id;
      if (!this.dragPreview) {
        const record = origin.card.closest<HTMLElement>(".audio-record")!;
        const bounds = record.getBoundingClientRect();
        this.dragPreview = record.cloneNode(true) as HTMLElement;
        this.dragPreview.classList.remove("playing", "dragging");
        this.dragPreview.classList.add("audio-drag-preview");
        this.dragPreview.setAttribute("aria-hidden", "true");
        this.dragPreview.inert = true;
        this.dragPreview.style.width = `${bounds.width}px`;
        this.dragPreview.style.height = `${bounds.height}px`;
        document.body.append(this.dragPreview);
        document.body.classList.add("audio-dragging");
      }
      this.dragPreview.style.transform = `translate3d(${event.clientX - origin.offsetX}px, ${event.clientY - origin.offsetY}px, 0)`;
      this.dragPreview.classList.toggle("can-drop", !!target);
      origin.card.closest(".audio-record")?.classList.add("dragging");
      document
        .querySelectorAll("[data-audio-drop].drop-target")
        .forEach((group) => {
          if (group !== target) group.classList.remove("drop-target");
        });
      target?.classList.add("drop-target");
      return;
    }
    if (
      event.type !== "pointerup" &&
      event.type !== "pointercancel" &&
      event.type !== "lostpointercapture"
    )
      return;
    const dragged = !!this.draggedClip;
    if (dragged && event.type === "pointerup") {
      const group = target?.dataset.audioDrop;
      if (
        clip &&
        group !== undefined &&
        (group === "" || tables?.groups?.some((entry) => entry.id === group)) &&
        (clip.group ?? "") !== group
      ) {
        clip.group = group;
        this.dirty = true;
        this.checked = false;
      }
    }
    this.clearDrag();
    if (dragged) this.hooks.render();
  }
  private clearDrag() {
    const origin = this.dragOrigin;
    const dragged = !!this.draggedClip;
    if (!origin && !this.dragPreview) return false;
    this.dragOrigin = null;
    this.draggedClip = "";
    this.dragPreview?.remove();
    this.dragPreview = null;
    document.body.classList.remove("audio-dragging");
    origin?.card.closest(".audio-record")?.classList.remove("dragging");
    document
      .querySelectorAll("[data-audio-drop].drop-target")
      .forEach((group) => {
        group.classList.remove("drop-target");
      });
    if (origin?.card.hasPointerCapture(origin.pointerId)) {
      origin.card.releasePointerCapture(origin.pointerId);
    }
    return dragged;
  }
  private cancelDrag() {
    if (this.clearDrag()) this.hooks.render();
  }
  private closeDetails() {
    const id = this.view.selected;
    this.view.selected = "";
    this.hooks.render();
    Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-audio="details"]'),
    )
      .find((button) => button.dataset.id === id)
      ?.focus();
  }
  stop() {
    ++this.previewGeneration;
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.player.pause();
    this.player.removeAttribute("src");
    this.player.load();
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = "";
    this.previewBinding = null;
    this.view.playing = "";
  }
  private updatePreviewSettings() {
    const tables = this.workspace!.draft.tables;
    const binding =
      this.previewBinding === null
        ? undefined
        : tables.bindings[this.previewBinding];
    const volume = binding
      ? binding.volume *
        tables.settings.masterVolume *
        (binding.event.startsWith("music.")
          ? tables.settings.musicVolume
          : tables.settings.effectsVolume)
      : 1;
    this.player.volume = 1;
    if (this.previewGain)
      this.previewGain.gain.value = Math.max(0, Math.min(4, volume));
    this.player.playbackRate = Math.max(
      0.5,
      Math.min(2, binding?.playbackRate ?? 1),
    );
  }
  input(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
    if (!this.workspace) return false;
    if (target.id === "audio-group-name") {
      target.setCustomValidity("");
      if (this.view.groupEditor) this.view.groupEditor.name = target.value;
      return true;
    }
    if (target.id === "audio-bind-event" || target.id === "audio-bind-target") {
      if (target.id === "audio-bind-event") {
        this.view.bindEvent = target.value;
        this.view.bindTarget = "*";
      } else this.view.bindTarget = target.value;
      this.hooks.render();
      return true;
    }
    if (target.id === "audio-search") {
      this.view.query = target.value;
      const position = (target as HTMLInputElement).selectionStart;
      this.hooks.render();
      const search = document.getElementById(
        "audio-search",
      ) as HTMLInputElement;
      search.focus();
      search.setSelectionRange(position, position);
      return true;
    }
    const { audioClip, audioBinding } = target.dataset;
    const key = audioClip ?? audioBinding;
    if (!key) return false;
    const tables = this.workspace.draft.tables;
    const row = audioClip
      ? tables.clips.find((c) => c.id === this.view.selected)
      : tables.bindings[Number(target.dataset.index)];
    if (!row) return true;
    let value: string | number | boolean = target.value;
    if (target.type === "checkbox")
      value = (target as HTMLInputElement).checked;
    if (target.type === "number") {
      if (!target.value || !Number.isFinite(Number(target.value))) {
        target.setCustomValidity("请输入有效数值");
        return true;
      }
      target.setCustomValidity("");
      value = Number(target.value);
      if (audioBinding === "delayMs") value = Math.round(value * 1000);
    }
    (row as unknown as Record<string, unknown>)[key] = value;
    this.dirty = true;
    this.checked = false;
    this.hooks.status();
    if (audioBinding && Number(target.dataset.index) === this.previewBinding) {
      if (key === "volume" || key === "playbackRate")
        this.updatePreviewSettings();
      else this.stop();
    }
    if (audioBinding && (key === "clip" || key === "target"))
      this.hooks.render();
    return true;
  }
  async save() {
    if (!this.workspace || !this.dirty) return;
    for (const [
      index,
      binding,
    ] of this.workspace.draft.tables.bindings.entries()) {
      const fields = [
        {
          key: "volume",
          name: "音量",
          value: binding.volume,
          min: 0,
          max: 4,
          unit: " 倍",
        },
        {
          key: "playbackRate",
          name: "播放速度",
          value: binding.playbackRate ?? 1,
          min: 0.5,
          max: 2,
          unit: " 倍",
        },
        {
          key: "delayMs",
          name: "延迟播放",
          value: (binding.delayMs ?? 0) / 1000,
          min: 0,
          max: 10,
          unit: " 秒",
        },
      ];
      for (const field of fields) {
        if (
          Number.isFinite(field.value) &&
          field.value >= field.min &&
          field.value <= field.max
        )
          continue;
        const event = this.workspace.events.find(
          (entry) => entry.id === binding.event,
        )!;
        const object =
          binding.target === "*"
            ? ""
            : "（" +
              (audioTargets(binding.event, this.hooks.tables()).find(
                (target) => target.id === binding.target,
              )?.name ?? binding.target) +
              "）";
        const message = `事件「${event.name}」${object}的${field.name}必须在 ${field.min}～${field.max}${field.unit}之间，当前值：${field.value}`;
        this.view.mode = "bindings";
        this.view.category = event.category;
        this.hooks.render();
        const input = document.querySelector<HTMLInputElement>(
          `[data-audio-binding="${field.key}"][data-index="${index}"]`,
        );
        input?.setCustomValidity(message);
        input?.focus();
        input?.reportValidity();
        throw new Error(message);
      }
    }
    const invalid = document.querySelector<HTMLInputElement>(
      "#content input:invalid",
    );
    if (invalid) {
      invalid.reportValidity();
      throw new Error(
        `${invalid.getAttribute("aria-label") ?? "音效信息"}：${invalid.validationMessage}`,
      );
    }
    const { revision, tables } = this.workspace.draft;
    this.accept(await api<AudioWorkspace>("audio-save", { revision, tables }));
  }
  async validate() {
    await this.save();
    await api("audio-validate", { revision: this.workspace!.draft.revision });
    this.checked = true;
  }
  async publish() {
    await this.validate();
    this.accept(
      await api<AudioWorkspace>("audio-publish", {
        revision: this.workspace!.draft.revision,
      }),
    );
    this.hooks.render();
    this.hooks.notice("音效已发布，游戏将在 10 秒内更新");
  }
  async upload(input: HTMLInputElement) {
    const file = input.files?.[0],
      id = input.dataset.replace ?? "";
    if (!file || !this.workspace) return;
    input.value = "";
    await this.hooks.run(async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error("单个音频最大 20 MB");
      const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
      if (!["mp3", "wav"].includes(extension))
        throw new Error("仅支持 MP3 和 WAV");
      await this.save();
      const known = new Set(
        this.workspace!.draft.tables.clips.map((c) => c.id),
      );
      this.accept(
        await uploadAudio<AudioWorkspace>(
          {
            extension,
            id,
            revision: this.workspace!.draft.revision,
            name: file.name.replace(/\.[^.]+$/, "").slice(0, 60),
            category: this.view.category,
            group: this.view.group === "*" ? "" : this.view.group,
          },
          file,
        ),
      );
      this.view.selected =
        id ||
        this.workspace!.draft.tables.clips.find((c) => !known.has(c.id))!.id;
      this.view.mode = "library";
      this.view.query = "";
      this.stop();
      this.hooks.render();
      this.hooks.notice(
        id ? "文件已替换，发布后生效" : "上传成功，选择事件绑定后发布",
      );
    });
  }
  async click(button: HTMLElement) {
    if (!this.workspace) return;
    const action = button.dataset.audio,
      id = button.dataset.id ?? "";
    if (action === "mode") {
      this.stop();
      this.view.selected = "";
      this.view.mode = button.dataset.value as AudioViewState["mode"];
      this.hooks.render();
    } else if (action === "filter-group") {
      this.view.group = id;
      this.hooks.render();
    } else if (action === "new-group" || action === "rename-group") {
      const group = this.workspace.draft.tables.groups?.find(
        (entry) => entry.id === id,
      );
      if (action === "rename-group" && !group) return;
      this.stop();
      this.view.groupEditor = { id: group?.id ?? "", name: group?.name ?? "" };
      this.hooks.render();
    } else if (action === "close-group") {
      this.closeModal();
    } else if (action === "delete-group") {
      const tables = this.workspace.draft.tables;
      const group = tables.groups?.find((entry) => entry.id === id);
      if (!group) return;
      this.stop();
      this.hooks.render();
      if (
        !(await this.hooks.dialog(
          "删除分类",
          `<p>删除「${e(group.name)}」？其中的音频会移回未分类，事件绑定保留。</p>`,
          "删除分类",
        ))
      )
        return;
      tables.groups = tables.groups!.filter((entry) => entry.id !== id);
      for (const clip of tables.clips) if (clip.group === id) clip.group = "";
      if (this.view.group === id) this.view.group = "";
      this.dirty = true;
      this.checked = false;
      this.hooks.render();
    } else if (action === "category") {
      this.stop();
      this.view.category = button.dataset.value as AudioViewState["category"];
      this.hooks.render();
    } else if (action === "close-detail") {
      this.closeDetails();
    } else if (action === "details") {
      this.stop();
      this.view.selected = id;
      this.view.bindEvent =
        this.workspace.events.find(
          (event) =>
            !this.workspace!.draft.tables.bindings.find(
              (binding) => binding.event === event.id && binding.target === "*",
            )?.clip,
        )?.id ?? this.workspace.events[0].id;
      this.view.bindTarget = "*";
      this.hooks.render();
    } else if (action === "bind") {
      const clip = this.workspace.draft.tables.clips.find(
        (entry) => entry.id === this.view.selected,
      );
      if (!clip) return;
      const rows = this.workspace.draft.tables.bindings;
      const event = this.view.bindEvent,
        target = this.view.bindTarget;
      if (
        !audioTargets(event, this.hooks.tables()).some(
          (entry) => entry.id === target,
        )
      )
        return;
      let binding = rows.find(
        (entry) => entry.event === event && entry.target === target,
      );
      if (!binding) {
        const base = rows.find(
          (entry) => entry.event === event && entry.target === "*",
        );
        if (!base) return;
        binding = { ...base, target };
        rows.push(binding);
      }
      binding.clip = clip.id;
      binding.enabled = true;
      this.dirty = true;
      this.checked = false;
      this.hooks.render();
    } else if (action === "unbind") {
      const binding =
        this.workspace.draft.tables.bindings[Number(button.dataset.index)];
      if (!binding || binding.clip !== this.view.selected) return;
      binding.clip = "";
      this.dirty = true;
      this.checked = false;
      this.hooks.render();
    } else if (action === "upload" || action === "replace") {
      const input = document.getElementById("audio-upload") as HTMLInputElement;
      input.dataset.replace = action === "replace" ? id : "";
      input.click();
    } else if (action === "preview") {
      const index =
        button.dataset.index === undefined
          ? null
          : Number(button.dataset.index);
      const previewKey = index === null ? id : "binding:" + index;
      const wasPlaying = this.view.playing === previewKey;
      this.stop();
      if (!id || wasPlaying) {
        this.hooks.render();
        return;
      }
      const clip = this.workspace.draft.tables.clips.find((c) => c.id === id);
      if (!clip) return;
      const generation = this.previewGeneration;
      const delayMs =
        index === null
          ? 0
          : (this.workspace.draft.tables.bindings[index].delayMs ?? 0);
      if (delayMs < 0 || delayMs > 10000) {
        this.hooks.notice("延迟播放必须在 0～10 秒之间", true);
        return;
      }
      const playAt = performance.now() + delayMs;
      await this.hooks.run(async () => {
        if (!this.context) {
          this.context = new AudioContext();
          this.previewGain = this.context.createGain();
          this.context
            .createMediaElementSource(this.player)
            .connect(this.previewGain)
            .connect(this.context.destination);
        }
        if (this.context.state === "suspended") await this.context.resume();
        const blob = await audioPreview(clip.file);
        if (generation !== this.previewGeneration) return;
        this.previewUrl = URL.createObjectURL(blob);
        this.player.src = this.previewUrl;
        this.previewBinding = index;
        this.updatePreviewSettings();
        this.view.playing = previewKey;
        this.hooks.render();
        const play = async () => {
          this.previewTimer = null;
          if (generation !== this.previewGeneration) return;
          try {
            await this.player.play();
          } catch {
            if (generation !== this.previewGeneration) return;
            this.stop();
            this.hooks.render();
            this.hooks.notice("音频无法播放，请检查文件格式", true);
          }
        };
        const remaining = Math.max(0, playAt - performance.now());
        if (remaining > 0)
          this.previewTimer = window.setTimeout(() => {
            void play();
          }, remaining);
        else await play();
      });
    } else if (action === "override") {
      const rows = this.workspace.draft.tables.bindings;
      const target = audioTargets(id, this.hooks.tables()).find(
        (t) => !rows.some((b) => b.event === id && b.target === t.id),
      );
      const base = rows.find((b) => b.event === id && b.target === "*");
      if (target && base) {
        rows.push({ ...base, target: target.id, clip: "" });
        this.dirty = true;
        this.checked = false;
        this.hooks.render();
      }
    } else if (action === "remove-binding") {
      this.stop();
      this.workspace.draft.tables.bindings.splice(
        Number(button.dataset.index),
        1,
      );
      this.dirty = true;
      this.checked = false;
      this.hooks.render();
    } else if (action === "delete") {
      const clip = this.workspace.draft.tables.clips.find((c) => c.id === id)!;
      if (!clip) return;
      this.stop();
      const count = this.workspace.draft.tables.bindings.filter(
        (b) => b.clip === id,
      ).length;
      if (
        !(await this.hooks.dialog(
          "删除音效",
          `<p>${e(clip.name)}</p>${count ? `<p>同时解除 ${count} 处绑定。</p>` : ""}`,
          "删除并解除绑定",
        ))
      )
        return;
      this.stop();
      this.workspace.draft.tables.clips =
        this.workspace.draft.tables.clips.filter((c) => c.id !== id);
      for (const b of this.workspace.draft.tables.bindings)
        if (b.clip === id) b.clip = "";
      this.view.selected = "";
      this.dirty = true;
      this.checked = false;
      this.hooks.render();
    } else if (action === "reload") {
      if (
        this.dirty &&
        !(await this.hooks.dialog(
          "重新载入音效草稿",
          "<p>未保存的音效修改将丢失。</p>",
          "重新载入",
        ))
      )
        return;
      await this.hooks.run(async () => {
        this.stop();
        this.accept(await api<AudioWorkspace>("audio"));
        this.hooks.render();
      });
    }
  }
}
