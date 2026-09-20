import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "../client/node_modules/typescript/lib/typescript.js";

const source = await fs.readFile(
  new URL("../client/src/audio/audio_system.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const refreshers = [],
  started = [],
  media = [],
  visibility = [];
let downloads = 0,
  revision = 1;
const clip = (id) => ({
  id,
  name: id,
  category: "ui",
  file: id + ".wav",
  enabled: true,
  duration: 1,
  bytes: 16044,
});
const binding = (event, clip, target = "*", extra = {}) => ({
  event,
  clip,
  target,
  enabled: true,
  volume: 1,
  cooldownMs: 0,
  maxVoices: 3,
  range: 0,
  ...extra,
});
let catalog = {
  revision: "1",
  clips: [
    clip("click"),
    clip("home"),
    clip("night"),
    clip("day"),
    clip("background"),
  ],
  settings: {
    enabled: true,
    masterVolume: 1,
    effectsVolume: 1,
    musicVolume: 0.3,
  },
  bindings: [
    binding("ui.click", "click", "*", { volume: 2 }),
    binding("door.hit", "click", "*", { range: 10, playbackRate: 0.75 }),
    binding("music.home", "home"),
    binding("music.night", "night", "harbor", { playbackRate: 1.25 }),
    binding("music.day", "day"),
    binding("music.background", "background"),
  ],
};
globalThis.window = {
  setInterval: (fn) => {
    refreshers.push(fn);
    return 1;
  },
};
globalThis.document = {
  hidden: false,
  addEventListener: (_, fn) => visibility.push(fn),
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.Audio = class {
  paused = true;
  src = "";
  volume = 1;
  constructor() {
    media.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
};
globalThis.AudioContext = class {
  state = "running";
  destination = {};
  resume() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ length: 8000, numberOfChannels: 1, duration: 1 });
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createMediaElementSource(element) {
    return {
      connect(gain) {
        element.gain = gain;
        return gain;
      },
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect(gain) {
        this.gain = gain;
        return gain;
      },
      disconnect() {},
      start() {
        started.push(this);
      },
      stop() {
        this.onended?.();
      },
    };
  }
};
globalThis.fetch = async (url) => {
  if (url === "/api/audio")
    return {
      ok: true,
      status: 200,
      json: async () => structuredClone(catalog),
    };
  downloads++;
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const { AudioSystem } = await import(
  "data:text/javascript;base64," + Buffer.from(javascript).toString("base64")
);
const audio = new AudioSystem();
await flush();
audio.play("ui.click");
await flush();
assert.equal(started.length, 0, "no playback before a user gesture");
audio.unlock();
assert.equal(media[0].src, "/assets/audio/files/home.wav");
audio.play("ui.click");
await flush();
assert.equal(started.length, 1);
assert.equal(
  started[0].gain.gain.value,
  2,
  "effects support amplification above 1",
);
assert.equal(
  started[0].playbackRate.value,
  1,
  "older bindings use original speed",
);
audio.play("ui.click");
await flush();
assert.equal(downloads, 1, "decoded clips are reused");
const state = {
  code: "test",
  map: { id: "harbor", seed: 1, tileSize: 32 },
  phase: "preparing",
  you: 0,
  players: [{ x: 0, y: 0 }],
  elapsed: 10,
  eventSequence: 4,
  events: [
    {
      id: 4,
      time: 10,
      type: "door.hit",
      target: "wood",
      player: 1,
      x: 0,
      y: 0,
    },
  ],
};
audio.setState(state);
await flush();
assert.equal(started.length, 2, "initial snapshots do not replay old events");
assert.equal(
  media[0].src,
  "/assets/audio/files/night.wav",
  "map-specific night music",
);
assert.equal(media[0].playbackRate, 1.25, "map binding controls music speed");
assert.equal(
  media[0].preservesPitch,
  false,
  "music and effects use the same pitch behavior",
);
state.phase = "running";
state.eventSequence = 5;
state.events = [{ ...state.events[0], id: 5, x: 160 }];
audio.setState(state);
await flush();
assert.equal(started.length, 3);
assert.equal(started.at(-1).gain.gain.value, 0.5);
assert.equal(
  started.at(-1).playbackRate.value,
  0.75,
  "same clip has independent event speed",
);
assert.equal(media[0].src, "/assets/audio/files/day.wav");
assert.equal(
  media[0].playbackRate,
  1,
  "changing scenes restores the next event's speed",
);
audio.setState(state);
await flush();
assert.equal(started.length, 3, "duplicate state does not duplicate audio");
audio.resetEvents();
audio.setState(state);
await flush();
assert.equal(started.length, 3, "resume establishes a baseline");
state.eventSequence = 6;
state.events = [{ ...state.events[0], id: 6, time: 8 }];
audio.setState(state);
await flush();
assert.equal(started.length, 3, "stale events are ignored");
audio.toggleMute();
assert.equal(media[0].paused, true);
audio.play("ui.click");
await flush();
assert.equal(started.length, 3);
audio.toggleMute();
assert.equal(media[0].paused, false);
catalog.revision = String(++revision);
catalog.clips.find((c) => c.id === "day").file = "day-v2.wav";
refreshers[0]();
await flush();
assert.equal(
  media[0].src,
  "/assets/audio/files/day-v2.wav",
  "publication changes music without a page reload",
);
catalog.revision = String(++revision);
catalog.bindings.find((b) => b.event === "music.day").playbackRate = 0.5;
catalog.bindings.find((b) => b.event === "music.day").volume = 4;
media[0].currentTime = 12;
refreshers[0]();
await flush();
assert.equal(
  media[0].playbackRate,
  0.5,
  "speed-only publication updates current music",
);
assert.equal(
  media[0].volume,
  1,
  "media element volume stays within browser limits",
);
assert.equal(
  media[0].gain.gain.value,
  1.2,
  "music uses gain amplification above 1",
);
assert.equal(media[0].currentTime, 12, "setting changes do not restart music");
catalog.revision = String(++revision);
catalog.bindings.push(binding("music.day", "", "harbor"));
refreshers[0]();
await flush();
assert.equal(
  media[0].paused,
  true,
  "explicit map silence does not play fallback music",
);
document.hidden = true;
visibility[0]();
audio.play("ui.click");
await flush();
assert.equal(started.length, 3, "hidden tabs are quiet");
document.hidden = false;
visibility[0]();
await flush();
audio.setState(null);
assert.equal(media[0].src, "/assets/audio/files/home.wav");
console.log(
  "PASS audio unlock, caching, map music, event deduplication, reconnect, distance, mute, event speed and hot replacement",
);
