import {
  Color, HorizontalTextAlignment, Label, Node, Size, Sprite, UIOpacity, UITransform, Vec2, Vec3, VerticalTextAlignment,
} from 'cc';
import { SharedArt } from '../art/SharedArt';
import type { GameState, MonsterState } from '../model/GameTypes';
import { battleHudLayout, doorUnderAttack, phaseClock, playerActivity, type HudBox } from './BattleHudModel';
import { UI_COLORS, UiSkin } from './UiSkin';
import { WalletHud } from './WalletHud';

interface CatBadge {
  stage: Node;
  portrait: Node;
  opacity: UIOpacity;
  attacker: Node;
  captured: Node;
  label: Label;
  pulseAt: number;
  animating: boolean;
}

/** Presentation only: all combat values and attack/upgrade events come from server snapshots. */
export class BattleHud {
  readonly node: Node;
  private readonly overlay: Node;
  private readonly skin: UiSkin;
  private viewport = new Size(0, 0);
  private state: GameState | null = null;
  private wallet!: WalletHud;
  private phaseLabel!: Label;
  private clockLabel!: Label;
  private team!: Node;
  private teamTitle!: Label;
  private roster!: Node;
  private rosterKey = '';
  private readonly cats = new Map<number, CatBadge>();
  private ownStatus = '';
  private toast!: Node;
  private toastLabel!: Label;
  private toastUntil = 0;
  private noticePriority = 0;
  private noticeMessage = '';
  private announcement!: Node;
  private announcementText!: Label;
  private announcementDetail!: Label;
  private announcementUntil = 0;
  private activeAnnouncement: MonsterState['levelUps'][number] | null = null;
  private announcements: MonsterState['levelUps'] = [];
  private connection!: Node;
  private connected = true;
  private round = '';
  private seenLevel = 0;
  private lastAttack = -1;
  private lastNotice = -1;
  private readonly hitRegions: Node[] = [];

  constructor(parent: Node, private readonly art: SharedArt, private readonly leave: () => void) {
    this.skin = new UiSkin(art);
    this.node = this.makeNode(parent, 'BattleHud', 0, 0);
    this.overlay = this.makeNode(parent, 'BattleAlerts', 0, 0);
    this.node.active = false;
    this.overlay.active = false;
    this.layout(new Size(1280, 720));
  }

  layout(viewport: Size): void {
    if (this.viewport.equals(viewport)) return;
    this.viewport.set(viewport);
    for (const child of [...this.node.children]) child.destroy();
    for (const child of [...this.overlay.children]) child.destroy();
    this.hitRegions.length = 0;
    this.cats.clear();
    this.rosterKey = '';
    const boxes = battleHudLayout(viewport.width, viewport.height);
    const phase = this.card('Phase', boxes.phase);
    this.phaseLabel = this.label(phase, '', 20, 0, 18, boxes.phase.width - 24, 26);
    this.clockLabel = this.label(phase, '', 30, 0, -12, boxes.phase.width - 24, 40, true);

    this.team = this.card('Team', boxes.team);
    this.teamTitle = this.label(this.team, '', 20, 0, boxes.team.height / 2 - 15, boxes.team.width - 24, 24, true);
    this.roster = this.makeNode(this.team, 'CatRoster', boxes.team.width - 20, boxes.team.height - 30);
    this.roster.setPosition(0, -10);

    this.wallet = new WalletHud(this.node, this.art);
    this.wallet.node.setScale(boxes.wallet.width / 280, boxes.wallet.width / 280, 1);
    this.wallet.node.setPosition(boxes.wallet.x + boxes.wallet.width / 2 - viewport.width / 2,
      viewport.height / 2 - boxes.wallet.y - boxes.wallet.height / 2);
    this.hitRegions.push(this.wallet.node);
    const exit = this.card('Exit', boxes.exit);
    this.skin.symbol(exit, 'back', -25, 0, 20);
    this.label(exit, '退出', 20, 10, 0, 48, 32, true);
    this.skin.bindButton(exit, true, this.leave);

    this.toast = this.card('Notice', boxes.toast, this.overlay, false);
    this.toastLabel = this.label(this.toast, this.noticeMessage, 21, 0, 0, boxes.toast.width - 32, 58);
    this.toastLabel.enableWrapText = true;
    this.toast.active = false;

    this.announcement = this.card('ManagerAnnouncement', boxes.announcement, this.overlay);
    const aw = boxes.announcement.width;
    this.skin.image(this.announcement, 'AngryManager', this.managerPortrait(), -aw / 2 + 52, 0, 76);
    this.label(this.announcement, '全街注意 · 店长怒气升级', 18, 38, 44, aw - 130, 26, false, '#b07b42');
    this.announcementText = this.label(this.announcement, '', 29, 38, 2, aw - 130, 66, true, '#97452f');
    this.announcementText.enableWrapText = true;
    this.announcementDetail = this.label(this.announcement, '', 17, 38, -48, aw - 130, 24);
    this.announcement.active = !!this.activeAnnouncement;
    if (this.activeAnnouncement) this.fillAnnouncement(this.activeAnnouncement);

    this.connection = this.card('Reconnecting', { x: (viewport.width - 320) / 2, y: viewport.height * 0.55 - 26, width: 320, height: 52 }, this.overlay);
    this.label(this.connection, '连接中断，正在重连…', 23, 0, 0, 292, 38, true, '#ab6049');
    this.connection.active = !this.connected;
    if (this.state) this.present(this.state, performance.now());
  }

