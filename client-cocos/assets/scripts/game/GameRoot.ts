import {
  _decorator,
  Camera,
  Color,
  Component,
  EventTouch,
  Graphics,
  HorizontalTextAlignment,
  Input,
  Label,
  Layers,
  Node,
  Rect,
  RenderRoot2D,
  ResolutionPolicy,
  Size,
  Sprite,
  sys,
  UITransform,
  Vec3,
  VerticalTextAlignment,
  input,
  view,
} from 'cc';
import { FollowCamera } from './FollowCamera';
import { MotionTrack } from './MotionTrack';
import {
  cellCenter,
  cellFromWorld,
  roomAt,
  type CharacterOption,
  type CharacterSelection,
  type GameState,
  type GridMap,
  type MapOption,
  type PlayerState,
} from '../model/GameTypes';
import { GameConnection } from '../network/GameConnection';
import {
  sampleClip,
  SharedArt,
  type AnimationClip,
  type CharacterArt,
  type ThemeArt,
} from '../art/SharedArt';
import { GridActionPanel, type GridAction } from '../ui/GridActionPanel';
import { GameFlowPanel } from '../ui/GameFlowPanel';
import { VirtualJoystick } from '../ui/VirtualJoystick';

const { ccclass } = _decorator;
const WORLD_LAYER = 1 << 19;
const SERVER_URL = 'ws://127.0.0.1:8787/ws';
const ROOM_COLORS = ['#f7e6d0', '#dcebd9', '#dfe7f4', '#eee0ef', '#f4e6c9', '#d8ece8'];

type Direction = 'left' | 'right' | 'up' | 'down';
type DoorVisualState = 'closed' | 'open' | 'damaged_1' | 'damaged_2';

interface ActorView {
  node: Node;
  visualNode: Node;
  sprite: Sprite;
  graphics: Graphics;
  track: MotionTrack;
  art: CharacterArt | null;
  selectionKey: string;
  action: string;
  actionAt: number;
  lastPose: { x: number; y: number } | null;
  lastSleeping: boolean;
  wakeAt: number;
  lastMotionAt: number;
  lastDirection: Direction;
}

interface WorldObjectView {
  node: Node;
  sprite: Sprite;
  clip: AnimationClip | null;
  assetKey: string;
  actionAt: number;
}

@ccclass('CatShopGameRoot')
export class GameRoot extends Component {
  private readonly art = new SharedArt();
  private worldCamera!: Camera;
  private uiCamera!: Camera;
  private cameraFollow!: FollowCamera;
  private worldRoot!: Node;
  private backgroundRoot!: Node;
  private terrainRoot!: Node;
  private fallbackGraphics!: Graphics;
  private overlayGraphics!: Graphics;
  private objectRoot!: Node;
  private actorRoot!: Node;
  private uiRoot!: Node;
  private statusLabel!: Label;
  private walletLabel!: Label;
  private managerLabel!: Label;
  private teamLabel!: Label;
  private noticeLabel!: Label;
  private announcementLabel!: Label;
  private titleLabel!: Label;
  private exitButton!: Node;
  private flow!: GameFlowPanel;
  private actionPanel!: GridActionPanel;
  private joystick!: VirtualJoystick;
  private connection!: GameConnection;
  private state: GameState | null = null;
  private readonly actors = new Map<number, ActorView>();
  private readonly objects = new Map<string, WorldObjectView>();
  private managerActor: ActorView | null = null;
  private mapSeed = -1;
  private themeGeneration = 0;
  private worldReady = false;
  private sequence = 0;
  private serverReady = false;
  private mapOptions: MapOption[] = [];
  private characterOptions: CharacterOption[] = [];
  private startSentForSeed = -1;
  private selectedCell = -1;
  private gridColor = '#6d65432e';
  private gridLineWidth = 0.65;
  private designWidth = 0;
  private designHeight = 0;
  private lastSteerX = 0;
  private lastSteerY = 0;
  private lastSteerAt = 0;
  private lastViewSize = { width: 0, height: 0, safeX: 0, safeY: 0, safeWidth: 0, safeHeight: 0 };
  private lastManagerAttackSequence = -1;
  private announcementUntil = 0;
  private cameraTouchId: number | null = null;
  private cameraTouchStart = { x: 0, y: 0 };
  private cameraTouchLast = { x: 0, y: 0 };
  private cameraDragging = false;

  start(): void {
    this.configureDesignResolution();
    this.buildScene();
    this.connection = new GameConnection(SERVER_URL, {
      onReady: () => {
        this.serverReady = true;
        this.setStatus('已连接服务器');
        this.updateMenu();
      },
      onState: (state) => this.acceptState(state),
      onMaps: (maps) => {
        this.mapOptions = maps;
        this.flow.setChoices(this.mapOptions, this.characterOptions);
      },
      onCharacters: (characters) => {
        this.characterOptions = characters;
        this.flow.setChoices(this.mapOptions, this.characterOptions);
      },
      onJoined: (lastSequence) => {
        this.sequence = lastSequence;
        this.setStatus('正在加载店铺街区…');
      },
      onStatus: (connected) => {
        if (!connected) {
          this.serverReady = false;
          this.setStatus('连接中断，正在重连…');
          this.updateMenu();
        }
      },
      onError: (message) => {
        if (!this.state && this.connection.isConnected()) this.serverReady = true;
        this.setStatus(message);
        this.flow.setError(message);
        this.updateMenu();
      },
      onExpired: () => this.clearSession('上一局已经结束，可以开始新的行动'),
      onLeft: () => this.clearSession('已返回主菜单'),
    });
    this.connection.connect();
    input.on(Input.EventType.TOUCH_START, this.handleCameraTouchStart, this);
    input.on(Input.EventType.TOUCH_MOVE, this.handleCameraTouchMove, this);
    input.on(Input.EventType.TOUCH_END, this.handleTouchEnd, this);
    input.on(Input.EventType.TOUCH_CANCEL, this.handleCameraTouchCancel, this);
    this.setStatus('正在连接游戏服务器…');
    this.updateMenu();
  }

