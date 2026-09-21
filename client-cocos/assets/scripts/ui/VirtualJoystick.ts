import { Camera, Color, EventTouch, Graphics, Layers, Node, Size, UITransform, Vec3 } from 'cc';

export class VirtualJoystick {
  readonly node: Node;
  readonly direction = { x: 0, y: 0 };
  private readonly base: Graphics;
  private readonly thumb: Node;
  private readonly thumbGraphics: Graphics;
  private radius = 86;
  private touchId: number | null = null;
  private consumedId: number | null = null;
  private consumedUntil = 0;

  constructor(
    parent: Node,
    private readonly camera: Camera,
    private readonly onStart: () => void,
    private readonly onRelease: () => void,
  ) {
    this.node = new Node('MovementJoystick');
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setParent(parent);
    this.node.addComponent(UITransform);
    this.base = this.node.addComponent(Graphics);
    this.thumb = new Node('JoystickThumb');
    this.thumb.layer = Layers.Enum.UI_2D;
    this.thumb.setParent(this.node);
    this.thumbGraphics = this.thumb.addComponent(Graphics);
    this.node.on(Node.EventType.TOUCH_START, this.handleStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.handleMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.handleEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.handleEnd, this);
    this.node.active = false;
  }

  get pressed(): boolean {
    return this.touchId !== null;
  }

  setVisible(visible: boolean): void {
    if (!visible && this.touchId !== null) this.release();
    this.node.active = visible;
  }

  layout(viewport: Size): void {
    this.radius = Math.min(viewport.height > viewport.width ? 104 : 86, viewport.width / 4);
    this.node.getComponent(UITransform)!.setContentSize(this.radius * 2 + 16, this.radius * 2 + 16);
    this.node.setPosition(-viewport.width / 2 + this.radius + 24, -viewport.height / 2 + this.radius + 24, 60);
    this.draw();
  }

  consumes(event: EventTouch): boolean {
    const id = event.getID() ?? -1;
    return id === this.touchId || (id === this.consumedId && performance.now() < this.consumedUntil);
  }

  cancel(): void {
    if (this.touchId !== null) this.release();
  }

  private draw(): void {
    this.base.clear();
    this.base.fillColor = new Color('#f9f8edaa');
    this.base.strokeColor = new Color('#678365cc');
    this.base.lineWidth = 3;
    this.base.circle(0, 0, this.radius);
    this.base.fill();
    this.base.stroke();
    this.thumbGraphics.clear();
    this.thumbGraphics.fillColor = new Color('#577b54dd');
    this.thumbGraphics.circle(0, 0, this.radius * 0.42);
    this.thumbGraphics.fill();
  }

  private handleStart(event: EventTouch): void {
    if (this.touchId !== null) return;
    event.propagationStopped = true;
    this.touchId = event.getID() ?? -1;
    this.consumedId = this.touchId;
    this.consumedUntil = performance.now() + 200;
    this.onStart();
    this.updateDirection(event);
  }

  private handleMove(event: EventTouch): void {
    if ((event.getID() ?? -1) !== this.touchId) return;
    event.propagationStopped = true;
    this.updateDirection(event);
  }

  private handleEnd(event: EventTouch): void {
    if ((event.getID() ?? -1) !== this.touchId) return;
    event.propagationStopped = true;
    this.release();
  }

  private updateDirection(event: EventTouch): void {
    const location = event.getLocation();
    const point = this.camera.screenToWorld(new Vec3(location.x, location.y, 0));
    const center = this.node.worldPosition;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy);
    const reach = Math.min(distance, this.radius * 0.56);
    const scale = distance > 0 ? reach / distance : 0;
    this.thumb.setPosition(dx * scale, dy * scale);
    if (distance < this.radius * 0.16) {
      this.direction.x = 0;
      this.direction.y = 0;
    } else {
      this.direction.x = dx / distance;
      this.direction.y = dy / distance;
    }
  }

  private release(): void {
    this.consumedId = this.touchId;
    this.consumedUntil = performance.now() + 200;
    this.touchId = null;
    this.direction.x = 0;
    this.direction.y = 0;
    this.thumb.setPosition(0, 0);
    this.onRelease();
  }
}
