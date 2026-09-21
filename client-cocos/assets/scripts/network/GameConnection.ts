import { sys } from 'cc';
import type { Catalog, CharacterOption, GameState, MapOption } from '../model/GameTypes';
import { COMMANDS, decodeMessage, encodeRequest, type ClientMessage } from './GameProtocol';
import { StateStream } from './StateStream';

export interface ConnectionCallbacks {
  onReady: () => void;
  onMaps: (maps: MapOption[]) => void;
  onCharacters: (characters: CharacterOption[]) => void;
  onState: (state: GameState) => void;
  onJoined: (lastSequence: number) => void;
  onStatus: (connected: boolean) => void;
  onError: (message: string) => void;
  onExpired: () => void;
  onLeft: () => void;
}

interface PendingRequest {
  command: number;
  sent: number;
}

export class GameConnection {
  private readonly stream = new StateStream();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly storageKey = 'cat-shop-cocos-session-v2';
  private socket: WebSocket | null = null;
  private catalog: Catalog | null = null;
  private ready = false;
  private disposed = false;
  private requestId = 0;
  private lastReceived = 0;
  private lastPing = 0;
  private reconnectAttempts = 0;
  private reconnectAt = 0;
  private resyncPending = false;

  constructor(
    private readonly url: string,
    private readonly callbacks: ConnectionCallbacks,
  ) {}

  connect(): void {
    if (this.disposed || this.socket) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.ready = false;
    socket.onopen = () => this.handleOpen(socket);
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onerror = () => undefined;
    socket.onclose = () => this.handleClose(socket);
  }

  isConnected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  update(now: number): void {
    if (this.disposed) return;
    if (!this.socket && now >= this.reconnectAt) this.connect();
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
    if (now - this.lastReceived >= 30_000 || [...this.pending.values()].some((item) => now - item.sent >= 15_000)) {
      this.socket.close();
      return;
    }
    if (now - this.lastPing >= 10_000 && this.send({ type: 'ping' })) this.lastPing = now;
  }

  send(message: ClientMessage): boolean {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > 256 * 1024 || this.pending.size >= 128) return false;
    this.requestId = (this.requestId % 0xffffffff) + 1;
    this.pending.set(this.requestId, { command: COMMANDS[message.type], sent: performance.now() });
    this.socket.send(encodeRequest(message, this.requestId));
    return true;
  }

  forgetSession(): void {
    sys.localStorage.removeItem(this.storageKey);
    this.stream.reset();
    this.resyncPending = false;
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.pending.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private handleOpen(socket: WebSocket): void {
    if (socket !== this.socket || this.disposed) return;
    const now = performance.now();
    this.catalog = null;
    this.stream.reset();
    this.pending.clear();
    this.resyncPending = false;
    this.lastReceived = now;
    this.lastPing = now;
  }

  private handleMessage(socket: WebSocket, raw: unknown): void {
    if (socket !== this.socket || this.disposed) return;
    let message;
    try {
      if (typeof raw !== 'string') throw new Error('Unsupported frame');
      message = decodeMessage(raw);
    } catch {
      this.callbacks.onError('网络协议不匹配');
      socket.close();
      return;
    }
    this.lastReceived = performance.now();
    if (message.type === 'reply') {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.command !== message.command) return;
      this.pending.delete(message.requestId);
      if (message.code !== 0) {
        this.callbacks.onError(message.message);
        if (message.command === COMMANDS.resync) socket.close();
      }
      return;
    }

    const body = message.body;
    switch (message.type) {
      case 'hello': {
        this.ready = true;
        this.reconnectAttempts = 0;
        this.callbacks.onStatus(true);
        this.send({ type: 'maps' });
        this.send({ type: 'characters' });
        const token = sys.localStorage.getItem(this.storageKey);
        if (token) this.send({ type: 'resume', token });
        else this.callbacks.onReady();
        break;
      }
      case 'joined':
        this.stream.reset();
        this.resyncPending = false;
        sys.localStorage.setItem(this.storageKey, String(body.token));
        this.callbacks.onJoined(Number(body.lastSequence ?? 0));
        break;
      case 'config':
        this.catalog = body as unknown as Catalog;
        break;
      case 'maps':
        if (Array.isArray(body.maps)) this.callbacks.onMaps(body.maps as MapOption[]);
        break;
      case 'characters':
        if (Array.isArray(body.characters)) this.callbacks.onCharacters(body.characters as CharacterOption[]);
        break;
      case 'snapshot':
      case 'delta': {
        if (this.resyncPending && message.type === 'delta') return;
        try {
          const state = this.stream.apply(body, message.type === 'snapshot', this.catalog);
          if (state) {
            this.resyncPending = false;
            this.callbacks.onState(state);
          }
        } catch {
          if (!this.resyncPending) this.resyncPending = this.send({ type: 'resync' });
          if (!this.resyncPending || message.type === 'snapshot') socket.close();
        }
        break;
      }
      case 'error':
        this.callbacks.onError(String(body.message ?? '服务器拒绝了本次操作'));
        break;
      case 'expired':
        this.forgetSession();
        this.callbacks.onExpired();
        break;
      case 'left':
        this.forgetSession();
        this.callbacks.onLeft();
        break;
      default:
        break;
    }
  }

  private handleClose(socket: WebSocket): void {
    if (socket !== this.socket || this.disposed) return;
    this.socket = null;
    this.ready = false;
    this.pending.clear();
    this.callbacks.onStatus(false);
    const delay = Math.min(500 * 2 ** ++this.reconnectAttempts, 6000);
    this.reconnectAt = performance.now() + delay;
  }
}
