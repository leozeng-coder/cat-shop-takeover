export async function loadCharacterAnimations(manifestUrl) {
  const url = new URL(manifestUrl, location.href);
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('无法读取角色动作配置');
  const manifest = await response.json();
  const [width, height] = manifest.frameSize;
  if (![width, height, manifest.referenceHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid character frame dimensions');
  }
  const config = {
    profile: manifest.profile ?? 'cat',
    strideWorldUnits: manifest.strideWorldUnits,
    paletteUrl: new URL(manifest.palettes, url).href,
    movementClips: manifest.movementClips,
    atlases: {},
    clips: {},
  };
  for (const [name, animation] of Object.entries(manifest.animations)) {
    const { frameCount, columns } = animation;
    if (![frameCount, columns].every((value) => Number.isInteger(value) && value > 0)) {
      throw new Error(`${name}: invalid frame count or columns`);
    }
    config.atlases[name] = {
      src: new URL(animation.src, url).href,
      width: columns * width,
      height: Math.ceil(frameCount / columns) * height,
      sourceBodyHeight: manifest.referenceHeight,
      frames: Array.from({ length: frameCount }, (_, index) => ({
        rect: [(index % columns) * width, Math.floor(index / columns) * height, width, height],
        anchor: manifest.anchor,
      })),
    };
    config.clips[name] = {
      atlas: name,
      frames: Array.from({ length: frameCount }, (_, index) => index),
      durationsMs: animation.durationsMs,
      loop: animation.loop,
      facing: animation.facing,
      mirrorForRight: animation.mirrorForRight === true,
    };
  }
  validateManifest(config);
  return config;
}

export function clipDuration(clip) {
  return clip.durationsMs.reduce((total, milliseconds) => total + milliseconds, 0);
}

export function sampleClip(config, name, time) {
  const clip = config.clips[name];
  const total = clipDuration(clip);
  let offset = clip.loop ? Math.max(0, time) % total : Math.min(Math.max(0, time), total - 0.001);
  let index = 0;
  while (index < clip.frames.length - 1 && offset >= clip.durationsMs[index]) {
    offset -= clip.durationsMs[index++];
  }
  return { atlas: config.atlases[clip.atlas], frame: clip.frames[index], index };
}

export function walkTime(config, distance, action = 'move') {
  return (distance / config.strideWorldUnits) * clipDuration(config.clips[action]);
}

export function validateManifest(config) {
  // Actor-specific states: a shopkeeper has no sleeping/waking cat state.
  const profiles = {
    cat: { move: true, idle: true, sleep: true, wake: false },
    shop_manager: {
      move_left: true,
      move_right: true,
      move_up: true,
      move_down: true,
      idle: true,
      attack: false,
      retreat: true,
    },
  };
  const profile = config.profile ?? 'cat';
  if (!Object.hasOwn(profiles, profile)) throw new Error('Invalid character profile');
  for (const [name, loop] of Object.entries(profiles[profile])) {
    if (config.clips[name]?.loop !== loop) {
      throw new Error(`Invalid character clip: ${name} must ${loop ? 'loop' : 'play once'}`);
    }
  }
  if (profile === 'shop_manager') {
    const directions = ['left', 'right', 'up', 'down'].map((direction) => config.movementClips?.[direction]);
    if (
      directions.some((name) => !name) ||
      new Set(directions).size !== 4 ||
      Object.values(config.clips).some((clip) => clip.mirrorForRight)
    ) {
      throw new Error('Invalid shopkeeper directions: preserve the net hand with separate views');
    }
  }
  for (const [direction, action] of Object.entries(config.movementClips ?? {})) {
    if (!['left', 'right', 'up', 'down'].includes(direction) || !config.clips[action]?.loop) {
      throw new Error(`Invalid movement clip: ${direction} -> ${action}`);
    }
  }
  for (const [name, clip] of Object.entries(config.clips)) {
    const atlas = config.atlases[clip.atlas];
    const expected = clip.frames.length;
    if (
      !atlas ||
      expected === 0 ||
      new Set(clip.frames).size !== expected ||
      clip.durationsMs.length !== expected
    ) {
      throw new Error(`${name}: expected distinct frames with matching durations`);
    }
    if (clip.durationsMs.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`${name}: invalid frame duration`);
    }
    for (const index of clip.frames) {
      if (!Number.isInteger(index) || index < 0) throw new Error(`${name}: invalid frame index`);
      const frame = atlas.frames[index];
      if (!frame || frame.rect.length !== 4 || frame.anchor.length !== 2)
        throw new Error(`${name}: invalid frame`);
      const [x, y, width, height] = frame.rect;
      if (
        width <= 0 ||
        height <= 0 ||
        x < 0 ||
        y < 0 ||
        x + width > atlas.width ||
        y + height > atlas.height
      ) {
        throw new Error(`${name}: frame outside atlas`);
      }
    }
  }
  if (!(config.strideWorldUnits > 0)) throw new Error('Invalid stride length');
}
