import assert from 'node:assert/strict';
import { StateStream, applyStatePatch } from '../client/src/net/state_stream.ts';
import { encodeRequest, decodeMessage } from '../client/src/net/game_protocol.ts';

const catalog = { version: 'fixture' };
const world = {
  configVersion: 'fixture',
  map: { seed: 12, rows: ['...'] },
  players: [{ id: 0, x: 10, path: [1, 2] }],
  dorms: [{ id: 0, props: [{ cell: 2, level: 1, lastShot: 0 }] }],
  monster: { level: 1, levelUps: [] },
};
const personal = {
  you: 0,
  offers: { nest: { enabled: false } },
  repairOffers: [{ enabled: false, reason: 'not yours' }],
};
const stream = new StateStream();
const first = stream.apply({ revision: 1, baseRevision: 0, world, personal }, true, catalog);
const second = stream.apply(
  {
    revision: 2,
    baseRevision: 1,
    world: {
      players: { 0: { x: 14, path: [] } },
      dorms: { 0: { props: { 0: { lastShot: 2 } } } },
      monster: { level: 3, levelUps: [{ level: 2 }, { level: 3 }] },
    },
    personal: { repairOffers: { 0: { enabled: true, reason: '' } } },
  },
  false,
  catalog,
);
assert.equal(first.players[0].x, 10, 'old motion samples cannot be mutated');
assert.deepEqual(first.players[0].path, [1, 2]);
assert.equal(first.dorms[0].props[0].lastShot, 0);
assert.equal(second.players[0].x, 14);
assert.deepEqual(second.players[0].path, []);
assert.equal(second.dorms[0].repairOffer.enabled, true);
assert.equal(second.dorms[0].props[0].lastShot, 2);
assert.deepEqual(
  second.monster.levelUps.map((e) => e.level),
  [2, 3],
  'coalesced event order is preserved',
);
assert.equal(first.map, second.map, 'unchanged map is reused');
assert.throws(
  () => stream.apply({ revision: 4, baseRevision: 3, world: {}, personal: {} }, false, catalog),
  /baseline/,
);
assert.equal(
  stream.apply({ revision: 2, baseRevision: 1, world: {}, personal: {} }, false, catalog),
  null,
  'duplicate frame ignored',
);
assert.throws(
  () => stream.apply({ revision: 3, baseRevision: 2, world: {}, personal: { you: 9 } }, false, catalog),
  /Incomplete/,
);
assert.ok(
  stream.apply({ revision: 3, baseRevision: 2, world: {}, personal: {} }, false, catalog),
  'invalid frame does not advance baseline',
);
assert.ok(
  stream.apply(
    {
      revision: 7,
      baseRevision: 0,
      world: { ...world, map: { seed: 13, rows: ['#.#'] } },
      personal,
    },
    true,
    catalog,
  ),
  'full rebase recovers a gap/new round',
);
assert.deepEqual(applyStatePatch([1, 2], [7]), [7], 'resized arrays replace');
assert.deepEqual(applyStatePatch({ a: 1, b: 2 }, { a: null }), { b: 2 });
assert.throws(() => applyStatePatch({}, JSON.parse('{"__proto__":{"bad":1}}')), /Invalid/);
assert.throws(() => applyStatePatch([{}], { 2: { x: 1 } }), /Invalid/);
assert.equal(JSON.parse(encodeRequest({ type: 'ping' }, 11)).cmd, 1);
assert.deepEqual(decodeMessage('{"v":2,"kind":2,"cmd":1,"id":11,"code":0,"message":""}'), {
  type: 'reply',
  command: 1,
  requestId: 11,
  code: 0,
  message: '',
});
assert.throws(() => decodeMessage('{"v":1,"kind":3,"cmd":100,"body":{}}'), /协议/);
console.log(
  'PASS immutable delta merge, sparse arrays, event order, revisions, rebase and command envelopes',
);
