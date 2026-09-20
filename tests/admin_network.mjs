import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-shop-admin-"));
const config = path.join(temp, "config");
const storage = path.join(temp, "client-admin/data");
await fs.mkdir(config);
for (const file of await fs.readdir(path.join(root, "data/config"))) {
  if (file.endsWith(".json") && !file.startsWith("."))
    await fs.copyFile(
      path.join(root, "data/config", file),
      path.join(config, file),
    );
}
const token = "isolated-admin-test-key-not-a-production-secret";
await fs.writeFile(path.join(temp, "key"), token);
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
let server, stopped;
let logs = "";
async function startServer() {
  server = spawn(
    path.join(root, "build/server/Release/cat_shop_admin.exe"),
    [
      "--port",
      String(port),
      "--config",
      config,
      "--store",
      storage,
      "--token-file",
      path.join(temp, "key"),
    ],
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (text) => (logs += text));
  server.stderr.on("data", (text) => (logs += text));
  stopped = once(server, "exit");
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      ready = (await fetch(base + "/api/admin/health")).ok;
    } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
}
async function stopServer() {
  if (server?.exitCode === null) server.kill();
  if (stopped) await stopped;
}
function checkGame(directory) {
  return spawnSync(
    path.join(root, "build/server/Release/cat_shop_server.exe"),
    ["--config", directory, "--check-config"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
}
async function assertLatestOnly() {
  assert.deepEqual(
    (await fs.readdir(config)).sort(),
    Object.keys(originalTables)
      .map((n) => n + ".json")
      .sort(),
    "runtime directory contains only current tables, no history or release pointer",
  );
}
let originalTables;
const base = `http://127.0.0.1:${port}`;
async function request(action, body, status = 200, extra = {}) {
  const result = await fetch(base + "/api/admin/" + action, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await result.text();
  assert.equal(result.status, status, action + ": " + text);
  return JSON.parse(text);
}
try {
  await startServer();
  await request("workspace", undefined, 401, { Authorization: "" });
  await request("workspace", undefined, 403, {
    Origin: "https://example.invalid",
  });
  let w = await request("workspace");
  assert.equal(Object.keys(w.current.tables).length, 14);
  const original = (originalTables = structuredClone(w.current.tables));
  assert.equal(w.current.release, "source");
  const clients = await request("clients");
  assert.deepEqual(
    clients.map((c) => c.id),
    ["web", "cocos"],
  );
  const catalog = await request("assets");
  assert.equal(catalog.characters.length, 2);
  assert.equal(catalog.themes.length, 4);
  assert.equal(path.resolve(catalog.sourceRoot), path.join(root, "assets"));
  for (const client of clients) {
    assert.equal(client.available, true, client.problem);
    assert.equal(client.sourceMatches, true);
    assert.equal(
      path.resolve(client.assetRoot),
      path.resolve(catalog.sourceRoot),
    );
  }
  const resourceUrl = catalog.themes[0].assets[0].src;
  assert.ok(resourceUrl.startsWith("/assets/"));
  const resource = await fetch(base + resourceUrl);
  assert.equal(resource.status, 200);
  assert.equal(resource.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    Buffer.from(await resource.arrayBuffer()),
    await fs.readFile(
      path.join(catalog.sourceRoot, resourceUrl.slice("/assets/".length)),
    ),
    "admin serves the actual shared source, not a stale client build",
  );
  const characterIndex = await fetch(base + "/assets/characters/v1/index.json");
  assert.equal(characterIndex.status, 200);
  assert.equal(
    (await characterIndex.json()).characters.length,
    catalog.characters.length,
  );
  assert.equal(
    (await fetch(base + "/assets/%2e%2e%2fclient/package.json")).status,
    404,
  );
  assert.equal((await fetch(base + resourceUrl + ".meta")).status, 404);
  assert.equal(
    (await fetch(base + "/client-assets/cocos/characters/v1/index.json"))
      .status,
    404,
  );
  const oldRevision = w.draft.revision;
  await request(
    "draft",
    { revision: oldRevision, tables: { ...w.draft.tables, manager: [] } },
    400,
  );
  assert.equal((await request("workspace")).draft.revision, oldRevision);
  w.draft.tables.manager.levels[0].max_hp += 15;
  w = await request("draft", { revision: oldRevision, tables: w.draft.tables });
  assert.equal(
    w.current.tables.manager.levels[0].max_hp,
    original.manager.levels[0].max_hp,
    "saving a draft never changes live values",
  );
  await request(
    "draft",
    { revision: oldRevision, tables: w.draft.tables },
    409,
  );
  await request("validate", { revision: w.draft.revision });
  const pool = w.draft.tables.random_items[0];
  delete pool.level_weight_decay;
  pool.rewards = [
    {
      item: "launcher",
      weight: 3,
      min_level: 2,
      max_level: 3,
      level_weights: [
        { level: 2, weight: 7 },
        { level: 3, weight: 2 },
      ],
    },
    {
      item: "mini_fridge",
      weight: 9,
      min_level: 1,
      max_level: 1,
      level_weights: [{ level: 1, weight: 1 }],
    },
  ];
  for (const invalidate of [
    (r) => {
      r[0].item = "missing_item";
    },
    (r) => {
      r[0].weight = 59.99;
    },
    (r) => {
      r[0].weight = -1;
    },
    (r) => {
      r[0].level_weights[0].weight = 75.249;
    },
    (r) => {
      r[0].max_level = 99;
    },
    (r) => {
      r[0].level_weights.forEach((l) => (l.weight = 0));
    },
    (r) => {
      r.forEach((item) => (item.weight = 0));
    },
    (r) => {
      r[1].item = "launcher";
    },
  ]) {
    const invalid = structuredClone(w.draft.tables);
    invalidate(invalid.random_items[0].rewards);
    await request(
      "draft",
      { revision: w.draft.revision, tables: invalid },
      422,
    );
    assert.equal(
      (await request("workspace")).draft.revision,
      w.draft.revision,
      "invalid reward configuration must not replace the saved draft",
    );
  }
  w = await request("draft", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  assert.deepEqual(w.draft.tables.random_items[0].rewards, pool.rewards);
  const crate = w.draft.tables.items.find((item) => item.id === "crate");
  crate.levels[0].next_level = 2;
  crate.levels.push({
    ...structuredClone(crate.levels[0]),
    level: 2,
    next_level: 0,
    amount: 180,
  });
  const mapProfile = w.draft.tables.map_generation.profiles[0];
  mapProfile.match = { preparation_ms: 45000, duration_ms: 675000 };
  mapProfile.initial_items = {
    min_per_room: 2,
    max_per_room: 3,
    rewards: [
      {
        item: "launcher",
        weight: 1,
        min_level: 2,
        max_level: 2,
        level_weights: [{ level: 2, weight: 1 }],
      },
    ],
  };
  mapProfile.initial_items.rewards.push({
    item: "crate",
    weight: 2,
    min_level: 2,
    max_level: 2,
    level_weights: [{ level: 2, weight: 1 }],
  });
  for (const invalidate of [
    (p) => {
      p.match.duration_ms = 0;
    },
    (p) => {
      p.initial_items.rewards[0].item = "deleted_item";
    },
    (p) => {
      p.initial_items.rewards[0].weight = -1;
    },
    (p) => {
      p.initial_items.rewards[0].max_level = 99;
    },
    (p) => {
      p.initial_items.max_per_room = 100;
    },
  ]) {
    const invalid = structuredClone(w.draft.tables);
    invalidate(invalid.map_generation.profiles[0]);
    await request(
      "draft",
      { revision: w.draft.revision, tables: invalid },
      422,
    );
    assert.equal(
      (await request("workspace")).draft.revision,
      w.draft.revision,
      "invalid map rules must preserve the saved draft",
    );
  }
  w = await request("draft", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
  assert.deepEqual(w.draft.tables.map_generation.profiles[0], mapProfile);
  const valid = structuredClone(w.draft.tables);
  w.draft.tables.items[0].levels[0].cost[0].currency = "missing_currency";
  await request(
    "draft",
    {
      revision: w.draft.revision,
      tables: w.draft.tables,
    },
    422,
  );
  // An older or externally edited draft must still be rejected at publication.
  const corruptDraft = JSON.parse(
    await fs.readFile(path.join(storage, "draft.json"), "utf8"),
  );
  corruptDraft.tables.random_items[0].rewards[0].weight = -1;
  await fs.writeFile(
    path.join(storage, "draft.json"),
    JSON.stringify(corruptDraft),
  );
  await request("validate", { revision: w.draft.revision }, 422);
  await request("publish", { revision: w.draft.revision }, 422);
  await assert.rejects(fs.access(path.join(config, "active.json")));
  w = await request("draft", { revision: w.draft.revision, tables: valid });
  w = await request("publish", {
    revision: w.draft.revision,
    note: "isolated publish test",
  });
  assert.equal(
    w.current.tables.manager.levels[0].max_hp,
    original.manager.levels[0].max_hp + 15,
  );
  assert.equal(w.conflict, false);
  assert.deepEqual(
    w.current.tables.random_items[0].rewards,
    pool.rewards,
    "published relative weights are preserved without requiring a total of 100",
  );

  assert.deepEqual(
    w.current.tables.map_generation.profiles[0],
    mapProfile,
    "published map rules round-trip unchanged",
  );
  assert.notEqual(w.current.release, "source");
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(config, "manager.json"), "utf8")),
    w.current.tables.manager,
    "publish replaces the current runtime tables",
  );
  const first = w.current.release;
  const history = await request("history");
  assert.equal(history.length, 2);
  assert.equal(
    history.find((r) => r.id === first).version,
    w.current.version,
    "snapshot version matches runtime loader",
  );
  const baseline = history.find((r) => r.id !== first);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(storage, "releases", baseline.id, "manager.json"),
      ),
    ),
    original.manager,
    "old values are retained only in admin history",
  );
  await assertLatestOnly();
  assert.equal(
    (await fetch(base + "/data/releases/" + first + "/manager.json")).status,
    404,
  );

  await request(
    "rollback",
    {
      revision: w.draft.revision,
      currentRevision: "stale",
      release: baseline.id,
    },
    409,
  );
  w = await request("rollback", {
    revision: w.draft.revision,
    currentRevision: w.current.revision,
    release: baseline.id,
  });
  assert.deepEqual(w.current.tables.manager, original.manager);
  assert.notEqual(
    w.current.release,
    baseline.id,
    "rollback creates a new immutable version",
  );
  assert.equal((await request("history")).length, 3);
  await assertLatestOnly();
  const managerPath = path.join(config, "manager.json");
  const outside = JSON.parse(await fs.readFile(managerPath, "utf8"));
  outside.levels[0].max_hp += 1;
  await fs.writeFile(managerPath, JSON.stringify(outside));
  assert.equal((await request("workspace")).conflict, true);
  await request("publish", { revision: w.draft.revision }, 409);
  w = await request("reset", { revision: w.draft.revision });
  assert.equal(w.conflict, false);
  // A runtime deployment needs only these 14 files, even without the admin directory.
  if (process.env.ADMIN_CHECK_GAME === "1") {
    const standalone = path.join(temp, "standalone-config");
    await fs.cp(config, standalone, { recursive: true });
    const check = checkGame(standalone);
    assert.equal(check.status, 0, check.stderr);
    assert.ok(check.stdout.includes(w.current.version));
  }

  // Simulate an interrupted multi-table publication. Recovery must restore the
  // previous complete version while preserving the saved draft.
  const savedDraft = JSON.parse(
    await fs.readFile(path.join(storage, "draft.json")),
  );
  await stopServer();
  const interrupted = {
    configRoot: config.replaceAll("\\", "/"),
    before: first,
    after: baseline.id,
    phase: "applying",
  };
  await fs.writeFile(
    path.join(storage, "pending.json"),
    JSON.stringify(interrupted),
  );
  await fs.writeFile(
    path.join(config, ".publishing.json"),
    JSON.stringify({ release: baseline.id }),
  );
  await fs.writeFile(managerPath, JSON.stringify(original.manager));
  if (process.env.ADMIN_CHECK_GAME === "1") {
    const incomplete = checkGame(config);
    assert.notEqual(
      incomplete.status,
      0,
      "partial runtime tables cannot be loaded",
    );
    assert.ok(incomplete.stderr.includes("publication is incomplete"));
  }
  await startServer();
  w = await request("workspace");
  assert.equal(w.current.release, first);
  assert.equal(
    w.current.tables.manager.levels[0].max_hp,
    original.manager.levels[0].max_hp + 15,
  );
  assert.deepEqual(
    w.draft,
    savedDraft,
    "interrupted publish preserves the admin draft",
  );
  await assertLatestOnly();
  await assert.rejects(fs.access(path.join(storage, "pending.json")));

  // A committed transaction interrupted during cleanup must finish the new version.
  await stopServer();
  interrupted.phase = "committed";
  await fs.writeFile(
    path.join(storage, "pending.json"),
    JSON.stringify(interrupted),
  );
  await fs.writeFile(
    path.join(config, ".publishing.json"),
    JSON.stringify({ release: baseline.id }),
  );
  await startServer();
  w = await request("workspace");
  assert.equal(w.current.release, baseline.id);
  assert.deepEqual(w.current.tables.manager, original.manager);
  assert.deepEqual(w.draft.tables, w.current.tables);
  await assertLatestOnly();
  if (process.env.ADMIN_CHECK_GAME === "1") {
    const recovered = checkGame(config);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.ok(recovered.stdout.includes(w.current.version));
  }

  console.log(
    "PASS admin authentication, shared source assets, both client integrations, drafts, conflicts, validation, admin-only history, latest-only runtime, publish/rollback and crash recovery",
  );
} finally {
  await stopServer();
  assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith("cat-shop-admin-"));
  await fs.rm(temp, { recursive: true, force: true });
}
