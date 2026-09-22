import {
  Color,
  EditBox,
  EventTouch,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Layers,
  Node,
  Size,
  Sprite,
  SpriteFrame,
  UITransform,
  VerticalTextAlignment,
} from 'cc';
import { SharedArt } from '../art/SharedArt';
import type { CharacterOption, CharacterSelection, GameState, MapOption } from '../model/GameTypes';

const MODES = [
  { capacity: 1, name: '单人模式', detail: '你和 5 位 AI 猫猫' },
  { capacity: 2, name: '双人联机', detail: '邀请 1 位好友，其余由 AI 补齐' },
  { capacity: 6, name: '多人联机', detail: '邀请 1～5 位好友，其余由 AI 补齐' },
] as const;
const SKIN_NAMES: Record<string, string> = {
  orange: '橘猫', blue_gray: '蓝灰猫', purple_white: '紫白猫',
  milk_tea: '奶茶猫', mint: '薄荷猫', rose: '玫瑰猫',
};

interface FlowActions {
  create: (capacity: number, mapId: string, name: string, character: CharacterSelection) => void;
  join: (code: string, name: string, character: CharacterSelection) => void;
  selectMap: (mapId: string) => void;
  selectCharacter: (character: CharacterSelection) => void;
  ready: (ready: boolean, mapSeed: number) => void;
  start: (mapSeed: number) => void;
  rematch: () => void;
  leave: () => void;
}

export class GameFlowPanel {
  readonly node: Node;
  private readonly backdrop: Graphics;
  private viewport = new Size(1280, 720);
  private maps: MapOption[] = [];
  private characters: CharacterOption[] = [];
  private state: GameState | null = null;
  private connected = false;
  private readyForMenu = false;
  private signature = '';
  private modeIndex = 0;
  private selectedMapId = '';
  private mapPage = 0;
  private characterIndex = 0;
  private characterPage = 0;
  private nickname = '橘子';
  private inviteCode = '';
  private nicknameBox: EditBox | null = null;
  private inviteBox: EditBox | null = null;
  private error = '';

