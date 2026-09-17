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
