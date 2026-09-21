export interface CharacterSelection {
  character: string;
  skin: string;
}

export interface CharacterOption {
  id: string;
  skins: string[];
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
  appearance: string;
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
  appearance: string;
  currency: string;
  buildable: boolean;
  unique: boolean;
  levels: ItemLevelConfig[];
}

export interface PlayerState {
  id: number;
  name: string;
  character: CharacterSelection;
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

export interface PropState {
  cell: number;
  kind: string;
  appearance: string;
  level: number;
  lastShot: number;
  revealStartedAt?: number;
  revealAt?: number;
}

export interface DormState {
  id: number;
  owner: number;
  level: number;
  hp: number;
  maxHp: number;
  doorName: string;
  doorAppearance: string;
  door: number;
  entrance: number;
  nest: number;
  area: number;
  closed: boolean;
  props: PropState[];
  repairOffer: Offer;
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
    appearance: string;
    maxHp: number;
    nextStage: number;
    cost: Price[];
    requirements: string[];
  }[];
  nests: (LevelConfig & { currency: string })[];
  items: Record<string, ItemConfig>;
  repair: { cost: Price[]; amount: number; cooldown: number };
  manager: {
    timeRage: number;
    doorRage: number;
    damageRageMultiplier: number;
    levelUpHealPercent: number;
  };
  [key: string]: unknown;
}

export interface MonsterState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  rage: number;
  nextRage: number;
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
  levelUps: { level: number; healed: number; text: string }[];
}

export interface GameState {
  type: 'state';
  code: string;
  capacity: number;
  phase: 'lobby' | 'preparing' | 'running' | 'won' | 'lost';
  host: number;
  selectedMap: string;
  you: number;
  tick: number;
  elapsed: number;
  duration: number;
  preparation: number;
  minimumHumans: number;
  configVersion: string;
  map: GridMap;
  players: PlayerState[];
  dorms: DormState[];
  monster: MonsterState;
  notices: { id: number; time: number; text: string }[];
  eventSequence: number;
  events: { id: number; time: number; type: string; target: string; x: number; y: number; player: number }[];
  offers: { nest: Offer; door: Offer; items: Record<string, ItemOffer[]> };
  catalog: Catalog;
}

export function roomAt(map: GridMap, cell: number): number {
  if (cell < 0 || cell >= map.width * map.height) return -1;
  const value = map.rows[Math.floor(cell / map.width)]?.[cell % map.width] ?? '#';
  const floor = '0123456789ABCDEF'.indexOf(value);
  if (floor >= 0) return floor;
  return value >= 'a' && value <= 'p' ? value.charCodeAt(0) - 97 : -1;
}

export function cellCenter(map: GridMap, cell: number) {
  return {
    x: ((cell % map.width) + 0.5) * map.tileSize,
    y: (Math.floor(cell / map.width) + 0.5) * map.tileSize,
  };
}

export function cellFromWorld(map: GridMap, x: number, y: number): number {
  const column = Math.floor(x / map.tileSize);
  const row = Math.floor(y / map.tileSize);
  if (column < 0 || row < 0 || column >= map.width || row >= map.height) return -1;
  return row * map.width + column;
}
