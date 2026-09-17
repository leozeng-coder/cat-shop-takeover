import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const WebSocket = require('ws');
const root = fileURLToPath(new URL('../', import.meta.url));
const tempBase = path.resolve(os.tmpdir());
const directory = await fs.mkdtemp(path.join(tempBase, 'cat-shop-tables-'));
assert.equal(path.dirname(path.resolve(directory)), tempBase);
assert.ok(path.basename(directory).startsWith('cat-shop-tables-'));
const names = [
  'manifest',
  'currencies',
  'match',
  'doors',
  'nests',
  'items',
  'manager',
  'repair',
  'map_items',
  'cat_ai',
  'manager_ai',
];
const tables = {};
for (const name of names) {
  const text = await fs.readFile(path.join(root, 'data/config', name + '.json'), 'utf8');
  tables[name] = JSON.parse(text);
  await fs.writeFile(path.join(directory, name + '.json'), text);
}
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const executable = path.join(root, 'build/server/Release/cat_shop_server.exe');
const server = spawn(
  executable,
  ['--bind', '127.0.0.1', '--port', String(port), '--web', 'client/dist', '--config', directory],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
server.stdout.on('data', (data) => {
  log = (log + data).slice(-20000);
});
server.stderr.on('data', (data) => {
  log = (log + data).slice(-20000);
});
const stopped = once(server, 'exit');
const clients = [];
class Client {
  constructor() {
    this.socket = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    this.messages = [];
    this.waiters = new Set();
    this.catalogs = 0;
    this.socket.on('message', (bytes) => {
      const message = JSON.parse(bytes);
      if (message.type === 'config') {
        this.catalog = message;
        ++this.catalogs;
      }
      if (message.type === 'joined') {
        this.token = message.token;
        this.code = message.code;
      }
      if (message.type === 'state') {
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
    await once(this.socket, 'open');
  }
  send(value) {
    this.socket.send(JSON.stringify(value));
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
        reject(new Error('Timed out waiting for configuration protocol'));
      }, 5000);
      this.waiters.add(check);
      check();
    });
  }
  async create(capacity = 1) {
    await this.open();
    this.send({ type: 'create', capacity, name: 'Config test' });
    await this.wait((m) => m.type === 'joined');
    return this.wait((m) => m.type === 'state');
  }
}
try {
  let ready = false;
  for (let i = 0; i < 60; ++i) {
    if (server.exitCode !== null) throw new Error('Test server exited: ' + log);
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/health');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'test server starts with split tables');
  const host = new Client();
  const old = await host.create(6);
  const oldVersion = old.configVersion;
  const oldIncome = host.catalog.nests[0].amount;
  const peer = new Client();
  await peer.open();
  peer.send({ type: 'join', code: host.code, name: 'Friend' });
  await peer.wait((m) => m.type === 'state');
  assert.deepEqual(peer.catalog, host.catalog, 'friends share one configuration snapshot');
  tables.nests[0].amount = oldIncome + 3;
  tables.currencies.find((c) => c.id === 'dried_fish').initial = 4;
  for (const name of ['nests', 'currencies']) {
    await fs.writeFile(path.join(directory, name + '.json'), JSON.stringify(tables[name]));
  }
  const fresh = new Client();
  const next = await fresh.create();
  assert.notEqual(next.configVersion, oldVersion);
  assert.equal(fresh.catalog.nests[0].amount, oldIncome + 3);
  assert.equal(next.players[0].wallet.dried_fish, 4);
  const unchanged = await host.wait((m) => m.type === 'state' && m.tick > old.tick);
  assert.equal(unchanged.configVersion, oldVersion);
  assert.equal(host.catalog.nests[0].amount, oldIncome);
  assert.equal(host.catalogs, 1, 'catalog is sent once per version');
  assert.equal(unchanged.players[0].wallet.dried_fish, 0);
  tables.items[0].behavior = 'missing_handler';
  await fs.writeFile(path.join(directory, 'items.json'), JSON.stringify(tables.items));
  const fallback = new Client();
  const kept = await fallback.create();
  assert.equal(kept.configVersion, next.configVersion, 'bad table cannot partially replace valid bundle');
  assert.equal(kept.players[0].wallet.dried_fish, 4);
  const resumed = new Client();
  const token = host.token;
  host.socket.close();
  await resumed.open();
  resumed.send({ type: 'resume', token });
  const resumedState = await resumed.wait((m) => m.type === 'state');
  assert.equal(resumedState.configVersion, oldVersion);
  assert.equal(resumed.catalog.nests[0].amount, oldIncome);
  assert.equal(resumedState.players[0].wallet.dried_fish, 0);
  const invalid = spawn(executable, ['--config', directory, '--check-config'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
  });
  const [exit] = await once(invalid, 'exit');
  assert.equal(exit, 2, 'invalid first load fails startup validation');
  assert.match(log, /Config reload rejected/);
  console.log(
    'PASS split-table loading, live new-match reload, peer versions, old-match isolation, atomic rollback and reconnect',
  );
} finally {
  for (const c of clients) c.socket.terminate();
  server.kill();
  await stopped;
  for (const name of names) await fs.rm(path.join(directory, name + '.json'), { force: true });
  await fs.rmdir(directory);
}
