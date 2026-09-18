import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const ts = require('typescript');
// Load the actual UI module without a browser, with a deterministic timer/element boundary.
async function moduleUrl(url) {
  const source = await fs.readFile(url, 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const imports = [...output.matchAll(/from '([^']+)'/g)];
  for (const match of imports) {
    output = output.replace(match[0], "from '" + (await moduleUrl(new URL(match[1] + '.ts', url))) + "'");
  }
  return 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
}
const { ManagerAnnouncement } = await import(
  await moduleUrl(new URL('../client/src/ui/manager_announcement.ts', import.meta.url))
);
let serial = 0;
const timers = new Map();
globalThis.window = {
  setTimeout(callback) {
    const id = ++serial;
    timers.set(id, callback);
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
};
const element = {
  innerHTML: '',
  hidden: true,
  classList: {
    add(name) {
      if (name === 'hidden') element.hidden = true;
    },
    remove(name) {
      if (name === 'hidden') element.hidden = false;
    },
  },
};
const announcement = new ManagerAnnouncement(element);
const events = [
  { level: 2, healed: 202.5, text: '店长生气了！' },
  { level: 3, healed: 242.5, text: '是谁又在偷罐头？！' },
  { level: 4, healed: 0, text: '<img src=x onerror=alert(1)>' },
];
function state(level, seed = 1, phase = 'running') {
  return {
    code: 'ABC',
    map: { seed },
    phase,
    monster: { level, levelUps: events.filter((e) => e.level <= level) },
  };
}
function next() {
  assert.equal(timers.size, 1);
  const [id, callback] = timers.entries().next().value;
  timers.delete(id);
  callback();
}
announcement.update(state(1, 1, 'preparing'));
announcement.update(state(3));
assert.match(element.innerHTML, /店长生气了！/);
assert.match(element.innerHTML, /回复 202.5 生命/);
announcement.update(state(3));
assert.equal(timers.size, 1, 'duplicate snapshots do not restart animation');
next();
assert.match(element.innerHTML, /是谁又在偷罐头/);
announcement.update(state(4));
next();
assert.ok(!element.innerHTML.includes('<img'), 'configured copy is escaped');
assert.match(element.innerHTML, /&lt;img/);
assert.ok(!element.innerHTML.includes('回复'), 'lethal upgrade cannot claim healing');
next();
assert.equal(element.hidden, true, 'queue drains every coalesced event exactly once');
announcement.update(state(4));
assert.equal(timers.size, 0);
announcement.reset();
announcement.update(state(3));
assert.equal(element.hidden, true, 'fresh page does not replay historical upgrades');
announcement.update(state(4));
assert.equal(element.hidden, false, 'resumed page plays unseen upgrades');
announcement.update(state(1, 2, 'preparing'));
assert.equal(timers.size, 0, 'new match clears old animation and queue');
announcement.update(state(2, 2));
assert.match(element.innerHTML, /店长生气了/);
announcement.update(state(2, 2, 'won'));
assert.equal(element.hidden, true);
assert.equal(timers.size, 0, 'result screen cancels pending announcements');
announcement.reset();
assert.equal(element.innerHTML, '');
const withPortrait = new ManagerAnnouncement(element, () => 'blob:manager-idle');
withPortrait.update(state(1));
withPortrait.update(state(2));
assert.match(element.innerHTML, /<img src="blob:manager-idle" alt=""/);
withPortrait.reset();
console.log(
  'PASS upgrade queue ordering, deduplication, reconnect baseline, rematch, exit, terminal state and escaped configured copy',
);
