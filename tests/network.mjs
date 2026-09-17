import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const WebSocket = require('ws');
const managerBalance = require('../data/config/manager.json');
const base = process.env.GAME_TEST_URL || 'http://127.0.0.1:8787';
const clients = [];
class Client {
  constructor() {
    this.ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    this.messages = [];
    this.waiters = [];
    this.state = null;
    this.sequence = 0;
    this.catalog = null;
    this.configMessages = 0;
    this.ws.on('message', (data) => {
      const m = JSON.parse(data);
      this.messages.push(m);
      if (this.messages.length > 300) this.messages.shift();
      if (m.type === 'config') {
        this.catalog = m;
        ++this.configMessages;
      }
      if (m.type === 'state') {
        assert.equal(m.configVersion, this.catalog?.version, 'configuration arrives before its snapshots');
        m.catalog = this.catalog;
        this.state = m;
      }
      if (m.type === 'joined') {
        this.token = m.token;
        this.code = m.code;
        this.you = m.you;
        this.sequence = m.lastSequence;
      }
      for (const wake of [...this.waiters]) wake();
    });
    this.open = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.heartbeat = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.send({ type: 'ping' });
    }, 10000);
    clients.push(this);
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  wait(predicate, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((f) => f !== probe);
      };
      const probe = () => {
        const index = this.messages.findIndex(predicate);
        if (index >= 0) {
          const m = this.messages.splice(index, 1)[0];
          cleanup();
          resolve(m);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for server: ' + predicate.toString()));
      }, timeout);
      this.waiters.push(probe);
      probe();
    });
  }
  async create(capacity) {
    await this.open;
    this.send({ type: 'create', capacity, name: 'Host' });
    await this.wait((m) => m.type === 'joined');
    return this.wait((m) => m.type === 'state');
  }
  async join(code, name) {
    await this.open;
    this.send({ type: 'join', code, name });
    await this.wait((m) => m.type === 'joined');
    return this.wait((m) => m.type === 'state');
  }
  action(action, room = -1, cell = -1, kind = 'launcher') {
    this.send({
      type: 'action',
      action,
      room,
      cell,
      kind,
      seq: ++this.sequence,
    });
  }
  close() {
    clearInterval(this.heartbeat);
    this.ws.close();
  }
}
try {
  assert.equal((await (await fetch(base + '/api/health')).json()).service, 'cat-shop-cpp');
  const bad = new Client();
  await bad.open;
  bad.send({ type: 'start' });
  await bad.wait((m) => m.type === 'error');
  bad.send({ type: 'create', capacity: 'six' });
  await bad.wait((m) => m.type === 'error');
  bad.ws.send('{bad');
  await bad.wait((m) => m.type === 'error');
  bad.send({ type: 'resume', token: 'invalid' });
  await bad.wait((m) => m.type === 'expired');
  console.log('PASS malformed, unauthenticated and expired requests');
  const seeds = new Set();
  for (const [capacity, humans] of [
    [1, 1],
    [6, 2],
    [6, 3],
    [6, 6],
  ]) {
    const host = new Client();
    const initial = await host.create(capacity);
    seeds.add(initial.map.seed);
    assert.equal(initial.monster.level, 1);
    assert.equal(initial.monster.rage, 0);
    assert.equal(initial.monster.attackingPlayer, -1);
    assert.equal(initial.monster.maxLevel, managerBalance.levels.length);
    assert.equal(initial.catalog.manager.doorRage, managerBalance.door_rage);
    assert.equal(initial.catalog.manager.damageRageMultiplier, managerBalance.damage_rage_multiplier);
    assert.equal(initial.catalog.manager.levelUpHealPercent, managerBalance.level_up_heal_percent);
    assert.deepEqual(initial.monster.levelUps, []);
    assert.ok(
      initial.players.every((p) => !('hp' in p) && !('maxHp' in p)),
      'cats have no health field',
    );
    assert.equal(initial.map.rows.length, 36);
    assert.equal(initial.map.rows[0].length, 44);
    assert.equal(initial.players[0].wallet.dried_fish, 0);
    assert.equal(initial.catalog.items.pantry.behavior, 'currency_producer');
    assert.equal(initial.catalog.items.launcher.behavior, 'single_attack');
    assert.equal(initial.catalog.items.repair.behavior, 'door_repair');
    assert.equal(initial.dorms[0].doorName, '木门 1级');
    for (const room of initial.dorms) {
      assert.ok(room.props.length >= 1 && room.props.length <= 2);
      assert.equal(room.closed, false);
      assert.equal(initial.map.rows[Math.floor(room.nest / 44)][room.nest % 44], String(room.id));
      assert.ok(room.props.every((p) => p.cell !== room.nest));
    }
    const party = [host];
    for (let i = 1; i < humans; i++) {
      const friend = new Client();
      await friend.join(host.code, 'Friend ' + i);
      party.push(friend);
    }
    if (capacity === 6) {
      host.send({ type: 'start' });
      await host.wait((m) => m.type === 'error');
    }
    for (const friend of party.slice(1)) friend.send({ type: 'ready', ready: true });
    await host.wait(
      (m) =>
        m.type === 'state' &&
        m.players.filter((p) => p.human).length === humans &&
        m.players.every((p) => p.ready),
    );
    host.send({ type: 'start' });
    const start = await host.wait((m) => m.type === 'state' && m.phase === 'preparing');
    assert.equal(start.preparation, 30);
    assert.equal(
      start.preparation + start.duration,
      600,
      'round includes preparation in its ten-minute limit',
    );
    assert.equal(start.players.filter((p) => p.bot).length, 6 - humans);
    for (let i = 0; i < party.length; i++) party[i].action('nest', i);
    const walking = await host.wait((m) => m.type === 'state' && m.players[0].destination >= 0);
    assert.equal(walking.players[0].room, -1, 'nest click cannot remotely claim');
    const settled = await host.wait(
      (m) => m.type === 'state' && party.every((_, i) => m.players[i].sleeping && m.players[i].room === i),
    );
    for (const p of settled.players) {
      const x = Math.floor(p.x / settled.map.tileSize),
        y = Math.floor(p.y / settled.map.tileSize);
      assert.notEqual(settled.map.rows[y][x], '#', 'cat cannot occupy a wall');
    }
    assert.ok(
      party.every((_, i) => settled.dorms[i].closed),
      'each claimed door is closed',
    );
    host.action('move', -1, settled.map.spawn);
    await host.wait((m) => m.type === 'error' && m.message.includes('走不到'));
    host.action('move', -1, 0);
    await host.wait((m) => m.type === 'error' && m.message.includes('走不到'));
    host.action('build', -1, settled.dorms[0].nest);
    await host.wait((m) => m.type === 'error');
    assert.equal(settled.offers.nest.enabled, false, 'nest offer requires a stronger door');
    assert.ok(settled.offers.nest.reason.includes('木门 2级'));
    host.action('bed');
    await host.wait((m) => m.type === 'error' && m.message.includes('木门 2级'));
    host.action('door');
    const doorUpgraded = await host.wait((m) => m.type === 'state' && m.dorms[0].level === 2);
    assert.equal(doorUpgraded.dorms[0].doorName, '木门 2级');
    const affordable = await host.wait((m) => m.type === 'state' && m.offers.nest.enabled);
    host.send({
      type: 'action',
      action: 'build',
      kind: 'missing_item',
      room: 0,
      cell: Number(
        affordable.map.rows
          .flatMap((row, y) => [...row].map((t, x) => (t === '0' ? y * 44 + x : -1)))
          .find((c) => c >= 0 && c !== affordable.dorms[0].nest),
      ),
      seq: ++host.sequence,
    });
    await host.wait((m) => m.type === 'error');
    host.action('bed');
    await host.wait((m) => m.type === 'state' && m.players[0].bed === 2);
    host.send({ type: 'action', action: 'bed', seq: host.sequence });
    const funded = await host.wait(
      (m) =>
        m.type === 'state' &&
        m.players[0].wallet.cans >= host.catalog.items.pantry.levels[0].cost[0].amount &&
        m.players[0].bed === 2,
    );
    const map = funded.map,
      room = funded.dorms[0];
    let cell = -1;
    for (let y = 1; y < map.height - 1 && cell < 0; y++)
      for (let x = 1; x < map.width - 1; x++) {
        const n = y * map.width + x;
        if (map.rows[y][x] !== '0' || n === room.nest || room.props.some((p) => p.cell === n)) continue;
        const adjacent = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].filter(([xx, yy]) => map.rows[yy][xx] === '0').length;
        if (adjacent === 4) {
          cell = n;
          break;
        }
      }
    assert.ok(cell >= 0);
    host.action('build', -1, cell, 'pantry');
    const built = await host.wait(
      (m) => m.type === 'state' && m.dorms[0].props.some((p) => p.cell === cell && p.kind === 'pantry'),
    );
    assert.ok(built.players[0].income >= 13, 'storage increases nest income');
    let walkingCell = -1;
    for (let y = 0; y < map.height && walkingCell < 0; y++)
      for (let x = 0; x < map.width; x++) {
        const n = y * map.width + x;
        if (map.rows[y][x] === '0' && n !== room.nest && !built.dorms[0].props.some((p) => p.cell === n)) {
          walkingCell = n;
          break;
        }
      }
    assert.ok(walkingCell >= 0);
    host.action('move', -1, walkingCell);
    const awake = await host.wait((m) => m.type === 'state' && m.tick > built.tick && !m.players[0].sleeping);
    assert.equal(awake.players[0].income, built.players[0].income, 'movement keeps nest and storage income');
    const roaming = await host.wait(
      (m) =>
        m.type === 'state' &&
        m.tick > awake.tick &&
        !m.players[0].sleeping &&
        m.players[0].wallet.cans > awake.players[0].wallet.cans,
    );
    assert.equal(roaming.dorms[0].closed, true, 'standing does not reopen entrance');
    host.action('nest', 0);
    const resting = await host.wait(
      (m) => m.type === 'state' && m.tick > roaming.tick && m.players[0].sleeping,
    );
    assert.equal(resting.players[0].income, awake.players[0].income, 'resting keeps same income');
    if (humans === 2) {
      const token = party[1].token;
      party[1].close();
      await host.wait((m) => m.type === 'state' && m.players[1].bot && !m.players[1].connected, 8000);
      const resumed = new Client();
      await resumed.open;
      resumed.send({ type: 'resume', token });
      await resumed.wait((m) => m.type === 'joined');
      const restored = await resumed.wait(
        (m) => m.type === 'state' && m.players[1].connected && !m.players[1].bot,
      );
      assert.equal(restored.you, 1);
      assert.equal(restored.map.seed, start.map.seed);
      assert.equal(restored.players[1].room, 1);
      assert.equal(restored.dorms[1].closed, true, 'reconnect preserves closed door');
      resumed.send({ type: 'leave' });
      await resumed.wait((m) => m.type === 'left');
      resumed.close();
      console.log('PASS disconnect AI takeover and same-map reconnection');
    }
    if (humans === 6) {
      host.send({
        type: 'action',
        action: 'gainRage',
        seq: ++host.sequence,
        rage: 99999,
        level: 99,
      });
      await host.wait((m) => m.type === 'error' && m.message.includes('未知'));
      const attack = await host.wait(
        (m) =>
          m.type === 'state' &&
          m.phase === 'running' &&
          m.monster.state === 'attacking' &&
          m.monster.attackingPlayer >= 0 &&
          m.monster.doorHits > 0,
        40000,
      );
      assert.equal(attack.monster.attackingPlayer, attack.dorms[attack.monster.target].owner);
      assert.equal(attack.monster.attackSequence, attack.monster.doorHits, 'only valid door strikes count');
      assert.ok(attack.monster.rage > 0 || attack.monster.level > 1);
      assert.ok(attack.monster.level <= 10, 'client cannot award rage');
      const peer = await party[1].wait((m) => m.type === 'state' && m.tick === attack.tick);
      assert.deepEqual(
        peer.monster,
        attack.monster,
        'all clients receive identical combat state at same tick',
      );
      const token = party[1].token;
      party[1].close();
      const resumed = new Client();
      await resumed.open;
      resumed.send({ type: 'resume', token });
      await resumed.wait((m) => m.type === 'joined');
      const restored = await resumed.wait((m) => m.type === 'state');
      assert.ok(restored.monster.level >= attack.monster.level);
      assert.ok(restored.monster.doorHits >= attack.monster.doorHits);
      assert.ok(
        restored.monster.level > attack.monster.level || restored.monster.rage >= attack.monster.rage,
      );
      party[1] = resumed;
      console.log('PASS authoritative door rage, attack target, synchronized peers and combat reconnection');
    }
    assert.equal(host.configMessages, 1, 'static catalog is not repeated each snapshot');
    for (const c of party)
      if (c.ws.readyState === WebSocket.OPEN) {
        c.send({ type: 'leave' });
        await c.wait((m) => m.type === 'left');
        c.close();
      }
    console.log(
      'PASS ' + humans + ' humans: AI fill, synchronized map, physical arrival, grid building and income',
    );
  }
  assert.equal(seeds.size, 4);
  console.log('ALL NETWORK CHECKS PASSED');
} finally {
  for (const c of clients) c.close();
}
