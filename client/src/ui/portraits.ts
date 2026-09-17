export const CAT_COLORS = ['#ecad65', '#8fabb2', '#c6a1bc', '#ded0a2', '#92aa8e', '#dc9c92'];
export function catPortrait(id: number) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 30 10 9 27 20Q32 18 37 20L54 9 52 30Q59 55 32 57 5 55 12 30Z" fill="${CAT_COLORS[id % CAT_COLORS.length]}" stroke="#8c785f" stroke-width="2"/><path d="m15 24-1-9 9 7m18 0 9-7-1 9" fill="#e6b5a1"/><ellipse cx="23" cy="35" rx="2.3" ry="3.2" fill="#665647"/><ellipse cx="41" cy="35" rx="2.3" ry="3.2" fill="#665647"/><path d="m29 42 3 3 3-3" fill="#aa796a"/><path d="M24 46q4 6 8-1 4 7 8 1" fill="none" stroke="#826a52" stroke-width="1.5" stroke-linecap="round"/><path d="m11 40 7 1m28 0 7-1M11 46l7-1m28 0 7 1" stroke="#a48768" stroke-width="1.5"/></svg>`;
}
export function managerPortrait() {
  return '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="21" r="15" fill="#e9c295" stroke="#8d7255" stroke-width="1.5"/><path d="M6 17V9Q20 0 34 9v8" fill="#869780" stroke="#627a61" stroke-width="1.5"/><path d="M4 17h32" stroke="#65765b" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="23" r="1.6" fill="#655647"/><circle cx="26" cy="23" r="1.6" fill="#655647"/><path d="m11 20 6 1m6 0 6-1M15 31q5-4 10 0" stroke="#956b50" fill="none" stroke-width="1.5"/></svg>';
}
