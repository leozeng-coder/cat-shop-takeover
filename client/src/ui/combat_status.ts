import type { State } from '../types';
import { escapeHtml } from './format';
import { catPortrait, managerPortrait } from './portraits';
function meter(label: string, value: number, max: number, className: string) {
  const safe = Math.max(0, Math.min(max, value));
  const percent = max > 0 ? (100 * safe) / max : 0;
  return `<div class="combat-bar ${className}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.ceil(safe)}"><i style="width:${percent.toFixed(2)}%"></i></div>`;
}
export function combatStatusView(g: State) {
  const enemy = g.monster;
  const states: Record<string, string> = {
    waiting: '还未回店',
    hunting: '寻找猫店',
    attacking: '正在敲门',
    chasing: '正在巡视',
    retreating: '回家回血',
    defeated: '被赶跑了',
    resting: '休息回血',
  };
  const rage = enemy.nextRage > 0 ? `${enemy.rage} / ${enemy.nextRage} 怒气值` : '已达最高等级';
  const roster = g.players
    .map((p) => {
      const room = g.dorms[p.room];
      const tag = p.id === g.you ? '你' : p.bot ? 'AI' : '好友';
      const status = !p.alive ? '已被抱走' : p.human && !p.connected ? (p.bot ? 'AI 接管' : '暂时离线') : tag;
      const attacked =
        g.phase === 'running' && p.alive && enemy.state === 'attacking' && enemy.attackingPlayer === p.id;
      const activity = attacked
        ? '店长正在敲门'
        : !p.alive
          ? '猫店失守'
          : room
            ? p.sleeping
              ? '窝里休息'
              : '自由活动'
            : '寻找猫店';
      return `<li class="roster-cat ${p.id === g.you ? 'is-me' : ''} ${p.alive ? '' : 'is-captured'} ${attacked ? 'is-attacked' : ''}" aria-label="${escapeHtml(p.name)}，${status}，${activity}">
      <div class="portrait-stage">
        <div class="cat-portrait">${catPortrait(p.id)}</div>
        <span class="roster-badge">${status}</span>
        <div class="attacker-badge" ${attacked ? '' : 'hidden'} role="img" aria-label="店长正在敲${escapeHtml(p.name)}的门">${managerPortrait()}</div>
      </div>
      <strong class="roster-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</strong>
      <span class="roster-activity">${activity}</span>
    </li>`;
    })
    .join('');
  return `<div class="enemy-card">
    <div class="enemy-heading"><strong>店长 <em>Lv.${enemy.level}</em></strong><span>${states[enemy.state] ?? '行动中'}</span></div>
    <div class="enemy-health"><span>生命值</span><b>${Math.ceil(enemy.hp)} / ${enemy.maxHp}</b></div>
    ${meter('店长生命值', enemy.hp, enemy.maxHp, 'enemy-bar')}
    <div class="enemy-rage"><span>${rage}</span><span>敲门 ${enemy.doorHits} 次</span></div>
    ${enemy.nextRage > 0 ? meter('店长升级怒气值', enemy.rage, enemy.nextRage, 'rage-bar') : ''}
    <p>怒气：每秒 +${g.catalog.manager.timeRage} · 敲门 +${g.catalog.manager.doorRage}</p>
    <p>受伤怒气 = 实际伤害 × ${g.catalog.manager.damageRageMultiplier}</p>
    <p>升级回复 ${g.catalog.manager.levelUpHealPercent}% 最大生命值</p>
  </div><div class="roster-heading"><strong>猫猫小队</strong><span>${g.players.filter((p) => p.alive).length} / ${g.players.length} 留守</span></div><ul class="combat-roster">${roster}</ul>`;
}
