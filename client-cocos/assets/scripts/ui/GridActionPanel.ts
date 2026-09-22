import {
  Color,
  HorizontalTextAlignment,
  Label,
  Layers,
  Node,
  Size,
  SpriteFrame,
  UITransform,
  Vec3,
  VerticalTextAlignment,
} from 'cc';
import type { GameState, ItemConfig, Offer, Price } from '../model/GameTypes';
import { roomAt } from '../model/GameTypes';
import { SharedArt } from '../art/SharedArt';
import { UI_COLORS, UiSkin, type UiSurface } from './UiSkin';

export type GridAction = 'nest' | 'bed' | 'door' | 'build' | 'repair';
type Category = 'attack' | 'currency' | 'utility';

const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'attack', name: '基础道具' },
  { id: 'currency', name: '经济道具' },
  { id: 'utility', name: '功能道具' },
];

interface PanelCallbacks {
  command: (action: GridAction, room: number, cell: number, kind: string) => void;
  close: () => void;
}

export class GridActionPanel {
  readonly node: Node;
  private readonly transform: UITransform;
  private readonly skin: UiSkin;
  private category: Category = 'attack';
  private page = 0;
  private state: GameState | null = null;
  private cell = -1;
  private size = new Size(520, 430);
  private compact = false;
  private blockWorldInputUntil = 0;
  private displayedState = '';

  constructor(parent: Node, private readonly art: SharedArt, private readonly callbacks: PanelCallbacks) {
    this.skin = new UiSkin(art);
    this.node = new Node('GridActionPanel');
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setParent(parent);
    this.transform = this.node.addComponent(UITransform);
    this.node.active = false;
  }

  get active(): boolean {
    return this.node.active;
  }

  show(state: GameState, cell: number, viewport: Size): boolean {
    const room = state.dorms[roomAt(state.map, cell)];
    if (!room || state.players[state.you].escaping) {
      this.hide();
      return false;
    }
    this.state = state;
    this.cell = cell;
    this.node.active = true;
    this.layout(viewport);
    this.displayedState = this.presentationState(state, cell);
    this.rebuild();
    return true;
  }

  refresh(state: GameState, viewport: Size): void {
    if (!this.active) return;
    const next = this.presentationState(state, this.cell);
    this.state = state;
    if (next === this.displayedState) return;
    this.show(state, this.cell, viewport);
  }

  hide(): void {
    if (this.node.active) this.blockWorldInputUntil = performance.now() + 100;
    this.node.active = false;
    this.state = null;
    this.cell = -1;
    this.displayedState = '';
  }

  private presentationState(state: GameState, cell: number): string {
    const me = state.players[state.you];
    const room = state.dorms[roomAt(state.map, cell)];
    const prop = room?.props.find((entry) => entry.cell === cell);
    return JSON.stringify([
      state.phase, me.room, me.sleeping, me.escaping, me.bed, me.wallet,
      room?.owner, room?.level, room?.hp, room?.maxHp, room?.closed,
      prop?.kind, prop?.level, room?.repairOffer, state.offers,
    ]);
  }

  layout(viewport: Size): void {
    this.compact = viewport.height < 620;
    const width = Math.min(this.compact ? 620 : 540, viewport.width - 24);
    const room = this.state && this.cell >= 0 ? this.state.dorms[roomAt(this.state.map, this.cell)] : null;
    const mine = !!room && room.owner === this.state?.you;
    const height = Math.min(
      this.compact ? 320 : !room ? 440 : this.cell === room.nest || this.cell === room.door ? (mine ? 315 : 240) : room.props.some((prop) => prop.cell === this.cell) ? 240 : mine ? 440 : 200,
      viewport.height - 24,
    );
    this.size.set(width, height);
    this.transform.setContentSize(this.size);
    this.node.setPosition(
      this.compact ? viewport.width / 2 - width / 2 - 12 : 0,
      this.compact ? 0 : viewport.height > viewport.width
        ? viewport.height / 2 - height / 2 - 110
        : -viewport.height / 2 + height / 2 + 12,
      50,
    );
  }

  relayout(viewport: Size): void {
    const previousWidth = this.size.width;
    const previousHeight = this.size.height;
    const previousCompact = this.compact;
    this.layout(viewport);
    if (this.active && (previousWidth !== this.size.width || previousHeight !== this.size.height || previousCompact !== this.compact)) {
      this.rebuild();
    }
  }

  contains(uiPoint: Vec3): boolean {
    if (!this.active && performance.now() > this.blockWorldInputUntil) return false;
    const position = this.node.worldPosition;
    return (
      Math.abs(uiPoint.x - position.x) <= this.size.width / 2 &&
      Math.abs(uiPoint.y - position.y) <= this.size.height / 2
    );
  }

