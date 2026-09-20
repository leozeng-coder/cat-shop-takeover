import type { AudioBinding, AudioCatalog, AudioClip } from '../../../shared/audio';
import type { State } from '../types';

export class AudioSystem {
  private catalog: AudioCatalog | null = null;
  private context: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private voices = new Map<string, Set<AudioBufferSourceNode>>();
  private scheduled = new Map<AudioBufferSourceNode, number>();
  private cooldowns = new Map<string, number>();
  private music = new Audio();
  private musicGain: GainNode | null = null;
  private musicKey = '';
  private musicRequest = '';
  private musicTimer: number | null = null;
  private scene = 'music.home';
  private map = '*';
  private cursor: number | null = null;
  private game = '';
  private unlocked = false;
  private refreshing = false;
  private muted = false;
  private generation = 0;
  onChange: (() => void) | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem('cat-shop-muted') === 'true';
    } catch {
      /* Optional preference. */
    }
    this.music.loop = true;
    this.music.preservesPitch = false;
    this.music.preload = 'auto';
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopEffects();
        this.stopMusic();
      } else {
        void this.refresh();
        this.updateMusic();
      }
    });
    void this.refresh();
    window.setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, 10000);
  }
  isMuted() {
    return this.muted;
  }
  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.musicGain = this.context.createGain();
      this.context
        .createMediaElementSource(this.music)
        .connect(this.musicGain)
        .connect(this.context.destination);
    }
    this.unlocked = true;
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    this.updateMusic();
  }
  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('cat-shop-muted', String(this.muted));
    } catch {
      /* Optional preference. */
    }
    if (this.muted) this.stopEffects();
    this.updateMusic();
    this.onChange?.();
  }
  private async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const response = await fetch('/api/audio', {
        headers: this.catalog ? { 'If-None-Match': '"' + this.catalog.revision + '"' } : {},
        cache: 'no-cache',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 304 || !response.ok) return;
      const next = (await response.json()) as AudioCatalog;
      if (next.revision === this.catalog?.revision) return;
      if (!Array.isArray(next.clips) || !Array.isArray(next.bindings) || !next.settings) return;
      this.catalog = next;
      ++this.generation;
      this.cancelScheduledEffects();
      const files = new Set(next.clips.map((c) => c.file));
      for (const file of this.buffers.keys()) if (!files.has(file)) this.buffers.delete(file);
      this.cooldowns.clear();
      if (!next.settings.enabled) this.stopEffects();
      this.updateMusic();
    } catch {
      /* Audio cannot block gameplay; retry on the next refresh. */
    } finally {
      this.refreshing = false;
    }
  }
  private resolve(event: string, target = '*'): { binding: AudioBinding; clip: AudioClip } | null {
    if (!this.catalog) return null;
    const binding = this.catalog.bindings.find((b) => b.event === event && b.target === target);
    if (!binding?.enabled || !binding.clip) return null;
    const clip = this.catalog.clips.find((c) => c.id === binding.clip && c.enabled);
    return clip ? { binding, clip } : null;
  }
  private available() {
    return this.unlocked && !this.muted && !document.hidden && this.catalog?.settings.enabled;
  }
  private async buffer(clip: AudioClip): Promise<AudioBuffer> {
    const cached = this.buffers.get(clip.file);
    if (cached) return cached;
    const pending = this.loading.get(clip.file);
    if (pending) return pending;
    const load = (async () => {
      const response = await fetch('/assets/audio/files/' + clip.file, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Audio unavailable');
      const decoded = await this.context!.decodeAudioData(await response.arrayBuffer());
      // Bound decoded memory, independent of the uploaded compressed size.
      let size = decoded.length * decoded.numberOfChannels * 4;
      for (const buffer of this.buffers.values()) size += buffer.length * buffer.numberOfChannels * 4;
      while (size > 64 * 1024 * 1024 && this.buffers.size) {
        const [key, oldest] = this.buffers.entries().next().value!;
        size -= oldest.length * oldest.numberOfChannels * 4;
        this.buffers.delete(key);
      }
      if (decoded.duration <= 30) this.buffers.set(clip.file, decoded);
      return decoded;
    })();
    this.loading.set(clip.file, load);
    try {
      return await load;
    } finally {
      this.loading.delete(clip.file);
    }
  }
  play(event: string, attenuation = 1) {
    if (!this.available() || !this.context || attenuation <= 0) return;
    const resolved = this.resolve(event);
    if (!resolved) return;
    const { binding, clip } = resolved;
    const key = event,
      now = performance.now();
    const playAt = now + (binding.delayMs ?? 0);
    if (now - (this.cooldowns.get(key) ?? -Infinity) < binding.cooldownMs) return;
    if ((this.voices.get(key)?.size ?? 0) >= binding.maxVoices) return;
    this.cooldowns.set(key, now);
    const generation = this.generation;
    void this.buffer(clip)
      .then((buffer) => {
        if (!this.available() || generation !== this.generation || performance.now() - playAt > 800) return;
        const voices = this.voices.get(key) ?? new Set<AudioBufferSourceNode>();
        if (
          voices.size >= binding.maxVoices ||
          [...this.voices.values()].reduce((n, v) => n + v.size, 0) >= 24
        )
          return;
        const source = this.context!.createBufferSource(),
          gain = this.context!.createGain();
        source.buffer = buffer;
        source.playbackRate.value = binding.playbackRate ?? 1;
        gain.gain.value =
          binding.volume *
          attenuation *
          this.catalog!.settings.masterVolume *
          this.catalog!.settings.effectsVolume;
        source.connect(gain).connect(this.context!.destination);
        voices.add(source);
        this.voices.set(key, voices);
        source.onended = () => {
          this.scheduled.delete(source);
          voices.delete(source);
          source.disconnect();
          gain.disconnect();
        };
        const startsAt = this.context!.currentTime + Math.max(0, playAt - performance.now()) / 1000;
        this.scheduled.set(source, startsAt);
        source.start(startsAt);
      })
      .catch(() => {});
  }
  private stopEffects() {
    ++this.generation;
    for (const voices of this.voices.values()) for (const source of voices) source.stop();
    this.voices.clear();
    this.scheduled.clear();
  }
  private cancelScheduledEffects() {
    for (const [source, startsAt] of this.scheduled) {
      if (startsAt <= (this.context?.currentTime ?? 0)) continue;
      source.stop();
      for (const voices of this.voices.values()) voices.delete(source);
      this.scheduled.delete(source);
    }
  }
  private stopMusic() {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer);
    this.musicTimer = null;
    this.musicRequest = '';
    this.music.pause();
  }
  private updateMusic() {
    if (!this.available()) {
      this.stopMusic();
      return;
    }
    const rule =
      this.catalog!.bindings.find((b) => b.event === this.scene && b.target === this.map) ??
      this.catalog!.bindings.find((b) => b.event === this.scene && b.target === '*');
    const silent = rule && (!rule.enabled || (rule.target !== '*' && !rule.clip));
    const selected = silent
      ? null
      : (this.resolve(this.scene, rule?.target ?? '*') ?? this.resolve('music.background'));
    if (!selected) {
      this.stopMusic();
      this.musicKey = '';
      return;
    }
    const { clip, binding } = selected;
    const request = this.scene + '/' + this.map + '/' + clip.file + '/' + (binding.delayMs ?? 0);
    if (this.musicRequest !== request) {
      this.stopMusic();
      this.musicRequest = request;
    }
    if (this.musicKey !== clip.file) {
      this.musicKey = clip.file;
      this.music.src = '/assets/audio/files/' + clip.file;
    }
    this.music.volume = 1;
    this.musicGain!.gain.value =
      binding.volume * this.catalog!.settings.masterVolume * this.catalog!.settings.musicVolume;
    this.music.playbackRate = binding.playbackRate ?? 1;
    if (this.music.paused && this.musicTimer === null) {
      const play = () => {
        this.musicTimer = null;
        if (!this.available() || this.musicRequest !== request) return;
        void this.music.play().catch(() => {
          if (this.musicRequest === request) this.musicRequest = '';
        });
      };
      const delay = binding.delayMs ?? 0;
      if (delay > 0) this.musicTimer = window.setTimeout(play, delay);
      else play();
    }
  }
  resetEvents() {
    this.cursor = null;
    this.stopEffects();
  }
  setState(state: State | null) {
    const scene = !state
      ? 'music.home'
      : state.phase === 'preparing'
        ? 'music.night'
        : state.phase === 'running'
          ? 'music.day'
          : 'music.background';
    const map = state?.map.id ?? '*';
    if (scene !== this.scene || map !== this.map) {
      this.stopEffects();
      this.scene = scene;
      this.map = map;
      this.updateMusic();
    }
    if (!state) {
      this.resetEvents();
      this.game = '';
      return;
    }
    const game = state.code + '/' + state.map.seed;
    if (this.cursor === null || this.game !== game) {
      this.stopEffects();
      this.cursor = state.eventSequence ?? 0;
      this.game = game;
      return;
    }
    const listener = state.players[state.you];
    for (const event of state.events ?? []) {
      if (event.id <= this.cursor) continue;
      this.cursor = event.id;
      if (state.elapsed - event.time > 1) continue;
      const resolved = this.resolve(event.type);
      const range = resolved?.binding.range ?? 0;
      const distance = Math.hypot(event.x - listener.x, event.y - listener.y) / state.map.tileSize;
      const attenuation = range > 0 && event.player !== state.you ? Math.max(0, 1 - distance / range) : 1;
      this.play(event.type, attenuation);
    }
    this.cursor = Math.max(this.cursor, state.eventSequence ?? 0);
  }
}
