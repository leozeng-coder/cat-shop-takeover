import type { CharacterSelection } from '../model/GameTypes';

export const PROTOCOL_VERSION = 2;

export const COMMANDS = {
  ping: 1,
  create: 2,
  join: 3,
  resume: 4,
  ready: 5,
  start: 6,
  leave: 7,
  rematch: 8,
  action: 9,
  resync: 10,
  maps: 11,
  select_map: 12,
  characters: 13,
  select_character: 14,
} as const;

const NOTIFICATIONS = [
  'hello',
  'joined',
  'config',
  'snapshot',
  'delta',
  'left',
  'expired',
  'error',
  'maps',
  'characters',
] as const;

export type ClientMessage =
  | { type: 'create'; capacity: number; name: string; mapId?: string; character?: CharacterSelection }
  | { type: 'join'; code: string; name: string; character?: CharacterSelection }
  | { type: 'resume'; token: string }
  | { type: 'ready'; ready: boolean; mapSeed?: number }
  | { type: 'start'; mapSeed?: number }
  | { type: 'select_map'; mapId: string }
  | { type: 'select_character'; character: CharacterSelection }
  | { type: 'leave' | 'rematch' | 'ping' | 'resync' | 'maps' | 'characters' }
  | {
      type: 'action';
      action: 'move' | 'nest' | 'bed' | 'door' | 'build' | 'repair';
      room: number;
      cell: number;
      kind: string;
      seq: number;
    }
  | { type: 'action'; action: 'steer'; dx: number; dy: number; seq: number };

export interface Reply {
  type: 'reply';
  command: number;
  requestId: number;
  code: number;
  message: string;
}

export interface Notification {
  type: (typeof NOTIFICATIONS)[number];
  body: Record<string, unknown>;
}

export function encodeRequest(message: ClientMessage, requestId: number): string {
  const { type, ...body } = message;
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, type) || !Number.isInteger(requestId) || requestId < 1) {
    throw new Error('Invalid request');
  }
  return JSON.stringify({ v: PROTOCOL_VERSION, kind: 1, cmd: COMMANDS[type], id: requestId, body });
}

export function decodeMessage(raw: string): Reply | Notification {
  const packet = JSON.parse(raw) as Record<string, unknown>;
  if (!packet || packet.v !== PROTOCOL_VERSION || !Number.isInteger(packet.cmd)) {
    throw new Error('协议版本不匹配');
  }
  if (packet.kind === 2) {
    if (!Number.isInteger(packet.id) || !Number.isInteger(packet.code) || typeof packet.message !== 'string') {
      throw new Error('Invalid reply');
    }
    return {
      type: 'reply',
      command: packet.cmd as number,
      requestId: packet.id as number,
      code: packet.code as number,
      message: packet.message,
    };
  }
  const type = NOTIFICATIONS[(packet.cmd as number) - 100];
  if (packet.kind !== 3 || !type || !packet.body || typeof packet.body !== 'object' || Array.isArray(packet.body)) {
    throw new Error('Invalid notification');
  }
  return { type, body: packet.body as Record<string, unknown> };
}