  setVisible(visible: boolean): void {
    this.node.active = visible;
    this.overlay.active = visible;
    if (!visible) {
      this.announcements = [];
      this.activeAnnouncement = null;
      this.announcementUntil = 0;
      this.announcement.active = false;
      this.toast.active = false;
    }
  }

  raiseAlerts(): void {
    this.overlay.setSiblingIndex(this.overlay.parent!.children.length - 1);
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.connection.active = !connected;
  }

  reset(): void {
    this.state = null;
    this.round = '';
    this.seenLevel = 0;
    this.lastAttack = -1;
    this.lastNotice = -1;
    this.toastUntil = 0;
    this.ownStatus = '';
    this.setVisible(false);
  }

  present(state: GameState, now: number): void {
    this.state = state;
    const round = `${state.code}:${state.map.seed}`;
    if (round !== this.round || state.monster.level < this.seenLevel) {
      this.round = round;
      this.seenLevel = state.monster.level;
      this.lastAttack = state.monster.attackSequence;
      this.lastNotice = -1;
      this.ownStatus = '';
      this.toastUntil = 0;
      this.announcements = [];
      this.activeAnnouncement = null;
      this.announcementUntil = 0;
      this.announcement.active = false;
    }
    const monster = state.monster;
    this.phaseLabel.string = state.phase === 'preparing' ? '夜间占店' : '白天守店';
    this.clockLabel.string = phaseClock(state);
    this.clockLabel.color = new Color(state.phase === 'preparing' && state.preparation - state.elapsed < 10 ? '#b05c45' : UI_COLORS.text);
    this.wallet.update(state);
    this.teamTitle.string = `猫猫小队  ${state.players.filter((cat) => cat.alive).length} / ${state.players.length} 留守`;
    this.updateRoster(state, now);

    if (state.phase === 'running' && monster.level > this.seenLevel) {
      const fresh = monster.levelUps.filter((event) => event.level > this.seenLevel && event.level <= monster.level);
      this.announcements.push(...fresh.sort((a, b) => a.level - b.level));
      if (!fresh.length) this.announcements.push({ level: monster.level, healed: 0, text: '店长生气了！' });
    }
    this.seenLevel = monster.level;
    const latest = state.notices.reduce<GameState['notices'][number] | null>((last, entry) => !last || entry.id > last.id ? entry : last, null);
    if (latest && latest.id > this.lastNotice) {
      this.lastNotice = latest.id;
      if (state.elapsed - latest.time < 6) this.showNotice(latest.text, now);
    }
    // Announce a change once, rather than keeping the player's status on screen or repeating it per snapshot.
    if (this.node.active && (state.phase === 'preparing' || state.phase === 'running')) {
      const own = state.players[state.you];
      const room = state.dorms[own.room];
      const status = !own.alive ? 'captured' : own.escaping ? 'escaping'
        : room?.owner === own.id ? `settled:${room.id}` : 'searching';
      if (status !== this.ownStatus) {
        this.ownStatus = status;
        const message = !own.alive ? '小猫被抱走了，继续观战为队友加油'
          : own.escaping ? '店门失守，快用摇杆逃跑！'
          : status === 'searching' ? '用摇杆移动，点击罐头窝安家'
          : `已入住 ${room.id + 1} 号猫店，罐头开始持续增加`;
        this.showNotice(message, now, 1);
      }
    }
  }

  showNotice(message: string, now = performance.now(), priority = 0): void {
    if (!message) return;
    if (priority < this.noticePriority && now < this.toastUntil) return;
    this.noticePriority = priority;
    this.noticeMessage = message;
    this.toastLabel.string = message;
    this.toastUntil = now + 1500;
    this.toast.active = !this.activeAnnouncement;
  }

  tick(now: number): void {
    if (!this.node.active) return;
    if (this.activeAnnouncement && now >= this.announcementUntil) this.activeAnnouncement = null;
    if (!this.activeAnnouncement && this.announcements.length) {
      this.activeAnnouncement = this.announcements.shift()!;
      this.announcementUntil = now + 2800;
      this.fillAnnouncement(this.activeAnnouncement);
    }
    this.announcement.active = !!this.activeAnnouncement;
    this.toast.active = !this.activeAnnouncement && now < this.toastUntil;
    for (const cat of this.cats.values()) {
      if (!cat.animating) continue;
      const progress = (now - cat.pulseAt) / 420;
      if (progress >= 1 || !cat.attacker.active) {
        cat.stage.setPosition(0, 7);
        cat.stage.setScale(1, 1, 1);
        cat.attacker.setPosition(17, -15);
        cat.animating = false;
        continue;
      }
      const strength = Math.sin(Math.max(0, progress) * Math.PI);
      const shake = strength * Math.sin(progress * Math.PI * 6) * 3;
      cat.stage.setPosition(shake || 0, 7);
      const scale = 1 + strength * 0.13;
      cat.stage.setScale(scale, scale, 1);
      cat.attacker.setPosition(17 - strength * 8, -15 + strength * 6);
    }
  }

