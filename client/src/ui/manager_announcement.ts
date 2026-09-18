import type { ManagerLevelUp, State } from '../types';
import { escapeHtml } from './format';
import { managerPortrait } from './portraits';

// Levels are monotonic within a round: their numbers also identify upgrade events.
export class ManagerAnnouncement {
  private round = '';
  private seenLevel = 0;
  private pending: ManagerLevelUp[] = [];
  private timer = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly portrait: () => string | undefined = () => undefined,
  ) {}

  update(state: State): void {
    const round = state.code + ':' + state.map.seed;
    if (round !== this.round || state.monster.level < this.seenLevel) {
      this.reset();
      this.round = round;
      // A fresh page starts from its first snapshot instead of replaying old upgrades.
      this.seenLevel = state.monster.level;
      return;
    }
    if (state.phase !== 'running') {
      this.clear();
      this.seenLevel = state.monster.level;
      return;
    }
    this.pending.push(...state.monster.levelUps.filter((event) => event.level > this.seenLevel));
    this.seenLevel = state.monster.level;
    if (!this.timer) this.playNext();
  }

  reset(): void {
    this.clear();
    this.round = '';
    this.seenLevel = 0;
  }

  private clear(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pending = [];
    this.element.classList.add('hidden');
    this.element.innerHTML = '';
  }

  private playNext(): void {
    const event = this.pending.shift();
    if (!event) {
      this.clear();
      return;
    }
    const healing = event.healed > 0 ? ' · 回复 ' + Number(event.healed.toFixed(1)) + ' 生命' : '';
    this.element.innerHTML =
      '<div class="manager-alert-flash"></div><div class="manager-alert-banner">' +
      '<div class="manager-alert-portrait" aria-hidden="true">' +
      managerPortrait(this.portrait()) +
      '</div>' +
      '<div class="manager-alert-copy"><span>全街注意 · 店长怒气升级</span>' +
      '<strong>' +
      escapeHtml(event.text) +
      '</strong>' +
      '<p>Lv.' +
      event.level +
      healing +
      '</p></div></div>';
    this.element.classList.remove('hidden');
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.playNext();
    }, 2800);
  }
}
