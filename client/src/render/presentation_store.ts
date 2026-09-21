import { DEFAULT_VISUAL, type PresentationData, visual } from '../../../shared/presentation';

class PresentationStore {
  private data: PresentationData = { version: 1, entries: {} };
  readonly ready: Promise<void>;

  constructor() {
    this.ready = fetch('/assets/visuals/v1/index.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as PresentationData;
        if (data.version === 1 && data.entries && typeof data.entries === 'object') this.data = data;
      })
      .catch(() => {});
  }

  get(id: string) {
    return visual(this.data, id) ?? DEFAULT_VISUAL;
  }
}

export const presentationStore = new PresentationStore();
