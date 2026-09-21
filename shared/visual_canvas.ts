import type { VisualSettings } from './presentation';

// Door artwork uses a shared 6px inset. At this scale its frame meets both neighboring wall tiles.
export const DOOR_VISUAL_SCALE = 34 / 32;

export function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  settings: VisualSettings,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.globalAlpha *= settings.opacity;
  ctx.translate(x + settings.offsetX, y + settings.offsetY);
  ctx.scale(settings.scale, settings.scale);
  ctx.fillStyle = 'rgba(48, 62, 48, 0.16)';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.39, size * 0.28, size * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// World-space transform shared by the game renderer and the admin preview.
export function drawVisualImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  settings: VisualSettings,
  x: number,
  y: number,
  size: number,
  source?: readonly [number, number, number, number],
): void {
  ctx.save();
  ctx.globalAlpha *= settings.opacity;
  ctx.translate(x + settings.offsetX, y + settings.offsetY);
  ctx.scale(settings.scale, settings.scale);
  if (source) {
    ctx.drawImage(image, source[0], source[1], source[2], source[3], -size / 2, -size / 2, size, size);
  } else {
    ctx.drawImage(image, -size / 2, -size / 2, size, size);
  }
  ctx.restore();
}
