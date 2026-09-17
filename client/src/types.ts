export type Appearance = 'shelf' | 'crate' | 'launcher' | 'pantry' | 'repair' | 'fish_rack';
export interface Price {
  currency: string;
  amount: number;
}
export interface Offer {
  enabled: boolean;
  reason: string;
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
export interface ItemConfig {
  id: string;
  name: string;
  category: 'currency' | 'attack' | 'utility';
  behavior: 'obstacle' | 'pickup' | 'currency_producer' | 'single_attack' | 'door_repair';
  appearance: Appearance;
  currency: string;
  buildable: boolean;
  levels: LevelConfig[];
}
export interface Catalog {
  version: string;
  catSpeed: number;
  currencies: { id: string; name: string; symbol: string }[];
  doors: {
    id: string;
    stage: number;
    name: string;
    appearance: 'wood' | 'iron';
    maxHp: number;
    nextStage: number;
    cost: Price[];
    requirements: string[];
  }[];
  nests: (LevelConfig & { currency: string })[];
  items: Record<string, ItemConfig>;
  repair: { cost: Price[]; amount: number; cooldown: number };
  manager: { timeExperience: number; doorExperience: number };
}
export interface Prop {
  cell: number;
  kind: string;
  appearance: Appearance;
  level: number;
  lastShot: number;
}
export interface Player {
  id: number;
  name: string;
  human: boolean;
  connected: boolean;
  ready: boolean;
  bot: boolean;
  alive: boolean;
  sleeping: boolean;
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
  doorAppearance: string;
  repairOffer: Offer;
  door: number;
  closed: boolean;
  nest: number;
  entrance: number;
  area: number;
  props: Prop[];
}
export interface GridMap {
  width: number;
  height: number;
  tileSize: number;
  seed: number;
  spawn: number;
  rows: string[];
}
export interface State {
  type: 'state';
  code: string;
  capacity: number;
  phase: 'lobby' | 'preparing' | 'running' | 'won' | 'lost';
  host: number;
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
    experience: number;
    nextExperience: number;
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
  offers: { nest: Offer; door: Offer; items: Record<string, Offer[]> };
}
export function roomAt(map: GridMap, cell: number): number {
  if (cell < 0 || cell >= map.width * map.height) return -1;
  const tile = map.rows[Math.floor(cell / map.width)][cell % map.width];
  return tile >= '0' && tile <= '5'
    ? Number(tile)
    : tile >= 'a' && tile <= 'f'
      ? tile.charCodeAt(0) - 97
      : -1;
}
export function cellCenter(map: GridMap, cell: number) {
  return {
    x: ((cell % map.width) + 0.5) * map.tileSize,
    y: (Math.floor(cell / map.width) + 0.5) * map.tileSize,
  };
}