  constructor(parent: Node, private readonly art: SharedArt, private readonly actions: FlowActions) {
    this.node = new Node('GameFlowPanel');
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setParent(parent);
    this.node.addComponent(UITransform);
    this.backdrop = this.node.addComponent(Graphics);
    this.node.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; });
  }

  get visible(): boolean {
    return this.node.active;
  }

  layout(viewport: Size): void {
    if (this.viewport.width === viewport.width && this.viewport.height === viewport.height) return;
    this.viewport = viewport.clone();
    this.signature = '';
    this.present(this.state, this.connected, this.readyForMenu);
  }

  setChoices(maps: MapOption[], characters: CharacterOption[]): void {
    this.maps = maps;
    this.characters = characters;
    if (!maps.some((map) => map.id === this.selectedMapId)) this.selectedMapId = maps[0]?.id ?? '';
    this.mapPage = Math.floor(Math.max(0, maps.findIndex((map) => map.id === this.selectedMapId)) / 4);
    if (this.characterIndex >= this.characterSelections().length) this.characterIndex = 0;
    this.characterPage = Math.floor(this.characterIndex / 6);
    this.signature = '';
    this.present(this.state, this.connected, this.readyForMenu);
  }

  setError(message: string): void {
    this.error = message;
    this.signature = '';
    this.present(this.state, this.connected, this.readyForMenu);
  }

  present(state: GameState | null, connected: boolean, readyForMenu: boolean): void {
    this.state = state;
    this.connected = connected;
    this.readyForMenu = readyForMenu;
    const screen = !state ? 'menu' : state.phase === 'lobby' ? 'lobby' :
      state.phase === 'won' || state.phase === 'lost' ? 'result' : 'hidden';
    this.node.active = screen !== 'hidden';
    if (screen === 'hidden') return;
    const key = JSON.stringify([
      screen, connected, readyForMenu, this.error, this.viewport.width, this.viewport.height,
      this.modeIndex, this.selectedMapId, this.mapPage, this.characterIndex, this.characterPage,
      screen === 'menu' ? [this.maps, this.characters] : null,
      state && screen === 'lobby' ? [state.code, state.map.seed, state.map.name, state.selectedMap,
        state.host, state.you, state.minimumHumans,
        state.players.map((player) => [player.name, player.human, player.connected, player.ready,
          player.bot, player.character.character, player.character.skin])] : null,
      state && screen === 'result' ? [state.phase, state.host, state.you,
        state.players.map((player) => [player.name, player.alive])] : null,
    ]);
    if (key === this.signature) return;
    this.captureInputs();
    this.signature = key;
    this.rebuild(screen);
  }

  private captureInputs(): void {
    if (this.nicknameBox?.isValid) this.nickname = this.nicknameBox.string;
    if (this.inviteBox?.isValid) this.inviteCode = this.inviteBox.string;
    this.nicknameBox = null;
    this.inviteBox = null;
  }

  private refresh(): void {
    this.error = '';
    this.signature = '';
    this.present(this.state, this.connected, this.readyForMenu);
  }

  private rebuild(screen: 'menu' | 'lobby' | 'result'): void {
    for (const child of [...this.node.children]) child.destroy();
    this.node.getComponent(UITransform)!.setContentSize(this.viewport);
    this.backdrop.clear();
    this.backdrop.fillColor = new Color('#d0ddcd');
    this.backdrop.fillRect(-this.viewport.width / 2, -this.viewport.height / 2,
      this.viewport.width, this.viewport.height);
    const portraitMenu = screen === 'menu' && this.viewport.height > this.viewport.width * 1.15;
    if (screen === 'menu') this.renderMenuBackground(portraitMenu ? 'portrait' : 'landscape');
    const width = Math.min(
      screen === 'menu' && portraitMenu ? this.viewport.width * 0.86 : this.viewport.width - 28,
      screen === 'menu' ? 820 : 640,
    );
    const height = Math.min(this.viewport.height - 28, screen === 'result' ? 440 : portraitMenu ? 1100 : 700);
    const card = this.makeNode('FlowCard', this.node, width, height);
    const paper = card.addComponent(Graphics);
    paper.fillColor = new Color(255, 253, 243, screen === 'menu' ? 239 : 255);
    paper.strokeColor = new Color('#b3c5a8');
    paper.lineWidth = 2;
    paper.roundRect(-width / 2, -height / 2, width, height, 25);
    paper.fill();
    paper.stroke();
    if (screen === 'menu') this.renderMenu(card, width, height);
    else if (screen === 'lobby' && this.state) this.renderLobby(card, width, height, this.state);
    else if (this.state) this.renderResult(card, width, height, this.state);
  }

  private renderMenuBackground(orientation: 'landscape' | 'portrait'): void {
    const node = this.makeNode('MenuIllustration', this.node, this.viewport.width, this.viewport.height);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.enabled = false;
    void this.art.menuBackdrop(orientation).then((frame) => {
      if (!node.isValid) return;
      const size = frame.originalSize;
      const cover = Math.max(this.viewport.width / size.width, this.viewport.height / size.height);
      node.getComponent(UITransform)!.setContentSize(size.width * cover, size.height * cover);
      sprite.spriteFrame = frame;
      sprite.enabled = true;
    }).catch((error: unknown) => console.warn('首页背景加载失败', error));
  }

  private renderMenu(card: Node, width: number, height: number): void {
    if (this.viewport.height > this.viewport.width * 1.15) {
      this.renderPortraitMenu(card, width, height);
      return;
    }
    const scale = height / 700;
    const y = (offset: number) => height / 2 - offset * scale;
    const inner = width - 36;
    const map = this.maps.find((entry) => entry.id === this.selectedMapId);
    this.label(card, '猫猫夺店计划', 35 * scale, 0, y(37), inner, 46 * scale, true);
    this.label(card, this.error || (this.connected ? '选好今晚的街区与猫猫，出发夺店' : '正在连接猫店小街…'),
      17 * scale, 0, y(75), inner, 29 * scale, false, !!this.error);
    const mode = MODES[this.modeIndex];
    const modeWidth = (inner - 16) / MODES.length;
    MODES.forEach((option, index) => {
      this.choiceButton(card, `${option.name}\n${option.detail}`,
        -inner / 2 + modeWidth / 2 + index * (modeWidth + 8), y(130), modeWidth, 52 * scale,
        index === this.modeIndex, () => {
          this.modeIndex = index;
          this.refresh();
        });
    });
    this.label(card, '选择街区 · 每局房间布局仍会变化', 19 * scale, 0, y(185), inner, 28 * scale, true);
    if (this.maps.length > 4) {
      const pages = Math.ceil(this.maps.length / 4);
      this.button(card, `第 ${this.mapPage + 1} / ${pages} 页  ↻`, inner / 2 - 73, y(185), 140, 30 * scale,
        true, () => {
          this.mapPage = (this.mapPage + 1) % pages;
          this.refresh();
        });
    }
    const mapWidth = (inner - 10) / 2;
    for (const [index, map] of this.maps.slice(this.mapPage * 4, this.mapPage * 4 + 4).entries()) {
      this.mapCard(card, map,
        (index % 2 ? 1 : -1) * (mapWidth + 10) / 2,
        y(index < 2 ? 258 : 373), mapWidth, 106 * scale,
        map.id === this.selectedMapId);
    }
    if (!this.maps.length) this.label(card, '正在加载可选街区…', 19 * scale, 0, y(315), inner, 80 * scale);
    this.label(card, '选择猫猫', 19 * scale, 0, y(445), inner, 27 * scale, true);
    const selections = this.characterSelections();
    const character = selections[this.characterIndex];
    if (selections.length > 6) {
      const pages = Math.ceil(selections.length / 6);
      this.button(card, `第 ${this.characterPage + 1} / ${pages} 页  ↻`, inner / 2 - 73, y(445), 140, 30 * scale,
        true, () => {
          this.characterPage = (this.characterPage + 1) % pages;
          this.refresh();
        });
    }
    const visible = selections.slice(this.characterPage * 6, this.characterPage * 6 + 6);
    const skinWidth = (inner - (visible.length - 1) * 7) / Math.max(1, visible.length);
    visible.forEach((selection, index) => {
      this.characterCard(card, selection, -inner / 2 + skinWidth / 2 + index * (skinWidth + 7),
        y(500), skinWidth, 79 * scale, this.characterPage * 6 + index === this.characterIndex, () => {
          this.characterIndex = this.characterPage * 6 + index;
          this.refresh();
        });
    });
    if (!visible.length) this.label(card, '正在加载猫猫外观…', 17 * scale, 0, y(500), inner, 72 * scale);
    const nameWidth = Math.min(inner * 0.42, 300);
    this.nicknameBox = this.input(card, '猫猫名字', this.nickname,
      -inner / 2 + nameWidth / 2, y(574), nameWidth, 48 * scale, 16);
    const startWidth = inner - nameWidth - 10;
    this.button(card, mode.capacity === 1 ? '独自出发' : '创建好友房间',
      inner / 2 - startWidth / 2, y(574), startWidth, 48 * scale,
      this.readyForMenu && !!map && !!character, () => {
        this.captureInputs();
        this.actions.create(mode.capacity, map!.id, this.nickname.trim() || '橘子', character!);
      });
    if (mode.capacity !== 1) {
      this.inviteBox = this.input(card, '好友的 6 位邀请码', this.inviteCode,
        -inner * 0.2, y(651), inner * 0.6, 42 * scale, 6);
      this.button(card, '加入好友', inner * 0.32, y(651), inner * 0.34, 42 * scale,
        this.readyForMenu && !!character, () => {
          this.captureInputs();
          const code = this.inviteCode.trim().toUpperCase();
          if (!/^[A-F0-9]{6}$/.test(code)) {
            this.setError('请输入好友的 6 位邀请码');
            return;
          }
          this.actions.join(code, this.nickname.trim() || '橘子', character!);
        });
    } else {
      this.label(card, '单人模式由 AI 补齐队伍 · 好友联机可选双人或多人',
        16 * scale, 0, y(651), inner, 38 * scale);
    }
    this.label(card, mode.capacity === 1 ? '已选择街区；房间形状与道具每局重新生成' : '加入好友房间时使用房主选择的街区',
      13 * scale, 0, y(684), inner, 20 * scale);
  }

  private renderPortraitMenu(card: Node, width: number, height: number): void {
    const scale = height / 1100;
    const y = (offset: number) => height / 2 - offset * scale;
    const inner = width - 36;
    const map = this.maps.find((entry) => entry.id === this.selectedMapId);
    const mode = MODES[this.modeIndex];
    const selections = this.characterSelections();
    const character = selections[this.characterIndex];
    this.label(card, '猫猫夺店计划', 38 * scale, 0, y(48), inner, 60 * scale, true);
    this.label(card, this.error || (this.connected ? '选好今晚的街区与猫猫，出发夺店' : '正在连接猫店小街…'),
      19 * scale, 0, y(92), inner, 30 * scale, false, !!this.error);
    const modeWidth = (inner - 16) / MODES.length;
    MODES.forEach((option, index) => {
      this.choiceButton(card, `${option.name}\n${option.detail}`,
        -inner / 2 + modeWidth / 2 + index * (modeWidth + 8), y(150), modeWidth, 70 * scale,
        index === this.modeIndex, () => {
          this.modeIndex = index;
          this.refresh();
        });
    });
    this.label(card, '选择街区 · 每局房间布局仍会变化', 21 * scale, 0, y(215), inner, 30 * scale, true);
    if (this.maps.length > 4) {
      const pages = Math.ceil(this.maps.length / 4);
      this.button(card, `第 ${this.mapPage + 1} / ${pages} 页  ↻`, inner / 2 - 73, y(215), 140, 31 * scale,
        true, () => {
          this.mapPage = (this.mapPage + 1) % pages;
          this.refresh();
        });
    }
    this.maps.slice(this.mapPage * 4, this.mapPage * 4 + 4).forEach((option, index) => {
      this.mapCard(card, option, 0, y(286 + index * 110), inner, 100 * scale,
        option.id === this.selectedMapId);
    });
    if (!this.maps.length) this.label(card, '正在加载可选街区…', 20 * scale, 0, y(450), inner, 100 * scale);
    this.label(card, '选择猫猫', 21 * scale, 0, y(695), inner, 30 * scale, true);
    if (selections.length > 6) {
      const pages = Math.ceil(selections.length / 6);
      this.button(card, `第 ${this.characterPage + 1} / ${pages} 页  ↻`, inner / 2 - 73, y(695), 140, 31 * scale,
        true, () => {
          this.characterPage = (this.characterPage + 1) % pages;
          this.refresh();
        });
    }
    const visible = selections.slice(this.characterPage * 6, this.characterPage * 6 + 6);
    const skinWidth = (inner - 16) / 3;
    visible.forEach((selection, index) => {
      this.characterCard(card, selection,
        -inner / 2 + skinWidth / 2 + (index % 3) * (skinWidth + 8),
        y(index < 3 ? 760 : 850), skinWidth, 80 * scale,
        this.characterPage * 6 + index === this.characterIndex, () => {
          this.characterIndex = this.characterPage * 6 + index;
          this.refresh();
        });
    });
    if (!visible.length) this.label(card, '正在加载猫猫外观…', 18 * scale, 0, y(805), inner, 80 * scale);
    const nameWidth = Math.min(inner * 0.42, 300);
    this.nicknameBox = this.input(card, '猫猫名字', this.nickname,
      -inner / 2 + nameWidth / 2, y(948), nameWidth, 55 * scale, 16);
    const startWidth = inner - nameWidth - 10;
    this.button(card, mode.capacity === 1 ? '独自出发' : '创建好友房间',
      inner / 2 - startWidth / 2, y(948), startWidth, 55 * scale,
      this.readyForMenu && !!map && !!character, () => {
        this.captureInputs();
        this.actions.create(mode.capacity, map!.id, this.nickname.trim() || '橘子', character!);
      });
    if (mode.capacity !== 1) {
      this.inviteBox = this.input(card, '好友的 6 位邀请码', this.inviteCode,
        -inner * 0.2, y(1030), inner * 0.6, 46 * scale, 6);
      this.button(card, '加入好友', inner * 0.32, y(1030), inner * 0.34, 46 * scale,
        this.readyForMenu && !!character, () => {
          this.captureInputs();
          const code = this.inviteCode.trim().toUpperCase();
          if (!/^[A-F0-9]{6}$/.test(code)) {
            this.setError('请输入好友的 6 位邀请码');
            return;
          }
          this.actions.join(code, this.nickname.trim() || '橘子', character!);
        });
    } else {
      this.label(card, '单人模式由 AI 补齐队伍 · 好友联机可选双人或多人',
        17 * scale, 0, y(1030), inner, 43 * scale);
    }
    this.label(card, mode.capacity === 1 ? '街区固定选择，房间形状与道具每局重新生成' : '加入好友房间时使用房主选择的街区',
      14 * scale, 0, y(1080), inner, 20 * scale);
  }

  private choiceButton(parent: Node, value: string, x: number, y: number, width: number, height: number,
                       selected: boolean, action: () => void): void {
    const node = this.makeNode('ModeChoice', parent, width, height);
    node.setPosition(x, y);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(selected ? '#d7ead0' : '#f6f7ed');
    graphics.strokeColor = new Color(selected ? '#698d65' : '#ccd6c4');
    graphics.lineWidth = selected ? 2.5 : 1.2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 11);
    graphics.fill();
    graphics.stroke();
    this.label(node, value, height > 44 ? 17 : 14, 0, 0, width - 8, height - 6, selected);
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      event.propagationStopped = true;
      action();
    });
  }

  private mapCard(parent: Node, map: MapOption, x: number, y: number, width: number, height: number,
                  selected: boolean): void {
    const node = this.makeNode(`MapChoice-${map.id}`, parent, width, height);
    node.setPosition(x, y);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(selected ? '#fff0d7' : '#f8f8ef');
    graphics.strokeColor = new Color(selected ? '#c88d56' : '#cbd5c2');
    graphics.lineWidth = selected ? 2.5 : 1.2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();
    const imageWidth = Math.min(width * 0.34, height * 1.25);
    const imageX = -width / 2 + imageWidth / 2 + 7;
    this.previewSprite(node, 'MapPreview', imageX, 0, imageWidth, height - 12,
      this.art.themeBackdrop(map.theme));
    const textWidth = width - imageWidth - 19;
    const textX = width / 2 - textWidth / 2 - 6;
    this.label(node, map.name, 19, textX, height * 0.26, textWidth, height * 0.3, true);
    this.label(node, `${map.width}×${map.height} 格 · ${map.minRooms}～${map.maxRooms} 间猫店`,
      15, textX, 0, textWidth, height * 0.25);
    this.label(node, `布局${map.complexity >= 3 ? '多变' : map.complexity === 2 ? '灵活' : '舒展'} · 点击选择`,
      14, textX, -height * 0.28, textWidth, height * 0.27);
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      event.propagationStopped = true;
      this.selectedMapId = map.id;
      this.refresh();
    });
  }

  private characterCard(parent: Node, selection: CharacterSelection, x: number, y: number,
                        width: number, height: number, selected: boolean, action: () => void): void {
    const node = this.makeNode(`CatChoice-${selection.skin}`, parent, width, height);
    node.setPosition(x, y);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(selected ? '#fff0d7' : '#f7f8ee');
    graphics.strokeColor = new Color(selected ? '#c88d56' : '#ccd6c5');
    graphics.lineWidth = selected ? 2.5 : 1.2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 11);
    graphics.fill();
    graphics.stroke();
    const portraitSize = Math.min(width - 7, height * 0.82);
    this.previewSprite(node, 'CatPortrait', 0, height * 0.11, portraitSize, portraitSize,
      this.art.characterPortrait(selection));
    this.label(node, this.characterName(selection), 14, 0, -height * 0.34, width - 5, height * 0.3, selected);
    node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      event.propagationStopped = true;
      action();
    });
  }

  private previewSprite(parent: Node, name: string, x: number, y: number, width: number, height: number,
                        frame: Promise<SpriteFrame>): void {
    const node = this.makeNode(name, parent, width, height);
    node.setPosition(x, y);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.enabled = false;
    void frame.then((result) => {
      if (!node.isValid) return;
      sprite.spriteFrame = result;
      sprite.enabled = true;
    }).catch((error: unknown) => console.warn(`${name} 美术资源加载失败`, error));
  }

  private renderLobby(card: Node, width: number, height: number, state: GameState): void {
    const scale = height / 700;
    const y = (offset: number) => height / 2 - offset * scale;
    const inner = width - 48;
    const me = state.players[state.you];
    const host = state.host === state.you;
    const humans = state.players.filter((player) => player.human);
    const allReady = humans.length >= state.minimumHumans &&
      humans.every((player) => player.ready && player.connected);
    this.label(card, '好友集合，准备夺店', 31 * scale, 0, y(52), inner, 45 * scale, true);
    this.label(card, `邀请码  ${state.code}    真人 ${humans.length} / ${state.capacity} · 其余 AI 补齐`,
      21 * scale, 0, y(105), inner, 39 * scale);
    const currentMapIndex = state.catalog.maps.findIndex((map) => map.id === state.selectedMap);
    this.button(card, `街区：${state.map.name}${host ? '  ↻' : ''}\n${host ? '房主可切换地图，切换后好友需重新准备' : '房主选择本局地图'}`,
      0, y(170), inner, 59 * scale, host && !!state.catalog.maps.length, () => {
        const next = state.catalog.maps[(currentMapIndex + 1) % state.catalog.maps.length];
        this.actions.selectMap(next.id);
      });
    const selections = this.selections(state.catalog.characters);
    const characterIndex = selections.findIndex((choice) =>
      choice.character === me.character.character && choice.skin === me.character.skin);
    this.button(card, `我的猫猫：${this.characterName(me.character)}  ↻\n换猫后需要重新准备`,
      0, y(245), inner, 59 * scale, selections.length > 1, () => {
        this.actions.selectCharacter(selections[(characterIndex + 1) % selections.length]);
      });
    this.label(card, '今晚的小队', 20 * scale, 0, y(303), inner, 31 * scale, true);
    const columns = 2;
    const columnWidth = (inner - 12) / columns;
    state.players.forEach((player, index) => {
      const x = (index % columns ? 1 : -1) * (columnWidth / 2 + 6);
      const rowY = y(351 + Math.floor(index / columns) * 64);
      const status = player.bot ? 'AI 补位' : !player.connected ? '离线中' :
        player.id === state.host ? '房主' : player.ready ? '已准备' : '未准备';
      this.label(card, `${player.name}${player.id === state.you ? ' · 你' : ''}\n${status}`,
        17 * scale, x, rowY, columnWidth, 55 * scale);
    });
    this.label(card, this.error || (host
      ? allReady ? '队伍已集齐，可以出发' : '至少两位真人，等待所有好友准备'
      : me.ready ? '已准备，等待房主出发' : '准备好后通知房主'),
    17 * scale, 0, y(566), inner, 36 * scale, false, !!this.error);
    this.button(card, host ? '一起出发' : me.ready ? '取消准备' : '准备好了',
      0, y(621), inner, 58 * scale, this.connected && (host ? allReady : true), () => {
        if (host) this.actions.start(state.map.seed);
        else this.actions.ready(!me.ready, state.map.seed);
      });
    this.button(card, '返回主菜单', 0, y(675), inner * 0.52, 35 * scale, true, this.actions.leave);
  }

  private renderResult(card: Node, width: number, height: number, state: GameState): void {
    const scale = height / 440;
    const y = (offset: number) => height / 2 - offset * scale;
    const alive = state.players.filter((player) => player.alive).length;
    const won = state.phase === 'won';
    this.label(card, won ? '守住了，开罐头！' : '小猫都被抱走啦',
      34 * scale, 0, y(80), width - 48, 60 * scale, true);
    this.label(card, won ? `还有 ${alive} 只猫留守，店长放弃了。` : '换个猫店，再试试新的机关组合。',
      21 * scale, 0, y(158), width - 48, 62 * scale);
    if (state.host === state.you) {
      this.button(card, '在当前街区再玩一局', 0, y(256), width - 72, 67 * scale,
        this.connected, this.actions.rematch);
    } else {
      this.label(card, '等待房主再开一局', 20 * scale, 0, y(256), width - 72, 62 * scale);
    }
    this.button(card, '返回主菜单', 0, y(355), width - 72, 56 * scale, true, this.actions.leave);
  }

  private characterSelections(): CharacterSelection[] {
    return this.selections(this.characters);
  }

  private selections(options: CharacterOption[]): CharacterSelection[] {
    const result: CharacterSelection[] = [];
    for (const option of options) {
      for (const skin of option.skins) result.push({ character: option.id, skin });
    }
    return result;
  }

  private characterName(selection?: CharacterSelection): string {
    return selection ? SKIN_NAMES[selection.skin] ?? selection.skin : '正在加载猫猫…';
  }

  private makeNode(name: string, parent: Node, width: number, height: number): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.setParent(parent);
    node.addComponent(UITransform).setContentSize(width, height);
    return node;
  }

  private label(parent: Node, value: string, fontSize: number, x: number, y: number,
                width: number, height: number, strong = false, error = false): Label {
    const node = this.makeNode('FlowLabel', parent, width, height);
    node.setPosition(x, y);
    const label = node.addComponent(Label);
    label.string = value;
    label.fontSize = Math.max(13, Math.round(fontSize));
    label.lineHeight = Math.round(label.fontSize * 1.25);
    label.color = new Color(error ? '#b65e4b' : strong ? '#3b543b' : '#6c7967');
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.enableWrapText = true;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private button(parent: Node, value: string, x: number, y: number, width: number, height: number,
                 enabled: boolean, action: () => void): Node {
    const node = this.makeNode(`FlowButton-${value.split('\n')[0]}`, parent, width, height);
    node.setPosition(x, y);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color(enabled ? '#e5efde' : '#efefe8');
    graphics.strokeColor = new Color(enabled ? '#93aa87' : '#d2d4ca');
    graphics.lineWidth = 1.5;
    graphics.roundRect(-width / 2, -height / 2, width, height, 12);
    graphics.fill();
    graphics.stroke();
    const label = this.label(node, value, value.includes('\n') ? 18 : 21, 0, 0,
      width - 16, height - 6, enabled);
    if (!enabled) label.color = new Color('#a3a8a0');
    if (enabled) node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      event.propagationStopped = true;
      action();
    });
    return node;
  }

  private input(parent: Node, placeholder: string, value: string, x: number, y: number,
                width: number, height: number, maxLength: number): EditBox {
    const node = this.makeNode(`FlowInput-${placeholder}`, parent, width, height);
    node.active = false;
    node.setPosition(x, y);
    const graphics = node.addComponent(Graphics);
    graphics.fillColor = new Color('#fffefa');
    graphics.strokeColor = new Color('#b9c9af');
    graphics.lineWidth = 1.5;
    graphics.roundRect(-width / 2, -height / 2, width, height, 10);
    graphics.fill();
    graphics.stroke();
    const box = node.addComponent(EditBox);
    box.inputMode = EditBox.InputMode.SINGLE_LINE;
    box.maxLength = maxLength;
    box.string = value;
    box.placeholder = placeholder;
    node.active = true;
    for (const label of [box.textLabel, box.placeholderLabel]) {
      if (!label) continue;
      label.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
      label.fontSize = Math.max(14, Math.round(20 * height / 58));
      label.lineHeight = Math.round(label.fontSize * 1.25);
      label.color = new Color(label === box.textLabel ? '#3b543b' : '#6c7967');
      label.horizontalAlign = HorizontalTextAlignment.CENTER;
      label.verticalAlign = VerticalTextAlignment.CENTER;
      label.overflow = Label.Overflow.SHRINK;
    }
    return box;
  }
}
