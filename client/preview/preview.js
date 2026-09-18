import { clipDuration, sampleClip, loadCharacterAnimations } from '../src/characters/animation.js';
import { loadPalettes, PaletteAtlases } from '../src/characters/palette-atlases.js';

const labels = {
  move: '横向移动',
  move_down: '朝下移动',
  move_up: '朝上移动',
  idle: '待机',
  wake: '起身',
  sleep: '睡眠呼吸',
};
const isMove = (name) => name === 'move' || name === 'move_up' || name === 'move_down';
const elements = Object.fromEntries(
  [
    'motion',
    'status',
    'pause',
    'previous',
    'next',
    'speed',
    'mode',
    'right',
    'frame',
    'frames',
    'action',
    'playback',
    'frame-count',
    'skins',
    'skin-status',
    'animation-summary',
  ].map((id) => [id, document.getElementById(id)]),
);
let config,
  images,
  paused = false,
  elapsed = 0,
  lastTime = 0,
  rate = 1,
  action = 'move';
let cards = [];
let palettes, paletteAtlases, displayImage, selectedSkin;
let wantedAction = 'move',
  wantedSkin,
  appearanceRevision = 0;
const skinButtons = new Map();

function context(canvas) {
  const rect = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr)),
    h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { ctx, width: rect.width, height: rect.height };
}

function drawCat(ctx, index, x, y, size, right = false) {
  const atlas = config.atlases[config.clips[action].atlas];
  const frame = atlas.frames[index],
    [sx, sy, sw, sh] = frame.rect;
  const scale = (size / atlas.sourceBodyHeight) * (frame.scale || 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(right ? -1 : 1, 1);
  ctx.drawImage(
    displayImage,
    sx,
    sy,
    sw,
    sh,
    -frame.anchor[0] * scale,
    -frame.anchor[1] * scale,
    sw * scale,
    sh * scale,
  );
  ctx.restore();
}

function setPaused(value) {
  paused = value;
  elements.pause.textContent = value ? '继续播放' : '暂停';
  elements.pause.setAttribute('aria-pressed', String(value));
}

function draw() {
  const clip = config.clips[action],
    current = sampleClip(config, action, elapsed);
  const { ctx, width, height } = context(elements.motion),
    baseline = height - 36;
  const verticalTravel = action !== 'move' && isMove(action) && elements.mode.value === 'travel';
  ctx.strokeStyle = '#b5b99f55';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x += 48) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  if (verticalTravel) {
    const distance = (elapsed / clipDuration(clip)) * 90;
    const offset = (((action === 'move_up' ? distance : -distance) % 48) + 48) % 48;
    for (let y = offset; y < height; y += 48) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
  }
  ctx.moveTo(0, baseline);
  ctx.lineTo(width, baseline);
  ctx.stroke();
  const displayHeight = Math.min(185, height * 0.68);
  const range = Math.max(0, width - 220),
    distance = (elapsed / clipDuration(clip)) * displayHeight * 0.95;
  const position = range ? distance % (range * 2) : 0;
  const travel = action === 'move' && elements.mode.value === 'travel';
  const x = travel ? 110 + (position < range ? position : range * 2 - position) : width / 2;
  const right = action === 'move' && (travel ? position < range : elements.right.checked);
  ctx.fillStyle = '#897b5020';
  ctx.beginPath();
  ctx.ellipse(x, baseline + 2, 47, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  drawCat(ctx, current.frame, x, baseline, displayHeight, right);
  elements.status.textContent = `${labels[action]} · 第 ${current.index + 1} / ${clip.frames.length} 帧${verticalTravel ? ' · 镜头跟随' : ''}`;
  elements.frame.value = current.index + 1;
  cards.forEach((card, i) => card.classList.toggle('active', i === current.index));
}

function drawFrames() {
  cards.forEach((card, i) => {
    const { ctx, width, height } = context(card.querySelector('canvas'));
    drawCat(ctx, config.clips[action].frames[i], width / 2, height - 10, height * 0.77);
  });
}

function selectAction(name) {
  const keepPhase = isMove(action) && isMove(name);
  action = name;
  if (!keepPhase) {
    elapsed = 0;
    setPaused(false);
  }
  elements.frames.replaceChildren();
  cards = [];
  const clip = config.clips[action];
  elements.frame.max = clip.frames.length;
  elements['frame-count'].textContent = `${clip.frames.length} 张`;
  elements.playback.textContent = clip.loop ? '连续循环' : '播放一次，停在站稳姿势';
  elements.mode.disabled = !isMove(action);
  elements.right.disabled = action !== 'move';
  clip.frames.forEach((_, i) => {
    const card = document.createElement('div');
    card.className = 'frame-card';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `${labels[action]}第 ${i + 1} 帧完整角色`);
    const label = document.createElement('p');
    label.textContent = String(i + 1).padStart(2, '0');
    card.append(canvas, label);
    elements.frames.append(card);
    cards.push(card);
  });
  drawFrames();
  draw();
}

