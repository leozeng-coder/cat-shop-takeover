import { roomAt, type State, type PropKind } from '../types';
import { escapeHtml } from './format';
const names: Record<PropKind, string> = {
  shelf: '旧货架',
  crate: '遗落的罐头箱',
  launcher: '毛线弹射器',
  pantry: '罐头储藏柜',
  repair: '自动修补台',
};
function action(
  doName: string,
  title: string,
  description: string,
  price: string,
  symbol: string,
  disabled = false,
  kind = '',
) {
  return `<button class="grid-action" data-do="${doName}" data-kind="${kind}" ${disabled ? 'disabled' : ''}><span class="symbol">${symbol}</span><span><strong>${title}</strong><small>${description}</small></span><span class="price">${price}</span></button>`;
}
export function gridMenuView(g: State, cell: number) {
  const rid = roomAt(g.map, cell),
    room = g.dorms[rid],
    me = g.players[g.you];
  if (!room) return '';
  const prop = room.props.find((p) => p.cell === cell),
    mine = room.owner === g.you;
  let title =
    cell === room.nest
      ? '罐头窝'
      : cell === room.door
        ? room.closed
          ? '店门 · 已关闭'
          : '猫店入口'
        : prop
          ? names[prop.kind]
          : '空地格';
  let body = '',
    description = mine
      ? '在这个格子安装道具，记得为猫猫留出通道。'
      : room.owner < 0
        ? '店长不在，找到罐头窝就能在这里安家。'
        : escapeHtml(g.players[room.owner].name) + ' 的猫店';
  if (cell === room.nest) {
    description = mine
      ? '已经安家，罐头持续产出。可以躺下休息，也可以起身在屋内活动。'
      : room.owner < 0
        ? '走到罐头窝安家后，店门会自动关闭，罐头开始持续产出。'
        : escapeHtml(g.players[room.owner].name) + ' 的罐头窝';
    if (room.owner < 0 || mine) {
      if (!me.sleeping)
        body += action(
          'nest',
          mine ? '躺回罐头窝' : '进入罐头窝',
          mine ? '回窝休息，罐头收入保持不变' : '走到窝里安家，自动关门并持续赚罐头',
          mine ? '躺下' : '去安家',
          '☾',
        );
      if (mine) {
        body += action(
          'bed',
          '升级罐头窝 · Lv.' + me.bed,
          me.bed < 3 ? '基础产出提升至 ' + g.rules.bedIncome[me.bed] + ' 罐头 / 秒' : '已达最高等级',
          me.bed < 3 ? '🥫 ' + g.rules.bedCost[me.bed - 1] : '满级',
          '▱',
          me.bed >= 3 || me.gold < g.rules.bedCost[me.bed - 1],
        );
        if (me.sleeping)
          body += action('move', '起身活动', '起身后点击屋内空格走动，罐头照常赚', '起床', '↗');
      }
    }
  } else if (cell === room.door) {
    description =
      (room.closed
        ? '店门已关闭，所有角色都无法穿过。'
        : room.hp <= 0
          ? '店门已被打破，店长可以进屋抓猫。'
          : '店门敞开，安家后自动关闭。') +
      ' 耐久 ' +
      Math.ceil(room.hp) +
      ' / ' +
      room.maxHp +
      ' · Lv.' +
      room.level;
    body += `<div class="health-meter"><i style="width:${(100 * room.hp) / room.maxHp}%"></i></div>`;
    if (mine)
      body += action(
        'door',
        '加固店门',
        '增加耐久上限，同时补充新增耐久',
        room.level < 3 ? '🥫 ' + g.rules.doorCost[room.level - 1] : '满级',
        '▥',
        room.level >= 3 || room.hp <= 0 || me.gold < g.rules.doorCost[room.level - 1],
      );
    if (room.owner >= 0 && me.room >= 0)
      body += action(
        'repair',
        '修补店门',
        '恢复 140 耐久 · 5 秒冷却',
        '🥫 45',
        '✚',
        room.hp <= 0 || room.hp >= room.maxHp || me.gold < 45 || me.repairCooldown > 0,
      );
    if (!room.closed && (room.owner < 0 || mine))
      body += action('move', '走到入口', '从入口进出猫店', '移动', '↗');
  } else if (prop) {
    if (prop.kind === 'crate')
      body += action('move', '拾取罐头箱', '走到这个格子，获得 35 罐头', '+35', '🥫');
    else if (prop.kind === 'shelf') description = '固定货架挡住了这个格子。猫猫会绕开它行走。';
    else if (mine) {
      const costs =
        prop.kind === 'launcher'
          ? g.rules.towerCost
          : prop.kind === 'pantry'
            ? g.rules.pantryCost
            : g.rules.repairCost;
      const desc =
        prop.kind === 'launcher'
          ? '用毛线球把附近的店长赶退'
          : prop.kind === 'pantry'
            ? '持续增加罐头收入，躺下和走动都生效'
            : '每秒自动修复店门耐久';
      body += action(
        'build',
        '升级' + names[prop.kind] + ' · Lv.' + prop.level,
        desc,
        prop.level < 3 ? '🥫 ' + costs[prop.level] : '满级',
        prop.kind === 'launcher' ? '✣' : prop.kind === 'pantry' ? '▤' : '✚',
        prop.level >= 3 || me.gold < costs[prop.level],
        prop.kind,
      );
    }
  } else {
    body += action(
      'move',
      '走到这里',
      mine ? '屋内自由走动，罐头持续增加' : '自动绕过墙体和道具',
      '移动',
      '↗',
    );
    if (mine) {
      body += action(
        'build',
        '安装毛线弹射器',
        '自动攻击附近的店长',
        '🥫 ' + g.rules.towerCost[0],
        '✣',
        me.gold < g.rules.towerCost[0],
        'launcher',
      );
      body += action(
        'build',
        '安装罐头储藏柜',
        '持续额外 +2 罐头 / 秒',
        '🥫 ' + g.rules.pantryCost[0],
        '▤',
        me.gold < g.rules.pantryCost[0],
        'pantry',
      );
      body += action(
        'build',
        '安装自动修补台',
        '店门每秒恢复 2 耐久',
        '🥫 ' + g.rules.repairCost[0],
        '✚',
        me.gold < g.rules.repairCost[0],
        'repair',
      );
    }
  }
  if (!me.alive) body = '';
  return `<div class="grid-menu-header"><h3>${title}</h3><button data-do="close-grid" aria-label="关闭格子菜单">×</button></div><p>${description}</p>${body}<div class="tile-caption">${rid + 1} 号猫店 · 网格 (${cell % g.map.width}, ${Math.floor(cell / g.map.width)}) · ${room.area} 格面积</div>`;
}
