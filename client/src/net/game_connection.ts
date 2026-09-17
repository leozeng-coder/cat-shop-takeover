import type { State, Catalog } from '../types';

export type ClientMessage =
  | { type: 'create'; capacity: number; name: string }
  | { type: 'join'; code: string; name: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' | 'leave' | 'rematch' }
  | {
      type: 'action';
      action: 'move' | 'nest' | 'bed' | 'door' | 'build' | 'repair';
      room: number;
      cell: number;
      kind: string;
      seq: number;
    };

interface ConnectionCallbacks {
  onState: (state: State) => void;
  onJoined: (lastSequence: number) => void;
  onStatus: (connected: boolean) => void;
  onError: (message: string) => void;
  onExpired: () => void;
  onLeft: () => void;
}

// The connection owns transport, retry timers and the private resumption token.
// UI and rendering receive snapshots; they never mutate server-owned game state.
export class GameConnection {
  private catalog: Catalog | null = null;
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer = 0;
  private heartbeatTimer = 0;
  private disposed = false;
  private readonly storageKey = 'snack-shop-session-v2';

  constructor(private readonly callbacks: ConnectionCallbacks) {}

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(message: ClientMessage): boolean {
    if (!this.isConnected()) return false;
    this.socket!.send(JSON.stringify(message));
    return true;
  }

  forgetSession(): void {
    sessionStorage.removeItem(this.storageKey);
  }

  connect(): void {
    window.clearTimeout(this.reconnectTimer);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(protocol + '//' + location.host + '/ws');
    this.socket = socket;

    socket.onopen = () => {
      if (socket !== this.socket || this.disposed) return;
      this.reconnectAttempts = 0;
      this.catalog = null;
      this.callbacks.onStatus(true);
      const token = sessionStorage.getItem(this.storageKey);
      if (token) socket.send(JSON.stringify({ type: 'resume', token }));
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, 10000);
    };

    socket.onmessage = (event) => {
      if (socket !== this.socket || this.disposed) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      switch (message.type) {
        case 'joined':
          sessionStorage.setItem(this.storageKey, message.token);
          this.callbacks.onJoined(message.lastSequence ?? 0);
          break;
        case 'config':
          this.catalog = message as Catalog;
          break;
        case 'state':
          if (this.catalog?.version !== message.configVersion) return;
          this.callbacks.onState({ ...message, catalog: this.catalog } as State);
          break;
        case 'error':
          this.callbacks.onError(String(message.message));
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
      window.clearInterval(this.heartbeatTimer);
      this.callbacks.onStatus(false);
      const delay = Math.min(500 * 2 ** ++this.reconnectAttempts, 6000);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.heartbeatTimer);
    this.socket?.close();
  }
}
