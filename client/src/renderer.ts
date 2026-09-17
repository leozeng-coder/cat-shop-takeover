import { cellCenter, roomAt, type State, type Prop } from './types';
import { GameArt } from './render/game_art';
import { MotionTrack } from './render/motion_track';
import { CAT_COLORS } from './ui/portraits';
const floorColors = ['#eee4c6', '#dee8d2', '#e8dce5', '#e7e4ca', '#d7e5dd', '#e4dccc'];
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private art: GameArt;
  private state: State | null = null;
  private width = 0;
  private height = 0;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private hover = -1;
  private press: { x: number; y: number; px: number; py: number; dragged: boolean } | null = null;
  private tracks = new Map<string, MotionTrack>();
  selectedCell = -1;
  onCell: (cell: number, x: number, y: number) => void = () => {};
  onCamera: () => void = () => {};
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.art = new GameArt(this.ctx);
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.press = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, dragged: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.press) {
        const dx = e.clientX - this.press.x,
          dy = e.clientY - this.press.y;
        if (Math.hypot(dx, dy) > 6) this.press.dragged = true;
        if (this.press.dragged) {
          this.pan = { x: this.press.px + dx, y: this.press.py + dy };
          this.onCamera();
        }
      }
      this.hover = this.hit(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.press && !this.press.dragged) {
        const cell = this.hit(e.clientX, e.clientY),
          bounds = canvas.getBoundingClientRect();
        if (cell >= 0) this.onCell(cell, e.clientX - bounds.left, e.clientY - bounds.top);
      }
      this.press = null;
    });
    canvas.addEventListener('pointercancel', () => {
      this.press = null;
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
  setState(state: State | null) {
    if (state?.map.seed !== this.state?.map.seed) {
      this.tracks.clear();
      this.fit();
      this.selectedCell = -1;
    }
    this.state = state;
    if (state) {
      const received = performance.now();
      for (const player of state.players) {
        const key = 'cat' + player.id;
        if (!this.tracks.has(key)) this.tracks.set(key, new MotionTrack());
        this.tracks.get(key)!.push(state.tick, received, player);
      }
      if (!this.tracks.has('owner')) this.tracks.set('owner', new MotionTrack());
      this.tracks.get('owner')!.push(state.tick, received, state.monster);
    }
  }
  fit() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.onCamera();
  }
  zoomBy(factor: number) {
    this.changeZoom(factor, this.width / 2, this.height / 2);
  }
  locate() {
    if (!this.state) return;
    this.zoom = Math.max(this.zoom, 1.8);
    const p = this.state.players[this.state.you],
      t = this.transform();
    this.pan.x += this.width / 2 - (p.x * t.scale + t.x);
    this.pan.y += this.height / 2 - (p.y * t.scale + t.y);
    this.onCamera();
  }
  private changeZoom(factor: number, x: number, y: number) {
    const before = this.transform();
    this.zoom = Math.max(0.8, Math.min(3.4, this.zoom * factor));
    const after = this.transform(),
      ratio = after.scale / before.scale;
    this.pan.x += x - ((x - before.x) * ratio + after.x);
    this.pan.y += y - ((y - before.y) * ratio + after.y);
    this.onCamera();
  }
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
  }
  private transform() {
    const w = (this.state?.map.width ?? 44) * 32,
      h = (this.state?.map.height ?? 36) * 32;
    const scale = Math.min((this.width - 40) / w, (this.height - 25) / h) * this.zoom;
    return {
      scale: Math.max(0.05, scale),
      x: (this.width - w * scale) / 2 + this.pan.x,
      y: (this.height - h * scale) / 2 + this.pan.y,
    };
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
    } else if (prop.appearance === 'launcher') {
      a.ellipse(p.x, p.y + 5, 13, 10, '#a7bd95', '#748868');
      a.line(p.x - 7, p.y + 4, p.x - 7, p.y - 10, '#af8e63', 4);
      a.line(p.x + 7, p.y + 4, p.x + 7, p.y - 10, '#af8e63', 4);
      a.line(p.x - 7, p.y - 9, p.x, p.y - 3, '#705b4e', 2);
      a.line(p.x + 7, p.y - 9, p.x, p.y - 3, '#705b4e', 2);
      a.ellipse(p.x, p.y - 6, 6, 6, '#db9276');
      if (this.state!.elapsed - prop.lastShot < 0.18) {
        const target = this.state!.monster;
        c.save();
        c.setLineDash([5, 4]);
        a.line(p.x, p.y, target.x, target.y, '#e6ac75bb', 2);
        c.restore();
      }
    } else if (prop.appearance === 'fish_rack') {
      a.fishRack(p.x, p.y, prop.level);
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
  private drawMap() {
    const g = this.state!,
      m = g.map,
      a = this.art,
      c = this.ctx,
      night = g.phase === 'preparing';
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        const cell = y * m.width + x,
          t = m.rows[y][x],
          rid = roomAt(m, cell),
          px = x * 32,
          py = y * 32;
        if (t === '#') {
          a.rect(px, py, 32, 32, '#899784');
          a.rect(px + 1, py + 1, 30, 26, '#dde1c9', 2, '#b4bea4');
          a.line(px + 3, py + 3, px + 29, py + 3, '#f0eedc', 2);
        } else if (rid >= 0) {
          a.rect(px, py, 32, 32, floorColors[rid]);
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
    // Sparse street furnishings and markings never masquerade as walkable walls.
    const spawn = this.point(m.spawn);
    a.rect(spawn.x - 43, spawn.y - 20, 86, 45, night ? '#d5dcc3' : '#e1e3c3', 8);
    a.text('猫猫集合点', spawn.x, spawn.y + 5, 12, '#8c9d79', 'center');
    for (const room of g.dorms) {
      const door = this.point(room.door),
        nest = this.point(room.nest),
        horizontal = room.door - room.entrance === m.width || room.entrance - room.door === m.width;
      const mine = room.owner === g.you;
      c.save();
      c.translate(door.x, door.y);
      if (!horizontal) c.rotate(Math.PI / 2);
      // Door frames remain distinct from masonry in all three door states.
      for (const side of [-1, 1]) a.rect(side * 14 - 2, -10, 4, 20, '#8b704f', 1, '#705b42');
      if (room.closed) {
        a.rect(
          -12,
          -9,
          24,
          18,
          room.doorAppearance === 'iron' ? '#97aeb3' : mine ? '#c89e60' : '#bc925b',
          2,
          '#795d3e',
        );
        a.rect(-9, -6, 8, 12, '#d7b37b', 1, '#af864f');
        a.rect(2, -6, 7, 12, '#d7b37b', 1, '#af864f');
        a.ellipse(8, 0, 1.6, 1.6, '#6c583c');
        if (room.hp < room.maxHp * 0.5) {
          a.line(-5, -8, -1, -2, '#795d3e', 1.5);
          a.line(-1, -2, -4, 4, '#795d3e', 1.5);
        }
      } else if (room.hp > 0) {
        // The open leaf rests beside the frame, leaving the passage clear.
        a.rect(-12, -8, 5, 23, '#cba36c', 1, '#8b704f');
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
  private frame(now: number) {
    this.art.time = now / 1000;
    if (this.state && this.state.phase !== 'lobby' && this.width > 0 && this.height > 0) {
      const c = this.ctx,
        a = this.art,
        dpr = Math.min(window.devicePixelRatio || 1, 2),
        t = this.transform(),
        g = this.state;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, this.width, this.height);
      c.fillStyle = g.phase === 'preparing' ? '#a0b5ad' : '#becbb4';
      c.fillRect(0, 0, this.width, this.height);
      c.translate(t.x, t.y);
      c.scale(t.scale, t.scale);
      this.drawMap();
      for (const cat of g.players) {
        if (!cat.alive) continue;
        const p = this.tracks.get('cat' + cat.id)!.sample(now, g.map);
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
