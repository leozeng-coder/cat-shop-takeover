// Mirrors server/net/game_protocol.h. Commands and notifications have separate ranges.
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
] as const;

export type ClientMessage =
  | { type: 'create'; capacity: number; name: string; mapId?: string }
  | { type: 'join'; code: string; name: string }
  | { type: 'resume'; token: string }
  | { type: 'ready'; ready: boolean; mapSeed?: number }
  | { type: 'start'; mapSeed?: number }
  | { type: 'select_map'; mapId: string }
  | { type: 'leave' | 'rematch' | 'ping' | 'resync' | 'maps' }
  | {
      type: 'action';
      action: 'move' | 'nest' | 'bed' | 'door' | 'build' | 'repair';
      room: number;
      cell: number;
      kind: string;
      seq: number;
    };

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
  if (
    !Object.hasOwn(COMMANDS, type) ||
    !Number.isInteger(requestId) ||
    requestId < 1 ||
    requestId > 0xffffffff
  )
    throw new Error('Invalid request');
  return JSON.stringify({ v: PROTOCOL_VERSION, kind: 1, cmd: COMMANDS[type], id: requestId, body });
}
export function decodeMessage(raw: string): Reply | Notification {
  const packet = JSON.parse(raw);
  if (!packet || packet.v !== PROTOCOL_VERSION || !Number.isInteger(packet.cmd))
    throw new Error('协议版本不匹配，请刷新页面');
  if (packet.kind === 2) {
    if (
      !Number.isInteger(packet.id) ||
      packet.id < 1 ||
      packet.id > 0xffffffff ||
      !Number.isInteger(packet.code) ||
      typeof packet.message !== 'string'
    )
      throw new Error('Invalid reply');
    return {
      type: 'reply',
      command: packet.cmd,
      requestId: packet.id,
      code: packet.code,
      message: packet.message,
    };
  }
  const type = NOTIFICATIONS[packet.cmd - 100];
  if (
    packet.kind !== 3 ||
    !type ||
    !packet.body ||
    typeof packet.body !== 'object' ||
    Array.isArray(packet.body)
  )
    throw new Error('Invalid notification');
  return { type, body: packet.body };
}