  private rebuild(): void {
    const state = this.state;
    if (!state) return;
    for (const child of [...this.node.children]) child.destroy();
    this.skin.surface(this.node);

    const roomId = roomAt(state.map, this.cell);
    const room = state.dorms[roomId];
    const me = state.players[state.you];
    const prop = room.props.find((entry) => entry.cell === this.cell);
    const item = prop ? state.catalog.items[prop.kind] : undefined;
    const mine = room.owner === state.you;
    const leftWidth = this.compact ? this.size.width * 0.34 : this.size.width - 100;
    const leftX = this.compact ? -this.size.width / 2 + 24 + leftWidth / 2 : 24;
    const actionStep = this.compact ? 74 : 82;
    const title =
      this.cell === room.nest
        ? '罐头窝'
        : this.cell === room.door
          ? room.doorName
          : item
            ? item.levels[prop!.level - 1]?.name ?? item.name
            : '空地格';
    this.label(title, this.compact ? 25 : 29, new Color('#40503f'), leftX, this.size.height / 2 - 42, leftWidth, 48, true);
    this.button('×', this.size.width / 2 - 34, this.size.height / 2 - 34, 44, 42, true, () => this.callbacks.close());

    let y = this.size.height / 2 - (this.compact ? 100 : 104);
    const description = this.description(state, roomId, title, mine, prop?.level ?? 0, item);
    this.label(
      description,
      this.compact ? 17 : 18,
      new Color('#71806d'),
      this.compact ? leftX : 0,
      this.compact ? this.size.height / 2 - 112 : y,
      this.compact ? leftWidth : this.size.width - 54,
      this.compact ? 72 : 62,
      false,
    );
    if (!this.compact) y -= 72;

    if (this.cell === room.nest) {
      if ((room.owner < 0 || mine) && !me.sleeping) {
        this.actionButton(
          mine ? '躺回罐头窝' : '进入罐头窝',
          mine ? '收入保持不变' : '到达后安家并自动关门',
          { enabled: true, reason: '' },
          '',
          y,
          () => this.run('nest', roomId, ''),
          this.art.item('nest').then((clip) => clip.frames[0]),
        );
        y -= actionStep;
      }
      if (mine) {
        const next = state.catalog.nests[me.bed - 1]?.nextLevel ?? 0;
        const level = next ? state.catalog.nests[next - 1] : undefined;
        this.actionButton(
          level ? `升级罐头窝至 ${next} 级` : '罐头窝已满级',
          level ? `每 ${level.intervalMs / 1000} 秒产出 ${level.amount}` : '已达到最高等级',
          level ? state.offers.nest : { enabled: false, reason: '满级' },
          level ? this.price(state, level.cost) : '满级',
          y,
          () => this.run('bed', roomId, ''),
          this.art.item('nest').then((clip) => clip.frames[0]),
        );
      }
      return;
    }

    if (this.cell === room.door) {
      if (mine) {
        const next = state.catalog.doors[room.level - 1]?.nextStage ?? 0;
        const door = next ? state.catalog.doors[next - 1] : undefined;
        this.actionButton(
          door ? `升级为 ${door.name}` : `${room.doorName}已满级`,
          door ? `耐久提升至 ${door.maxHp}` : '已达到最高阶段',
          door ? state.offers.door : { enabled: false, reason: '满级' },
          door ? this.price(state, door.cost) : '满级',
          y,
          () => this.run('door', roomId, ''),
          this.art.door(door?.appearance ?? room.doorAppearance, 'closed'),
        );
        y -= actionStep;
      }
      if (room.owner >= 0 && me.room >= 0) {
        this.actionButton(
          '修补店门',
          `恢复 ${state.catalog.repair.amount} 耐久`,
          room.repairOffer,
          this.price(state, state.catalog.repair.cost),
          y,
          () => this.run('repair', roomId, ''),
        );
      }
      return;
    }

    if (prop && item) {
      if (mine && item.buildable) {
        const next = item.levels[prop.level - 1]?.nextLevel ?? 0;
        const level = next ? item.levels[next - 1] : undefined;
        const offer = level ? state.offers.items[item.id]?.[next - 1] : undefined;
        this.actionButton(
          level ? `升级为 ${level.name}` : `${item.name}已满级`,
          level ? this.effect(state, item, level) : '已达到最高等级',
          offer ?? { enabled: false, reason: '满级' },
          level ? this.price(state, level.cost) : '满级',
          y,
          () => this.run('build', roomId, item.id),
          this.art.item(level?.appearance ?? item.levels[prop.level - 1].appearance).then((clip) => clip.frames[0]),
        );
      }
      return;
    }

    if (!mine) return;
    const filterWidth = (this.size.width - 54) / CATEGORIES.length;
    CATEGORIES.forEach((category, index) => {
      this.button(
        category.name,
        this.compact ? leftX : -this.size.width / 2 + 27 + filterWidth * (index + 0.5),
        this.compact ? -14 - index * 52 : y,
        this.compact ? leftWidth : filterWidth - 8,
        44,
        true,
        () => {
          this.category = category.id;
          this.page = 0;
          this.rebuild();
        },
        this.category === category.id ? 'selected' : 'card',
      );
    });
    if (!this.compact) y -= 62;
    const items = Object.values(state.catalog.items).filter(
      (candidate) => candidate.buildable && candidate.category === this.category,
    );
    const pages = Math.max(1, Math.ceil(items.length / 3));
    if (pages > 1) {
      this.button(`更多道具 ${this.page + 1}/${pages} ↻`, this.size.width / 2 - 132,
        this.size.height / 2 - 39, 170, 38, true, () => {
          this.page = (this.page + 1) % pages;
          this.rebuild();
        });
    }
    for (const candidate of items.slice(this.page * 3, this.page * 3 + 3)) {
      const level = candidate.levels[0];
      const offer = state.offers.items[candidate.id]?.[0] ?? { enabled: false, reason: '暂不可用' };
      this.actionButton(
        `安装 ${level.name}`,
        this.effect(state, candidate, level) + (candidate.unique ? ' · 每位玩家限一件' : ''),
        offer,
        this.price(state, offer.cost ?? level.cost),
        y,
        () => this.run('build', roomId, candidate.id),
        this.art.item(level.appearance).then((clip) => clip.frames[0]),
      );
      y -= actionStep;
    }
  }

