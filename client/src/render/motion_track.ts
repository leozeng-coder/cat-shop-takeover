import { cellCenter, type GridMap } from '../types.ts';
interface Pose {
  x: number;
  y: number;
  path: number[];
}
interface Sample {
  tick: number;
  received: number;
  pose: Pose;
}
/** Buffered, constant-speed snapshot interpolation. Follow server waypoints at corners. */
export class MotionTrack {
  private samples: Sample[] = [];
  push(tick: number, received: number, pose: Pose) {
    const last = this.samples.at(-1);
    if (last?.tick === tick) {
      last.pose = pose;
      return;
    }
    this.samples.push({ tick, received, pose });
    if (this.samples.length > 8) this.samples.shift();
  }
  sample(now: number, map: GridMap, delay = 140): { x: number; y: number } {
    const target = now - delay;
    if (!this.samples.length) return { x: 0, y: 0 };
    let from = this.samples[0],
      to = from;
    for (const candidate of this.samples) {
      if (candidate.received <= target) from = candidate;
      if (candidate.received >= target) {
        to = candidate;
        break;
      }
      to = candidate;
    }
    if (from === to || target <= from.received) return { x: from.pose.x, y: from.pose.y };
    const alpha = Math.max(0, Math.min(1, (target - from.received) / (to.received - from.received)));
    return interpolateRoute(from.pose, to.pose, alpha, map);
  }
}
function interpolateRoute(from: Pose, to: Pose, alpha: number, map: GridMap) {
  if (Math.abs(from.x - to.x) < 0.01 || Math.abs(from.y - to.y) < 0.01)
    return { x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha };
  const points: { x: number; y: number }[] = [from];
  let found = false;
  for (const cell of from.path) {
    const next = cellCenter(map, cell),
      previous = points.at(-1)!;
    const onSegment =
      (Math.abs(previous.x - next.x) < 0.01 &&
        Math.abs(to.x - next.x) < 0.01 &&
        to.y >= Math.min(previous.y, next.y) - 0.01 &&
        to.y <= Math.max(previous.y, next.y) + 0.01) ||
      (Math.abs(previous.y - next.y) < 0.01 &&
        Math.abs(to.y - next.y) < 0.01 &&
        to.x >= Math.min(previous.x, next.x) - 0.01 &&
        to.x <= Math.max(previous.x, next.x) + 0.01);
    if (onSegment) {
      points.push(to);
      found = true;
      break;
    }
    points.push(next);
  }
  // An explicitly changed route is authoritative. Never draw a diagonal through a wall.
  if (!found) return { x: to.x, y: to.y };
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let distance = lengths.reduce((a, b) => a + b, 0) * alpha;
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] && lengths[i] > 0) {
      const t = distance / lengths[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    distance -= lengths[i];
  }
  return { x: to.x, y: to.y };
}
