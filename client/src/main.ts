import './style.css';
import { APP_SHELL } from './ui/shell';
import { updateHtml } from './ui/dom_patch';
import { lobbyView } from './ui/lobby';
import { gridMenuView } from './ui/grid_menu';
import { combatStatusView } from './ui/combat_status';
import { clock, escapeHtml } from './ui/format';
import { roomAt, type State } from './types';
import { Renderer } from './renderer';
import { GameConnection, type ClientMessage } from './net/game_connection';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = APP_SHELL;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const renderer = new Renderer(el<HTMLCanvasElement>('board'));
let state: State | null = null,
  capacity = 1,
  sequence = 0,
  busy = false,
  autoStart = false;
let selected = -1,
  popup = { x: 0, y: 0 },
  toastTimer = 0,
  loading = false,
  loadingStarted = 0,
  loadingScheduled = false,
  loadGeneration = 0;
function toast(message: string) {
  el('toast').textContent = message;
  el('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el('toast').classList.add('hidden'), 3200);
}
function closeGrid() {
  selected = -1;
  renderer.selectedCell = -1;
  el('grid-menu').classList.add('hidden');
}
function send(message: ClientMessage) {
  if (!connection.send(message)) {
    toast('正在连接小街，请稍候');
    return false;
  }
  return true;
}
type Action = Extract<ClientMessage, { type: 'action' }>['action'];
function act(action: Action, room = -1, cell = -1, kind = 'launcher') {
  return send({ type: 'action', action, room, cell, kind, seq: ++sequence });
}
function beginLoading() {
  if (loading) return;
  loading = true;
  loadingStarted = performance.now();
  loadingScheduled = false;
  el('loading').classList.remove('hidden');
}
function finishLoadingWhenReady() {
  if (!loading || loadingScheduled || !state || state.phase === 'lobby') return;
  loadingScheduled = true;
  const generation = loadGeneration;
  void document.fonts.ready.then(() =>
    requestAnimationFrame(() => {
      window.setTimeout(
        () => {
          if (generation !== loadGeneration) return;
          loading = false;
          loadingScheduled = false;
          el('loading').classList.add('hidden');
        },
        Math.max(0, 650 - (performance.now() - loadingStarted)),
      );
    }),
  );
}
function clearSession() {
  connection.forgetSession();
  state = null;
  sequence = 0;
  busy = false;
  autoStart = false;
  ++loadGeneration;
  loading = false;
  loadingScheduled = false;
  el('loading').classList.add('hidden');
  renderer.setState(null);
  closeGrid();
  render();
}
const connection = new GameConnection({
  onJoined(lastSequence) {
    sequence = lastSequence;
    busy = false;
  },
  onStatus(online) {
    el('connection').classList.toggle('online', online);
    el('connection').textContent = online ? '小街已连接' : '连接小街中';
    el('offline').classList.toggle('hidden', online || !state);
    if (!online) busy = false;
    render();
  },
  onState(next) {
    const previous = state;
    if (
      next.phase !== 'lobby' &&
      next.phase !== 'won' &&
      next.phase !== 'lost' &&
      (!previous || previous.phase === 'lobby')
    )
      beginLoading();
    if (previous?.map.seed !== next.map.seed) closeGrid();
    state = next;
    renderer.setState(next);
    render();
    finishLoadingWhenReady();
    if (autoStart && next.phase === 'lobby' && next.capacity === 1) {
      autoStart = false;
      send({ type: 'start' });
    }
  },
  onError(message) {
    busy = false;
    if (!state || state.phase === 'lobby') {
      ++loadGeneration;
      loading = false;
      loadingScheduled = false;
      el('loading').classList.add('hidden');
    }
    toast(message);
    render();
  },
  onExpired() {
    clearSession();
    toast('上一局已经结束，可以开始新的行动');
  },
  onLeft() {
    clearSession();
  },
});
function renderGrid() {
  const panel = el('grid-menu');
  if (!state || selected < 0 || !state.players[state.you].alive) {
    panel.classList.add('hidden');
    return;
  }
  const html = gridMenuView(state, selected);
  if (!html) {
    closeGrid();
    return;
  }
  updateHtml(panel, html);
  panel.classList.remove('hidden');
  const stage = el('map-stage');
  panel.style.left = Math.max(10, Math.min(popup.x + 15, stage.clientWidth - panel.offsetWidth - 12)) + 'px';
  panel.style.top = Math.max(10, Math.min(popup.y - 20, stage.clientHeight - panel.offsetHeight - 12)) + 'px';
}
function render() {
  const lobby = state?.phase === 'lobby';
  el('menu-screen').classList.toggle('hidden', !!state);
  el('lobby-screen').classList.toggle('hidden', !lobby);
  el('game-screen').classList.toggle('hidden', !state || !!lobby);
  el<HTMLButtonElement>('create').disabled = busy || !connection.isConnected();
  if (!state) return;
  const g = state,
    me = g.players[g.you];
  if (lobby) {
    updateHtml(el('lobby-content'), lobbyView(g));
    return;
  }
  const night = g.phase === 'preparing',
    finished = g.phase === 'won' || g.phase === 'lost';
  el('game-screen').classList.toggle('danger', !night);
  el('room-name').textContent =
    '午夜猫街 · ' +
    g.players.filter((p) => p.human).length +
    ' 位真人 + ' +
    g.players.filter((p) => !p.human).length +
    ' 位 AI';
  el('phase-label').textContent = night ? '☾ 夜间准备' : '☀ 白天守店';
  el('timer').textContent = clock(night ? g.preparation - g.elapsed : g.duration + g.preparation - g.elapsed);
  el('phase-description').textContent = night ? '店长不在，找猫窝安家' : '坚持到店长放弃';
  el('day-badge').textContent = night ? 'MOONLIGHT DISTRICT' : 'SUNRISE · THE OWNER IS BACK';
  updateHtml(el('combat-status'), combatStatusView(g));
  updateHtml(
    el('wallet'),
    g.catalog.currencies
      .map(
        (c) =>
          '<div class="resource"><span class="can-icon">' +
          escapeHtml(c.symbol) +
          '</span><div><small>' +
          escapeHtml(c.name) +
          '</small><strong>' +
          (me.wallet[c.id] ?? 0) +
          '</strong></div><span class="income">+' +
          Number((me.incomes[c.id] ?? 0).toFixed(2)) +
          ' / 秒</span></div>',
      )
      .join(''),
  );
  const ownerState: Record<string, string> = {
    hunting: '店长正在街上找猫',
    attacking: '店长正在拆 ' + (g.monster.target + 1) + ' 号店门',
    chasing: '店长正在追猫！',
    retreating: '店长血量不足，正在回家',
    defeated: '店长被赶跑了！',
    resting: '店长暂时在街口休息',
    waiting: '店长还没回来',
  };
  el('map-status').textContent = night
    ? '30 秒准备 · 自由选择猫店'
    : ownerState[g.monster.state] || '留意街上的店长';
  const alive = g.players.filter((p) => p.alive).length;
  el('cat-status').innerHTML =
    '<strong>' +
    alive +
    ' / 6</strong> 只猫留守 · ' +
    (!me.alive
      ? '你正在观战'
      : me.sleeping
        ? '窝里休息 · 持续赚罐头'
        : me.room >= 0
          ? '自由活动 · 持续赚罐头'
          : '还没有猫窝');
  el('notice').textContent = g.notices[0]?.text ?? '';
  el('game-tip').textContent = !me.alive
    ? '你已被店长抱走 · 继续观战队友'
    : me.room >= 0
      ? (g.dorms[me.room].closed ? '店门已关闭 · ' : '店门已破，留意店长 · ') +
        '点屋内空格走动或建造 · 点窝休息 / 升级 · 罐头持续增加'
      : '点街道移动 · 点罐头窝安家并关门 · 滚轮缩放 / 拖动地图';
  el('result').classList.toggle('hidden', !finished);
  if (finished) {
    closeGrid();
    updateHtml(
      el('result'),
      '<div class="result-card"><div class="eyebrow">OPERATION COMPLETE</div><div class="result-icon">' +
        (g.phase === 'won' ? '🥫' : '🐾') +
        '</div><h2>' +
        (g.phase === 'won' ? '守住了，开罐头！' : '小猫都被抱走啦') +
        '</h2><p>' +
        (g.phase === 'won' ? '店长放弃了，这条街今晚归猫。' : '换个猫店，再试试新的机关组合。') +
        '</p>' +
        (g.host === g.you
          ? '<button class="primary wide" data-do="rematch">再开一局 · 新街区 ↗</button>'
          : '<p>等待房主再开一局</p>') +
        '<button class="text-button" data-do="leave">返回主菜单</button></div>',
    );
  } else renderGrid();
}
renderer.onCamera = closeGrid;
renderer.onCell = (cell, x, y) => {
  if (!state || !['preparing', 'running'].includes(state.phase) || !state.players[state.you].alive) return;
  const g = state,
    me = g.players[g.you],
    rid = roomAt(g.map, cell),
    room = g.dorms[rid];
  const tile = g.map.rows[Math.floor(cell / g.map.width)][cell % g.map.width];
  if (tile === '#') {
    closeGrid();
    toast('这里是墙，猫猫要从店门进入');
    return;
  }
  if (room && cell === room.nest && (room.owner < 0 || room.owner === g.you) && !me.sleeping) {
    closeGrid();
    act('nest', room.id);
    toast(room.owner === g.you ? '猫猫回窝休息，罐头照常赚' : '猫猫正走向罐头窝，抵达后关门安家');
    return;
  }
  if (
    !room ||
    (!me.sleeping && room.owner < 0 && cell !== room.door && !room.props.some((p) => p.cell === cell))
  ) {
    closeGrid();
    act('move', -1, cell);
    return;
  }
  selected = cell;
  popup = { x, y };
  renderer.selectedCell = cell;
  renderGrid();
};
el('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = el<HTMLInputElement>('invite-input').value.trim().toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(code)) {
    toast('请输入好友的 6 位邀请码');
    return;
  }
  autoStart = false;
  send({ type: 'join', code, name: el<HTMLInputElement>('nickname').value.trim() || '小猫' });
});
app.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-do]');
  if (!button || button.disabled) return;
  const op = button.dataset.do!;
  if (op === 'mode') {
    capacity = Number(button.dataset.capacity);
    app.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
    el('create').innerHTML = (capacity === 1 ? '独自出发' : '创建好友房间') + ' <span>↗</span>';
    el('join-form').classList.toggle('hidden', capacity === 1);
  } else if (op === 'create') {
    autoStart = capacity === 1;
    if (capacity === 1) beginLoading();
    if (send({ type: 'create', capacity, name: el<HTMLInputElement>('nickname').value.trim() || '橘子' })) {
      busy = true;
      render();
    }
  } else if (op === 'start') {
    beginLoading();
    send({ type: 'start' });
  } else if (op === 'ready' && state) send({ type: 'ready', ready: !state.players[state.you].ready });
  else if (op === 'leave') {
    if (connection.isConnected()) send({ type: 'leave' });
    else clearSession();
  } else if (op === 'rematch') {
    autoStart = state?.capacity === 1;
    send({ type: 'rematch' });
  } else if (op === 'copy' && state) {
    try {
      await navigator.clipboard.writeText(state.code);
      toast('邀请码已复制：' + state.code);
    } catch {
      toast('邀请码：' + state.code);
    }
  } else if (op === 'close-grid') closeGrid();
  else if (op === 'fit') renderer.fit();
  else if (op === 'locate') renderer.locate();
  else if (op === 'zoom-in') renderer.zoomBy(1.25);
  else if (op === 'zoom-out') renderer.zoomBy(0.8);
  else if (['move', 'nest', 'bed', 'door', 'repair', 'build'].includes(op) && state && selected >= 0) {
    const room = roomAt(state.map, selected);
    const kind = button.dataset.kind ?? '';
    act(op as Action, room, selected, kind);
    if (op === 'move' || op === 'nest') closeGrid();
  } else if (op === 'help') {
    el('modal').innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="eyebrow">A LITTLE MIDNIGHT ADVENTURE</div><h2 id="help-title">今晚，猫猫来营业</h2><ol><li>夜间有 30 秒准备。点击街道移动，猫猫会绕过墙和货架，从店门进入。</li><li>每家猫店都有一个罐头窝，额外随机放 1–2 个道具。点击空店的窝，猫会走过去安家，店门随即关闭，关闭的门无法穿过。</li><li>点自家空格，选择弹射器、储藏柜或修补台。点已有道具、罐头窝或店门，可以升级和修补。</li><li>安家后持续赚罐头，数量显示在右上角。可以躺在窝里，也可以点屋内空格选择走动，收入不变；走到罐头箱上还能拾取物资。</li><li>白天店长回来：先敲门、破门，再进店追猫。店长通过时间和敲门积累经验升级。左上角显示全员头像和店长等级、血量。店长正在敲门的猫店，其主人头像右下角会出现店长，每 2 秒撞击一次头像，提醒你及时防守。店门被打破后，店长会走进房间，接触到猫才会把它抓走；猫没有生命值或扣血阶段。坚持 5 分钟有猫留守就获胜。</li></ol><p>滚轮缩放，拖动地图，◎ 定位自己的猫。多人模式邀请好友加入，剩余位置自动补 AI。</p><button class="primary wide" data-do="close-help">知道啦，去找罐头 ↗</button></div>';
    el('modal').classList.remove('hidden');
  } else if (op === 'close-help') el('modal').classList.add('hidden');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeGrid();
    el('modal').classList.add('hidden');
  }
});
connection.connect();
render();
window.addEventListener('beforeunload', () => connection.dispose());
