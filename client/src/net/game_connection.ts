import type { State, Catalog } from '../types';
import { COMMANDS, decodeMessage, encodeRequest, type ClientMessage } from './game_protocol';
import { StateStream } from './state_stream';
export type { ClientMessage } from './game_protocol';

interface ConnectionCallbacks {
  onState: (state: State) => void;
  onJoined: (lastSequence: number) => void;
  onStatus: (connected: boolean) => void;
  onError: (message: string) => void;
  onExpired: () => void;
  onLeft: () => void;
}

// Transport owns connection health and request lifetimes; StateStream owns replication.
export class GameConnection {
  private catalog: Catalog | null = null;
  private readonly stream = new StateStream();
  private socket: WebSocket | null = null;
  private ready = false;
  private reconnectAttempts = 0;
  private reconnectTimer = 0;
  private heartbeatTimer = 0;
  private disposed = false;
  private requestId = 0;
  private lastReceived = 0;
  private lastPing = 0;
  private resyncPending = false;
  private readonly pending = new Map<number, { command: number; sent: number }>();
  private readonly storageKey = 'snack-shop-session-v2';

  constructor(private readonly callbacks: ConnectionCallbacks) {}

  isConnected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  send(message: ClientMessage): boolean {
    if (!this.isConnected() || this.socket!.bufferedAmount > 256 * 1024 || this.pending.size >= 128)
      return false;
    this.requestId = (this.requestId % 0xffffffff) + 1;
    const id = this.requestId;
    this.pending.set(id, { command: COMMANDS[message.type], sent: performance.now() });
    this.socket!.send(encodeRequest(message, id));
    return true;
  }

  forgetSession(): void {
    sessionStorage.removeItem(this.storageKey);
    this.stream.reset();
    this.resyncPending = false;
  }

  connect(): void {
    if (this.disposed) return;
    window.clearTimeout(this.reconnectTimer);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(protocol + '//' + location.host + '/ws');
    this.socket = socket;
    this.ready = false;

    socket.onopen = () => {
      if (socket !== this.socket || this.disposed) return;
      this.catalog = null;
      this.stream.reset();
      this.pending.clear();
      this.resyncPending = false;
      this.lastReceived = this.lastPing = performance.now();
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => {
        if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
        const now = performance.now();
        if (
          now - this.lastReceived >= 30000 ||
          [...this.pending.values()].some((p) => now - p.sent >= 15000)
        ) {
          // Do not replay purchases after a timeout. Resume and rebase authoritative state.
          this.ready = false;
          socket.close();
          return;
        }
        if (now - this.lastPing >= 10000 && this.send({ type: 'ping' })) this.lastPing = now;
      }, 1000);
    };

    socket.onmessage = (event) => {
      if (socket !== this.socket || this.disposed) return;
      let message;
      try {
        if (typeof event.data !== 'string') throw new Error('Unsupported frame');
        message = decodeMessage(event.data);
      } catch {
        this.callbacks.onError('网络协议不匹配，请刷新页面');
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
          const token = sessionStorage.getItem(this.storageKey);
          if (token) this.send({ type: 'resume', token });
          break;
        }
        case 'joined':
          this.stream.reset();
          this.resyncPending = false;
          sessionStorage.setItem(this.storageKey, String(body.token));
          this.callbacks.onJoined(Number(body.lastSequence ?? 0));
          break;
        case 'config':
          this.catalog = body as unknown as Catalog;
          break;
        case 'snapshot':
        case 'delta': {
          if (this.resyncPending && message.type === 'delta') return;
          let next: State | null;
          try {
            next = this.stream.apply(body, message.type === 'snapshot', this.catalog);
          } catch {
            if (!this.resyncPending) {
              this.resyncPending = this.send({ type: 'resync' });
              if (!this.resyncPending) socket.close();
            } else if (message.type === 'snapshot') socket.close();
            return;
          }
          if (next) {
            this.resyncPending = false;
            this.callbacks.onState(next);
          }
          break;
        }
        case 'error':
          this.callbacks.onError(String(body.message));
          break;
        case 'expired':
          this.forgetSession();
          this.callbacks.onExpired();
          break;
        case 'left':
          this.forgetSession();
          this.callbacks.onLeft();
          break;
      }
    };

    socket.onclose = () => {
      if (socket !== this.socket || this.disposed) return;
      this.ready = false;
      this.pending.clear();
      window.clearInterval(this.heartbeatTimer);
      this.callbacks.onStatus(false);
      const delay = Math.min(500 * 2 ** ++this.reconnectAttempts, 6000);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.pending.clear();
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.heartbeatTimer);
    this.socket?.close();
  }
}
