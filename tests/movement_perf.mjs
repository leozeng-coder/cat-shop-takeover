import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../client/package.json", import.meta.url),
);
const WebSocket = require("ws");
const ws = new WebSocket("ws://127.0.0.1:8787/ws");
let sequence = 0,
  last = null,
  arrivals = [],
  stalls = 0,
  steps = 0,
  started = 0,
  commandAt = 0,
  firstMove = 0,
  previousTime = 0,
  destination = -1;
const timer = setTimeout(() => {
  console.error("No movement completion");
  ws.close();
  process.exitCode = 1;
}, 25000);
ws.on("open", () =>
  ws.send(
    JSON.stringify({ type: "create", capacity: 1, name: "Movement probe" }),
  ),
);
ws.on("message", (data) => {
  const m = JSON.parse(data);
  if (m.type === "joined") ws.send(JSON.stringify({ type: "start" }));
  if (m.type !== "state") return;
  const p = m.players[m.you],
    now = performance.now();
  if (m.phase === "preparing" && !started) {
    started = now;
    commandAt = now;
    destination = m.map.width + 1;
    ws.send(
      JSON.stringify({
        type: "action",
        action: "move",
        cell: destination,
        seq: ++sequence,
      }),
    );
  }
  if (started && last) {
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist > 0.1 && !firstMove) firstMove = now;
    if (last.destination >= 0 && p.destination >= 0) {
      arrivals.push(now - previousTime);
      steps++;
      if (dist < 0.01) stalls++;
    }
  }
  last = p;
  previousTime = now;
  if (firstMove && p.destination < 0) {
    clearTimeout(timer);
    arrivals.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        firstMoveMs: firstMove - commandAt,
        snapshots: steps,
        stationarySnapshots: stalls,
        p95GapMs: arrivals[Math.floor(arrivals.length * 0.95)],
        maxGapMs: arrivals.at(-1),
        journeyMs: now - started,
      }),
    );
    assert.equal(stalls, 0, "movement should never pause between path nodes");
    ws.send(JSON.stringify({ type: "leave" }));
    ws.close();
  }
});
