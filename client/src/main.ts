import './style.css';
import { AudioSystem } from './audio/audio_system';
import { characterLibrary } from './characters/character_library';
import { MANAGER_CHARACTER } from './characters/manager_motion';
import { characterKey, type CharacterOption, type CharacterSelection } from './characters/types';
import { characterPickerView } from './ui/character_picker';
import { APP_SHELL } from './ui/shell';
import { updateHtml } from './ui/dom_patch';
import { lobbyView } from './ui/lobby';
import { mapPickerView } from './ui/map_picker';
import { gridMenuView, ITEM_CATEGORIES, type ItemCategory } from './ui/grid_menu';
import { combatStatusView } from './ui/combat_status';
import { ManagerAnnouncement } from './ui/manager_announcement';
import { clock, escapeHtml } from './ui/format';
import { roomAt, type State, type MapOption } from './types';
import { Renderer } from './renderer';
import { GameConnection, type ClientMessage } from './net/game_connection';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = APP_SHELL;
const audio = new AudioSystem();
for (const container of Array.from(app.querySelectorAll('.header-end,.hud-left'))) {
  container.insertAdjacentHTML(
    'beforeend',
    '<button class="text-button" data-audio-toggle aria-label="切换声音"></button>',
  );
}
audio.onChange = () => {
  for (const button of Array.from(app.querySelectorAll('[data-audio-toggle]'))) {
    button.textContent = audio.isMuted() ? '声音：关' : '声音：开';
    button.setAttribute('aria-pressed', String(!audio.isMuted()));
  }
};
audio.onChange();
document.addEventListener(
  'click',
  (event) => {
    audio.unlock();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-audio-toggle')) audio.toggleMute();
    else audio.play('ui.click');
  },
  { capture: true },
);
document.addEventListener('keydown', () => audio.unlock(), { capture: true });
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const renderer = new Renderer(el<HTMLCanvasElement>('board'));
const managerPortraitUrl = () => characterLibrary.card(MANAGER_CHARACTER)?.portrait;
const managerAnnouncement = new ManagerAnnouncement(el('manager-announcement'), managerPortraitUrl);
let state: State | null = null,
  capacity = 1,
  sequence = 0,
  busy = false,
  autoStart = false;
