import { cellCenter, type GridMap } from '../model/GameTypes';

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

export class MotionTrack {
  private readonly samples: Sample[] = [];

  push(tick: number, received: number, pose: Pose): void {
    const last = this.samples[this.samples.length - 1];
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
    let from = this.samples[0];
    let to = from;
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
  if (!from.path.length || Math.abs(from.x - to.x) < 0.01 || Math.abs(from.y - to.y) < 0.01) {
    return { x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha };
  }
  const points: { x: number; y: number }[] = [from];
  let found = false;
  for (const cell of from.path) {
    const next = cellCenter(map, cell);
    const previous = points[points.length - 1];
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
  if (!found) return { x: to.x, y: to.y };
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let distance = lengths.reduce((sum, length) => sum + length, 0) * alpha;
  for (let index = 0; index < lengths.length; index += 1) {
    if (distance <= lengths[index] && lengths[index] > 0) {
      const ratio = distance / lengths[index];
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    distance -= lengths[index];
  }
  return { x: to.x, y: to.y };
}