async function selectAppearance(nextAction, nextSkin) {
  wantedAction = nextAction;
  wantedSkin = nextSkin;
  const revision = ++appearanceRevision;
  const skin = palettes.skins.find((entry) => entry.id === nextSkin);
  elements['skin-status'].textContent = `正在切换 · ${skin.name}`;
  try {
    const result = await paletteAtlases.get(nextAction, images[nextAction], skin);
    if (revision !== appearanceRevision) return;
    displayImage = result.image;
    paletteAtlases.pin(result.key);
    selectedSkin = nextSkin;
    if (action !== nextAction) selectAction(nextAction);
    else {
      drawFrames();
      draw();
    }
    elements.action.value = nextAction;
    for (const [id, button] of skinButtons) button.setAttribute('aria-pressed', String(id === selectedSkin));
    elements['skin-status'].textContent = `已选择 · ${skin.name}`;
  } catch (error) {
    if (revision !== appearanceRevision) return;
    wantedAction = action;
    wantedSkin = selectedSkin;
    elements.action.value = action;
    elements['skin-status'].textContent = '毛色切换失败，请重试';
    console.error(error);
  }
}

async function createSkinChoices() {
  const atlas = config.atlases[config.clips.idle.atlas];
  const rect = atlas.frames[0].rect;
  const thumbnails = palettes.skins.map(async (skin) => {
    const button = document.createElement('button');
    button.className = 'skin-card';
    button.setAttribute('aria-label', skin.name);
    button.setAttribute('aria-pressed', String(skin.id === selectedSkin));
    button.addEventListener('click', () => selectAppearance(wantedAction, skin.id));
    const canvas = document.createElement('canvas');
    canvas.width = rect[2];
    canvas.height = rect[3];
    canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = skin.name;
    const swatches = document.createElement('span');
    swatches.className = 'skin-swatches';
    swatches.setAttribute('aria-hidden', 'true');
    for (const color of [skin.stripe, skin.fur, skin.white]) {
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = color;
      swatches.append(swatch);
    }
    button.append(canvas, label, swatches);
    elements.skins.append(button);
    skinButtons.set(skin.id, button);
    const thumbnail = await paletteAtlases.tint(images.idle, skin, rect);
    canvas.getContext('2d').drawImage(thumbnail, 0, 0);
    thumbnail.close?.();
  });
  for (const result of await Promise.allSettled(thumbnails)) {
    if (result.status === 'rejected') console.error('毛色缩略图加载失败', result.reason);
  }
}

function showFrame(index) {
  setPaused(true);
  elapsed = config.clips[action].durationsMs.slice(0, index).reduce((sum, ms) => sum + ms, 0);
  draw();
}

function tick(now) {
  if (!paused) {
    elapsed += Math.min(now - lastTime, 80) * rate;
    const clip = config.clips[action],
      total = clipDuration(clip);
    if (!clip.loop && elapsed >= total) {
      elapsed = total - 0.001;
      setPaused(true);
    }
  }
  lastTime = now;
  draw();
  requestAnimationFrame(tick);
}

async function start() {
  config = await loadCharacterAnimations('../assets/characters/v1/cat_orange/manifest.json');
  elements['animation-summary'].textContent = Object.entries(config.clips)
    .map(([name, clip]) => `${labels[name] ?? name} ${clip.frames.length} 帧`)
    .join(' · ');
  elements.action.replaceChildren(
    ...Object.keys(config.clips).map((name) => new Option(labels[name] ?? name, name)),
  );
  palettes = await loadPalettes(config.paletteUrl);
  paletteAtlases = new PaletteAtlases(palettes);
  selectedSkin = wantedSkin = palettes.default;
  images = Object.fromEntries(
    await Promise.all(
      Object.entries(config.clips).map(async ([name, clip]) => {
        const image = new Image(),
          atlas = config.atlases[clip.atlas];
        image.src = atlas.src;
        await image.decode();
        if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height)
          throw new Error(`${name}: 图集尺寸不符`);
        return [name, image];
      }),
    ),
  );
  displayImage = images.move;
  elements.action.addEventListener('change', (event) => selectAppearance(event.target.value, wantedSkin));
  elements.pause.addEventListener('click', () => {
    const clip = config.clips[action];
    if (paused && !clip.loop && sampleClip(config, action, elapsed).index === clip.frames.length - 1)
      elapsed = 0;
    setPaused(!paused);
    draw();
  });
  for (const [id, step] of [
    ['previous', -1],
    ['next', 1],
  ])
    elements[id].addEventListener('click', () => {
      const clip = config.clips[action],
        current = sampleClip(config, action, elapsed).index;
      const index = clip.loop
        ? (current + step + clip.frames.length) % clip.frames.length
        : Math.max(0, Math.min(clip.frames.length - 1, current + step));
      showFrame(index);
    });
  elements.frame.addEventListener('input', (event) => showFrame(Number(event.target.value) - 1));
  elements.speed.addEventListener('change', (event) => {
    rate = Number(event.target.value);
  });
  window.addEventListener('resize', drawFrames);
  selectAction('move');
  void createSkinChoices();
  await selectAppearance('move', selectedSkin);
  elements.action.disabled = false;
  lastTime = performance.now();
  requestAnimationFrame(tick);
}
start().catch((error) => {
  elements.status.textContent = '动作加载失败，请刷新重试。';
  console.error(error);
});