  contains(point: Vec3): boolean {
    if (!this.node.active) return false;
    return this.hitRegions.some((node) => node.activeInHierarchy && node.getComponent(UITransform)!.getBoundingBoxToWorld().contains(new Vec2(point.x, point.y)));
  }

  private updateRoster(state: GameState, now: number): void {
    const key = `${state.you}:` + state.players.map((cat) => `${cat.id}:${cat.name}:${cat.character.character}:${cat.character.skin}`).join('|');
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      for (const child of [...this.roster.children]) child.destroy();
      this.cats.clear();
      const columns = this.viewport.width < 900 ? 3 : state.players.length;
      const rows = Math.ceil(state.players.length / columns);
      const width = this.roster.getComponent(UITransform)!.width / columns;
      state.players.forEach((cat, index) => {
        const slot = this.makeNode(this.roster, `Cat-${cat.id}`, width, 62);
        slot.setPosition(width * (index % columns + 0.5 - columns / 2),
          ((rows - 1) / 2 - Math.floor(index / columns)) * 70);
        const stage = this.makeNode(slot, 'PortraitStage', 44, 44);
        stage.setPosition(0, 7);
        const portrait = this.skin.image(stage, 'Portrait', this.art.characterPortrait(cat.character), 0, 0, 42);
        const opacity = portrait.addComponent(UIOpacity);
        const attacker = this.makeNode(stage, 'DoorAttacker', 29, 29);
        attacker.setPosition(17, -15);
        this.skin.surface(attacker, 'card');
        this.skin.image(attacker, 'Manager', this.managerPortrait(), 0, 0, 25);
        attacker.active = false;
        const captured = this.label(stage, '×', 24, 17, -13, 25, 28, true, '#b05a45').node;
        captured.active = false;
        if (cat.id === state.you) this.label(stage, '你', 13, -18, 15, 20, 20, true, '#587845');
        const label = this.label(slot, '', 17, 0, -25, width - 3, 22);
        this.cats.set(cat.id, { stage, portrait, opacity, attacker, captured, label, pulseAt: -Infinity, animating: false });
        this.skin.bindButton(slot, true, () => {
          const current = this.state?.players.find((player) => player.id === cat.id);
          if (current) this.showNotice(`${current.name} · ${playerActivity(current)}${current.room >= 0 ? ` · ${current.room + 1} 号猫店` : ''}`);
        });
      });
    }
    for (const player of state.players) {
      const badge = this.cats.get(player.id)!;
      const attacked = doorUnderAttack(state, player);
      badge.attacker.active = attacked;
      badge.captured.active = !player.alive;
      badge.opacity.opacity = player.alive ? 255 : 85;
      const sprite = badge.portrait.getComponent(Sprite);
      if (sprite) sprite.grayscale = !player.alive;
      badge.label.string = !player.alive ? '抱走了' : player.human && !player.connected ? '离线' : player.id === state.you ? '你' : player.bot ? `AI ${player.id + 1}` : player.name;
      if (attacked && state.monster.attackSequence !== this.lastAttack) {
        badge.pulseAt = now;
        badge.animating = true;
      }
    }
    this.lastAttack = state.monster.attackSequence;
  }

  private fillAnnouncement(event: MonsterState['levelUps'][number]): void {
    this.announcementText.string = event.text;
    this.announcementDetail.string = `Lv.${event.level}${event.healed > 0 ? ` · 回复 ${Math.round(event.healed)} 生命` : ''}`;
  }

  private managerPortrait() {
    return this.art.characterPortrait({ character: 'shop_manager', skin: 'original' });
  }

  private card(name: string, box: HudBox, parent = this.node, blockInput = true): Node {
    const node = this.makeNode(parent, name, box.width, box.height);
    node.setPosition(box.x + box.width / 2 - this.viewport.width / 2, this.viewport.height / 2 - box.y - box.height / 2);
    this.skin.surface(node, 'hud');
    if (blockInput) this.hitRegions.push(node);
    return node;
  }

  private makeNode(parent: Node, name: string, width: number, height: number): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    node.setParent(parent);
    node.addComponent(UITransform).setContentSize(width, height);
    return node;
  }

  private label(parent: Node, text: string, fontSize: number, x: number, y: number,
                width: number, height: number, bold = false, color: string = UI_COLORS.muted): Label {
    const node = this.makeNode(parent, 'Label', width, height);
    node.setPosition(x, y);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.2);
    label.isBold = bold;
    label.color = new Color(color);
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }
}