  private description(
    state: GameState,
    roomId: number,
    title: string,
    mine: boolean,
    propLevel: number,
    item?: ItemConfig,
  ): string {
    const room = state.dorms[roomId];
    if (this.cell === room.nest)
      return mine ? '持续产出罐头；猫猫可以躺下休息，也可以在屋内活动。' : '走到空窝安家并关门。';
    if (this.cell === room.door) return `${room.closed ? '店门已关闭' : '店门敞开'} · 耐久 ${Math.ceil(room.hp)} / ${room.maxHp}`;
    if (item) return `${item.description}${propLevel ? ` · ${propLevel}级` : ''}`;
    return mine ? '选择一种道具安装在这个格子；道具不会影响通行。' : `${title} · 这不是你的猫店。`;
  }

  private effect(state: GameState, item: ItemConfig, level: ItemConfig['levels'][number]): string {
    const seconds = level.intervalMs / 1000;
    if (item.behavior === 'currency_producer') {
      const currency = state.catalog.currencies.find((entry) => entry.id === item.currency)?.name ?? item.currency;
      return `每 ${seconds} 秒产出 ${level.amount} ${currency}`;
    }
    if (item.behavior === 'single_attack') return `伤害 ${level.amount} · 间隔 ${seconds} 秒`;
    if (item.behavior === 'door_repair') return `每 ${seconds} 秒恢复 ${level.amount} 耐久`;
    if (item.behavior === 'door_attack_delay') return `每次延后店长攻击 ${level.amount / 1000} 秒`;
    return item.description;
  }

  private price(state: GameState, costs: Price[]): string {
    return costs
      .map((cost) => `${state.catalog.currencies.find((entry) => entry.id === cost.currency)?.symbol ?? cost.currency} ${cost.amount}`)
      .join(' + ');
  }

  private run(action: GridAction, room: number, kind: string): void {
    if (!this.state) return;
    this.callbacks.command(action, room, this.cell, kind);
    this.hide();
  }

  private actionButton(
    title: string,
    description: string,
    offer: Offer,
    price: string,
    y: number,
    action: () => void,
    thumbnail?: Promise<SpriteFrame>,
  ): void {
    const suffix = offer.enabled ? price : offer.reason;
    const width = this.compact ? this.size.width * 0.58 : this.size.width - 54;
    const x = this.compact ? this.size.width / 2 - 24 - width / 2 : 0;
    const height = this.compact ? 64 : 70;
    const node = this.button('', x, y, width, height, offer.enabled, action, offer.enabled ? 'card' : 'disabled');
    if (thumbnail) this.skin.image(node, 'ItemThumbnail', thumbnail, -width / 2 + 31, 0, 46);
    else this.skin.symbol(node, 'upgrade', -width / 2 + 30, 0, 25);
    const contentWidth = width - 82;
    this.label(title, 19, new Color(offer.enabled ? '#405c3e' : '#82887b'), 23, 13, contentWidth, 25, true, node);
    this.label(`${description}${suffix ? ` · ${suffix}` : ''}`, 15, new Color('#7b826f'),
      23, -14, contentWidth, 28, true, node);
  }

  private button(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    enabled: boolean,
    action: () => void,
    style: UiSurface = enabled ? 'button' : 'disabled',
  ): Node {
    const node = new Node(`Button-${text.split('\n')[0]}`);
    node.layer = Layers.Enum.UI_2D;
    node.setParent(this.node);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    this.skin.surface(node, text === '×' ? 'card' : style);
    if (text === '×') this.skin.symbol(node, 'close', 0, 0, 22);
    else if (text) {
      this.label(text, text.includes('\n') ? 17 : 18, new Color(!enabled ? '#9a9d91' : style === 'button' ? UI_COLORS.onAccent : UI_COLORS.text),
        0, 1, width - 18, height - 8, false, node);
    }
    this.skin.bindButton(node, enabled, () => {
      this.blockWorldInputUntil = performance.now() + 100;
      action();
    });
    return node;
  }

  private label(
    text: string,
    fontSize: number,
    color: Color,
    x: number,
    y: number,
    width: number,
    height: number,
    left: boolean,
    parent = this.node,
  ): Label {
    const node = new Node('Label');
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.setPosition(x, y);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.35);
    label.color = color;
    label.horizontalAlign = left ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.enableWrapText = true;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }
}
