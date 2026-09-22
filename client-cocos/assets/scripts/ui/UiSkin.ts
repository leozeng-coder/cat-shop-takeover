import { Button, Color, EventTouch, Graphics, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { SharedArt } from '../art/SharedArt';
import { fitExtent } from '../art/SpriteLayout';

export type UiSurface = 'panel' | 'hud' | 'card' | 'field' | 'selected' | 'button' | 'disabled';
export type UiSymbol = 'close' | 'back' | 'upgrade' | 'build' | 'clock';

export const UI_COLORS = {
  text: '#354d43', muted: '#748176', accent: '#527961', onAccent: '#fffaf0',
  paper: '#fffaf0', card: '#f5f3e9', selected: '#e3eddf', border: '#d9dfd0',
} as const;

/** Shared artwork and feedback for menu, lobby and in-game controls. */
export class UiSkin {
  constructor(private readonly art: SharedArt) {}

  surface(parent: Node, style: UiSurface = 'panel'): Node {
    const size = parent.getComponent(UITransform)!.contentSize;
    const node = this.node(parent, `Skin-${style}`, size.width, size.height);
    node.setSiblingIndex(0);
    const primary = style === 'button';
    const selected = style === 'selected';
    const fallback = node.addComponent(Graphics);
    const radius = Math.min(style === 'panel' ? 24 : 14, size.height / 3);
    if (style === 'panel' || style === 'hud') {
      fallback.fillColor = new Color('#263c3212');
      fallback.roundRect(-size.width / 2, -size.height / 2 - 3, size.width, size.height, radius);
      fallback.fill();
    }
    fallback.fillColor = new Color(primary ? UI_COLORS.accent : selected ? UI_COLORS.selected
      : style === 'disabled' ? '#eceee7' : style === 'field' ? '#efeee4'
      : style === 'card' ? UI_COLORS.card : UI_COLORS.paper);
    fallback.strokeColor = new Color(selected ? '#7e9b78' : UI_COLORS.border);
    fallback.lineWidth = selected ? 2 : 1;
    fallback.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, radius);
    fallback.fill();
    if (selected || style === 'field' || style === 'hud') fallback.stroke();
    // Small controls use quiet flat surfaces; illustrated textures are reserved for the main panel and CTA.
    if (style !== 'panel' && !primary) return node;
    // Cocos permits one UI renderer per node; keep the loading fallback separate.
    const artwork = this.node(node, 'Artwork', size.width, size.height);
    const sprite = artwork.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = Sprite.Type.SLICED;
    sprite.enabled = false;
    void this.art.ui(primary ? 'button' : 'panel').then((frame) => {
      if (!node.isValid) return;
      // Keep corners and outlines at a consistent screen size, independently of source image resolution.
      const borderScale = (primary ? 18 : 24) / Math.max(1, frame.insetTop);
      artwork.getComponent(UITransform)!.setContentSize(size.width / borderScale, size.height / borderScale);
      artwork.setScale(borderScale, borderScale, 1);
      sprite.spriteFrame = frame;
      sprite.enabled = true;
      fallback.enabled = false;
    }).catch((error: unknown) => console.warn('UI 背景加载失败', error));
    return node;
  }

  bindButton(node: Node, enabled: boolean, action: () => void): void {
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.duration = 0.1;
    button.zoomScale = 0.985;
    button.interactable = enabled;
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; });
    node.on(Button.EventType.CLICK, action);
  }

  image(parent: Node, name: string, frame: Promise<SpriteFrame>, x: number, y: number, size: number): Node {
    const node = this.node(parent, name, size, size);
    node.setPosition(x, y);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.enabled = false;
    void frame.then((result) => {
      if (!node.isValid) return;
      const fitted = fitExtent(result.originalSize.width, result.originalSize.height, size);
      node.getComponent(UITransform)!.setContentSize(fitted.width, fitted.height);
      sprite.spriteFrame = result;
      sprite.enabled = true;
    }).catch((error: unknown) => console.warn(`${name} 图标加载失败`, error));
    return node;
  }

  symbol(parent: Node, symbol: UiSymbol, x: number, y: number, size = 20): void {
    const node = this.node(parent, `Icon-${symbol}`, size, size);
    node.setPosition(x, y);
    const g = node.addComponent(Graphics);
    const r = size * 0.3;
    g.lineWidth = 2;
    g.strokeColor = new Color(UI_COLORS.accent);
    if (symbol === 'clock') {
      g.circle(0, 0, size * 0.4);
      g.moveTo(0, size * 0.22); g.lineTo(0, 0); g.lineTo(size * 0.18, -size * 0.1);
    } else if (symbol === 'close') {
      g.moveTo(-r, -r); g.lineTo(r, r);
      g.moveTo(-r, r); g.lineTo(r, -r);
    } else if (symbol === 'back') {
      g.moveTo(r, 0); g.lineTo(-r, 0);
      g.moveTo(0, r); g.lineTo(-r, 0); g.lineTo(0, -r);
    } else if (symbol === 'upgrade') {
      g.moveTo(-r, 0); g.lineTo(0, r); g.lineTo(r, 0);
      g.moveTo(0, r); g.lineTo(0, -r);
    } else {
      g.moveTo(-r, 0); g.lineTo(r, 0);
      g.moveTo(0, -r); g.lineTo(0, r);
    }
    g.stroke();
  }

  private node(parent: Node, name: string, width: number, height: number): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    node.setParent(parent);
    node.addComponent(UITransform).setContentSize(width, height);
    return node;
  }
}
