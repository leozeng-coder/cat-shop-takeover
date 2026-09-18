import { ProtocolClient } from "./protocol_client.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../client/package.json", import.meta.url),
);
const WebSocket = require("ws");
const root = fileURLToPath(new URL("../", import.meta.url));
const tempBase = path.resolve(os.tmpdir());
const directory = await fs.mkdtemp(path.join(tempBase, "cat-shop-tables-"));
assert.equal(path.dirname(path.resolve(directory)), tempBase);
assert.ok(path.basename(directory).startsWith("cat-shop-tables-"));
const names = [
  "manifest",
  "currencies",
  "match",
  "doors",
  "nests",
  "items",
  "random_items",
  "manager",
  "repair",
  "map_items",
  "map_generation",
  "characters",
  "cat_ai",
  "manager_ai",
];
const tables = {};
for (const name of names) {
  const text = await fs.readFile(
    path.join(root, "data/config", name + ".json"),
    "utf8",
  );
  tables[name] = JSON.parse(text);
  await fs.writeFile(path.join(directory, name + ".json"), text);
}
const probe = net.createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const executable = path.join(root, "build/server/Release/cat_shop_server.exe");
const server = spawn(
  executable,
  [
    "--bind",
    "127.0.0.1",
    "--port",
    String(port),
    "--web",
    "client/dist",
    "--config",
    directory,
  ],
  { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
server.stdout.on("data", (data) => {
  log = (log + data).slice(-20000);
});
server.stderr.on("data", (data) => {
  log = (log + data).slice(-20000);
});
const stopped = once(server, "exit");
const clients = [];
class Client {
  protocol = new ProtocolClient();
  constructor() {
    this.socket = new WebSocket("ws://127.0.0.1:" + port + "/ws");
    this.messages = [];
    this.waiters = new Set();
    this.catalogs = 0;
    this.socket.on("message", (bytes) => {
      const message = this.protocol.receive(bytes);
      if (!message) return;
      if (message.type === "config") {
        this.catalog = message;
        ++this.catalogs;
      }
      if (message.type === "joined") {
        this.token = message.token;
        this.code = message.code;
      }
      if (message.type === "state") {
        assert.equal(message.configVersion, this.catalog?.version);
        this.state = message;
      }
      this.messages.push(message);
      if (this.messages.length > 200) this.messages.shift();
      for (const wake of this.waiters) wake();
    });
    clients.push(this);
  }
  async open() {
    await once(this.socket, "open");
  }
  send(value) {
    this.socket.send(this.protocol.send(value));
  }
  wait(predicate) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      const check = () => {
        const index = this.messages.findIndex(predicate);
        if (index >= 0) {
          cleanup();
          resolve(this.messages.splice(index, 1)[0]);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for configuration protocol"));
      }, 5000);
      this.waiters.add(check);
      check();
    });
  }
  async create(capacity = 1) {
    await this.open();
    this.send({ type: "create", capacity, name: "Config test" });
    await this.wait((m) => m.type === "joined");
    return this.wait((m) => m.type === "state");
  }
}
try {
  let ready = false;
  for (let i = 0; i < 60; ++i) {
    if (server.exitCode !== null) throw new Error("Test server exited: " + log);
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/api/health");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "test server starts with split tables");
  const host = new Client();
  const old = await host.create(6);
  const oldVersion = old.configVersion;
  const oldIncome = host.catalog.nests[0].amount;
  const fridgeCatalog = host.catalog.items.mini_fridge;
  assert.equal(fridgeCatalog.unique, true);
  assert.equal(fridgeCatalog.behavior, "door_attack_delay");
  assert.equal(fridgeCatalog.appearance, "mini_fridge");
  assert.deepEqual(
    fridgeCatalog.levels.map((l) => l.amount),
    [200, 400, 600, 800, 1000],
  );
  assert.ok(fridgeCatalog.levels.every((l) => l.intervalMs === 2000));
  assert.ok(
    Object.values(host.catalog.items).every(
      (item) => item.description.length > 0,
    ),
  );
  assert.equal(host.catalog.items.magic_trash_bin.behavior, "random_item");
  assert.equal(old.offers.items.magic_trash_bin[0].limit, 3);

  const peer = new Client();
  await peer.open();
  peer.send({ type: "join", code: host.code, name: "Friend" });
  await peer.wait((m) => m.type === "state");
  assert.deepEqual(
    peer.catalog,
    host.catalog,
    "friends share one configuration snapshot",
  );
  tables.nests[0].amount = oldIncome + 3;
  tables.currencies.find((c) => c.id === "dried_fish").initial = 4;
  for (const name of ["nests", "currencies"]) {
    await fs.writeFile(
      path.join(directory, name + ".json"),
      JSON.stringify(tables[name]),
    );
  }
  const fresh = new Client();
  const next = await fresh.create();
  assert.notEqual(next.configVersion, oldVersion);
  assert.equal(fresh.catalog.nests[0].amount, oldIncome + 3);
  assert.equal(next.players[0].wallet.dried_fish, 4);
  const unchanged = await host.wait(
    (m) => m.type === "state" && m.tick > old.tick,
  );
  assert.equal(unchanged.configVersion, oldVersion);
  assert.equal(host.catalog.nests[0].amount, oldIncome);
  assert.equal(host.catalogs, 1, "catalog is sent once per version");
  assert.equal(unchanged.players[0].wallet.dried_fish, 0);
  tables.items[0].behavior = "missing_handler";
  await fs.writeFile(
    path.join(directory, "items.json"),
    JSON.stringify(tables.items),
  );
  const fallback = new Client();
  const kept = await fallback.create();
  assert.equal(
    kept.configVersion,
    next.configVersion,
    "bad table cannot partially replace valid bundle",
  );
  assert.equal(kept.players[0].wallet.dried_fish, 4);
  const resumed = new Client();
  const token = host.token;
  host.socket.close();
  await resumed.open();
  resumed.send({ type: "resume", token });
  const resumedState = await resumed.wait((m) => m.type === "state");
  assert.equal(resumedState.configVersion, oldVersion);
  assert.equal(resumed.catalog.nests[0].amount, oldIncome);
  assert.equal(resumedState.players[0].wallet.dried_fish, 0);
  const invalid = spawn(executable, ["--config", directory, "--check-config"], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
  });
  const [exit] = await once(invalid, "exit");
  assert.equal(exit, 2, "invalid first load fails startup validation");
  assert.match(log, /Config reload rejected/);
  // An isolated accelerated match exercises coalesced upgrades through real sockets.
  tables.items[0].behavior = "single_attack";
  tables.match.preparation_ms = 1000;
  tables.match.duration_ms = 1000;
  tables.manager.time_rage = 1000;
  tables.manager.damage_rage_multiplier = 0.5;
  tables.manager.level_up_heal_percent = 40;
  for (const level of tables.manager.levels) {
    level.speed = 1;
    level.next_rage = level.level === tables.manager.levels.length ? 0 : 1;
    if (level.level > 1)
      level.level_up_announcement = "测试怒气播报 " + level.level;
  }
  for (const name of ["items", "match", "manager"]) {
    await fs.writeFile(
      path.join(directory, name + ".json"),
      JSON.stringify(tables[name]),
    );
  }
  const rageHost = new Client();
  await rageHost.create(6);
  const ragePeer = new Client();
  await ragePeer.open();
  ragePeer.send({ type: "join", code: rageHost.code, name: "Rage friend" });
  await ragePeer.wait((m) => m.type === "joined");
  ragePeer.send({ type: "ready", ready: true });
  await rageHost.wait(
    (m) => m.type === "state" && m.players[1].ready && m.players[1].human,
  );
  assert.equal(rageHost.catalog.manager.damageRageMultiplier, 0.5);
  assert.equal(rageHost.catalog.manager.levelUpHealPercent, 40);
  rageHost.send({ type: "start" });
  const upgraded = await rageHost.wait(
    (m) => m.type === "state" && m.monster.level === 10,
  );
  const peerUpgrade = await ragePeer.wait(
    (m) => m.type === "state" && m.tick === upgraded.tick,
  );
  assert.deepEqual(peerUpgrade.monster.levelUps, upgraded.monster.levelUps);
  assert.deepEqual(
    upgraded.monster.levelUps.map((e) => e.level),
    [2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  for (const event of upgraded.monster.levelUps) {
    assert.equal(
      event.text,
      tables.manager.levels[event.level - 1].level_up_announcement,
    );
    assert.ok(event.healed >= 0);
  }
  assert.equal(
    upgraded.monster.levelUps[0].healed,
    tables.manager.levels[1].max_hp - tables.manager.levels[0].max_hp,
    "event records actual capped recovery",
  );
  const rageResumed = new Client();
  const rageToken = ragePeer.token;
  ragePeer.socket.close();
  await rageResumed.open();
  rageResumed.send({ type: "resume", token: rageToken });
  const restoredRage = await rageResumed.wait((m) => m.type === "state");
  assert.deepEqual(
    restoredRage.monster.levelUps,
    upgraded.monster.levelUps,
    "reconnect retains authoritative event history",
  );
  const ended = await rageHost.wait(
    (m) => m.type === "state" && (m.phase === "won" || m.phase === "lost"),
  );
  rageHost.send({ type: "rematch" });
  const reset = await rageHost.wait(
    (m) => m.type === "state" && m.map.seed !== ended.map.seed,
  );
  assert.equal(reset.monster.rage, 0);
  assert.equal(reset.monster.level, 1);
  assert.deepEqual(reset.monster.levelUps, []);
  console.log(
    "PASS configured rage/healing, ordered multi-level broadcasts, synchronized peers, reconnect and rematch reset",
  );

  // Real commands validate unique purchases independently for each player.
  tables.match.preparation_ms = 30000;
  tables.match.cat_speed = 1000;
  tables.currencies.find((c) => c.id === "cans").initial = 30000;
  tables.currencies.find((c) => c.id === "dried_fish").initial = 1000;
  for (const name of ["match", "currencies"]) {
    await fs.writeFile(
      path.join(directory, name + ".json"),
      JSON.stringify(tables[name]),
    );
  }
  const fridgeHost = new Client();
  await fridgeHost.create(6);
  const fridgePeer = new Client();
  await fridgePeer.open();
  fridgePeer.send({
    type: "join",
    code: fridgeHost.code,
    name: "Fridge friend",
  });
  await fridgePeer.wait((m) => m.type === "joined");
  fridgePeer.send({ type: "ready", ready: true });
  await fridgeHost.wait(
    (m) => m.type === "state" && m.players[1].ready && m.players[1].human,
  );
  fridgeHost.send({ type: "start" });
  await fridgeHost.wait((m) => m.type === "state" && m.phase === "preparing");
  let fridgeSequence = 0;
  function action(client, name, room = -1, cell = -1, kind = "mini_fridge") {
    const message = {
      type: "action",
      action: name,
      room,
      cell,
      kind,
      seq: ++fridgeSequence,
    };
    client.send(message);
    return message;
  }
  action(fridgeHost, "nest", 0);
  action(fridgePeer, "nest", 1);
  const claimed = await fridgeHost.wait(
    (m) =>
      m.type === "state" && m.players[0].room === 0 && m.players[1].room === 1,
  );
  assert.equal(claimed.players.length, 6);
  const profile = claimed.catalog.maps.find((map) => map.id === claimed.map.id);
  assert.ok(
    claimed.dorms.length >= profile.minRooms &&
      claimed.dorms.length <= profile.maxRooms,
  );
  const mapPeer = await fridgePeer.wait(
    (m) => m.type === "state" && m.map.seed === claimed.map.seed,
  );
  assert.deepEqual(mapPeer.map, claimed.map);
  assert.deepEqual(
    mapPeer.dorms.map((r) => [r.id, r.nest, r.door, r.area]),
    claimed.dorms.map((r) => [r.id, r.nest, r.door, r.area]),
  );
  function buildCells(state, roomId) {
    const room = state.dorms[roomId],
      map = state.map;
    const free = (cell) =>
      cell >= 0 &&
      cell < map.width * map.height &&
      map.rows[Math.floor(cell / map.width)][cell % map.width] ===
        String(roomId) &&
      cell !== room.nest &&
      !room.props.some((p) => p.cell === cell) &&
      !state.players.some(
        (p) =>
          Math.floor(p.y / map.tileSize) * map.width +
            Math.floor(p.x / map.tileSize) ===
          cell,
      );
    const cells = [];
    for (let cell = 0; cell < map.width * map.height; ++cell) {
      if (free(cell)) cells.push(cell);
    }
    const score = (cell) =>
      [cell - 1, cell + 1, cell - map.width, cell + map.width].filter(free)
        .length;
    return cells.sort((a, b) => score(b) - score(a));
  }
  async function install(client, player, kind = "mini_fridge") {
    for (const cell of buildCells(claimed, player)) {
      action(client, "build", -1, cell, kind);
      const result = await client.wait(
        (m) =>
          m.type === "error" ||
          (m.type === "state" &&
            m.dorms[player].props.some(
              (p) => p.kind === kind && p.cell === cell,
            )),
      );
      if (result.type === "state") return { cell, state: result };
    }
    throw new Error("No accessible fridge tile");
  }
  const doorUpgrade = action(fridgeHost, "door");
  fridgeHost.send(doorUpgrade);
  const doorUpgraded = await fridgeHost.wait(
    (m) => m.type === "state" && m.dorms[0].level >= 2,
  );
  assert.equal(
    doorUpgraded.dorms[0].level,
    2,
    "duplicate action sequence cannot purchase twice",
  );
  const installed = await install(fridgeHost, 0);
  assert.equal(installed.state.offers.items.mini_fridge[0].enabled, false);
  assert.match(installed.state.offers.items.mini_fridge[0].reason, /已安装/);
  assert.equal(
    installed.state.offers.items.mini_fridge[1].enabled,
    true,
    "unique item upgrades stay enabled",
  );
  const duplicateCell = buildCells(installed.state, 0)[0];
  action(fridgeHost, "build", -1, duplicateCell);
  action(fridgeHost, "build", -1, duplicateCell);
  await fridgeHost.wait(
    (m) => m.type === "error" && m.message.includes("每位玩家限一件"),
  );
  await fridgeHost.wait(
    (m) => m.type === "error" && m.message.includes("每位玩家限一件"),
  );
  const afterDuplicates = await fridgeHost.wait(
    (m) => m.type === "state" && m.tick > installed.state.tick,
  );
  assert.equal(
    afterDuplicates.dorms[0].props.filter((p) => p.kind === "mini_fridge")
      .length,
    1,
  );
  assert.ok(
    afterDuplicates.players[0].wallet.cans >=
      installed.state.players[0].wallet.cans,
    "rejected repeated commands never charge cans",
  );
  action(fridgeHost, "build", -1, installed.cell);
  const upgradedFridge = await fridgeHost.wait(
    (m) =>
      m.type === "state" &&
      m.dorms[0].props.some((p) => p.kind === "mini_fridge" && p.level === 2),
  );
  // Commands may broadcast several revisions within the same simulation tick.
  const friendView = await fridgePeer.wait(
    (m) =>
      m.type === "state" &&
      m.tick >= upgradedFridge.tick &&
      m.dorms[0].props.some((p) => p.kind === "mini_fridge" && p.level === 2),
  );
  assert.deepEqual(friendView.dorms[0].props, upgradedFridge.dorms[0].props);
  const onFridgeTile = (m) =>
    m.type === "state" &&
    m.tick > upgradedFridge.tick &&
    !m.players[0].sleeping &&
    m.players[0].destination === -1 &&
    Math.floor(m.players[0].y / m.map.tileSize) * m.map.width +
      Math.floor(m.players[0].x / m.map.tileSize) ===
      installed.cell;
  action(fridgeHost, "move", -1, installed.cell);
  await fridgeHost.wait(onFridgeTile);
  await fridgePeer.wait(onFridgeTile);
  action(fridgeHost, "nest", 0);
  await fridgeHost.wait(
    (m) =>
      m.type === "state" &&
      m.tick > upgradedFridge.tick &&
      m.players[0].sleeping,
  );
  console.log(
    "PASS movement onto installed items and synchronized peer positions",
  );
  const friendFridge = await install(fridgePeer, 1);
  assert.equal(
    friendFridge.state.dorms[1].props.filter((p) => p.kind === "mini_fridge")
      .length,
    1,
  );
  const fridgeToken = fridgePeer.token;
  fridgePeer.socket.close();
  const rejoinedFridge = new Client();
  await rejoinedFridge.open();
  rejoinedFridge.send({ type: "resume", token: fridgeToken });
  const restoredFridge = await rejoinedFridge.wait((m) => m.type === "state");
  assert.equal(restoredFridge.offers.items.mini_fridge[0].enabled, false);
  assert.equal(
    restoredFridge.dorms[1].props.filter((p) => p.kind === "mini_fridge")
      .length,
    1,
  );
  console.log(
    "PASS fridge catalog, per-player uniqueness, repeated-command rejection, upgrades, peer snapshots and reconnect",
  );
  // Progress to steel using only authoritative door/nest purchase commands.
  let steelState = upgradedFridge;
  for (let level = 3; level <= 6; ++level) {
    const row = tables.doors.find((d) => d.stage === level);
    const requiredNest =
      row.conditions.find((c) => c.type === "nest_level")?.level ?? 1;
    while (steelState.players[0].bed < requiredNest) {
      const nextBed = steelState.players[0].bed + 1;
      action(fridgeHost, "bed");
      steelState = await fridgeHost.wait(
        (m) => m.type === "state" && m.players[0].bed === nextBed,
      );
    }
    action(fridgeHost, "door");
    steelState = await fridgeHost.wait(
      (m) => m.type === "state" && m.dorms[0].level === level,
    );
  }
  const steelRow = tables.doors.find((d) => d.id === "steel_1");
  assert.equal(steelState.players[0].bed, 5);
  assert.equal(steelState.offers.door.enabled, false);
  action(fridgeHost, "door");
  await fridgeHost.wait(
    (m) => m.type === "error" && m.message.includes("罐头窝"),
  );
  action(fridgeHost, "bed");
  steelState = await fridgeHost.wait(
    (m) => m.type === "state" && m.players[0].bed === 6,
  );
  assert.equal(steelState.offers.door.enabled, true);
  action(fridgeHost, "door");
  steelState = await fridgeHost.wait(
    (m) => m.type === "state" && m.dorms[0].level === steelRow.stage,
  );
  assert.equal(steelState.dorms[0].doorName, "钢门 1级");
  assert.equal(steelState.dorms[0].doorAppearance, "steel");
  assert.equal(steelState.dorms[0].maxHp, steelRow.health);
  assert.equal(steelState.dorms[0].hp, steelRow.health);
  assert.equal(steelState.dorms[0].closed, true);
  assert.equal(steelState.offers.door.enabled, false);
  const steelPeer = await rejoinedFridge.wait(
    (m) => m.type === "state" && m.dorms[0].level === steelRow.stage,
  );
  assert.deepEqual(steelPeer.dorms[0], steelState.dorms[0]);
  const steelCatalog = fridgeHost.catalog.doors.find(
    (d) => d.id === steelRow.id,
  );
  assert.equal(steelCatalog.appearance, "steel");
  assert.equal(steelCatalog.maxHp, steelRow.health);
  assert.deepEqual(steelCatalog.cost, steelRow.cost);
  console.log(
    "PASS steel prerequisites, authoritative upgrade, catalog and synchronized peer appearance",
  );

  const weapon = await install(fridgeHost, 0, "launcher");
  const launcherTable = tables.items.find((item) => item.id === "launcher");
  for (const row of launcherTable.levels) {
    const catalog = fridgeHost.catalog.items.launcher.levels[row.level - 1];
    assert.equal(catalog.name, row.name ?? launcherTable.name);
    assert.equal(
      catalog.appearance,
      row.appearance ?? launcherTable.appearance,
    );
    if (row.level === 1) continue;
    action(fridgeHost, "build", -1, weapon.cell, "launcher");
    const evolved = await fridgeHost.wait(
      (m) =>
        m.type === "state" &&
        m.dorms[0].props.some(
          (p) => p.cell === weapon.cell && p.level === row.level,
        ),
    );
    const own = evolved.dorms[0].props.find((p) => p.cell === weapon.cell);
    assert.equal(own.kind, "launcher");
    assert.equal(own.appearance, catalog.appearance);
    const peer = await rejoinedFridge.wait(
      (m) =>
        m.type === "state" &&
        m.dorms[0].props.some(
          (p) => p.cell === weapon.cell && p.level === row.level,
        ),
    );
    assert.equal(
      peer.dorms[0].props.find((p) => p.cell === weapon.cell).appearance,
      own.appearance,
    );
  }
  console.log(
    "PASS configured item evolution names, upgraded appearances and peer synchronization",
  );

  let drawState = fridgeHost.state;
  for (let draw = 1; draw <= 3; ++draw) {
    const cell = buildCells(drawState, 0)[0];
    const message = action(fridgeHost, "build", -1, cell, "magic_trash_bin");
    fridgeHost.send(message);
    const pending = await fridgeHost.wait(
      (m) =>
        m.type === "state" &&
        m.dorms[0].props.some(
          (p) => p.cell === cell && p.kind === "magic_trash_bin",
        ),
    );
    const bin = pending.dorms[0].props.find((p) => p.cell === cell);
    assert.equal(bin.appearance, "magic_trash_bin");
    assert.ok(bin.revealAt > bin.revealStartedAt);
    assert.equal(
      bin.rewardKind,
      undefined,
      "unrevealed result stays on the server",
    );
    assert.equal(bin.rewardLevel, undefined);
    const offer = pending.offers.items.magic_trash_bin[0];
    assert.equal(
      offer.purchased,
      draw,
      "duplicate command sequence never draws twice",
    );
    assert.equal(offer.limit, 3);
    assert.deepEqual(
      offer.cost,
      tables.random_items[0].purchase_costs[draw] ?? [],
    );
    const peerPending = await rejoinedFridge.wait(
      (m) =>
        m.type === "state" &&
        m.dorms[0].props.some(
          (p) => p.cell === cell && p.kind === "magic_trash_bin",
        ),
    );
    assert.deepEqual(
      peerPending.dorms[0].props.find((p) => p.cell === cell),
      bin,
    );
    assert.equal(
      peerPending.offers.items.magic_trash_bin[0].purchased,
      0,
      "draw limits are personal",
    );
    drawState = await fridgeHost.wait(
      (m) =>
        m.type === "state" &&
        m.dorms[0].props.some(
          (p) => p.cell === cell && p.kind !== "magic_trash_bin",
        ),
    );
    const reward = drawState.dorms[0].props.find((p) => p.cell === cell);
    assert.ok(
      reward.level >= 1 &&
        reward.level <= fridgeHost.catalog.items[reward.kind].levels.length,
    );
    assert.notEqual(
      reward.kind,
      "mini_fridge",
      "owned unique items are excluded",
    );
    assert.equal(
      reward.revealAt,
      undefined,
      "delta removes the completed reveal timer",
    );
    const peerReward = await rejoinedFridge.wait(
      (m) =>
        m.type === "state" &&
        m.dorms[0].props.some((p) => p.cell === cell && p.kind === reward.kind),
    );
    assert.deepEqual(
      peerReward.dorms[0].props.find((p) => p.cell === cell),
      reward,
    );
  }
  assert.equal(drawState.offers.items.magic_trash_bin[0].enabled, false);
  action(
    fridgeHost,
    "build",
    -1,
    buildCells(drawState, 0)[0],
    "magic_trash_bin",
  );
  await fridgeHost.wait(
    (m) => m.type === "error" && m.message.includes("次数已用完"),
  );
  const drawToken = fridgeHost.token;
  fridgeHost.socket.close();
  const drawResumed = new Client();
  await drawResumed.open();
  drawResumed.send({ type: "resume", token: drawToken });
  const restoredDraws = await drawResumed.wait((m) => m.type === "state");
  assert.equal(restoredDraws.offers.items.magic_trash_bin[0].purchased, 3);
  assert.equal(restoredDraws.offers.items.magic_trash_bin[0].enabled, false);
  console.log(
    "PASS delayed trash-bin replacement, hidden draws, synchronized peers, three-purchase cap and reconnect",
  );

  // A visitor exits a closed shop through real movement commands, without opening it to others.
  tables.cat_ai.start_delay_ms = 10000;
  await fs.writeFile(
    path.join(directory, "cat_ai.json"),
    JSON.stringify(tables.cat_ai),
  );
  const doorHost = new Client();
  await doorHost.create(2);
  const doorGuest = new Client();
  await doorGuest.open();
  doorGuest.send({ type: "join", code: doorHost.code, name: "Inside guest" });
  await doorGuest.wait((m) => m.type === "joined");
  doorGuest.send({ type: "ready", ready: true });
  await doorHost.wait(
    (m) => m.type === "state" && m.players[1].human && m.players[1].ready,
  );
  doorHost.send({ type: "start" });
  const doorStart = await doorHost.wait(
    (m) => m.type === "state" && m.phase === "preparing",
  );
  const shop = doorStart.dorms[0];
  const cellAt = (state, id) => {
    const cat = state.players[id],
      map = state.map;
    return (
      Math.floor(cat.y / map.tileSize) * map.width +
      Math.floor(cat.x / map.tileSize)
    );
  };
  action(doorHost, "move", -1, shop.nest);
  action(doorGuest, "move", -1, shop.nest);
  const visited = await doorHost.wait(
    (m) =>
      m.type === "state" &&
      m.players
        .slice(0, 2)
        .every((p) => cellAt(m, p.id) === shop.nest && p.path.length === 0),
  );
  assert.equal(
    visited.dorms[0].owner,
    -1,
    "visiting never claims or reserves the room",
  );
  action(doorHost, "nest", 0);
  const closed = await doorGuest.wait(
    (m) => m.type === "state" && m.dorms[0].owner === 0 && m.dorms[0].closed,
  );
  assert.equal(
    cellAt(closed, 1),
    shop.nest,
    "door closes while guest is still inside",
  );
  assert.equal(closed.players[1].room, -1);
  action(doorHost, "move", -1, shop.entrance);
  await doorHost.wait(
    (m) => m.type === "error" && m.message.includes("走不到"),
  );
  action(doorGuest, "move", -1, shop.entrance);
  const exited = await doorGuest.wait(
    (m) =>
      m.type === "state" &&
      m.tick > closed.tick &&
      cellAt(m, 1) === shop.entrance &&
      m.players[1].path.length === 0,
  );
  assert.equal(exited.dorms[0].closed, true);
  const ownerView = await doorHost.wait(
    (m) =>
      m.type === "state" &&
      m.tick >= exited.tick &&
      cellAt(m, 1) === shop.entrance &&
      m.players[1].path.length === 0,
  );
  assert.equal(ownerView.dorms[0].owner, 0);
  assert.equal(
    ownerView.dorms[0].closed,
    true,
    "guest exit does not globally open the door",
  );
  action(doorGuest, "move", -1, shop.nest);
  await doorGuest.wait(
    (m) => m.type === "error" && m.message.includes("走不到"),
  );
  const extraRoom = doorStart.dorms.length - 1;
  action(doorGuest, "nest", extraRoom);
  const resettled = await doorGuest.wait(
    (m) => m.type === "state" && m.players[1].room === extraRoom,
  );
  assert.equal(resettled.dorms[0].owner, 0);
  assert.equal(resettled.dorms[extraRoom].owner, 1);
  assert.equal(resettled.dorms[0].closed, true);
  console.log(
    "PASS immediate closure, inside guest exit, owner confinement, no re-entry and synchronized peers",
  );
  console.log(
    "PASS split-table loading, live new-match reload, peer versions, old-match isolation, atomic rollback and reconnect",
  );
} finally {
  for (const c of clients) c.socket.terminate();
  server.kill();
  await stopped;
  for (const name of names)
    await fs.rm(path.join(directory, name + ".json"), { force: true });
  await fs.rmdir(directory);
}
