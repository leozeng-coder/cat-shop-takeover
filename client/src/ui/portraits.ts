import { escapeHtml } from './format';

export function managerPortrait(portraitUrl?: string) {
  if (portraitUrl) return `<img src="${escapeHtml(portraitUrl)}" alt="" draggable="false">`;
  return '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="21" r="15" fill="#e9c295" stroke="#8d7255" stroke-width="1.5"/><path d="M6 17V9Q20 0 34 9v8" fill="#869780" stroke="#627a61" stroke-width="1.5"/><path d="M4 17h32" stroke="#65765b" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="23" r="1.6" fill="#655647"/><circle cx="26" cy="23" r="1.6" fill="#655647"/><path d="m11 20 6 1m6 0 6-1M15 31q5-4 10 0" stroke="#956b50" fill="none" stroke-width="1.5"/></svg>';
}