  update(deltaTime: number): void {
    this.configureDesignResolution();
    const now = performance.now();
    this.connection.update(now);
    this.layoutUi();
    this.updateJoystick(now);
    if (this.announcementUntil && now >= this.announcementUntil) {
      this.announcementUntil = 0;
      this.announcementLabel.node.active = false;
    }
    const state = this.state;
    if (!state || state.phase === 'lobby') return;
    this.updateActors(state, now);
    this.updateWorldObjects(now);
    const own = this.actors.get(state.players[state.you].id);
    if (own) {
      const position = own.node.position;
      const map = state.map;
      this.cameraFollow.update(
        { x: position.x + (map.width * map.tileSize) / 2, y: (map.height * map.tileSize) / 2 - position.y },
        deltaTime,
        state.players[state.you].alive,
      );
    }
  }

  onDestroy(): void {
    input.off(Input.EventType.TOUCH_START, this.handleCameraTouchStart, this);
    input.off(Input.EventType.TOUCH_MOVE, this.handleCameraTouchMove, this);
    input.off(Input.EventType.TOUCH_END, this.handleTouchEnd, this);
    input.off(Input.EventType.TOUCH_CANCEL, this.handleCameraTouchCancel, this);
    this.connection?.dispose();
  }

  private configureDesignResolution(): void {
    const frame = view.getFrameSize();
    if (frame.width <= 0 || frame.height <= 0) return;
    const portrait = frame.height > frame.width;
    const width = sys.isMobile ? (portrait ? 720 : 960) : 1280;
    const height = Math.round(width * frame.height / frame.width);
    if (width === this.designWidth && height === this.designHeight) return;
    this.designWidth = width;
    this.designHeight = height;
    view.setDesignResolutionSize(width, height, ResolutionPolicy.SHOW_ALL);
    this.lastViewSize.width = 0;
  }

