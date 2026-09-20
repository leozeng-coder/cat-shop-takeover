import type { AudioWorkspace } from "../shared/audio";
import type { Assets, Tables } from "./types";
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
  assets(): Assets;
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
  private view: AudioViewState = {
    mode: "library",
    category: "ui",
    selected: "",
    playing: "",
    query: "",
  };
  constructor(private hooks: Hooks) {
    this.player.preservesPitch = false;
    this.player.onended = () => {
      this.stop();
      this.hooks.render();
    };
  }
  accept(value: AudioWorkspace) {
    this.workspace = value;
    this.dirty = false;
    this.checked = false;
  }
  render() {
    return this.workspace
      ? audioView(
          this.workspace,
          this.view,
          this.hooks.tables(),
          this.hooks.assets(),
        )
      : '<div class="empty-state">音效加载中…</div>';
  }
  stop() {
    ++this.previewGeneration;
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
              (audioTargets(
                binding.event,
                this.hooks.tables(),
                this.hooks.assets(),
              ).find((target) => target.id === binding.target)?.name ??
                binding.target) +
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
      this.view.mode = button.dataset.value as AudioViewState["mode"];
      this.hooks.render();
    } else if (action === "category") {
      this.view.category = button.dataset.value as AudioViewState["category"];
      this.hooks.render();
    } else if (action === "close-detail") {
      this.view.selected = "";
      this.hooks.render();
    } else if (action === "select") {
      this.view.selected = id;
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
        try {
          await this.player.play();
        } catch {
          this.stop();
          throw new Error("音频无法播放，请检查文件格式");
        }
        this.view.playing = previewKey;
        this.hooks.render();
      });
    } else if (action === "override") {
      const rows = this.workspace.draft.tables.bindings;
      const target = audioTargets(
        id,
        this.hooks.tables(),
        this.hooks.assets(),
      ).find((t) => !rows.some((b) => b.event === id && b.target === t.id));
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
