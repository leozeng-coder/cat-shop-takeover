import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { ProtocolClient } from './protocol_client.mjs';
import { decodeMessage } from '../client/src/net/game_protocol.ts';

const require = createRequire(new URL('../client/package.json', import.meta.url));
const WebSocket = require('ws');
const url = (process.env.GAME_TEST_URL || 'http://127.0.0.1:8787').replace(/^http/, 'ws') + '/ws';
const clients = [];
class Client {
  protocol = new ProtocolClient();
  messages = [];
  state = null;
  failure = null;
  dropNextDelta = false;
  rebaseNeeded = false;
  expectGap = false;
  constructor() {
    clients.push(this);
    this.ws = new WebSocket(url);
    this.ws.on('error', (error) => {
      this.failure = error;
    });
    this.ws.on('message', (data) => {
      try {
        const packet = decodeMessage(String(data));
        if (this.dropNextDelta && packet.type === 'delta') {
          this.dropNextDelta = false;
          return;
        }
        if (this.rebaseNeeded && packet.type === 'delta') return;
        const message = this.protocol.receive(data);
        if (!message) return;
        if (message.type === 'state') this.state = message;
        if (message.type === 'joined') this.joined = message;
        this.messages.push(message);
      } catch (error) {
        if (this.expectGap && error.message === 'Missing snapshot baseline') this.rebaseNeeded = true;
        else this.failure = error;
      }
    });
  }
  send(message) {
    this.ws.send(this.protocol.send(message));
    return this.protocol.requestId;
  }
  async until(predicate) {
    const deadline = performance.now() + 5000;
    while (!predicate()) {
      if (this.failure) throw this.failure;
      if (performance.now() > deadline)
        throw new Error(
          'Timeout: ' +
            predicate +
            '\n' +
            JSON.stringify({
              phase: this.state?.phase,
              rebaseNeeded: this.rebaseNeeded,
              packets: this.protocol.packets.slice(-4),
            }),
        );
      await delay(10);
    }
  }
  async ready() {
    await this.until(() => this.messages.some((m) => m.type === 'hello'));
  }
  async request(message, expectError = false) {
    const id = this.send(message);
    await this.until(() => this.messages.some((m) => m.requestId === id));
    const reply = this.messages.find((m) => m.requestId === id);
    if (expectError) assert.equal(reply.type, 'error');
    else assert.notEqual(reply.type, 'error', reply.message);
    return reply;
  }
  frames(type) {
    return this.protocol.packets.filter((p) => p.packet.type === type);
  }
}
try {
  const host = new Client();
  await host.ready();
  const ping = await host.request({ type: 'ping' });
  assert.equal(ping.command, 1);
  await host.request({ type: 'create', capacity: 6, name: 'Delta host' });
  const party = [host];
  for (let i = 1; i < 6; ++i) {
    const peer = new Client();
    await peer.ready();
    await peer.request({
      type: 'join',
      code: host.joined.code,
      name: 'Friend ' + i,
    });
    await peer.request({ type: 'ready', ready: true });
    party.push(peer);
  }
  // Interleave I/O commands with timer snapshots; neither may overtake the other.
  await Promise.all(
    party
      .slice(1)
      .flatMap((peer) =>
        Array.from({ length: 6 }, (_, i) => peer.request({ type: 'ready', ready: i % 2 === 1 })),
      ),
  );
  await host.request({ type: 'start' });
  await host.until(() => host.state?.phase === 'preparing');
  const frame = host.frames('delta').at(-1).packet.body;
  for (const [seat, peer] of party.entries()) {
    await peer.until(() => peer.frames('delta').some((f) => f.packet.body.revision === frame.revision));
    const other = peer.frames('delta').find((f) => f.packet.body.revision === frame.revision).packet.body;
    assert.deepEqual(other.world, frame.world, 'same frame shares one public patch');
    assert.equal(peer.state.you, seat);
    assert.equal(peer.state.players.filter((p) => p.human).length, 6);
    assert.equal(peer.frames('snapshot').length, 1, 'only the initial frame is full');
    assert.equal(peer.frames('config').length, 1);
    assert.ok(peer.frames('delta').every((f) => !Object.hasOwn(f.packet.body.world, 'map')));
  }
  console.log('PASS six friends, correlated replies, shared deltas, separate player views and one baseline');

  const affected = party[2];
  affected.expectGap = true;
  affected.dropNextDelta = true;
  await affected.until(() => affected.rebaseNeeded);
  const count = affected.frames('snapshot').length;
  await affected.request({ type: 'resync' });
  assert.equal(affected.frames('snapshot').length, count + 1);
  assert.equal(affected.state.code, host.state.code);
  assert.equal(affected.state.you, 2);
  affected.rebaseNeeded = false;
  affected.expectGap = false;
  const rebasedTick = affected.state.tick;
  await affected.until(() => affected.state.tick > rebasedTick);
  assert.equal(affected.rebaseNeeded, false, 'deltas continue after a full rebase');
  assert.equal(host.frames('snapshot').length, 1, 'one peer resync does not reset other peers');

  const token = affected.joined.token;
  affected.ws.terminate();
  const resumed = new Client();
  await resumed.ready();
  await resumed.request({ type: 'resume', token });
  assert.equal(resumed.state.you, 2);
  assert.equal(resumed.state.code, host.state.code);
  assert.deepEqual(
    resumed.state.map,
    host.state.map,
    'reconnect retains the authoritative map profile and geometry',
  );
  assert.equal(resumed.frames('snapshot').length, 1);
  assert.equal(resumed.frames('config').length, 1);
  const resumedTick = resumed.state.tick;
  await resumed.until(() => resumed.state.tick > resumedTick);
  console.log('PASS missing revision detection, peer-only rebase and session resume followed by deltas');

  const choice = new Client();
  await choice.ready();
  await choice.request({ type: 'maps' });
  const maps = choice.messages.find((m) => m.type === 'maps').maps;
  assert.ok(maps.length >= 2);
  await choice.request({ type: 'create', capacity: 6, name: 'Map host', mapId: 'missing_map' }, true);
  await choice.request({ type: 'create', capacity: 6, name: 'Map host', mapId: maps[0].id });
  assert.equal(choice.state.map.id, maps[0].id);
  assert.equal(choice.state.map.theme, maps[0].theme);
  const guest = new Client();
  await guest.ready();
  await guest.request({ type: 'join', code: choice.joined.code, name: 'Map friend' });
  const oldSeed = guest.state.map.seed;
  await guest.request({ type: 'ready', ready: true, mapSeed: oldSeed });
  await guest.request({ type: 'select_map', mapId: maps[1].id }, true);
  await choice.request({ type: 'select_map', mapId: maps[1].id });
  await guest.until(() => guest.state.map.id === maps[1].id);
  assert.deepEqual(choice.state.map, guest.state.map);
  assert.equal(guest.state.players[1].ready, false);
  assert.equal(choice.state.map.width, maps[1].width);
  await guest.request({ type: 'ready', ready: true, mapSeed: oldSeed }, true);
  await choice.request({ type: 'start', mapSeed: oldSeed }, true);
  await guest.request({ type: 'ready', ready: true, mapSeed: guest.state.map.seed });
  await choice.request({ type: 'start', mapSeed: choice.state.map.seed });
  await choice.request({ type: 'select_map', mapId: maps[0].id }, true);
  console.log(
    'PASS map list, explicit selection, host-only changes, peer map agreement and stale readiness rejection',
  );

  const solo = new Client();
  await solo.ready();
  await solo.request({ type: 'create', capacity: 1, name: 'Bandwidth probe' });
  await solo.request({ type: 'start' });
  const since = performance.now();
  await delay(8500);
  const elapsed = (performance.now() - since) / 1000;
  if (solo.failure) throw solo.failure;
  const deltas = solo.frames('delta').filter((f) => f.time >= since);
  assert.ok(deltas.length > 40);
  assert.equal(solo.frames('snapshot').length, 1);
  const bytes = deltas.reduce((sum, p) => sum + p.bytes, 0);
  console.log(
    JSON.stringify({
      sample: 'solo preparation; UTF-8 application payload, excludes framing and initial baseline/catalog',
      seconds: +elapsed.toFixed(2),
      deltas: deltas.length,
      averageDeltaBytes: Math.round(bytes / deltas.length),
      payloadBytesPerSecond: Math.round(bytes / elapsed),
      initialBaselineBytes: solo.frames('snapshot')[0].bytes,
      catalogBytes: solo.frames('config')[0].bytes,
    }),
  );
  console.log('PASS incremental bandwidth probe');
} finally {
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.joined) client.send({ type: 'leave' });
    client.ws.close();
  }
}
