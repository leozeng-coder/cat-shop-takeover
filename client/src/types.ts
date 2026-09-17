export type PropKind = 'shelf' | 'crate' | 'launcher' | 'pantry' | 'repair';
export interface Prop {
  cell: number;
  kind: PropKind;
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
  gold: number;
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
  rules: {
    bedIncome: number[];
    bedCost: number[];
    doorCost: number[];
    towerCost: number[];
    pantryCost: number[];
    repairCost: number[];
    repairDoorCost: number;
    enemyTimeExperience: number;
    enemyDoorExperience: number;
  };
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
