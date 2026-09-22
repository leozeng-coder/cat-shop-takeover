import { Camera, Color, EventTouch, Graphics, Layers, Node, Size, Sprite, UIOpacity, UITransform, Vec3 } from 'cc';
import { SharedArt } from '../art/SharedArt';

export class VirtualJoystick {
  readonly node: Node;
  readonly direction = { x: 0, y: 0 };
  private readonly base: Graphics;
  private readonly thumb: Node;
  private readonly thumbGraphics: Graphics;
  private readonly baseArt: Node;
  private readonly thumbArt: Node;
  private readonly baseOpacity: UIOpacity;
  private radius = 68;
  private touchId: number | null = null;
  private consumedId: number | null = null;
  private consumedUntil = 0;

  constructor(
    parent: Node,
    private readonly camera: Camera,
    art: SharedArt,
    private readonly onStart: () => void,
    private readonly onRelease: () => void,
  ) {
    this.node = new Node('MovementJoystick');
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setParent(parent);
    this.node.addComponent(UITransform);
    this.base = this.node.addComponent(Graphics);
    this.baseArt = this.createArtwork(this.node, 'JoystickBaseArt', art, 'joystick-base', this.base);
    this.baseOpacity = this.baseArt.addComponent(UIOpacity);
    this.baseOpacity.opacity = 210;
    this.thumb = new Node('JoystickThumb');
    this.thumb.layer = Layers.Enum.UI_2D;
    this.thumb.setParent(this.node);
    this.thumbGraphics = this.thumb.addComponent(Graphics);
    this.thumbArt = this.createArtwork(this.thumb, 'JoystickPawArt', art, 'joystick-paw', this.thumbGraphics);
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
    this.radius = Math.min(viewport.height > viewport.width ? 92 : 68, viewport.width / 4);
    this.node.getComponent(UITransform)!.setContentSize(this.radius * 2 + 16, this.radius * 2 + 16);
    this.node.setPosition(-viewport.width / 2 + this.radius + 24, -viewport.height / 2 + this.radius + 24, 60);
    this.baseArt.getComponent(UITransform)!.setContentSize(this.radius * 2, this.radius * 2);
    this.thumbArt.getComponent(UITransform)!.setContentSize(this.radius, this.radius);
    this.draw();
  }

  private createArtwork(parent: Node, name: string, art: SharedArt, id: string, fallback: Graphics): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    node.setParent(parent);
    node.addComponent(UITransform);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.enabled = false;
    void art.ui(id).then((frame) => {
      if (!node.isValid) return;
      sprite.spriteFrame = frame;
      sprite.enabled = true;
      fallback.enabled = false;
    }).catch((error: unknown) => console.warn('摇杆美术资源加载失败', error));
    return node;
  }

  consumes(event: EventTouch): boolean {
    const id = event.getID() ?? -1;
    return id === this.touchId || (id === this.consumedId && performance.now() < this.consumedUntil);
  }

  contains(event: EventTouch): boolean {
    if (!this.node.active) return false;
    const location = event.getLocation();
    const point = this.camera.screenToWorld(new Vec3(location.x, location.y, 0));
    const center = this.node.worldPosition;
    const reach = this.radius + 8;
    return Math.abs(point.x - center.x) <= reach && Math.abs(point.y - center.y) <= reach;
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
    this.baseOpacity.opacity = 245;
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
    this.baseOpacity.opacity = 210;
    this.direction.x = 0;
    this.direction.y = 0;
    this.thumb.setPosition(0, 0);
    this.onRelease();
  }
}
