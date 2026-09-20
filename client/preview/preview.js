import { clipDuration, sampleClip, loadCharacterAnimations } from '../src/characters/animation.js';
import { loadPalettes, loadSkinAtlases, BakedAtlases } from '../src/characters/baked-atlases.js';

const labels = {
  move: '横向移动',
  move_left: '朝左移动',
  move_right: '朝右移动',
  move_down: '朝下移动',
  move_up: '朝上移动',
  idle: '待机',
  wake: '起身',
  sleep: '睡眠呼吸',
  attack: '敲门攻击',
  retreat: '撤退',
};
const isMove = (name) => name === 'move' || name.startsWith('move_') || name === 'retreat';
const elements = Object.fromEntries(
  [
    'motion',
    'status',
    'pause',
    'previous',
    'next',
    'speed',
    'mode',
    'size',
    'right',
    'frame',
    'frames',
    'action',
    'playback',
    'frame-count',
    'skins',
    'skin-status',
    'animation-summary',
    'character-title',
    'skin-section',
    'asset-note',
    'manifest-link',
    'palette-link',
  ].map((id) => [id, document.getElementById(id)]),
);
let config,
  paused = false,
  elapsed = 0,
  lastTime = 0,
  rate = 1,
  action = 'move';
let cards = [];
let palettes, bakedAtlases, displayImage, selectedSkin;
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

function drawCharacter(ctx, index, x, y, size, right = false) {
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
  const displayHeight = Math.min(Number(elements.size.value), height * 0.68);
  const followTravel = action !== 'move' && isMove(action) && elements.mode.value === 'travel';
  const verticalTravel = followTravel && ['front', 'back'].includes(clip.facing);
  const gridDistance =
    ((elapsed / clipDuration(clip)) * config.strideWorldUnits * displayHeight) /
    config.atlases[clip.atlas].sourceBodyHeight;
  const horizontalOffset =
    followTravel && !verticalTravel
      ? (((clip.facing === 'left' ? gridDistance : -gridDistance) % 48) + 48) % 48
      : 0;
  ctx.strokeStyle = '#b5b99f55';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = horizontalOffset; x < width; x += 48) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  if (verticalTravel) {
    const offset = (((clip.facing === 'back' ? gridDistance : -gridDistance) % 48) + 48) % 48;
    for (let y = offset; y < height; y += 48) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
  }
  ctx.moveTo(0, baseline);
  ctx.lineTo(width, baseline);
  ctx.stroke();
  const range = Math.max(0, width - 220),
    distance = (elapsed / clipDuration(clip)) * displayHeight * 0.95;
  const position = range ? distance % (range * 2) : 0;
  const travel = clip.mirrorForRight && action === 'move' && elements.mode.value === 'travel';
  const x = travel ? 110 + (position < range ? position : range * 2 - position) : width / 2;
  const right = clip.mirrorForRight && (travel ? position < range : elements.right.checked);
  ctx.fillStyle = '#897b5020';
  ctx.beginPath();
  ctx.ellipse(x, baseline + 2, displayHeight * 0.25, displayHeight * 0.032, 0, 0, Math.PI * 2);
  ctx.fill();
  drawCharacter(ctx, current.frame, x, baseline, displayHeight, right);
  elements.status.textContent = `${labels[action] ?? action} · 第 ${current.index + 1} / ${clip.frames.length} 帧${followTravel ? ' · 镜头跟随' : ''}`;
  elements.frame.value = current.index + 1;
  cards.forEach((card, i) => card.classList.toggle('active', i === current.index));
}

function drawFrames() {
  cards.forEach((card, i) => {
    const { ctx, width, height } = context(card.querySelector('canvas'));
    drawCharacter(ctx, config.clips[action].frames[i], width / 2, height - 10, height * 0.77);
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
  elements.playback.textContent = clip.loop ? '连续循环' : '播放一次，停在末帧';
  elements.mode.disabled = !isMove(action);
  elements.right.disabled = !clip.mirrorForRight;
  elements.right.parentElement.hidden = config.profile === 'shop_manager';
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
    const result = await bakedAtlases.get(nextAction, nextSkin);
    if (revision !== appearanceRevision) return;
    displayImage = result.image;
    bakedAtlases.pin(result.key);
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
  const frame = atlas.frames[0].rect;
  const crop = config.portraitRect ?? [0, 0, frame[2], frame[3]];
  const rect = [frame[0] + crop[0], frame[1] + crop[1], crop[2], crop[3]];
  const thumbnails = palettes.skins.map((skin) => {
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
    return async () => {
      const { image } = await bakedAtlases.get('idle', skin.id);
      canvas.getContext('2d').drawImage(image, ...rect, 0, 0, canvas.width, canvas.height);
    };
  });
  // Decode one full atlas at a time; the cache retains only recent selections.
  for (const thumbnail of thumbnails) {
    try {
      await thumbnail();
    } catch (error) {
      console.error('毛色缩略图加载失败', error);
    }
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
  const params = new URLSearchParams(location.search);
  const root = new URL('../assets/characters/v1/', location.href);
  if (params.get('embedded') === '1') document.body.classList.add('embedded');
  for (const link of document.querySelectorAll('[data-character]')) {
    const target = new URL(link.href);
    if (params.has('embedded')) target.searchParams.set('embedded', '1');
    link.href = target.href;
  }
  const response = await fetch(new URL('index.json', root), { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('无法读取角色目录');
  const { characters } = await response.json();
  const requested = new URLSearchParams(location.search).get('character') ?? 'cat_orange';
  const entry = characters.find((entry) => entry.id === requested) ?? characters[0];
  const manifestUrl = new URL(entry.manifest, root).href;
  config = await loadCharacterAnimations(manifestUrl);
  const manager = config.profile === 'shop_manager';
  elements['character-title'].textContent = manager ? '店长的动作小剧场。' : '猫猫的动作小剧场。';
  document.title = `${manager ? '店长' : '猫猫'} · 角色动作预览`;
  elements['skin-section'].hidden = manager;
  elements['asset-note'].textContent = manager
    ? '完整角色逐帧 · 四向独立绘制 · 右手持网'
    : '完整角色逐帧 · 六套毛色共用动作';
  elements['manifest-link'].href = manifestUrl;
  elements['palette-link'].href = config.paletteUrl;
  elements['palette-link'].hidden = manager;
  for (const link of document.querySelectorAll('[data-character]')) {
    if (link.dataset.character === entry.id) link.setAttribute('aria-current', 'page');
  }
  elements['animation-summary'].textContent = Object.entries(config.clips)
    .map(([name, clip]) => `${labels[name] ?? name} ${clip.frames.length} 帧`)
    .join(' · ');
  elements.action.replaceChildren(
    ...Object.keys(config.clips).map((name) => new Option(labels[name] ?? name, name)),
  );
  palettes = await loadPalettes(config.paletteUrl);
  bakedAtlases = new BakedAtlases(config, await loadSkinAtlases(config, palettes));
  selectedSkin = wantedSkin = palettes.default;
  const initialAction = manager ? 'idle' : 'move';
  const initial = await bakedAtlases.get(initialAction, selectedSkin);
  displayImage = initial.image;
  bakedAtlases.pin(initial.key);
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
  selectAction(initialAction);
  if (!manager) void createSkinChoices();
  await selectAppearance(initialAction, selectedSkin);
  elements.action.disabled = false;
  lastTime = performance.now();
  requestAnimationFrame(tick);
}
start().catch((error) => {
  elements.status.textContent = '动作加载失败，请刷新重试。';
  console.error(error);
});
