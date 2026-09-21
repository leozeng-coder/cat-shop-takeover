import type { Catalog, DormState, GameState } from '../model/GameTypes';

type World = Omit<GameState, 'catalog' | 'you' | 'offers' | 'type' | 'dorms'> & {
  dorms: Omit<DormState, 'repairOffer'>[];
};

interface PersonalState {
  you: number;
  offers: GameState['offers'];
  repairOffers: GameState['dorms'][number]['repairOffer'][];
}

export function applyStatePatch(previous: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const entries = Object.keys(patch).map((key) => [key, (patch as Record<string, unknown>)[key]] as const);
  if (!entries.length && previous && typeof previous === 'object') return previous;
  if (Array.isArray(previous)) {
    const result = previous.slice();
    for (const [key, value] of entries) {
      const index = Number(key);
      if (!Number.isInteger(index) || String(index) !== key || index < 0 || index >= result.length || value === null) {
        throw new Error('Invalid array patch');
      }
      result[index] = applyStatePatch(previous[index], value);
    }
    return result;
  }
  const source = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  const result = { ...source };
  for (const [key, value] of entries) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid patch key');
    if (value === null) delete result[key];
    else result[key] = applyStatePatch(source[key], value);
  }
  return result;
}

export class StateStream {
  private world: World | null = null;
  private personal: PersonalState | null = null;
  private revision = 0;

  reset(): void {
    this.world = null;
    this.personal = null;
    this.revision = 0;
  }

  apply(body: Record<string, unknown>, full: boolean, catalog: Catalog | null): GameState | null {
    const revision = body.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new Error('Invalid revision');
    if (!full && (revision as number) <= this.revision) return null;
    if (!full && (!this.world || body.baseRevision !== this.revision)) throw new Error('Missing snapshot baseline');
    if (full && body.baseRevision !== 0) throw new Error('Invalid full snapshot');

    const world = (full ? body.world : applyStatePatch(this.world, body.world)) as World;
    const personal = (full ? body.personal : applyStatePatch(this.personal, body.personal)) as PersonalState;
    if (
      !world ||
      !personal ||
      !catalog ||
      world.configVersion !== catalog.version ||
      !Number.isInteger(personal.you) ||
      !world.players?.[personal.you] ||
      !Array.isArray(world.dorms) ||
      personal.repairOffers?.length !== world.dorms.length ||
      !world.map?.rows ||
      !world.monster
    ) {
      throw new Error('Incomplete snapshot');
    }

    this.world = world;
    this.personal = personal;
    this.revision = revision as number;
    return {
      ...world,
      type: 'state',
      you: personal.you,
      offers: personal.offers,
      dorms: world.dorms.map((room, index) => ({ ...room, repairOffer: personal.repairOffers[index] })),
      catalog,
    };
  }
}
