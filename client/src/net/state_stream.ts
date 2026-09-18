import type { Catalog, Dorm, Offer, State } from '../types.ts';
type World = Omit<State, 'catalog' | 'you' | 'offers' | 'type' | 'dorms'> & {
  dorms: Omit<Dorm, 'repairOffer'>[];
};
interface Personal {
  you: number;
  offers: State['offers'];
  repairOffers: Offer[];
}

// Copy-on-write preserves old poses held by MotionTrack and queued UI events.
export function applyStatePatch(previous: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const entries = Object.entries(patch);
  if (!entries.length && previous && typeof previous === 'object') return previous;
  if (Array.isArray(previous)) {
    const result = previous.slice();
    for (const [key, value] of entries) {
      const index = Number(key);
      if (
        !Number.isInteger(index) ||
        String(index) !== key ||
        index < 0 ||
        index >= result.length ||
        value === null
      )
        throw new Error('Invalid array patch');
      result[index] = applyStatePatch(previous[index], value);
    }
    return result;
  }
  const source = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  const result = { ...source };
  for (const [key, value] of entries) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype')
      throw new Error('Invalid patch key');
    if (value === null) delete result[key];
    else result[key] = applyStatePatch(source[key], value);
  }
  return result;
}
export class StateStream {
  private world: World | null = null;
  private personal: Personal | null = null;
  private revision = 0;

  reset() {
    this.world = null;
    this.personal = null;
    this.revision = 0;
  }
  apply(body: Record<string, unknown>, full: boolean, catalog: Catalog | null): State | null {
    const revision = body.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new Error('Invalid revision');
    if (!full && (revision as number) <= this.revision) return null;
    if (!full && (!this.world || body.baseRevision !== this.revision))
      throw new Error('Missing snapshot baseline');
    if (full && body.baseRevision !== 0) throw new Error('Invalid full snapshot');
    const world = (full ? body.world : applyStatePatch(this.world, body.world)) as World;
    const personal = (full ? body.personal : applyStatePatch(this.personal, body.personal)) as Personal;
    if (
      !world ||
      !personal ||
      !catalog ||
      world.configVersion !== catalog.version ||
      !Number.isInteger(personal.you) ||
      !world.players?.[personal.you] ||
      !Array.isArray(world.dorms) ||
      personal.repairOffers?.length !== world.dorms.length ||
      !personal.offers ||
      !world.map?.rows ||
      !world.monster
    )
      throw new Error('Incomplete snapshot');
    // Commit both parts together only after the complete frame has passed validation.
    this.world = world;
    this.personal = personal;
    this.revision = revision as number;
    return {
      ...world,
      type: 'state',
      you: personal.you,
      offers: personal.offers,
      dorms: world.dorms.map((room, i) => ({ ...room, repairOffer: personal.repairOffers[i] })),
      catalog,
    };
  }
}
