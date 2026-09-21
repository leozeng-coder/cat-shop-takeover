import { DOOR_VISUAL_SCALE } from '../../shared/visual_canvas';

const gallery = document.querySelector('#gallery');
const doors = document.querySelector('#doors');
const status = document.querySelector('#status');
const play = document.querySelector('#play');
const frameSlider = document.querySelector('#frame');
const frameLabel = document.querySelector('#frame-label');
const speed = document.querySelector('#speed');

const assetRoot = '/assets/item/v2/';
const stateNames = { closed: '关门', open: '开门', damaged_1: '轻度损坏', damaged_2: '重度损坏' };
let entries = [];
let paused = false;
let phase = 0;
let previousTime = 0;
let previousDraw = 0;
const doorImages = [];
const wallImage = new Image();
wallImage.onload = () => {
  for (const entry of doorImages) drawDoor(entry.canvas, entry.image);
};
wallImage.src = '/assets/themes/v1/snack_street/wall.png';

function imageAt(path, onload) {
  const image = new Image();
  image.onload = onload;
  image.src = assetRoot + path;
  return image;
}

function drawShadow(ctx, size) {
  ctx.fillStyle = 'rgba(48, 62, 48, 0.16)';
  ctx.beginPath();
  ctx.ellipse(size / 2, size * 0.89, size * 0.28, size * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawItem(canvas, data, image) {
  if (!image.complete || !image.naturalWidth) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const index = data.frameCount === 1 ? 0 : Math.floor(phase) % data.frameCount;
  const sx = (index % data.columns) * data.frameWidth;
  const sy = Math.floor(index / data.columns) * data.frameHeight;
  ctx.clearRect(0, 0, size, size);
  if (data.frameCount > 1) drawShadow(ctx, size);
  ctx.drawImage(image, sx, sy, data.frameWidth, data.frameHeight, 0, 0, size, size);
}

function renderItems() {
  frameSlider.value = String(Math.floor(phase) % 6 + 1);
  frameLabel.textContent = `${frameSlider.value} / 6`;
  for (const entry of entries) {
    for (const canvas of entry.canvases) drawItem(canvas, entry.data, entry.image);
  }
}

function setFrame(value) {
  phase = (value + 6) % 6;
  renderItems();
}

function pause() {
  paused = true;
  play.textContent = '播放';
  play.setAttribute('aria-pressed', 'true');
}

function tick(now) {
  if (!previousTime) previousTime = now;
  if (!paused) phase = (phase + (now - previousTime) * Number(speed.value) / 180) % 6;
  previousTime = now;
  if (now - previousDraw >= 40) {
    renderItems();
    previousDraw = now;
  }
  requestAnimationFrame(tick);
}

play.addEventListener('click', () => {
  paused = !paused;
  play.textContent = paused ? '播放' : '暂停';
  play.setAttribute('aria-pressed', String(paused));
});
document.querySelector('#previous').addEventListener('click', () => { pause(); setFrame(Math.floor(phase) - 1); });
document.querySelector('#next').addEventListener('click', () => { pause(); setFrame(Math.floor(phase) + 1); });
frameSlider.addEventListener('input', () => { pause(); setFrame(Number(frameSlider.value) - 1); });

function itemCard(data) {
  const card = document.createElement('article');
  const title = document.createElement('h2');
  title.textContent = data.name;
  card.append(title);
  const visual = document.createElement('div');
  visual.className = 'visual';
  const large = document.createElement('canvas');
  large.width = large.height = 96;
  const small = document.createElement('canvas');
  small.width = small.height = 36;
  small.className = 'small';
  visual.append(large, small);
  card.append(visual);
  const caption = document.createElement('small');
  caption.textContent = data.frameCount === 1 ? '静态 · 单张图' : '动态 · 六帧循环';
  card.append(caption);
  gallery.append(card);
  const entry = { data, canvases: [large, small], image: null };
  entry.image = imageAt(data.src, renderItems);
  return entry;
}

function drawDoor(canvas, image) {
  if (!image.complete || !image.naturalWidth) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#cbd7c2';
  ctx.fillRect(0, 0, 112, 64);
  for (const x of [8, 72]) {
    if (wallImage.complete && wallImage.naturalWidth) ctx.drawImage(wallImage, x, 16, 32, 32);
    else {
      ctx.fillStyle = '#eff0d9';
      ctx.fillRect(x, 16, 32, 32);
    }
  }
  const size = 32 * DOOR_VISUAL_SCALE;
  ctx.drawImage(image, 56 - size / 2, 32 - size / 2, size, size);
}

function doorCard(door, states) {
  const card = document.createElement('article');
  const title = document.createElement('h2');
  title.textContent = door.name;
  card.append(title);
  const grid = document.createElement('div');
  grid.className = 'door-states';
  for (const state of states) {
    const cell = document.createElement('div');
    cell.className = 'door-state';
    const canvas = document.createElement('canvas');
    canvas.width = 112;
    canvas.height = 64;
    const caption = document.createElement('div');
    caption.textContent = stateNames[state] ?? state;
    cell.append(canvas, caption);
    grid.append(cell);
    const image = imageAt(`door/${door.id}/${state}.png`, function () { drawDoor(canvas, this); });
    doorImages.push({ canvas, image });
  }
  card.append(grid);
  doors.append(card);
}

try {
  const [items, doorManifest] = await Promise.all([
    fetch('/assets/item/v2/index.json').then((response) => response.json()),
    fetch('/assets/item/v2/door/index.json').then((response) => response.json()),
  ]);
  entries = items.items.map(itemCard);
  for (const door of doorManifest.doors) doorCard(door, doorManifest.states);
  status.textContent = `${entries.length} 种道具 · ${entries.filter((entry) => entry.data.frameCount > 1).length} 种动画 · ${doorManifest.doors.length} 种门`;
  requestAnimationFrame(tick);
} catch (error) {
  status.textContent = `道具加载失败：${error.message}`;
}
