import type { GameState, PlayerState } from '../model/GameTypes';

export interface HudBox { x: number; y: number; width: number; height: number }

/** Coordinates are measured from the top left of the safe viewport. */
export function battleHudLayout(width: number, height: number) {
  const narrow = width < 900;
  const phaseWidth = narrow ? 180 : 200;
  const phase: HudBox = { x: (width - phaseWidth) / 2, y: 12, width: phaseWidth, height: 72 };
  const team: HudBox = { x: 12, y: 12,
    width: Math.min(360, phase.x - 24), height: narrow ? 166 : 96 };
  const walletWidth = narrow ? 224 : width < 1100 ? 248 : 280;
  const wallet: HudBox = { x: width - walletWidth - (narrow ? 12 : 112), y: 24, width: walletWidth, height: 48 };
  const exit: HudBox = { x: width - 100, y: narrow ? 84 : 24, width: 88, height: 48 };
  const toastWidth = Math.min(520, width - 48);
  const toast: HudBox = { x: (width - toastWidth) / 2, y: (height - 72) / 2, width: toastWidth, height: 72 };
  const announcement: HudBox = { x: (width - Math.min(610, width - 36)) / 2,
    y: Math.min(narrow ? 196 : 124, height * 0.38), width: Math.min(610, width - 36), height: 144 };
  return { phase, team, wallet, exit, toast, announcement };
}

export function phaseClock(state: Pick<GameState, 'phase' | 'elapsed' | 'preparation' | 'duration'>): string {
  const remaining = Math.max(0, Math.ceil((state.phase === 'preparing' ? state.preparation : state.preparation + state.duration) - state.elapsed));
  return `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
}

export function doorUnderAttack(state: GameState, player: PlayerState): boolean {
  return state.phase === 'running' && player.alive && state.monster.state === 'attacking' &&
    state.monster.attackingPlayer === player.id;
}

export function playerActivity(player: PlayerState): string {
  if (!player.alive) return '已被抱走';
  if (player.escaping) return '逃跑中';
  if (player.human && !player.connected) return '离线托管';
  if (player.room < 0) return '寻找猫店';
  return player.sleeping ? '窝里休息' : '自由活动';
}
