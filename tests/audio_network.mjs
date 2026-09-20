import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-shop-audio-"));
const config = path.join(temp, "config"),
  assets = path.join(temp, "assets"),
  store = path.join(temp, "admin");
await fs.cp(path.join(root, "data/config"), config, { recursive: true });
await fs.mkdir(assets);
const token = "isolated-audio-test-access-key-00000000";
await fs.writeFile(path.join(temp, "key"), token);
const children = [];
async function port() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function start(executable, args, health) {
  const child = spawn(
    path.join(root, "build/server/Release/" + executable + ".exe"),
    args,
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  let logs = "";
  child.stdout.on("data", (data) => (logs += data));
  child.stderr.on("data", (data) => (logs += data));
  for (let i = 0; i < 80; ++i) {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch(health)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Startup failed: " + logs);
}
const adminPort = await port(),
  gamePort = await port();
const admin = `http://127.0.0.1:${adminPort}`,
  game = `http://127.0.0.1:${gamePort}`;
const args = [
  "--port",
  String(adminPort),
  "--config",
  config,
  "--assets",
  assets,
  "--store",
  store,
  "--token-file",
  path.join(temp, "key"),
];
async function request(action, body, expected = 200) {
  const response = await fetch(admin + "/api/admin/" + action, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
}
function wave(frequency) {
  const samples = 8000,
    bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      Math.round(1600 * Math.sin((i * frequency * Math.PI * 2) / 8000)),
      44 + i * 2,
    );
  return bytes;
}
async function upload(w, bytes, id = "", expected = 200) {
  const response = await fetch(
    admin +
      "/api/admin/audio-upload?" +
      new URLSearchParams({
        revision: w.draft.revision,
        extension: "wav",
        name: "测试音频",
        category: "ui",
        id,
      }),
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: bytes,
    },
  );
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
try {
  let process = await start(
    "cat_shop_admin",
    args,
    admin + "/api/admin/health",
  );
  await start(
    "cat_shop_server",
    ["--port", String(gamePort), "--config", config, "--assets", assets],
    game + "/api/health",
  );
  assert.equal((await fetch(admin + "/api/admin/audio")).status, 401);
  assert.equal(
    (
      await fetch(admin + "/api/admin/audio-upload", {
        method: "POST",
        body: wave(220),
      })
    ).status,
    401,
  );
  let w = await request("audio");
  assert.equal(w.events.length, 21);
  assert.equal(w.current.clips.length, 0);
  assert.deepEqual(w.current.groups, []);
  // A legacy draft/publication without the new classification table still works.
  delete w.draft.tables.groups;
  w = await request("audio-save", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  await upload(
    w,
    Buffer.from("This is not a valid WAV audio file at all."),
    "",
    422,
  );
  const original = wave(220),
    replacement = wave(330);
  w = await upload(w, original);
  const id = w.draft.tables.clips[0].id,
    oldFile = w.draft.tables.clips[0].file;
  assert.equal(w.draft.tables.clips[0].duration, 1);
  assert.equal(
    (await fetch(game + "/api/audio").then((r) => r.json())).clips.length,
    0,
    "upload remains a draft",
  );
  assert.equal(
    (await fetch(game + "/assets/audio/files/" + oldFile)).status,
    404,
  );
  const preview = await fetch(
    admin + "/api/admin/audio-preview?file=" + oldFile,
    { headers: { Authorization: "Bearer " + token } },
  );
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), original);
  const stale = w.draft.revision;
  w.draft.tables.bindings.find((b) => b.event === "ui.click").clip = id;
  for (const delayMs of [-1, 10001, 0.5, "200", null]) {
    const invalid = structuredClone(w.draft.tables);
    invalid.bindings[0].delayMs = delayMs;
    const rejected = await request(
      "audio-save",
      { revision: w.draft.revision, tables: invalid },
      422,
    );
    assert.match(rejected.error, /延迟播放/);
  }
  const targeted = structuredClone(w.draft.tables);
  targeted.bindings.push({
    ...targeted.bindings.find((b) => b.event === "item.fire"),
    target: "yarn",
  });
  const targetError = await request(
    "audio-save",
    { revision: w.draft.revision, tables: targeted },
    422,
  );
  assert.match(targetError.error, /音效按事件统一绑定/);
  for (const invalidRate of [0, -1, 0.49, 2.01, "1.25", null]) {
    const invalid = structuredClone(w.draft.tables);
    invalid.bindings[0].playbackRate = invalidRate;
    const rejected = await request(
      "audio-save",
      { revision: w.draft.revision, tables: invalid },
      422,
    );
    assert.match(rejected.error, /事件「点击按钮」的播放速度/);
    assert.match(rejected.error, /0\.5～2 倍/);
    assert.match(rejected.error, /当前值/);
  }
  const invalidVolume = structuredClone(w.draft.tables);
  invalidVolume.bindings.find((b) => b.event === "item.upgrade").volume = 50;
  const volumeError = await request(
    "audio-save",
    {
      revision: w.draft.revision,
      tables: invalidVolume,
    },
    422,
  );
  assert.match(
    volumeError.error,
    /事件「升级」的音量必须在 0～4 倍之间，当前值：50/,
  );
  // Pre-existing drafts without playbackRate remain editable.
  delete w.draft.tables.bindings[0].playbackRate;
  delete w.draft.tables.bindings[0].delayMs;
  w = await request("audio-save", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  await request("audio-save", { revision: stale, tables: w.draft.tables }, 409);
  w.draft.tables.bindings.find((b) => b.event === "ui.click").playbackRate =
    1.25;
  w.draft.tables.bindings.find((b) => b.event === "ui.click").volume = 4;
  w.draft.tables.bindings.find((b) => b.event === "ui.click").delayMs = 750;
  w = await request("audio-save", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  await request("audio-validate", { revision: w.draft.revision });
  w = await request("audio-publish", { revision: w.draft.revision });
  const catalogResponse = await fetch(game + "/api/audio");
  const etag = catalogResponse.headers.get("etag");
  const publishedCatalog = await catalogResponse.json();
  assert.equal(
    publishedCatalog.bindings.find((b) => b.event === "ui.click").delayMs,
    750,
  );
  assert.equal(
    publishedCatalog.bindings.find((b) => b.event === "ui.click").clip,
    id,
  );
  assert.equal(
    publishedCatalog.bindings.find((b) => b.event === "ui.click").playbackRate,
    1.25,
  );
  assert.equal(
    publishedCatalog.bindings.find((b) => b.event === "ui.click").volume,
    4,
    "amplification publishes without clamping",
  );
  assert.equal(
    (await fetch(game + "/api/audio", { headers: { "If-None-Match": etag } }))
      .status,
    304,
  );
  assert.deepEqual(
    Buffer.from(
      await fetch(game + "/assets/audio/files/" + oldFile).then((r) =>
        r.arrayBuffer(),
      ),
    ),
    original,
  );
  assert.equal(publishedCatalog.groups, undefined);
  const groups = [
    { id: "group_battle", name: "战斗音效" },
    { id: "group_empty", name: "空分类" },
  ];
  w.draft.tables.groups = groups;
  w.draft.tables.clips[0].group = "group_battle";
  for (const invalidGroups of [
    [],
    [groups[0], groups[0]],
    [{ ...groups[0], name: "未分类" }],
  ]) {
    const invalid = structuredClone(w.draft.tables);
    invalid.groups = invalidGroups;
    await request(
      "audio-save",
      { revision: w.draft.revision, tables: invalid },
      422,
    );
  }
  const bindingsBeforeGrouping = structuredClone(w.draft.tables.bindings);
  w = await request("audio-save", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  w = await request("audio");
  assert.deepEqual(
    w.draft.tables.groups,
    groups,
    "empty and populated groups persist across reloads",
  );
  assert.equal(w.draft.tables.clips[0].group, "group_battle");
  w.draft.tables.groups[0].name = "战斗与门";
  w = await request("audio-save", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  w = await request("audio-publish", { revision: w.draft.revision });
  const groupedCatalog = await fetch(game + "/api/audio").then((r) => r.json());
  assert.equal(groupedCatalog.groups[0].name, "战斗与门");
  assert.equal(
    groupedCatalog.clips[0].group,
    "group_battle",
    "renaming keeps clip membership",
  );
  assert.deepEqual(
    groupedCatalog.bindings,
    bindingsBeforeGrouping,
    "organizing never changes event bindings",
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(assets, "audio/groups.json"), "utf8"),
    ),
    groupedCatalog.groups,
  );
  w = await upload(w, replacement, id);
  assert.equal(
    w.draft.tables.clips[0].group,
    "group_battle",
    "file replacement preserves classification",
  );
  const newFile = w.draft.tables.clips[0].file;
  assert.notEqual(oldFile, newFile);
  assert.equal(
    w.draft.tables.bindings.find((b) => b.event === "ui.click").clip,
    id,
  );
  assert.equal(
    (await fetch(game + "/api/audio").then((r) => r.json())).clips[0].file,
    oldFile,
    "replace is not live before publish",
  );
  w = await request("audio-publish", { revision: w.draft.revision });
  assert.equal(
    (await fetch(game + "/api/audio").then((r) => r.json())).clips[0].file,
    newFile,
    "running game reads the latest publication",
  );
  assert.deepEqual(
    Buffer.from(
      await fetch(game + "/assets/audio/files/" + newFile).then((r) =>
        r.arrayBuffer(),
      ),
    ),
    replacement,
  );
  assert.equal(
    (await fetch(game + "/assets/audio/files/" + oldFile)).status,
    404,
  );
  assert.deepEqual(
    await fs.readFile(path.join(store, "audio/files", oldFile)),
    original,
    "history stays in admin storage",
  );
  w.draft.tables.groups = [];
  w.draft.tables.clips[0].group = "";
  w = await request("audio-save", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  assert.equal(
    w.draft.tables.clips[0].id,
    id,
    "removing a group keeps the audio",
  );
  assert.deepEqual(w.draft.tables.bindings, bindingsBeforeGrouping);
  const bad = structuredClone(w.draft.tables);
  bad.clips = [];
  await request("audio-save", { revision: w.draft.revision, tables: bad }, 422);
  bad.bindings.forEach((b) => (b.clip = ""));
  w = await request("audio-save", { revision: w.draft.revision, tables: bad });
  w = await request("audio-publish", { revision: w.draft.revision });
  assert.equal(
    (await fetch(game + "/api/audio").then((r) => r.json())).clips.length,
    0,
  );
  assert.deepEqual(
    await fs.readdir(path.join(assets, "audio/files")),
    [],
    "deleted audio leaves the live resource directory",
  );
  assert.equal(
    (
      await fetch(
        game +
          "/assets/audio/files/%2e%2e%2f%2e%2e%2f%2e%2e%2fclient-admin%2fdata%2faudio%2fdraft.json",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(
        admin +
          "/api/admin/audio-preview?file=" +
          encodeURIComponent("../draft.json"),
        { headers: { Authorization: "Bearer " + token } },
      )
    ).status,
    422,
    "preview cannot read private draft files",
  );
  assert.equal(
    (await fetch(game + "/assets/audio/files/test.wav")).status,
    404,
  );
  // A stopped publisher resumes the same journal and finishes a coherent release.
  const restored = structuredClone(w.draft.tables);
  restored.clips = [
    {
      id,
      name: "恢复测试",
      category: "ui",
      enabled: true,
      file: oldFile,
      duration: 1,
      bytes: original.length,
    },
  ];
  restored.bindings.find((b) => b.event === "ui.click").clip = id;
  process.kill();
  await once(process, "exit");
  await fs.writeFile(
    path.join(store, "audio/pending.json"),
    JSON.stringify(restored),
  );
  process = await start("cat_shop_admin", args, admin + "/api/admin/health");
  w = await request("audio");
  assert.equal(w.current.clips[0].file, oldFile);
  assert.equal(w.conflict, false);
  assert.equal(w.draft.baseRevision, w.current.revision);
  console.log(
    "PASS audio groups, legacy migration, upload, validation, preview, conflicts, publication, replacement, deletion, cache and recovery",
  );
} finally {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  // Only this uniquely created test directory is removed; no project data is touched.
  assert.ok(
    path
      .resolve(temp)
      .startsWith(path.resolve(os.tmpdir()) + path.sep + "cat-shop-audio-"),
  );
  await fs.rm(temp, { recursive: true, force: true });
}
