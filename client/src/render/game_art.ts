export class GameArt {
  time = 0;
  constructor(readonly ctx: CanvasRenderingContext2D) {}
  rect(x: number, y: number, w: number, h: number, color: string, r = 0, stroke = '') {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 2;
      c.stroke();
    }
  }
  text(text: string, x: number, y: number, size = 12, color = '#657258', align: CanvasTextAlign = 'left') {
    const c = this.ctx;
    c.font = '600 ' + size + 'px "Segoe UI","Microsoft YaHei",sans-serif';
    c.fillStyle = color;
    c.textAlign = align;
    c.fillText(text, x, y);
  }
  line(x: number, y: number, xx: number, yy: number, color: string, width = 1) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(xx, yy);
    c.stroke();
  }
  ellipse(x: number, y: number, rx: number, ry: number, color: string, stroke = '') {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 2;
      c.stroke();
    }
  }
  triangle(points: number[], color: string, stroke = '') {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 2;
      c.stroke();
    }
  }
  can(x: number, y: number, color = '#e88765', scale = 1) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    this.rect(-9, -8, 18, 19, color, 3, '#78684e');
    this.ellipse(0, -7, 9, 3, '#ece9d8', '#78684e');
    this.line(-7, 7, 7, 7, '#ffffff66', 1);
    this.ellipse(0, 0, 4, 2.5, '#fff6d1');
    this.triangle([3, 0, 7, -3, 7, 3], '#fff6d1');
    c.restore();
  }
  launcher(
    x: number,
    y: number,
    appearance: 'launcher' | 'launcher_dual' | 'launcher_cannon',
    pulse: number,
  ) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    this.ellipse(0, 11, 14, 4, '#43544828');
    if (appearance === 'launcher_cannon') {
      this.rect(-13, 3, 26, 11, '#73748d', 4, '#505a6a');
      this.rect(-10, 8, 20, 3, '#d6b76b', 1);
      this.ellipse(0, 2, 11, 9, '#a7abc0', '#586778');
      this.triangle([-11, -2, -10, -11, -4, -5], '#e4ca83', '#776e68');
      this.triangle([4, -5, 10, -11, 11, -2], '#e4ca83', '#776e68');
      this.rect(-7, -14 + pulse * 2, 14, 17, '#708693', 3, '#505e70');
      this.rect(-9, -15 + pulse * 2, 18, 5, '#e4ca83', 2, '#9a895d');
      this.ellipse(0, -12 + pulse * 2, 6, 3, '#465365');
      this.ellipse(0, -12 + pulse * 2, 3, 2, '#edaf91');
      this.paw(0, 7, '#fff0be', 0.42);
    } else if (appearance === 'launcher_dual') {
      this.rect(-13, 2, 26, 12, '#83aaa2', 4, '#577e79');
      this.rect(-10, 9, 20, 3, '#d4dcc0', 1);
      for (const side of [-1, 1]) {
        const bx = side * 7;
        this.rect(bx - 4, -12 + pulse, 8, 19, '#c0d8cd', 2, '#6b958e');
        this.line(bx, -9, bx, 3, '#729890', 1);
        this.ellipse(bx, -7 + pulse, 4, 4, '#e4a181', '#af7e68');
        this.line(bx - 2, -9 + pulse, bx + 2, -5 + pulse, '#f6cdb0', 1);
      }
      this.rect(-4, 3, 8, 4, '#e6c47b', 1);
    } else {
      this.ellipse(0, 5, 13, 10, '#a7bd95', '#748868');
      this.line(-7, 4, -7, -10, '#af8e63', 4);
      this.line(7, 4, 7, -10, '#af8e63', 4);
      this.line(-7, -9, 0, -3, '#705b4e', 2);
      this.line(7, -9, 0, -3, '#705b4e', 2);
      this.ellipse(0, -6, 6, 6, '#db9276');
      this.line(-3, -9, 3, -3, '#f5c5a3', 1);
      this.line(-4, -6, 2, -1, '#f5c5a3', 1);
    }
    c.restore();
  }
  miniFridge(x: number, y: number, pulse: number) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    this.ellipse(0, 12, 13, 3, '#456e7625');
    this.rect(-10, -12, 21, 26, '#bce3e1', 4, '#749fa4');
    this.rect(-8, -10, 17, 8, '#eaf8ef', 2);
    this.line(-9, -1, 10, -1, '#749fa4', 1);
    this.line(5, -8, 5, -5, '#739ca3', 2);
    this.line(5, 3, 5, 8, '#739ca3', 2);
    this.triangle([-8, -12, -8, -17, -3, -12], '#97cacb', '#749fa4');
    this.triangle([3, -12, 8, -17, 8, -12], '#97cacb', '#749fa4');
    this.paw(-2, 5, '#78aab5', 0.55);
    if (pulse > 0) {
      c.globalAlpha = pulse;
      this.text('❄', -17 - (1 - pulse) * 8, -12, 11, '#70b8d1', 'center');
      this.text('❄', 15 + (1 - pulse) * 6, -4, 9, '#70b8d1', 'center');
    }
    c.restore();
  }
  fishRack(x: number, y: number, level: number) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    this.ellipse(0, 11, 14, 4, '#5a593325');
    this.line(-10, -11, -12, 11, '#9f7852', 3);
    this.line(10, -11, 12, 11, '#9f7852', 3);
    this.line(-13, -11, 13, -11, '#c39b6a', 4);
    this.line(-10, 9, 10, 9, '#c39b6a', 2);
    const count = Math.min(level + 1, 4);
    for (let i = 0; i < count; i++) {
      c.save();
      c.translate((i - (count - 1) / 2) * 6, -10);
      c.rotate(Math.sin(this.time * 1.8 + x * 0.1 + i) * 0.06);
      this.line(0, 0, 0, 4, '#826b51', 0.8);
      this.triangle([-2, 3, 2, 3, 0, 6], '#91b5b5');
      this.ellipse(0, 8, 2.4, 4, '#91b5b5');
      this.ellipse(0.8, 9.5, 0.65, 0.65, '#405e60');
      c.restore();
    }
    c.restore();
  }
  paw(x: number, y: number, color = '#b7b895', scale = 1) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    this.ellipse(0, 3, 5, 4, color);
    for (const [xx, yy] of [
      [-6, -2],
      [-2, -6],
      [3, -6],
      [7, -1],
    ])
      this.ellipse(xx, yy, 2, 2.5, color);
    c.restore();
  }
  cat(x: number, y: number, color: string, sleeping = false, raccoon = false) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    this.ellipse(0, 21, 22, 6, '#5a593325');
    c.strokeStyle = raccoon ? '#8d9692' : color;
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(13, 14);
    c.quadraticCurveTo(31, 14, 26, -2 + Math.sin(this.time * 2) * 3);
    c.stroke();
    if (raccoon) {
      this.line(24, 4, 28, 6, '#44504b', 5);
      this.line(22, 11, 27, 14, '#44504b', 5);
    }
    this.ellipse(0, 9, 15, 18, color, '#6b6654');
    this.ellipse(-9, 22, 7, 4, color, '#6b6654');
    this.ellipse(8, 22, 7, 4, color, '#6b6654');
    this.triangle([-19, -10, -18, -31, -3, -19], color, '#6b6654');
    this.triangle([4, -19, 20, -31, 20, -8], color, '#6b6654');
    this.triangle([-15, -19, -14, -26, -8, -20], '#e3a09a');
    this.triangle([10, -20, 16, -26, 16, -18], '#e3a09a');
    this.ellipse(0, -9, 23, 20, color, '#6b6654');
    this.ellipse(0, 0, 15, 11, raccoon ? '#d4d9cd' : '#fff1d1');
    if (raccoon) {
      this.ellipse(-10, -10, 10, 7, '#4d5954');
      this.ellipse(10, -10, 10, 7, '#4d5954');
    }
    if (sleeping) {
      this.line(-14, -9, -8, -7, '#535749', 2);
      this.line(8, -7, 14, -9, '#535749', 2);
    } else {
      this.ellipse(-10, -9, 2.4, 3.6, raccoon ? '#fff3c9' : '#475143');
      this.ellipse(10, -9, 2.4, 3.6, raccoon ? '#fff3c9' : '#475143');
    }
    this.triangle([-3, -2, 3, -2, 0, 1], '#b77772');
    this.line(0, 1, -3, 4, '#7b6556', 1);
    this.line(0, 1, 3, 4, '#7b6556', 1);
    for (const side of [-1, 1]) {
      this.line(side * 16, -1, side * 27, -4, '#8f8069', 1);
      this.line(side * 16, 3, side * 27, 4, '#8f8069', 1);
    }
    if (!raccoon) {
      this.line(-5, -25, -4, -20, '#a16d3a77', 2);
      this.line(3, -26, 4, -21, '#a16d3a77', 2);
    }
    if (sleeping) {
      this.text('♪', 28, -29 + Math.sin(this.time * 2) * 3, 14, '#e1a15b');
    }
    c.restore();
  }
}
