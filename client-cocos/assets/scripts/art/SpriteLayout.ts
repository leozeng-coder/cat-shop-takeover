export type PixelBounds = readonly [number, number, number, number];

/** SpriteFrame rectangles use image coordinates: top row first. */
export function atlasRect(index: number, columns: number, width: number, height: number,
                          bounds: PixelBounds = [0, 0, width, height]): PixelBounds {
  return [(index % columns) * width + bounds[0], Math.floor(index / columns) * height + bounds[1],
    bounds[2], bounds[3]];
}

export function fitExtent(width: number, height: number, extent: number): { width: number; height: number } {
  const scale = extent / Math.max(width, height);
  return { width: width * scale, height: height * scale };
}

export function clipFrameIndex(durations: readonly number[], total: number, loop: boolean, elapsed: number): number {
  let offset = loop ? ((elapsed % total) + total) % total : Math.min(Math.max(elapsed, 0), total - 0.001);
  let index = 0;
  while (index < durations.length - 1 && offset >= durations[index]) offset -= durations[index++];
  return index;
}
