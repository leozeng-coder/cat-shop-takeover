export interface VisualSettings {
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  speed: number;
  curve: [number, number, number, number];
}

export const DEFAULT_VISUAL: VisualSettings = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  speed: 1,
  curve: [0, 0, 1, 1],
};

export interface PresentationData {
  version: 1;
  entries: Record<string, VisualSettings>;
}

export function visual(
  data: PresentationData | undefined,
  id: string,
): VisualSettings {
  return data?.entries[id] ?? DEFAULT_VISUAL;
}

// Cubic-bezier timing: solve x(t) first, then evaluate y(t).
export function visualEase(
  progress: number,
  curve: VisualSettings["curve"],
): number {
  const [x1, y1, x2, y2] = curve;
  const target = Math.max(0, Math.min(1, progress));
  if (x1 === y1 && x2 === y2) return target;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 16; i++) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
    if (x < target) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
}

export function visualTime(
  time: number,
  duration: number,
  settings: VisualSettings,
  loop = true,
): number {
  if (duration <= 0) return 0;
  const elapsed = Math.max(0, time * settings.speed);
  const cycle = loop ? elapsed % duration : Math.min(elapsed, duration);
  return visualEase(cycle / duration, settings.curve) * duration;
}