  private buildScene(): void {
    this.worldRoot = this.makeNode('World', WORLD_LAYER);
    this.worldRoot.setParent(this.node.scene);
    this.worldRoot.addComponent(RenderRoot2D);
    this.backgroundRoot = this.makeNode('Background', WORLD_LAYER, this.worldRoot);
    this.terrainRoot = this.makeNode('Terrain', WORLD_LAYER, this.worldRoot);
    const fallbackNode = this.makeNode('FallbackMap', WORLD_LAYER, this.worldRoot);
    this.fallbackGraphics = fallbackNode.addComponent(Graphics);
    const overlayNode = this.makeNode('MapOverlay', WORLD_LAYER, this.worldRoot);
    this.overlayGraphics = overlayNode.addComponent(Graphics);
    this.objectRoot = this.makeNode('WorldObjects', WORLD_LAYER, this.worldRoot);
    this.actorRoot = this.makeNode('Actors', WORLD_LAYER, this.worldRoot);

    const worldCameraNode = this.makeNode('WorldCamera', WORLD_LAYER, this.node.scene!);
    worldCameraNode.setPosition(0, 0, 1000);
    this.worldCamera = worldCameraNode.addComponent(Camera);
    this.worldCamera.projection = Camera.ProjectionType.ORTHO;
    this.worldCamera.visibility = WORLD_LAYER;
    this.worldCamera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    this.worldCamera.clearColor = new Color('#c6d4bf');
    this.worldCamera.priority = 0;
    this.cameraFollow = new FollowCamera(this.worldCamera);

    this.uiRoot = this.makeNode('UI', Layers.Enum.UI_2D, this.node.scene!);
    this.uiRoot.addComponent(RenderRoot2D);
    const uiCameraNode = this.makeNode('UICamera', Layers.Enum.UI_2D, this.node.scene!);
    uiCameraNode.setPosition(0, 0, 1000);
    this.uiCamera = uiCameraNode.addComponent(Camera);
    this.uiCamera.projection = Camera.ProjectionType.ORTHO;
    this.uiCamera.visibility = Layers.Enum.UI_2D;
    this.uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
    this.uiCamera.priority = 10;

    this.statusLabel = this.makeLabel('Status', 22, new Color('#435143'), this.uiRoot);
    this.statusLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.walletLabel = this.makeLabel('Wallet', 24, new Color('#795b32'), this.uiRoot);
    this.walletLabel.horizontalAlign = HorizontalTextAlignment.RIGHT;
    this.managerLabel = this.makeLabel('ManagerStatus', 18, new Color('#9a5d47'), this.uiRoot);
    this.managerLabel.horizontalAlign = HorizontalTextAlignment.LEFT;
    this.teamLabel = this.makeLabel('TeamStatus', 18, new Color('#445c4b'), this.uiRoot);
    this.noticeLabel = this.makeLabel('Notice', 18, new Color('#465a45'), this.uiRoot);
    this.announcementLabel = this.makeLabel('ManagerAnnouncement', 25, new Color('#a24e34'), this.uiRoot);
    this.announcementLabel.node.active = false;
    this.titleLabel = this.makeLabel('Title', 44, new Color('#394b3c'), this.uiRoot);
    this.titleLabel.string = '正在布置猫店…';
    this.flow = new GameFlowPanel(this.uiRoot, this.art, {
      create: (capacity, mapId, name, character) => this.createRoom(capacity, mapId, name, character),
      join: (code, name, character) => this.joinRoom(code, name, character),
      selectMap: (mapId) => this.sendFlow({ type: 'select_map', mapId }),
      selectCharacter: (character) => this.sendFlow({ type: 'select_character', character }),
      ready: (ready, mapSeed) => this.sendLobbyCommand({ type: 'ready', ready, mapSeed }),
      start: (mapSeed) => this.sendLobbyCommand({ type: 'start', mapSeed }),
      rematch: () => this.sendFlow({ type: 'rematch' }),
      leave: () => this.leaveRoom(),
    });

    this.actionPanel = new GridActionPanel(this.uiRoot, {
      command: (action, room, cell, kind) => this.sendGridAction(action, room, cell, kind),
      close: () => {
        if (this.state) this.closeActionPanel(this.state.map);
        else this.actionPanel.hide();
      },
    });
    this.joystick = new VirtualJoystick(
      this.uiRoot,
      this.uiCamera,
      () => {
        if (this.state && this.actionPanel.active) this.closeActionPanel(this.state.map);
      },
      () => this.stopJoystick(),
    );
    this.exitButton = this.makeNode('ExitGameButton', Layers.Enum.UI_2D, this.uiRoot);
    this.exitButton.addComponent(UITransform).setContentSize(88, 44);
    const exitGraphics = this.exitButton.addComponent(Graphics);
    exitGraphics.fillColor = new Color('#fff8e9ee');
    exitGraphics.strokeColor = new Color('#ae8b69');
    exitGraphics.lineWidth = 2;
    exitGraphics.roundRect(-44, -22, 88, 44, 12);
    exitGraphics.fill();
    exitGraphics.stroke();
    const exitLabel = this.makeLabel('ExitGameLabel', 19, new Color('#735741'), this.exitButton);
    exitLabel.string = '退出';
    exitLabel.node.getComponent(UITransform)!.setContentSize(76, 38);
    this.exitButton.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      event.propagationStopped = true;
      this.leaveRoom();
    });
    this.exitButton.active = false;
  }

  private makeNode(name: string, layer: number, parent?: Node): Node {
    const node = new Node(name);
    node.layer = layer;
    if (parent) node.setParent(parent);
    return node;
  }

  private makeLabel(name: string, fontSize: number, color: Color, parent: Node): Label {
    const node = this.makeNode(name, Layers.Enum.UI_2D, parent);
    node.addComponent(UITransform).setContentSize(900, 72);
    const label = node.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.35);
    label.color = color;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    return label;
  }

  private layoutUi(): void {
    const size = view.getVisibleSize();
    const safe = this.uiRect();
    if (
      size.width === this.lastViewSize.width && size.height === this.lastViewSize.height &&
      safe.x === this.lastViewSize.safeX && safe.y === this.lastViewSize.safeY &&
      safe.width === this.lastViewSize.safeWidth && safe.height === this.lastViewSize.safeHeight
    ) return;
    this.lastViewSize = {
      width: size.width, height: size.height,
      safeX: safe.x, safeY: safe.y, safeWidth: safe.width, safeHeight: safe.height,
    };
    this.uiCamera.orthoHeight = size.height / 2;
    this.uiRoot.setPosition(safe.x + safe.width / 2 - size.width / 2, safe.y + safe.height / 2 - size.height / 2);
    this.statusLabel.node.setPosition(-safe.width / 2 + 200, safe.height / 2 - 38);
    this.statusLabel.node.getComponent(UITransform)!.setContentSize(380, 44);
    this.managerLabel.node.setPosition(-safe.width / 2 + 220, safe.height / 2 - 72);
    this.managerLabel.node.getComponent(UITransform)!.setContentSize(420, 38);
    this.teamLabel.node.setPosition(0, safe.height / 2 - 113);
    this.teamLabel.node.getComponent(UITransform)!.setContentSize(safe.width - 24, 42);
    this.noticeLabel.node.setPosition(0, -safe.height / 2 + 28);
    this.noticeLabel.node.getComponent(UITransform)!.setContentSize(Math.min(safe.width - 24, 680), 42);
    this.announcementLabel.node.setPosition(0, safe.height / 2 - 175);
    this.announcementLabel.node.getComponent(UITransform)!.setContentSize(Math.min(safe.width - 24, 760), 86);
    this.walletLabel.node.setPosition(safe.width / 2 - 230, safe.height / 2 - 38);
    this.walletLabel.node.getComponent(UITransform)!.setContentSize(280, 44);
    this.exitButton.setPosition(safe.width / 2 - 52, safe.height / 2 - 38);
    this.titleLabel.node.setPosition(0, 80);
    this.flow.layout(new Size(safe.width, safe.height));
    this.actionPanel.relayout(new Size(safe.width, safe.height));
    this.joystick.layout(new Size(safe.width, safe.height));
  }

  private uiRect(): Rect {
    const size = view.getVisibleSize();
    if (sys.isMobile && !sys.isBrowser) {
      try {
        const safe = sys.getSafeAreaRect(false);
        if (
          Number.isFinite(safe.x) && Number.isFinite(safe.y) &&
          Number.isFinite(safe.width) && Number.isFinite(safe.height) &&
          safe.width > size.width / 2 && safe.height > size.height / 2
        ) return safe;
      } catch {
        // Some embedded browsers do not expose safe-area insets.
      }
    }
    return new Rect(0, 0, size.width, size.height);
  }

  private updateMenu(): void {
    const menu = !this.state;
    const phase = this.state?.phase;
    const playing = phase === 'preparing' || phase === 'running';
    const loading = playing && !this.worldReady;
    this.titleLabel.node.active = loading;
    this.walletLabel.node.active = playing && !loading;
    this.managerLabel.node.active = playing && !loading;
    this.teamLabel.node.active = playing && !loading;
    this.noticeLabel.node.active = playing && !loading;
    this.exitButton.active = playing && !loading;
    this.flow.present(this.state, this.connection?.isConnected() ?? false, this.serverReady);
    this.joystick.setVisible(
      !loading && playing && !!this.state &&
      this.state.players[this.state.you].alive,
    );
    if (menu) this.announcementLabel.node.active = false;
  }

  private createRoom(capacity: number, mapId: string, name: string, character: CharacterSelection): void {
    if (!this.serverReady || this.state) return;
    if (this.connection.send({ type: 'create', capacity, name, mapId, character })) {
      this.serverReady = false;
      this.updateMenu();
    } else this.flow.setError('连接尚未就绪，请稍后再试');
  }

  private joinRoom(code: string, name: string, character: CharacterSelection): void {
    if (!this.serverReady || this.state) return;
    if (this.connection.send({ type: 'join', code, name, character })) {
      this.serverReady = false;
      this.updateMenu();
    } else this.flow.setError('连接尚未就绪，请稍后再试');
  }

  private sendFlow(message: Parameters<GameConnection['send']>[0]): void {
    if (!this.connection.send(message)) this.flow.setError('连接尚未就绪，请稍后再试');
  }

  private sendLobbyCommand(message: Parameters<GameConnection['send']>[0]): void {
    if (!this.worldReady) {
      this.flow.setError('街区资源还在加载，请稍候');
      return;
    }
    this.sendFlow(message);
  }

  private leaveRoom(): void {
    this.joystick.cancel();
    this.sendFlow({ type: 'leave' });
  }

  private clearSession(message: string): void {
    this.cameraTouchId = null;
    this.cameraDragging = false;
    this.cameraFollow.endDrag();
    this.state = null;
    this.mapSeed = -1;
    ++this.themeGeneration;
    this.worldReady = false;
    this.startSentForSeed = -1;
    this.selectedCell = -1;
    this.actors.clear();
    this.objects.clear();
    this.managerActor = null;
    this.clearNode(this.actorRoot);
    this.clearNode(this.objectRoot);
    this.clearNode(this.terrainRoot);
    this.clearNode(this.backgroundRoot);
    this.worldRoot.active = false;
    this.actionPanel.hide();
    this.serverReady = this.connection.isConnected();
    this.setStatus(message);
    this.updateMenu();
  }

  private acceptState(state: GameState): void {
    const now = performance.now();
    const previous = this.state;
    this.state = state;
    if (previous?.code === state.code && state.monster.level > previous.monster.level) {
      const message = state.monster.levelUps.find((entry) => entry.level === state.monster.level);
      this.announcementLabel.string = message?.text ?? `店长生气了！升至 ${state.monster.level} 级`;
      this.announcementLabel.node.active = true;
      this.announcementUntil = now + 3200;
    }
    for (const player of state.players) {
      let actor = this.actors.get(player.id);
      if (!actor) actor = this.createActor(player);
      this.ensureActorArt(actor, player);
      actor.track.push(state.tick, now, { x: player.x, y: player.y, path: player.path });
    }
    if (!this.managerActor) {
      this.managerActor = this.createManagerActor();
      this.loadActorArt(this.managerActor, { character: 'shop_manager', skin: 'original' });
    }
    this.managerActor.track.push(state.tick, now, {
      x: state.monster.x,
      y: state.monster.y,
      path: state.monster.path,
    });

    const mapChanged = state.map.seed !== this.mapSeed;
    if (mapChanged) {
      this.cameraTouchId = null;
      this.cameraDragging = false;
      this.mapSeed = state.map.seed;
      this.worldReady = false;
      this.worldRoot.active = false;
      this.fallbackGraphics.clear();
      this.overlayGraphics.clear();
      this.clearNode(this.backgroundRoot);
      this.clearNode(this.terrainRoot);
      this.worldCamera.clearColor = new Color('#c6d4bf');
      const own = state.players[state.you];
      this.cameraFollow.reset(state.map, { x: own.x, y: own.y });
    }
    this.syncWorldObjects(state);
    if (mapChanged) void this.loadPresentation(state);
    this.startLobbyWhenReady();
    if (state.phase === 'won' || state.phase === 'lost' || state.phase === 'lobby') {
      this.closeActionPanel(state.map);
    } else if (this.actionPanel.active) {
      const safe = this.uiRect();
      this.actionPanel.refresh(state, new Size(safe.width, safe.height));
    }
    this.updateHud(state);
    this.updateMenu();
    this.setStatus(this.statusText(state));
  }

  private updateHud(state: GameState): void {
    const me = state.players[state.you];
    this.walletLabel.string = state.catalog.currencies
      .map((currency) => `${currency.symbol} ${Math.floor(me.wallet[currency.id] ?? 0)}`)
      .join('    ');
    this.managerLabel.string = `店长 Lv.${state.monster.level}  生命 ${Math.ceil(state.monster.hp)} / ${state.monster.maxHp}  怒气 ${Math.floor(state.monster.rage)} / ${state.monster.nextRage}`;
    this.teamLabel.string = state.players.map((player) =>
      `${player.alive ? '●' : '×'}${player.id === state.you ? '你' : player.name}${player.bot ? '·AI' : ''}`,
    ).join('   ');
    const attack = state.players[state.monster.attackingPlayer];
    this.noticeLabel.string = attack && state.monster.state === 'attacking'
      ? `店长正在敲 ${attack.name} 的店门` : state.notices[0]?.text ?? '';
  }

  private statusText(state: GameState): string {
    if (!this.worldReady) return '正在加载本局美术资源…';
    if (state.phase === 'lobby') return `房间 ${state.code} · 等待队友准备`;
    if (state.phase === 'preparing') return `夜间占店 · 准备时间 ${Math.max(0, Math.ceil(state.preparation - state.elapsed))} 秒`;
    if (state.phase === 'running') return `白天守店 · ${Math.max(0, Math.ceil(state.preparation + state.duration - state.elapsed))} 秒`;
    return state.phase === 'won' ? '猫猫守住了店铺！' : '本局结束';
  }

  private drawFallbackMap(map: GridMap): void {
    this.clearNode(this.backgroundRoot);
    this.clearNode(this.terrainRoot);
    const graphics = this.fallbackGraphics;
    const tile = map.tileSize;
    const width = map.width * tile;
    const height = map.height * tile;
    graphics.clear();
    graphics.fillColor = new Color('#b7c7b0');
    graphics.fillRect(-width / 2 - tile * 4, -height / 2 - tile * 4, width + tile * 8, height + tile * 8);
    for (let row = 0; row < map.height; row += 1) {
      for (let column = 0; column < map.width; column += 1) {
        const value = map.rows[row][column];
        const x = column * tile - width / 2;
        const y = height / 2 - (row + 1) * tile;
        graphics.fillColor = this.tileColor(value);
        graphics.fillRect(x, y, tile, tile);
        if (value === '#') {
          graphics.fillColor = new Color('#87977e');
          graphics.fillRect(x, y, tile, Math.max(3, tile * 0.14));
        }
      }
    }
    this.gridColor = '#6d65432e';
    this.gridLineWidth = 0.65;
    this.drawGridOverlay(map);
  }

  private async loadPresentation(initialState: GameState): Promise<void> {
    const map = initialState.map;
    const generation = ++this.themeGeneration;
    const theme = this.art.theme(map.theme);
    const resources: Promise<unknown>[] = [theme];
    for (const player of initialState.players) resources.push(this.art.character(player.character));
    resources.push(this.art.character({ character: 'shop_manager', skin: 'original' }));
    const itemAppearances = new Set<string>(['nest']);
    const doorKeys = new Set<string>();
    for (const room of initialState.dorms) {
      for (const prop of room.props) itemAppearances.add(prop.appearance);
      const state = this.doorVisualState(room);
      const key = `${room.doorAppearance}:${state}`;
      if (!doorKeys.has(key)) {
        doorKeys.add(key);
        resources.push(this.art.door(room.doorAppearance, state));
      }
    }
    for (const appearance of itemAppearances) resources.push(this.art.item(appearance));
    await Promise.all(resources.map((resource) => resource.catch(() => undefined)));
    if (generation !== this.themeGeneration || this.mapSeed !== map.seed) return;
    try {
      this.renderTheme(map, await theme);
    } catch (error) {
      console.warn('正式地图资源加载失败，继续使用调试地图。', error);
      this.drawFallbackMap(map);
    }
    this.worldReady = true;
    this.worldRoot.active = true;
    this.updateMenu();
    if (this.state) this.setStatus(this.statusText(this.state));
    this.startLobbyWhenReady();
  }

  private startLobbyWhenReady(): void {
    const state = this.state;
    if (!this.worldReady || !state || state.phase !== 'lobby' || state.capacity !== 1 ||
        this.startSentForSeed === state.map.seed) return;
    if (this.connection.send({ type: 'start', mapSeed: state.map.seed })) this.startSentForSeed = state.map.seed;
  }

  private renderTheme(map: GridMap, theme: ThemeArt): void {
    this.clearNode(this.backgroundRoot);
    this.clearNode(this.terrainRoot);
    const tile = map.tileSize;
    const width = map.width * tile;
    const height = map.height * tile;
    const margin = theme.outsideTiles * tile;
    const background = this.createSprite('ThemeBackground', this.backgroundRoot, theme.background, width + margin * 2, height + margin * 2);
    background.node.setPosition(0, 0, 0);
    // Terrain cells never overlap, so keep sprites using the same texture adjacent for batching.
    const batches = new Map<Sprite['spriteFrame'], number[]>();
    for (let row = 0; row < map.height; row += 1) {
      for (let column = 0; column < map.width; column += 1) {
        const cell = row * map.width + column;
        const room = roomAt(map, cell);
        const frame = map.rows[row][column] === '#' ? theme.wall : room >= 0 ? theme.floors[(map.seed + room) % theme.floors.length] : theme.road;
        let cells = batches.get(frame);
        if (!cells) batches.set(frame, (cells = []));
        cells.push(cell);
      }
    }
    for (const [frame, cells] of batches) {
      for (const cell of cells) {
        const column = cell % map.width;
        const row = Math.floor(cell / map.width);
        const sprite = this.createSprite(`Tile-${cell}`, this.terrainRoot, frame, tile, tile);
        sprite.node.setPosition(column * tile + tile / 2 - width / 2, height / 2 - row * tile - tile / 2, 0);
      }
    }
    this.worldCamera.clearColor = new Color(theme.clearColor);
    this.fallbackGraphics.clear();
    this.gridColor = theme.gridColor;
    this.gridLineWidth = theme.gridLineWidth;
    this.drawGridOverlay(map);
  }

  private drawGridOverlay(map: GridMap): void {
    const graphics = this.overlayGraphics;
    graphics.clear();
    if (this.gridLineWidth <= 0) return;
    const width = map.width * map.tileSize;
    const height = map.height * map.tileSize;
    graphics.strokeColor = new Color(this.gridColor);
    graphics.lineWidth = this.gridLineWidth;
    for (let column = 0; column <= map.width; column += 1) {
      const x = column * map.tileSize - width / 2;
      graphics.moveTo(x, -height / 2);
      graphics.lineTo(x, height / 2);
    }
    for (let row = 0; row <= map.height; row += 1) {
      const y = row * map.tileSize - height / 2;
      graphics.moveTo(-width / 2, y);
      graphics.lineTo(width / 2, y);
    }
    graphics.stroke();
    if (this.selectedCell >= 0) {
      const position = this.worldCell(map, this.selectedCell);
      graphics.strokeColor = new Color('#f2b65d');
      graphics.lineWidth = 3;
      graphics.rect(position.x - map.tileSize / 2 + 2, position.y - map.tileSize / 2 + 2, map.tileSize - 4, map.tileSize - 4);
      graphics.stroke();
    }
  }

  private tileColor(value: string): Color {
    if (value === '#') return new Color('#e5e8cd');
    if (value === '.') return new Color('#c2cdb9');
    const room = '0123456789ABCDEF'.indexOf(value);
    if (room >= 0) return new Color(ROOM_COLORS[room % ROOM_COLORS.length]);
    if (value >= 'a' && value <= 'p') return new Color('#ead9b9');
    return new Color('#c2cdb9');
  }

  private createActor(player: PlayerState): ActorView {
    const actor = this.createActorView(`Cat-${player.id}`);
    this.drawFallbackActor(actor.graphics, player.id === this.state?.players[this.state.you]?.id, player.bot);
    this.actors.set(player.id, actor);
    return actor;
  }

  private createManagerActor(): ActorView {
    const actor = this.createActorView('ShopManager');
    actor.node.active = false;
    const graphics = actor.graphics;
    graphics.fillColor = new Color('#c68765');
    graphics.roundRect(-12, -16, 24, 32, 5);
    graphics.fill();
    return actor;
  }

  private createActorView(name: string): ActorView {
    const node = this.makeNode(name, WORLD_LAYER, this.actorRoot);
    const graphics = node.addComponent(Graphics);
    const visualNode = this.makeNode(`${name}-Art`, WORLD_LAYER, node);
    const sprite = visualNode.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.enabled = false;
    return {
      node,
      visualNode,
      sprite,
      graphics,
      track: new MotionTrack(),
      art: null,
      selectionKey: '',
      action: '',
      actionAt: 0,
      lastPose: null,
      lastSleeping: false,
      wakeAt: -Infinity,
      lastMotionAt: -Infinity,
      lastDirection: 'down',
    };
  }

  private drawFallbackActor(graphics: Graphics, own: boolean, bot: boolean): void {
    graphics.clear();
    graphics.fillColor = new Color(own ? '#ffb868' : bot ? '#b19ad4' : '#94a9c6');
    graphics.circle(0, 4, 13);
    graphics.fill();
    graphics.moveTo(-10, 13);
    graphics.lineTo(-5, 24);
    graphics.lineTo(0, 14);
    graphics.close();
    graphics.moveTo(2, 14);
    graphics.lineTo(8, 24);
    graphics.lineTo(12, 12);
    graphics.close();
    graphics.fill();
    graphics.strokeColor = new Color('#684c3e');
    graphics.lineWidth = 2;
    graphics.circle(-4, 6, 1.2);
    graphics.circle(4, 6, 1.2);
    graphics.stroke();
  }

  private ensureActorArt(actor: ActorView, player: PlayerState): void {
    const key = `${player.character.character}:${player.character.skin}`;
    if (actor.selectionKey === key) return;
    this.loadActorArt(actor, player.character);
  }

  private loadActorArt(actor: ActorView, selection: PlayerState['character']): void {
    const key = `${selection.character}:${selection.skin}`;
    actor.selectionKey = key;
    void this.art
      .character(selection)
      .then((art) => {
        if (!actor.node.isValid || actor.selectionKey !== key) return;
        actor.art = art;
        actor.graphics.enabled = false;
        actor.sprite.enabled = true;
        const scale = (art.profile === 'shop_manager' ? 44 : 30) / art.referenceHeight;
        const transform = actor.visualNode.getComponent(UITransform)!;
        transform.setContentSize(art.frameSize.width * scale, art.frameSize.height * scale);
        transform.setAnchorPoint(art.anchor);
      })
      .catch((error: unknown) => console.warn(`角色资源加载失败：${key}`, error));
  }

  private updateActors(state: GameState, now: number): void {
    const width = state.map.width * state.map.tileSize;
    const height = state.map.height * state.map.tileSize;
    for (const player of state.players) {
      const actor = this.actors.get(player.id);
      if (!actor) continue;
      actor.node.active = player.alive;
      if (!player.alive) continue;
      const room = player.room >= 0 ? state.dorms[player.room] : null;
      const pose = player.sleeping && room
        ? cellCenter(state.map, room.nest)
        : actor.track.sample(now, state.map);
      if (actor.lastSleeping && !player.sleeping) actor.wakeAt = now;
      const wakeDuration = this.clipDuration(actor.art?.clips.wake);
      const restBlend = player.sleeping ? 1 : wakeDuration > 0
        ? Math.max(0, 1 - (now - actor.wakeAt) / wakeDuration) : 0;
      const nestOffset = state.map.tileSize * restBlend;
      const x = pose.x - width / 2 + nestOffset * 0.02;
      const y = height / 2 - pose.y - nestOffset * 0.18;
      if (Math.abs(actor.node.position.x - x) > 0.001 || Math.abs(actor.node.position.y - y) > 0.001) {
        actor.node.setPosition(x, y, 10);
      }
      this.animateCat(actor, player, pose, now, 1 - restBlend * 0.22);
    }
    const manager = this.managerActor;
    if (!manager) return;
    manager.node.active = state.phase === 'running' && state.monster.state !== 'defeated';
    if (!manager.node.active) return;
    const pose = manager.track.sample(now, state.map);
    const managerX = pose.x - width / 2;
    const managerY = height / 2 - pose.y;
    if (Math.abs(manager.node.position.x - managerX) > 0.001 ||
        Math.abs(manager.node.position.y - managerY) > 0.001) {
      manager.node.setPosition(managerX, managerY, 12);
    }
    this.animateManager(manager, state, pose, now);
  }

  private animateCat(
    actor: ActorView,
    player: PlayerState,
    pose: { x: number; y: number },
    now: number,
    scale: number,
  ): void {
    const art = actor.art;
    if (!art) return;
    const wake = art.clips.wake;
    const waking = wake && now - actor.wakeAt < this.clipDuration(wake);
    const motion = this.stableMotion(actor, pose, now);
    const action = player.sleeping
      ? 'sleep'
      : waking
        ? 'wake'
        : motion.moving
          ? art.movementClips[motion.direction]
          : 'idle';
    this.applyActorFrame(actor, action,
      motion.direction === 'right' && art.clips[action]?.mirrorForRight === true, now, scale);
    actor.lastPose = pose;
    actor.lastSleeping = player.sleeping;
  }

  private animateManager(
    actor: ActorView,
    state: GameState,
    pose: { x: number; y: number },
    now: number,
  ): void {
    const art = actor.art;
    if (!art) return;
    const motion = this.stableMotion(actor, pose, now);
    if (state.monster.attackSequence !== this.lastManagerAttackSequence) {
      if (this.lastManagerAttackSequence >= 0) {
        actor.action = 'attack';
        actor.actionAt = now;
      }
      this.lastManagerAttackSequence = state.monster.attackSequence;
    }
    const attacking = actor.action === 'attack' && now - actor.actionAt < this.clipDuration(art.clips.attack);
    const returning = state.monster.state === 'retreating' || state.monster.state === 'defeated';
    const action = attacking
      ? 'attack'
      : motion.moving
        ? returning
          ? art.retreatClips?.[motion.direction] ?? art.movementClips[motion.direction]
          : art.movementClips[motion.direction]
        : 'idle';
    this.applyActorFrame(actor, action, false, now);
    actor.lastPose = pose;
  }

  private applyActorFrame(actor: ActorView, action: string, mirror: boolean, now: number, scale = 1): void {
    const clip = actor.art?.clips[action];
    if (!clip) return;
    if (actor.action !== action) {
      actor.action = action;
      actor.actionAt = now;
    }
    const frame = sampleClip(clip, now - actor.actionAt);
    if (actor.sprite.spriteFrame !== frame) actor.sprite.spriteFrame = frame;
    const scaleX = mirror ? -scale : scale;
    if (actor.visualNode.scale.x !== scaleX || actor.visualNode.scale.y !== scale) {
      actor.visualNode.setScale(scaleX, scale, 1);
    }
  }

  private syncWorldObjects(state: GameState): void {
    const live = new Set<string>();
    for (const room of state.dorms) {
      const nestKey = `nest:${room.id}`;
      live.add(nestKey);
      this.ensureItemObject(nestKey, 'nest', room.nest, state.map, state.map.tileSize);

      const doorKey = `door:${room.id}`;
      live.add(doorKey);
      const doorState = this.doorVisualState(room);
      this.ensureDoorObject(doorKey, room.doorAppearance, doorState, room.door, room.entrance, state.map);

      for (const prop of room.props) {
        const key = `prop:${room.id}:${prop.cell}`;
        live.add(key);
        this.ensureItemObject(key, prop.appearance, prop.cell, state.map, state.map.tileSize * 0.94);
      }
    }
    for (const [key, object] of this.objects) {
      if (live.has(key)) continue;
      object.node.destroy();
      this.objects.delete(key);
    }
  }

  private ensureItemObject(key: string, appearance: string, cell: number, map: GridMap, size: number): void {
    const object = this.ensureObject(key, cell, map, size);
    const assetKey = `item:${appearance}`;
    if (object.assetKey === assetKey) return;
    object.assetKey = assetKey;
    object.clip = null;
    void this.art
      .item(appearance)
      .then((clip) => {
        if (!object.node.isValid || object.assetKey !== assetKey) return;
        object.clip = clip;
        object.sprite.spriteFrame = clip.frames[0];
      })
      .catch((error: unknown) => console.warn(`道具资源加载失败：${appearance}`, error));
  }

  private ensureDoorObject(
    key: string,
    appearance: string,
    state: DoorVisualState,
    cell: number,
    entrance: number,
    map: GridMap,
  ): void {
    const object = this.ensureObject(key, cell, map, map.tileSize * 1.34);
    const horizontal = Math.abs(cell - entrance) === map.width;
    object.node.setRotationFromEuler(0, 0, horizontal ? 0 : 90);
    const assetKey = `door:${appearance}:${state}`;
    if (object.assetKey === assetKey) return;
    object.assetKey = assetKey;
    object.clip = null;
    void this.art
      .door(appearance, state)
      .then((frame) => {
        if (!object.node.isValid || object.assetKey !== assetKey) return;
        object.sprite.spriteFrame = frame;
      })
      .catch((error: unknown) => console.warn(`店门资源加载失败：${appearance}/${state}`, error));
  }

  private doorVisualState(room: GameState['dorms'][number]): DoorVisualState {
    if (room.hp <= 0) return 'damaged_2';
    if (!room.closed) return 'open';
    if (room.hp < room.maxHp / 3) return 'damaged_2';
    return room.hp < (room.maxHp * 2) / 3 ? 'damaged_1' : 'closed';
  }

  private ensureObject(key: string, cell: number, map: GridMap, size: number): WorldObjectView {
    let object = this.objects.get(key);
    if (!object) {
      const node = this.makeNode(key, WORLD_LAYER, this.objectRoot);
      const sprite = node.addComponent(Sprite);
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      object = { node, sprite, clip: null, assetKey: '', actionAt: performance.now() };
      this.objects.set(key, object);
    }
    const position = this.worldCell(map, cell);
    object.node.setPosition(position.x, position.y, 5);
    object.node.getComponent(UITransform)!.setContentSize(size, size);
    return object;
  }

  private updateWorldObjects(now: number): void {
    for (const object of this.objects.values()) {
      if (object.clip && object.clip.frames.length > 1) {
        const frame = sampleClip(object.clip, now - object.actionAt);
        if (object.sprite.spriteFrame !== frame) object.sprite.spriteFrame = frame;
      }
    }
  }

  private handleCameraTouchStart(event: EventTouch): void {
    const state = this.state;
    if (this.cameraTouchId !== null || !this.worldReady || this.flow.visible || !state ||
        (state.phase !== 'preparing' && state.phase !== 'running') ||
        this.joystick.contains(event) || this.isExitButtonTouch(event)) return;
    const location = event.getLocation();
    const uiPoint = this.uiCamera.screenToWorld(new Vec3(location.x, location.y, 0));
    if (this.actionPanel.contains(uiPoint)) return;
    this.cameraTouchId = event.getID() ?? -1;
    this.cameraTouchStart = { x: location.x, y: location.y };
    this.cameraTouchLast = { x: location.x, y: location.y };
    this.cameraDragging = false;
  }

  private handleCameraTouchMove(event: EventTouch): void {
    if (this.cameraTouchId === null || (event.getID() ?? -1) !== this.cameraTouchId) return;
    const location = event.getLocation();
    if (!this.cameraDragging && Math.hypot(
      location.x - this.cameraTouchStart.x,
      location.y - this.cameraTouchStart.y,
    ) >= 9) {
      this.cameraDragging = true;
      this.cameraFollow.beginDrag();
      if (this.state && this.actionPanel.active) this.closeActionPanel(this.state.map);
    }
    if (this.cameraDragging) this.cameraFollow.dragBy(this.cameraTouchLast, location);
    this.cameraTouchLast = { x: location.x, y: location.y };
  }

  private handleCameraTouchCancel(event: EventTouch): void {
    this.finishCameraTouch(event);
  }

  private finishCameraTouch(event: EventTouch): boolean {
    if (this.cameraTouchId === null || (event.getID() ?? -1) !== this.cameraTouchId) return false;
    const dragged = this.cameraDragging;
    this.cameraTouchId = null;
    this.cameraDragging = false;
    if (dragged) this.cameraFollow.endDrag();
    return dragged;
  }

  private isExitButtonTouch(event: EventTouch): boolean {
    if (!this.exitButton.active) return false;
    const location = event.getLocation();
    const point = this.uiCamera.screenToWorld(new Vec3(location.x, location.y, 0));
    const center = this.exitButton.worldPosition;
    return Math.abs(point.x - center.x) <= 44 && Math.abs(point.y - center.y) <= 22;
  }

  private handleTouchEnd(event: EventTouch): void {
    if (this.finishCameraTouch(event)) return;
    if (!this.worldReady || this.flow.visible) return;
    if (this.joystick.consumes(event) || this.isExitButtonTouch(event)) return;
    const location = event.getLocation();
    const uiPoint = this.uiCamera.screenToWorld(new Vec3(location.x, location.y, 0));
    if (this.actionPanel.contains(uiPoint)) return;
    if (!this.state) return;
    const state = this.state;
    if (state.phase !== 'preparing' && state.phase !== 'running') return;
    const world = this.worldCamera.screenToWorld(new Vec3(location.x, location.y, 0));
    const x = world.x + (state.map.width * state.map.tileSize) / 2;
    const y = (state.map.height * state.map.tileSize) / 2 - world.y;
    const cell = cellFromWorld(state.map, x, y);
    if (cell < 0 || state.map.rows[Math.floor(cell / state.map.width)]?.[cell % state.map.width] === '#') {
      this.closeActionPanel(state.map);
      return;
    }
    const me = state.players[state.you];
    const roomId = roomAt(state.map, cell);
    const room = roomId >= 0 ? state.dorms[roomId] : null;
    const isSpecialCell = !!room && (cell === room.nest || cell === room.door || room.props.some((prop) => prop.cell === cell));
    if (!me.escaping && room && cell === room.nest &&
        (room.owner < 0 || room.owner === state.you) && !me.sleeping) {
      this.sendGridAction('nest', room.id, cell, '');
      return;
    }
    if (!me.escaping && room && (room.owner === state.you || isSpecialCell)) {
      if (this.actionPanel.active && this.selectedCell === cell && !isSpecialCell) {
        this.closeActionPanel(state.map);
        return;
      }
      this.selectedCell = cell;
      this.drawGridOverlay(state.map);
      const safe = this.uiRect();
      this.actionPanel.show(state, cell, new Size(safe.width, safe.height));
      return;
    }
    this.closeActionPanel(state.map);
  }

  private updateJoystick(now: number): void {
    const state = this.state;
    if (!state || !this.worldReady || !this.joystick.pressed ||
        (state.phase !== 'preparing' && state.phase !== 'running') || !state.players[state.you].alive) return;
    const direction = this.joystick.direction;
    if (direction.x === 0 && direction.y === 0) {
      this.stopJoystick();
      return;
    }
    const sector = Math.round(Math.atan2(-direction.y, direction.x) / (Math.PI / 4));
    const dx = Math.round(Math.cos(sector * Math.PI / 4) * 100);
    const dy = Math.round(Math.sin(sector * Math.PI / 4) * 100);
    const changed = dx !== this.lastSteerX || dy !== this.lastSteerY;
    if (now - this.lastSteerAt < (changed ? 70 : 280)) return;
    if (this.sendSteer(dx, dy)) {
      this.lastSteerX = dx;
      this.lastSteerY = dy;
      this.lastSteerAt = now;
    }
  }

  private stopJoystick(): void {
    if (this.lastSteerX === 0 && this.lastSteerY === 0) return;
    if (this.sendSteer(0, 0)) {
      this.lastSteerX = 0;
      this.lastSteerY = 0;
      this.lastSteerAt = performance.now();
    }
  }

  private sendSteer(dx: number, dy: number): boolean {
    const sequence = this.sequence + 1;
    if (!this.connection.send({ type: 'action', action: 'steer', dx, dy, seq: sequence })) return false;
    this.sequence = sequence;
    return true;
  }

  private sendGridAction(action: GridAction, room: number, cell: number, kind: string): void {
    const state = this.state;
    if (!state || state.players[state.you].escaping) return;
    this.joystick.cancel();
    const sequence = this.sequence + 1;
    if (!this.connection.send({
      type: 'action',
      action,
      room,
      cell,
      kind,
      seq: sequence,
    })) {
      this.setStatus('连接暂时中断，请稍后重试');
      return;
    }
    this.sequence = sequence;
    this.closeActionPanel(state.map);
  }

  private closeActionPanel(map: GridMap): void {
    this.actionPanel.hide();
    this.selectedCell = -1;
    this.drawGridOverlay(map);
  }

  private createSprite(name: string, parent: Node, frame: Sprite['spriteFrame'], width: number, height: number): Sprite {
    const node = this.makeNode(name, WORLD_LAYER, parent);
    node.addComponent(UITransform).setContentSize(width, height);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frame;
    return sprite;
  }

  private clearNode(node: Node): void {
    for (const child of [...node.children]) child.destroy();
  }

  private worldCell(map: GridMap, cell: number): { x: number; y: number } {
    const center = cellCenter(map, cell);
    return {
      x: center.x - (map.width * map.tileSize) / 2,
      y: (map.height * map.tileSize) / 2 - center.y,
    };
  }

  private motion(previous: { x: number; y: number } | null, current: { x: number; y: number }) {
    if (!previous) return { x: 0, y: 0, moving: false };
    const x = current.x - previous.x;
    const y = current.y - previous.y;
    return { x, y, moving: x * x + y * y > 0.01 };
  }

  private stableMotion(actor: ActorView, pose: { x: number; y: number }, now: number) {
    const delta = this.motion(actor.lastPose, pose);
    if (delta.moving) {
      actor.lastMotionAt = now;
      actor.lastDirection = this.direction(delta.x, delta.y);
    }
    return { moving: now - actor.lastMotionAt < 160, direction: actor.lastDirection };
  }

  private direction(dx: number, dy: number): Direction {
    if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'down' : 'up';
  }

  private clipDuration(clip?: AnimationClip): number {
    return clip?.durationsMs.reduce((sum, value) => sum + value, 0) ?? 0;
  }

  private setStatus(message: string): void {
    this.statusLabel.string = message;
  }
}
