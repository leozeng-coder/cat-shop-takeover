import type { CharacterOption, CharacterSelection } from './characters/types';
import type { PresentationEvent } from '../../shared/audio';
export type Appearance =
  | 'shelf'
  | 'crate'
  | 'launcher'
  | 'launcher_dual'
  | 'launcher_cannon'
  | 'pantry'
  | 'repair'
  | 'fish_rack'
  | 'mini_fridge'
  | 'magic_trash_bin';
export interface Price {
  currency: string;
  amount: number;
}
export interface Offer {
  enabled: boolean;
  reason: string;
}
export interface ItemOffer extends Offer {
  cost?: Price[];
  purchased?: number;
  limit?: number;
}
export interface LevelConfig {
  level: number;
  nextLevel: number;
  cost: Price[];
  requirements: string[];
  amount: number;
  intervalMs: number;
  range: number;
}
export interface ItemLevelConfig extends LevelConfig {
  name: string;
  appearance: Appearance;
}
export interface ItemConfig {
  id: string;
  name: string;
  description: string;
  category: 'currency' | 'attack' | 'utility';
  behavior:
    | 'obstacle'
    | 'pickup'
    | 'currency_producer'
    | 'single_attack'
    | 'door_repair'
    | 'door_attack_delay'
    | 'random_item';
  appearance: Appearance;
  currency: string;
  buildable: boolean;
  unique: boolean;
  levels: ItemLevelConfig[];
}
export interface MapOption {
  id: string;
  name: string;
  theme: string;
  width: number;
  height: number;
  minRooms: number;
  maxRooms: number;
  complexity: number;
}
export interface Catalog {
  version: string;
  maps: MapOption[];
  characters: CharacterOption[];
  catSpeed: number;
  currencies: { id: string; name: string; symbol: string }[];
  doors: {
    id: string;
    stage: number;
    name: string;
    appearance: 'wood' | 'iron' | 'steel';
    maxHp: number;
    nextStage: number;
    cost: Price[];
    requirements: string[];
  }[];
  nests: (LevelConfig & { currency: string })[];
  items: Record<string, ItemConfig>;
  repair: { cost: Price[]; amount: number; cooldown: number };
  manager: { timeRage: number; doorRage: number; damageRageMultiplier: number; levelUpHealPercent: number };
}
export interface Prop {
  cell: number;
  kind: string;
  appearance: Appearance;
  level: number;
  lastShot: number;
  revealStartedAt?: number;
  revealAt?: number;
}
export interface Player {
  character: CharacterSelection;
  id: number;
  name: string;
  human: boolean;
  connected: boolean;
  ready: boolean;
  bot: boolean;
  alive: boolean;
  sleeping: boolean;
  escaping: boolean;
  room: number;
  wallet: Record<string, number>;
  incomes: Record<string, number>;
  bed: number;
  income: number;
  x: number;
  y: number;
  repairCooldown: number;
  destination: number;
  path: number[];
}
export interface Dorm {
  id: number;
  owner: number;
  level: number;
  hp: number;
  maxHp: number;
  doorName: string;
  doorAppearance: Catalog['doors'][number]['appearance'];
  repairOffer: Offer;
  door: number;
  closed: boolean;
  nest: number;
  entrance: number;
  area: number;
  props: Prop[];
}
export interface GridMap {
  id: string;
  name: string;
  theme: string;
  width: number;
  height: number;
  tileSize: number;
  seed: number;
  spawn: number;
  rows: string[];
}
export interface ManagerLevelUp {
  level: number;
  healed: number;
  text: string;
}
export interface State {
  eventSequence: number;
  events: PresentationEvent[];
  type: 'state';
  code: string;
  capacity: number;
  phase: 'lobby' | 'preparing' | 'running' | 'won' | 'lost';
  host: number;
  selectedMap: string;
  you: number;
  elapsed: number;
  duration: number;
  preparation: number;
  minimumHumans: number;
  tick: number;
  map: GridMap;
  players: Player[];
  dorms: Dorm[];
  monster: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    level: number;
    rage: number;
    nextRage: number;
    levelUps: ManagerLevelUp[];
    maxLevel: number;
    doorHits: number;
    attackingPlayer: number;
    attackStartedAt: number;
    attackSequence: number;
    doorDamage: number;
    target: number;
    prey: number;
    path: number[];
    state: string;
  };
  notices: { id: number; time: number; text: string }[];
  configVersion: string;
  catalog: Catalog;
  offers: { nest: Offer; door: Offer; items: Record<string, ItemOffer[]> };
}
export function roomAt(map: GridMap, cell: number): number {
  if (cell < 0 || cell >= map.width * map.height) return -1;
  const tile = map.rows[Math.floor(cell / map.width)][cell % map.width];
  const floor = '0123456789ABCDEF'.indexOf(tile);
  if (floor >= 0) return floor;
  return tile >= 'a' && tile <= 'p' ? tile.charCodeAt(0) - 97 : -1;
}
export function cellCenter(map: GridMap, cell: number) {
  return {
    x: ((cell % map.width) + 0.5) * map.tileSize,
    y: (Math.floor(cell / map.width) + 0.5) * map.tileSize,
  };
}
