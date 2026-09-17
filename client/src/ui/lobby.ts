import type { State } from '../types';
import { escapeHtml } from './format';
export function lobbyView(g: State) {
  const humans = g.players.filter((p) => p.human).length,
    host = g.host === g.you;
  const ready =
    humans >= g.minimumHumans && g.players.filter((p) => p.human).every((p) => p.ready && p.connected);
  return `<div class="lobby-heading"><div><div class="eyebrow">THE MIDNIGHT CREW</div><h2>等好友一起出发</h2></div><button class="text-button" data-do="leave">返回主菜单 ↗</button></div>
    <p class="muted">2–6 位真人一起玩，空位由 AI 猫猫自动补齐。</p>
    <div class="invite"><small>把这个邀请码发给好友 · ${humans} / 6 位真人</small><div class="invite-line"><strong>${g.code}</strong><button data-do="copy" class="secondary">复制邀请码</button></div></div>
    <div class="members">${g.players.map((p) => `<div class="member ${p.id === g.you ? 'me' : ''}"><span class="avatar">${p.bot ? 'AI' : escapeHtml(p.name.slice(0, 1))}</span><div class="member-name">${escapeHtml(p.name)}${p.id === g.you ? ' · 你' : ''}<small>${p.bot ? '自动补位' : p.id === g.host ? '房主' : !p.connected ? '连接中' : p.ready ? '已准备 ✓' : '等待准备'}</small></div></div>`).join('')}</div>
    <p class="lobby-tip">${humans < g.minimumHumans ? '至少邀请一位好友加入。' : '所有好友准备后，由房主带队出发。'}<br>开局后有 30 秒夜间准备，大家从街道出发，自由选择猫店。</p>
    <div class="lobby-bottom">${host ? `<button class="primary" data-do="start" ${ready ? '' : 'disabled'}>一起出发 <span>↗</span></button>` : `<button class="primary" data-do="ready">${g.players[g.you].ready ? '取消准备' : '准备好了 ✓'}</button>`}</div>`;
}