let itemCategory: ItemCategory = 'attack';
let mapOptions: MapOption[] = [];
let selectedMap = '';
let characterOptions: CharacterOption[] = [];
let selectedCharacter: CharacterSelection | null = null;
try {
  selectedCharacter = JSON.parse(localStorage.getItem('cat-shop-character') ?? 'null');
} catch {
  /* Unavailable preferences do not block play. */
}
function rememberCharacter(selection: CharacterSelection) {
  selectedCharacter = selection;
  try {
    localStorage.setItem('cat-shop-character', JSON.stringify(selection));
  } catch {
    /* Private browsing. */
  }
}
characterLibrary.onChange = () => render();
function loadCharacterOptions(options: CharacterOption[]) {
  void characterLibrary.loadOptions(options).catch(() => toast('部分猫猫资源加载失败，请刷新重试'));
}
let dismissedPanelOnPress = false;
let combatExpanded = false;
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
function closeCombat() {
  if (!combatExpanded) return;
  combatExpanded = false;
  if (state) updateHtml(el('combat-status'), combatStatusView(state, combatExpanded, managerPortraitUrl()));
}
function updateCameraControl() {
  const follow = el<HTMLButtonElement>('camera-follow');
  follow.setAttribute('aria-pressed', String(renderer.following));
  follow.disabled = !state?.players[state.you].alive;
  follow.title = follow.disabled
    ? '你的猫已被抱走，可以自由查看街区'
    : renderer.following
      ? '镜头正在跟随你的猫 · 拖动可自由查看'
      : '定位自己的猫并恢复镜头跟随';
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
  void Promise.all([document.fonts.ready, renderer.ready]).then(() =>
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
  managerAnnouncement.reset();
  state = null;
  audio.setState(null);
  itemCategory = 'attack';
  combatExpanded = false;
  sequence = 0;
  busy = false;
  autoStart = false;
  ++loadGeneration;
  loading = false;
  loadingScheduled = false;
  el('loading').classList.add('hidden');
  renderer.setState(null);
  if (connection.isConnected()) {
    connection.send({ type: 'maps' });
    connection.send({ type: 'characters' });
  }
  closeGrid();
  render();
}
const connection = new GameConnection({
  onCharacters(options) {
    characterOptions = options;
    if (
      !options.some(
        (option) =>
          option.id === selectedCharacter?.character && option.skins.includes(selectedCharacter.skin),
      )
    )
      selectedCharacter = options.length ? { character: options[0].id, skin: options[0].skins[0] } : null;
    loadCharacterOptions(options);
    render();
  },
  onMaps(maps) {
    mapOptions = maps;
    if (!maps.some((map) => map.id === selectedMap)) selectedMap = '';
    render();
  },
  onJoined(lastSequence) {
    audio.resetEvents();
    sequence = lastSequence;
    busy = false;
  },
  onStatus(online) {
    el('connection').classList.toggle('online', online);
    el('connection').textContent = online ? '小街已连接' : '连接小街中';
    el('offline').classList.toggle('hidden', online || !state);
    if (!online) {
      busy = false;
      audio.resetEvents();
    }
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
    if (previous?.map.seed !== next.map.seed) {
      closeGrid();
      combatExpanded = false;
    }
    state = next;
    audio.setState(next);
    if (previous?.code === next.code && previous.map.seed === next.map.seed) {
      const mine = next.players[next.you].room;
      if (mine >= 0) {
        const before = previous.dorms[mine];
        for (const prop of next.dorms[mine].props) {
          const old = before.props.find((p) => p.cell === prop.cell);
          if (old && next.catalog.items[old.kind].behavior === 'random_item' && prop.kind !== old.kind) {
            toast(
              '翻到宝贝啦！' +
                next.catalog.items[prop.kind].levels[prop.level - 1].name +
                ' · ' +
                prop.level +
                '级',
            );
          }
        }
      }
    }
    if (
      !selectedCharacter ||
      characterKey(selectedCharacter) !== characterKey(next.players[next.you].character)
    )
      rememberCharacter(next.players[next.you].character);
    if (previous?.configVersion !== next.configVersion) loadCharacterOptions(next.catalog.characters);
    if (next.players[next.you].escaping) {
      closeGrid();
      if (!previous?.players[previous.you].escaping) toast('店门被打破了！点击地图逃跑');
    }
    managerAnnouncement.update(next);
    renderer.setState(next);
    render();
    finishLoadingWhenReady();
    if (autoStart && next.phase === 'lobby' && next.capacity === 1) {
      autoStart = false;
      const code = next.code;
      const mapSeed = next.map.seed;
      const generation = loadGeneration;
      void renderer.ready.then(() => {
        if (
          state?.code === code &&
          state.phase === 'lobby' &&
          state.map.seed === mapSeed &&
          generation === loadGeneration
        )
          send({ type: 'start', mapSeed });
      });
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
  if (state.players[state.you].escaping) {
    closeGrid();
    return;
  }
  const html = gridMenuView(state, selected, itemCategory);
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
  updateCameraControl();
  const lobby = state?.phase === 'lobby';
  el('menu-screen').classList.toggle('hidden', !!state);
  el('lobby-screen').classList.toggle('hidden', !lobby);
  el('game-screen').classList.toggle('hidden', !state || !!lobby);
  el<HTMLButtonElement>('create').disabled =
    busy ||
    !connection.isConnected() ||
    !mapOptions.length ||
    !selectedCharacter ||
    !characterLibrary.card(selectedCharacter);
  if (!state) {
    updateHtml(
      el('menu-character-picker'),
      characterPickerView(characterOptions, selectedCharacter, 'menu-character', busy),
    );
    if (mapOptions.length)
      updateHtml(el('menu-map-picker'), mapPickerView(mapOptions, selectedMap, 'menu-map', busy));
    return;
  }
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
    g.map.name +
    ' · ' +
    g.players.filter((p) => p.human).length +
    ' 位真人 + ' +
    g.players.filter((p) => !p.human).length +
    ' 位 AI';
  el('phase-label').textContent = night ? '☾ 夜间准备' : '☀ 白天守店';
  el('timer').textContent = clock(night ? g.preparation - g.elapsed : g.duration + g.preparation - g.elapsed);
  el('phase-description').textContent = me.escaping
    ? '店门已破，点击地图逃跑'
    : night
      ? '店长不在，找猫窝安家'
      : '坚持到店长放弃';
  if (finished) combatExpanded = false;
  updateHtml(el('combat-status'), combatStatusView(g, combatExpanded, managerPortraitUrl()));
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
  const alive = g.players.filter((p) => p.alive).length;
  el('cat-status').innerHTML =
    '<strong>' +
    alive +
    ' / 6</strong> 只猫留守 · ' +
    (!me.alive
      ? '你正在观战'
      : me.escaping
        ? '正在逃跑 · 点击地图移动'
        : me.sleeping
          ? '窝里休息 · 持续赚罐头'
          : me.room >= 0
            ? '自由活动 · 持续赚罐头'
            : '还没有猫窝');
  el('notice').textContent = g.notices[0]?.text ?? '';
  el('game-tip').textContent = !me.alive
    ? '你已被店长抱走 · 继续观战队友'
    : me.escaping
      ? '现在只能逃跑 · 点击地图移动 · 安装、升级、修门和回窝已禁用'
      : me.room >= 0
        ? '店门已关闭 · 点屋内空格建造 · 点窝休息 / 升级 · 罐头持续增加'
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
renderer.onCamera = () => {
  closeGrid();
  closeCombat();
  updateCameraControl();
};
renderer.onCell = (cell, x, y) => {
  if (dismissedPanelOnPress) return;
  if (!state || !['preparing', 'running'].includes(state.phase) || !state.players[state.you].alive) return;
  const g = state,
    me = g.players[g.you],
    rid = roomAt(g.map, cell),
    room = g.dorms[rid];
  const tile = g.map.rows[Math.floor(cell / g.map.width)][cell % g.map.width];
  if (tile === '#') {
    closeGrid();
    toast('这里是墙，猫猫不能穿过');
    return;
  }
  if (me.escaping) {
    closeGrid();
    act('move', -1, cell);
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
  if (busy) return;
  const code = el<HTMLInputElement>('invite-input').value.trim().toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(code)) {
    toast('请输入好友的 6 位邀请码');
    return;
  }
  autoStart = false;
  if (!selectedCharacter || !characterLibrary.card(selectedCharacter)) {
    toast('猫猫还在梳理毛发，请稍候');
    return;
  }
  if (
    send({
      type: 'join',
      code,
      name: el<HTMLInputElement>('nickname').value.trim() || '小猫',
      character: selectedCharacter,
    })
  ) {
    busy = true;
    render();
  }
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
  } else if (op === 'menu-character' || op === 'select-character') {
    const selection = { character: button.dataset.character!, skin: button.dataset.skin! };
    if (op === 'menu-character') {
      rememberCharacter(selection);
      audio.play('character.meow');
      render();
    } else if (!state || characterKey(state.players[state.you].character) !== characterKey(selection))
      send({ type: 'select_character', character: selection });
  } else if (op === 'menu-map') {
    selectedMap = button.dataset.mapId!;
    render();
  } else if (op === 'select-map') {
    send({ type: 'select_map', mapId: button.dataset.mapId! });
  } else if (op === 'create') {
    autoStart = capacity === 1;
    if (capacity === 1) beginLoading();
    if (
      send({
        type: 'create',
        capacity,
        name: el<HTMLInputElement>('nickname').value.trim() || '橘子',
        mapId: selectedMap,
        character: selectedCharacter!,
      })
    ) {
      busy = true;
      render();
    }
  } else if (op === 'start') {
    beginLoading();
    const code = state?.code;
    const mapSeed = state?.map.seed;
    await renderer.ready;
    if (state?.code === code && state?.phase === 'lobby' && state.map.seed === mapSeed)
      send({ type: 'start', mapSeed });
  } else if (op === 'ready' && state) {
    const code = state.code;
    const mapSeed = state.map.seed;
    await renderer.ready;
    if (state?.code === code && state.phase === 'lobby' && state.map.seed === mapSeed)
      send({ type: 'ready', ready: !state.players[state.you].ready, mapSeed });
  } else if (op === 'leave') {
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
  } else if (op === 'toggle-combat' || op === 'open-combat') {
    closeGrid();
    combatExpanded = op === 'open-combat' || !combatExpanded;
    if (state) updateHtml(el('combat-status'), combatStatusView(state, combatExpanded, managerPortraitUrl()));
  } else if (op === 'close-combat') closeCombat();
  else if (op === 'filter-items') {
    const category = ITEM_CATEGORIES.find((c) => c.id === button.dataset.category);
    if (category) {
      itemCategory = category.id;
      renderGrid();
    }
  } else if (op === 'close-grid') closeGrid();
  else if (op === 'fit') renderer.fit();
  else if (op === 'locate') renderer.locate();
  else if (op === 'zoom-in') renderer.zoomBy(1.25);
  else if (op === 'zoom-out') renderer.zoomBy(0.8);
  else if (op === 'exit-room' && state && selected >= 0) {
    const room = state.dorms[roomAt(state.map, selected)];
    if (room) act('move', -1, room.entrance);
    closeGrid();
  } else if (['move', 'nest', 'bed', 'door', 'repair', 'build'].includes(op) && state && selected >= 0) {
    if (state.players[state.you].escaping && op !== 'move') {
      closeGrid();
      toast('店门已破，现在只能点击地图逃跑');
      return;
    }
    const room = roomAt(state.map, selected);
    const kind = button.dataset.kind ?? '';
    act(op as Action, room, selected, kind);
    closeGrid();
  } else if (op === 'help') {
    el('modal').innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="eyebrow">A LITTLE MIDNIGHT ADVENTURE</div><h2 id="help-title">今晚，猫猫来营业</h2><ol><li>夜间有 ' +
      (state?.preparation ?? 30) +
      ' 秒准备。点击街道移动，猫猫会绕过墙和货架，从店门进入。</li><li>每局随机生成 8–10 间紧凑猫店，供 6 只猫选择；每店都有一个罐头窝，额外随机放 1–2 个道具。点击空店的窝，猫会走过去安家，谁先到达谁安家，选中猫窝不会提前占位。安家后立即关门，房主不能出门；屋内其他猫可开门出去，出去后不能再进，店长也不能进来。</li><li>点自家空格，选择弹射器、储藏柜或修补台。安装的道具不阻挡猫猫和店长通行，每格只能安装一件。点已有道具、罐头窝或店门，可以升级和修补。</li><li>安家后持续赚罐头，数量显示在右上角。起身后收入保持不变；走到罐头箱上还能拾取物资。</li><li>白天店长回来：先敲门、破门，再进店追猫。店长会随时间、敲门和受击积累怒气值，升级时回复部分生命值，并向全体猫猫播报。地图上方显示全员头像和店长等级、血量，点击头像或“详情”可查看详细战况。店长正在敲门的猫店，其主人头像右下角会出现店长，每 2 秒撞击一次头像，提醒你及时防守。店门被打破后，猫猫自动起身，真人点击地图控制逃跑，AI 自动避让；此时无法安装、升级、修门或回窝。店长会走进房间，接触到猫才会把它抓走；猫没有生命值或扣血阶段。倒计时结束时仍有猫留守就获胜（整局 ' +
      clock((state?.preparation ?? 30) + (state?.duration ?? 570)) +
      '，含准备阶段）。</li></ol><p>开局镜头自动聚焦并跟随自己的猫。滚轮或 ＋／− 缩放，拖动地图暂停跟随，◎ 定位并恢复跟随，⌗ 切到最远视野，拖动查看街区其它区域。多人模式邀请好友加入，剩余位置自动补 AI。</p><button class="primary wide" data-do="close-help">知道啦，去找罐头 ↗</button></div>';
    el('modal').classList.remove('hidden');
  } else if (op === 'close-help') el('modal').classList.add('hidden');
});
document.addEventListener('pointerdown', (event) => {
  const outsideGrid = selected >= 0 && !el('grid-menu').contains(event.target as Node);
  const outsideCombat = combatExpanded && !el('combat-status').contains(event.target as Node);
  dismissedPanelOnPress = outsideGrid || outsideCombat;
  if (outsideGrid) closeGrid();
  if (outsideCombat) closeCombat();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeGrid();
    closeCombat();
    el('modal').classList.add('hidden');
  }
});
connection.connect();
render();
window.addEventListener('beforeunload', () => connection.dispose());
