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
await fs.mkdir(config);
for (const file of await fs.readdir(path.join(root, "data/config"))) {
  if (file.endsWith(".json") && file !== "active.json")
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
const server = spawn(
  path.join(root, "build/server/Release/cat_shop_admin.exe"),
  [
    "--port",
    String(port),
    "--config",
    config,
    "--store",
    path.join(temp, "store"),
    "--token-file",
    path.join(temp, "key"),
  ],
  { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
server.stdout.on("data", (text) => (logs += text));
server.stderr.on("data", (text) => (logs += text));
const stopped = once(server, "exit");
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
  await request("workspace", undefined, 401, { Authorization: "" });
  await request("workspace", undefined, 403, {
    Origin: "https://example.invalid",
  });
  let w = await request("workspace");
  assert.equal(Object.keys(w.current.tables).length, 14);
  const original = structuredClone(w.current.tables);
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
  const valid = structuredClone(w.draft.tables);
  w.draft.tables.items[0].levels[0].cost[0].currency = "missing_currency";
  w = await request("draft", {
    revision: w.draft.revision,
    tables: w.draft.tables,
  });
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
  assert.notEqual(w.current.release, "source");
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(config, "manager.json"), "utf8")),
    original.manager,
    "original source tables remain untouched",
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
  const active = JSON.parse(
    await fs.readFile(path.join(config, "active.json"), "utf8"),
  );
  const managerPath = path.join(
    config,
    ".releases",
    active.release,
    "manager.json",
  );
  const outside = JSON.parse(await fs.readFile(managerPath, "utf8"));
  outside.levels[0].max_hp += 1;
  await fs.writeFile(managerPath, JSON.stringify(outside));
  assert.equal((await request("workspace")).conflict, true);
  await request("publish", { revision: w.draft.revision }, 409);
  w = await request("reset", { revision: w.draft.revision });
  assert.equal(w.conflict, false);
  // Verify the actual game executable follows the release pointer too.
  if (process.env.ADMIN_CHECK_GAME === "1") {
    const check = spawnSync(
      path.join(root, "build/server/Release/cat_shop_server.exe"),
      ["--config", config, "--check-config"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    assert.equal(check.status, 0, check.stderr);
    assert.ok(
      check.stdout.includes(w.current.version),
      "game and admin see the same active snapshot",
    );
  }
  console.log(
    "PASS admin authentication, shared source assets, both client integrations, drafts, conflicts, validation, atomic publish and rollback",
  );
} finally {
  server.kill();
  await stopped;
  assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith("cat-shop-admin-"));
  await fs.rm(temp, { recursive: true, force: true });
}
