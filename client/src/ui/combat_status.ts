import type { State } from '../types';
import { escapeHtml } from './format';
import { catPortrait, managerPortrait } from './portraits';
function meter(label: string, value: number, max: number, className: string) {
  const safe = Math.max(0, Math.min(max, value));
  const percent = max > 0 ? (100 * safe) / max : 0;
  return `<div class="combat-bar ${className}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.ceil(safe)}"><i style="width:${percent.toFixed(2)}%"></i></div>`;
}
export function combatStatusView(g: State, expanded = false) {
  const enemy = g.monster;
  const states: Record<string, string> = {
    waiting: '还未回店',
    hunting: '寻找猫店',
    attacking: `敲 ${enemy.target + 1} 号店门`,
    chasing: '正在追猫',
    retreating: '回家回血',
    defeated: '被赶跑了',
    resting: '休息回血',
  };
  const rage = enemy.nextRage > 0 ? `${enemy.rage} / ${enemy.nextRage} 怒气值` : '已达最高等级';
  const alive = g.players.filter((p) => p.alive).length;
  const players = g.players.map((p) => {
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
    return { p, status, attacked, activity };
  });
  const roster = players
    .map(({ p, status, attacked, activity }) => {
      const label = `${p.name}，${status}，${activity}`;
      const badge = !p.alive ? '×' : p.id === g.you ? '你' : p.human && !p.connected ? '离' : '';
      return `<li class="roster-cat ${p.id === g.you ? 'is-me' : ''} ${p.alive ? '' : 'is-captured'} ${attacked ? 'is-attacked' : ''}">
      <button class="roster-control" data-do="open-combat" aria-label="${escapeHtml(label)}，查看战况详情" aria-controls="combat-details" aria-expanded="${expanded}" title="${escapeHtml(label)}">
        <span class="portrait-stage">
          <span class="cat-portrait">${catPortrait(p.id)}</span>
          <span class="roster-badge" ${badge ? '' : 'hidden'}>${badge}</span>
          <span class="attacker-badge" ${attacked ? '' : 'hidden'} aria-hidden="true">${managerPortrait()}</span>
        </span>
        <span class="roster-name">${escapeHtml(p.name)}</span>
      </button>
    </li>`;
    })
    .join('');
  const detailRoster = players
    .map(
      ({ p, status, activity }) => `<li>
    <strong>${escapeHtml(p.name)}</strong><span>${status} · ${p.room >= 0 ? p.room + 1 + ' 号店 · ' : ''}${activity}</span>
  </li>`,
    )
    .join('');
  return `<div class="combat-summary">
    <div class="enemy-card">
      <div class="enemy-heading"><strong>店长 <em>Lv.${enemy.level}</em></strong><span class="enemy-state">${states[enemy.state] ?? '行动中'}</span><span class="roster-count">${alive}/${g.players.length} 留守</span><button class="combat-toggle" data-do="toggle-combat" aria-controls="combat-details" aria-expanded="${expanded}">${expanded ? '收起' : '详情'}</button></div>
      <div class="enemy-health">${meter('店长生命值', enemy.hp, enemy.maxHp, 'enemy-bar')}<b>${Math.ceil(enemy.hp)} / ${enemy.maxHp}</b></div>
    </div>
    <ul class="combat-roster" aria-label="猫猫小队">${roster}</ul>
  </div>
  <section class="combat-details" id="combat-details" aria-label="战况详情" ${expanded ? '' : 'hidden'}>
    <div class="combat-details-heading"><strong>战况详情</strong><button class="combat-close" data-do="close-combat" aria-label="关闭战况详情">×</button></div>
    <div class="enemy-rage"><span>${rage}</span><span>敲门 ${enemy.doorHits} 次</span></div>
    ${enemy.nextRage > 0 ? meter('店长升级怒气值', enemy.rage, enemy.nextRage, 'rage-bar') : ''}
    <p>怒气：每秒 +${g.catalog.manager.timeRage} · 敲门 +${g.catalog.manager.doorRage}</p>
    <p>受伤怒气 = 实际伤害 × ${g.catalog.manager.damageRageMultiplier}</p>
    <p>升级回复 ${g.catalog.manager.levelUpHealPercent}% 最大生命值</p>
    <ul class="combat-detail-roster">${detailRoster}</ul>
  </section>`;
}
