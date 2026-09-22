import { Color, Graphics, Node, UITransform } from 'cc';

/** Redraw only when the visible fill changes; network snapshots never rebuild the widget. */
export class HudMeter {
  readonly node: Node;
  private readonly graphics: Graphics;
  private lastPixels = -1;
  private readonly fill: Color;

  constructor(parent: Node, name: string, private readonly width: number, private readonly height: number, color: string) {
    this.node = new Node(name);
    this.node.layer = parent.layer;
    this.node.setParent(parent);
    this.node.addComponent(UITransform).setContentSize(width, height);
    this.graphics = this.node.addComponent(Graphics);
    this.fill = new Color(color);
  }

  set(value: number, max: number): void {
    const pixels = Math.round(this.width * (max > 0 ? Math.max(0, Math.min(1, value / max)) : 0));
    if (pixels === this.lastPixels) return;
    this.lastPixels = pixels;
    const g = this.graphics;
    g.clear();
    g.fillColor = new Color('#e7e1ce');
    g.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, this.height / 2);
    g.fill();
    if (!pixels) return;
    g.fillColor = this.fill;
    g.roundRect(-this.width / 2, -this.height / 2, pixels, this.height, Math.min(pixels / 2, this.height / 2));
    g.fill();
  }
}
