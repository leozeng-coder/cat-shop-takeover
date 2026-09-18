import { cellCenter, roomAt, type State, type Prop } from './types';
import { GameArt } from './render/game_art';
import { MotionTrack } from './render/motion_track';
import { GameCamera } from './render/game_camera';
import { MapTheme, type TileSurface } from './render/map_theme';
import { CAT_COLORS } from './ui/portraits';
const floorColors = [
  '#eee4c6',
  '#dee8d2',
  '#e8dce5',
  '#e7e4ca',
  '#d7e5dd',
  '#e4dccc',
  '#dbe3ee',
  '#efddd2',
  '#e5e8ce',
  '#dedbea',
];
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private art: GameArt;
  private state: State | null = null;
  private width = 0;
  private height = 0;
  private camera = new GameCamera();
  private theme = new MapTheme();
  private lastFrame = 0;
  private hover = -1;
  private press: {
    id: number;
    cell: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    dragged: boolean;
  } | null = null;
  private tracks = new Map<string, MotionTrack>();
  selectedCell = -1;
  onCell: (cell: number, x: number, y: number) => void = () => {};
  onCamera: () => void = () => {};
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.art = new GameArt(this.ctx);
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || this.press) return;
      this.press = {
        id: e.pointerId,
        cell: this.hit(e.clientX, e.clientY),
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        dragged: false,
      };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.press && this.press.id === e.pointerId) {
        const dx = e.clientX - this.press.x,
          dy = e.clientY - this.press.y;
        if (Math.hypot(dx, dy) > 6) this.press.dragged = true;
        if (this.press.dragged) {
          this.camera.drag(e.clientX - this.press.lastX, e.clientY - this.press.lastY);
          this.press.lastX = e.clientX;
          this.press.lastY = e.clientY;
          this.onCamera();
        }
      }
      this.hover = this.hit(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.press?.id !== e.pointerId) return;
      if (this.press && !this.press.dragged) {
        const cell = this.press.cell,
          bounds = canvas.getBoundingClientRect();
        if (cell >= 0) this.onCell(cell, e.clientX - bounds.left, e.clientY - bounds.top);
      }
      this.press = null;
    });
    canvas.addEventListener('pointercancel', (e) => {
      if (this.press?.id === e.pointerId) this.press = null;
    });
    canvas.addEventListener('lostpointercapture', (e) => {
      if (this.press?.id === e.pointerId) this.press = null;
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = -1;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const box = canvas.getBoundingClientRect();
        this.changeZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - box.left, e.clientY - box.top);
      },
      { passive: false },
    );
    requestAnimationFrame((t) => this.frame(t));
  }
  get following() {
    return this.camera.following && !!this.state?.players[this.state.you].alive;
  }
  get ready(): Promise<void> {
    return this.theme.ready;
  }
  setState(state: State | null) {
    const previous = this.state;
    const newMap =
      state?.map.seed !== previous?.map.seed ||
      state?.code !== previous?.code ||
      state?.you !== previous?.you;
    this.state = state;
    if (newMap) {
      this.tracks.clear();
      this.selectedCell = -1;
      this.hover = -1;
      this.press = null;
      if (state) {
        this.camera.reset(state.map, state.players[state.you]);
        this.theme.select(state.map.seed);
      }
      this.onCamera();
    }
    if (state) {
      const received = performance.now();
      for (const player of state.players) {
        const key = 'cat' + player.id;
        if (!this.tracks.has(key)) this.tracks.set(key, new MotionTrack());
        this.tracks.get(key)!.push(state.tick, received, player);
      }
      if (!this.tracks.has('owner')) this.tracks.set('owner', new MotionTrack());
      this.tracks.get('owner')!.push(state.tick, received, state.monster);
      if (this.camera.following && !state.players[state.you].alive) this.fit();
    }
  }
  fit() {
    this.camera.fit();
    this.onCamera();
  }
  zoomBy(factor: number) {
    this.changeZoom(factor, this.width / 2, this.height / 2);
  }
  locate() {
    if (!this.state || !this.state.players[this.state.you].alive) return;
    const p =
      this.tracks.get('cat' + this.state.you)?.sample(performance.now(), this.state.map) ??
      this.state.players[this.state.you];
    this.camera.follow(p);
    this.onCamera();
  }
  private changeZoom(factor: number, x: number, y: number) {
    this.camera.zoomAt(factor, x, y);
    this.onCamera();
  }
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.camera.resize(r.width, r.height);
    this.onCamera();
  }
  private transform() {
    return this.camera.transform();
  }
  private hit(x: number, y: number) {
    if (!this.state) return -1;
    const box = this.canvas.getBoundingClientRect(),
      t = this.transform(),
      m = this.state.map;
    const cx = Math.floor((x - box.left - t.x) / t.scale / m.tileSize),
      cy = Math.floor((y - box.top - t.y) / t.scale / m.tileSize);
    return cx >= 0 && cy >= 0 && cx < m.width && cy < m.height ? cy * m.width + cx : -1;
  }
  private point(cell: number) {
    return cellCenter(this.state!.map, cell);
  }
  private tile(cell: number) {
    const m = this.state!.map;
    return m.rows[Math.floor(cell / m.width)]?.[cell % m.width] ?? '#';
  }
  private drawProp(prop: Prop) {
    const a = this.art,
      c = this.ctx,
      p = this.point(prop.cell);
    if (prop.appearance === 'shelf') {
      a.rect(p.x - 12, p.y - 13, 24, 26, '#b0ae87', 3, '#8e9577');
      for (let row = 0; row < 2; row++) {
        a.line(p.x - 11, p.y + row * 12, p.x + 11, p.y + row * 12, '#e3d8ad', 2);
        for (let k = 0; k < 3; k++)
          a.can(p.x - 8 + k * 8, p.y - 6 + row * 12, ['#bf9075', '#89a29b', '#dbc183'][k], 0.28);
      }
    } else if (prop.appearance === 'crate') {
      a.rect(p.x - 12, p.y - 11, 24, 22, '#d8ae74', 3, '#aa8757');
      a.rect(p.x - 2, p.y - 10, 4, 21, '#edcca0');
      a.can(p.x, p.y - 3, '#d18e5c', 0.55);
      a.text(
        '+' + this.state!.catalog.items[prop.kind].levels[prop.level - 1].amount,
        p.x,
        p.y + 19,
        9,
        '#a3844d',
        'center',
      );
    } else if (
      prop.appearance === 'launcher' ||
      prop.appearance === 'launcher_dual' ||
      prop.appearance === 'launcher_cannon'
    ) {
      a.launcher(p.x, p.y, prop.appearance, Math.max(0, 1 - (this.state!.elapsed - prop.lastShot) / 0.18));
      if (this.state!.elapsed - prop.lastShot < 0.18) {
        const target = this.state!.monster;
        c.save();
        c.setLineDash([5, 4]);
        a.line(p.x, p.y, target.x, target.y, '#e6ac75bb', 2);
        c.restore();
      }
    } else if (prop.appearance === 'fish_rack') {
      a.fishRack(p.x, p.y, prop.level);
    } else if (prop.appearance === 'mini_fridge') {
      a.miniFridge(p.x, p.y, Math.max(0, 1 - (this.state!.elapsed - prop.lastShot) / 0.7));
    } else if (prop.appearance === 'pantry') {
      a.rect(p.x - 12, p.y - 12, 24, 25, '#a7b895', 4, '#7d9676');
      a.can(p.x - 5, p.y, '#e3b266', 0.55);
      a.can(p.x + 5, p.y - 4, '#c08064', 0.55);
    } else {
      a.rect(p.x - 12, p.y - 11, 24, 23, '#ddd6a8', 5, '#a69d74');
      a.line(p.x - 6, p.y, p.x + 6, p.y, '#94a37e', 4);
      a.line(p.x, p.y - 6, p.x, p.y + 6, '#94a37e', 4);
    }
    if (prop.appearance !== 'shelf' && prop.appearance !== 'crate')
      a.text('' + prop.level, p.x + 11, p.y + 12, 8, '#fffbea', 'center');
  }
  private drawSurface(surface: TileSurface, x: number, y: number, tileSize: number) {
    const { image, tilesPerImage } = surface;
    const sw = image.width / tilesPerImage,
      sh = image.height / tilesPerImage;
    this.ctx.drawImage(
      image,
      (x % tilesPerImage) * sw,
      (y % tilesPerImage) * sh,
      sw,
      sh,
      x * tileSize,
      y * tileSize,
      tileSize,
      tileSize,
    );
  }
  private drawMap() {
    const g = this.state!,
      m = g.map,
      a = this.art,
      c = this.ctx,
      night = g.phase === 'preparing';
    const topLeft = this.camera.toWorld(0, 0),
      bottomRight = this.camera.toWorld(this.width, this.height),
      minX = Math.max(0, Math.floor(topLeft.x / m.tileSize) - 1),
      minY = Math.max(0, Math.floor(topLeft.y / m.tileSize) - 1),
      maxX = Math.min(m.width, Math.ceil(bottomRight.x / m.tileSize) + 1),
      maxY = Math.min(m.height, Math.ceil(bottomRight.y / m.tileSize) + 1);
    // Only paint visible ground tiles; keep a one-tile border for wall outlines.
    for (let y = minY; y < maxY; y++)
      for (let x = minX; x < maxX; x++) {
        const cell = y * m.width + x,
          t = m.rows[y][x],
          rid = roomAt(m, cell),
          px = x * m.tileSize,
          py = y * m.tileSize,
          texture =
            t === '#'
              ? this.theme.surface('wall')
              : rid >= 0
                ? this.theme.floor(m.seed, rid)
                : this.theme.surface('road');
        if (texture) {
          // Default: one complete swatch per cell. Tables can spread it across N x N cells.
          this.drawSurface(texture, x, y, m.tileSize);
          if (rid >= 0 && t !== '#' && this.theme.rendering.grid.lineWidth > 0) {
            c.strokeStyle = this.theme.rendering.grid.color;
            c.lineWidth = this.theme.rendering.grid.lineWidth;
            c.strokeRect(px + 0.5, py + 0.5, m.tileSize - 1, m.tileSize - 1);
          }
        } else if (t === '#') {
          a.rect(px, py, 32, 32, '#899784');
          a.rect(px + 1, py + 1, 30, 26, '#dde1c9', 2, '#b4bea4');
          a.line(px + 3, py + 3, px + 29, py + 3, '#f0eedc', 2);
        } else if (rid >= 0) {
          a.rect(px, py, 32, 32, floorColors[rid % floorColors.length]);
          if ((x + y) % 2 === 0) a.rect(px, py, 32, 32, '#ffffff15');
          c.strokeStyle = '#9da58838';
          c.lineWidth = 0.7;
          c.strokeRect(px + 0.5, py + 0.5, 31, 31);
        } else {
          a.rect(px, py, 32, 32, night ? '#aabdb4' : '#c5ceb9');
          c.strokeStyle = night ? '#93a99a55' : '#aebda655';
          c.lineWidth = 0.7;
          c.strokeRect(px + 0.5, py + 0.5, 31, 31);
          if ((x * 13 + y * 7) % 113 === 0) a.paw(px + 16, py + 16, night ? '#91a599' : '#b1bca2', 0.7);
        }
      }
    if (night && this.theme.surface('road')) {
      // Tint terrain only, keeping cats, nests and interactable objects readable.
      c.fillStyle = this.theme.rendering.nightTint;
      c.fillRect(0, 0, m.width * m.tileSize, m.height * m.tileSize);
    }
    // Sparse street furnishings and markings never masquerade as walkable walls.
    const spawn = this.point(m.spawn);
    a.rect(spawn.x - 43, spawn.y - 20, 86, 45, night ? '#d5dcc3' : '#e1e3c3', 8);
    a.text('猫猫集合点', spawn.x, spawn.y + 5, 12, '#8c9d79', 'center');
    for (const room of g.dorms) {
      const door = this.point(room.door),
        nest = this.point(room.nest),
        horizontal = room.door - room.entrance === m.width || room.entrance - room.door === m.width;
      const mine = room.owner === g.you;
      const steel = room.doorAppearance === 'steel';
      const doorEdge = steel ? '#526b83' : '#795d3e';
      const doorPanel = steel ? '#9bb6cc' : '#d7b37b';
      c.save();
      c.translate(door.x, door.y);
      if (!horizontal) c.rotate(Math.PI / 2);
      // Door frames remain distinct from masonry in all three door states.
      for (const side of [-1, 1])
        a.rect(side * 14 - 2, -10, 4, 20, steel ? '#718aa2' : '#8b704f', 1, doorEdge);
      if (room.closed) {
        const guestExiting = g.players.some((cat) => {
          const cell = Math.floor(cat.y / m.tileSize) * m.width + Math.floor(cat.x / m.tileSize);
          return (
            cat.alive &&
            cat.id !== room.owner &&
            roomAt(m, cell) === room.id &&
            cat.path.includes(room.entrance) &&
            Math.hypot(cat.x - door.x, cat.y - door.y) < 24
          );
        });
        c.save();
        if (guestExiting) {
          c.translate(-12, 0);
          c.rotate(-0.9);
          c.translate(12, 0);
        }
        a.rect(
          -12,
          -9,
          24,
          18,
          steel ? '#c3d6e5' : room.doorAppearance === 'iron' ? '#97aeb3' : mine ? '#c89e60' : '#bc925b',
          2,
          doorEdge,
        );
        a.rect(-9, -6, 8, 12, doorPanel, 1, steel ? doorEdge : '#af864f');
        a.rect(2, -6, 7, 12, doorPanel, 1, steel ? doorEdge : '#af864f');
        if (steel) {
          a.rect(-10, -2, 20, 4, '#e6f0f7', 1, doorEdge);
          for (const x of [-9, 9]) for (const y of [-6, 6]) a.ellipse(x, y, 1, 1, '#526b83');
        }
        a.ellipse(8, 0, 1.6, 1.6, steel ? '#425b72' : '#6c583c');
        if (room.hp < room.maxHp * 0.5) {
          a.line(-5, -8, -1, -2, '#795d3e', 1.5);
          a.line(-1, -2, -4, 4, '#795d3e', 1.5);
        }
        c.restore();
      } else if (room.hp > 0) {
        // The open leaf rests beside the frame, leaving the passage clear.
        a.rect(-12, -8, 5, 23, steel ? '#c3d6e5' : '#cba36c', 1, doorEdge);
        a.ellipse(-9.5, 10, 1, 1, '#6c583c');
      } else {
        a.line(-9, 5, 7, -4, '#b59b72', 3);
        a.line(-6, -7, 5, 8, '#b59b72', 3);
      }
      c.restore();
      if (room.closed) {
        a.rect(door.x - 17, door.y - 23, 34, 4, '#899176', 2);
        a.rect(door.x - 17, door.y - 23, 34 * Math.max(0, room.hp / room.maxHp), 4, '#bad080', 2);
      }
      c.save();
      c.shadowColor = '#f5d97d';
      c.shadowBlur = night ? 14 : 0;
      a.rect(nest.x - 14, nest.y - 13, 28, 27, mine ? '#e9bd71' : '#e2c493', 7, '#b49b6c');
      c.restore();
      a.ellipse(nest.x, nest.y, 10, 8, '#f6e3af');
      a.can(nest.x, nest.y - 2, mine ? '#d9944f' : '#c7a773', 0.65);
      a.text('窝', nest.x, nest.y + 24, 10, '#9c8355', 'center');
      for (const prop of room.props) this.drawProp(prop);
    }
    const me = g.players[g.you];
    if (me.path.length) {
      c.save();
      c.strokeStyle = '#f8edbf';
      c.lineWidth = 3;
      c.setLineDash([4, 6]);
      c.beginPath();
      c.moveTo(me.x, me.y);
      for (const cell of me.path) {
        const p = this.point(cell);
        c.lineTo(p.x, p.y);
      }
      c.stroke();
      c.restore();
    }
    for (const cell of [this.hover, this.selectedCell]) {
      if (cell < 0 || this.tile(cell) === '#') continue;
      const p = this.point(cell);
      c.strokeStyle = cell === this.selectedCell ? '#f9ce75' : '#f8f3cbaa';
      c.lineWidth = cell === this.selectedCell ? 3 : 1.5;
      c.strokeRect(p.x - 15, p.y - 15, 30, 30);
      if (cell === this.selectedCell) a.rect(p.x - 14, p.y - 14, 28, 28, '#fbe09b33', 2);
    }
  }
  private drawOwner(x: number, y: number) {
    const a = this.art,
      c = this.ctx;
    c.save();
    c.translate(x, y);
    a.ellipse(0, 10, 13, 6, '#5a66402e');
    a.rect(-10, -5, 20, 20, '#b8755c', 5, '#8b694e');
    a.rect(-7, 0, 14, 14, '#e6d5a0', 2);
    a.ellipse(0, -12, 11, 11, '#e6c195', '#9d8061');
    a.rect(-12, -24, 24, 8, '#85987f', 3, '#60795e');
    a.ellipse(-3, -13, 1.4, 2, '#645b4b');
    a.ellipse(4, -13, 1.4, 2, '#645b4b');
    a.line(9, 2, 19, 8, '#b78e68', 4);
    a.ellipse(22, 9, 8, 11, '#d7d5ab', '#8c9771');
    a.text('店长 Lv.' + this.state!.monster.level, 0, -32, 10, '#ac6a4b', 'center');
    c.restore();
  }
  private drawSurroundings() {
    const m = this.state!.map,
      a = this.art,
      night = this.state!.phase === 'preparing',
      w = m.width * m.tileSize,
      h = m.height * m.tileSize;
    const background = this.theme.background;
    if (background) {
      const margin = this.theme.rendering.background.outsideTiles * m.tileSize;
      // Anchor artwork to the world, including the four-cell decorative perimeter.
      this.ctx.drawImage(background, -margin, -margin, w + margin * 2, h + margin * 2);
      if (night) {
        this.ctx.fillStyle = this.theme.rendering.nightTint;
        this.ctx.fillRect(-margin, -margin, w + margin * 2, h + margin * 2);
      }
      return;
    }
    // Decorative pavement stays outside the playable grid and has no collision data.
    a.rect(-42, -42, w + 84, h + 84, night ? '#92a59a' : '#b2bea6', 12);
    a.rect(-24, -24, w + 48, h + 48, night ? '#bcc5b2' : '#d4d7be', 5, night ? '#819887' : '#a4b295');
    const seam = night ? '#a1b39e' : '#b9c3a9';
    for (let x = 0; x <= w; x += 64) {
      a.line(x, -23, x, -2, seam, 1);
      a.line(x, h + 2, x, h + 23, seam, 1);
    }
    for (let y = 0; y <= h; y += 64) {
      a.line(-23, y, -2, y, seam, 1);
      a.line(w + 2, y, w + 23, y, seam, 1);
    }
    for (let x = 64; x < w; x += 192) {
      for (const y of [-55, h + 55]) {
        a.ellipse(x, y, 20, 12, night ? '#829d8d' : '#a4b58f');
        a.ellipse(x - 9, y - 4, 12, 9, night ? '#90aa95' : '#b1c09c');
      }
    }
    for (let y = 64; y < h; y += 192) {
      for (const x of [-55, w + 55]) {
        a.ellipse(x, y, 12, 20, night ? '#829d8d' : '#a4b58f');
        a.ellipse(x - 4, y - 9, 9, 12, night ? '#90aa95' : '#b1c09c');
      }
    }
  }
  private frame(now: number) {
    const seconds = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    this.lastFrame = now;
    this.art.time = now / 1000;
    if (this.state && this.state.phase !== 'lobby' && this.width > 0 && this.height > 0) {
      const g = this.state,
        me = this.tracks.get('cat' + g.you)!.sample(now, g.map);
      // Press-time world selection lets click-to-move keep following without a pause.
      if (this.selectedCell < 0 && g.players[g.you].alive) this.camera.track(me, seconds);
      else this.camera.hold();
      const c = this.ctx,
        a = this.art,
        dpr = Math.min(window.devicePixelRatio || 1, 2),
        t = this.transform();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, this.width, this.height);
      c.fillStyle = this.theme.rendering.background.clearColor;
      c.fillRect(0, 0, this.width, this.height);
      c.translate(t.x, t.y);
      c.scale(t.scale, t.scale);
      this.drawSurroundings();
      this.drawMap();
      for (const cat of g.players) {
        if (!cat.alive) continue;
        const p = cat.id === g.you ? me : this.tracks.get('cat' + cat.id)!.sample(now, g.map);
        if (cat.id === g.you) {
          c.save();
          c.strokeStyle = '#faf2b4';
          c.lineWidth = 3;
          c.beginPath();
          c.ellipse(p.x, p.y + 5, 15, 9, 0, 0, Math.PI * 2);
          c.stroke();
          c.restore();
        }
        c.save();
        c.translate(p.x, p.y);
        c.scale(0.47, 0.47);
        a.cat(0, 0, CAT_COLORS[cat.id], cat.sleeping);
        c.restore();
        a.text(
          cat.id === g.you ? '▼ 你' : cat.bot ? 'AI' : cat.name,
          p.x,
          p.y - 22,
          9,
          cat.id === g.you ? '#fff9c5' : '#667f61',
          'center',
        );
      }
      if (g.phase !== 'preparing') {
        const p = this.tracks.get('owner')!.sample(now, g.map);
        this.drawOwner(p.x, p.y);
        a.rect(p.x - 18, p.y - 42, 36, 4, '#9a977b', 2);
        a.rect(p.x - 18, p.y - 42, (36 * g.monster.hp) / g.monster.maxHp, 4, '#d79572', 2);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}
