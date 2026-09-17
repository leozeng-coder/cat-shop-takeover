import { roomAt, type State, type Price, type Offer, type ItemConfig, type LevelConfig } from '../types';
import { escapeHtml as e } from './format';
function action(
  doName: string,
  title: string,
  description: string,
  price: string,
  symbol: string,
  disabled = false,
  kind = '',
) {
  return (
    '<button class="grid-action" data-do="' +
    e(doName) +
    '" data-kind="' +
    e(kind) +
    '" ' +
    (disabled ? 'disabled' : '') +
    '><span class="symbol">' +
    e(symbol) +
    '</span><span><strong>' +
    e(title) +
    '</strong><small>' +
    e(description) +
    '</small></span><span class="price">' +
    e(price) +
    '</span></button>'
  );
}
function price(g: State, costs: Price[]) {
  return costs
    .map(
      (c) => (g.catalog.currencies.find((v) => v.id === c.currency)?.symbol ?? c.currency) + ' ' + c.amount,
    )
    .join(' + ');
}
function details(text: string, required: string[], offer: Offer) {
  const isUnmet = (condition: string) => !offer.enabled && offer.reason === '需要' + condition;
  const condition = required.length
    ? ' · 需要：' + required.map((r) => r + (isUnmet(r) ? '（未满足）' : '')).join('、')
    : '';
  return text + condition + (!offer.enabled && !required.some(isUnmet) ? ' · ' + offer.reason : '');
}
function effect(g: State, item: ItemConfig, l: LevelConfig) {
  const seconds = l.intervalMs / 1000;
  if (item.behavior === 'currency_producer')
    return (
      '每 ' +
      seconds +
      ' 秒产出 ' +
      l.amount +
      ' ' +
      g.catalog.currencies.find((c) => c.id === item.currency)!.name
    );
  if (item.behavior === 'single_attack')
    return '伤害 ' + l.amount + ' · 间隔 ' + seconds + ' 秒 · 射程 ' + l.range;
  if (item.behavior === 'door_repair') return '每 ' + seconds + ' 秒恢复店门 ' + l.amount + ' 耐久';
  if (item.behavior === 'door_attack_delay')
    return '每 ' + seconds + ' 秒将店长下次敲自家门延后 ' + l.amount / 1000 + ' 秒';
  return '';
}
function itemButton(g: State, item: ItemConfig, target: number, upgrade: boolean) {
  if (!target) return action('build', item.name + ' · 已满级', '已达最高等级', '满级', '✧', true, item.id);
  const l = item.levels[target - 1],
    offer = g.offers.items[item.id][target - 1];
  const symbol =
    item.category === 'attack'
      ? '✣'
      : item.category === 'currency'
        ? g.catalog.currencies.find((c) => c.id === item.currency)!.symbol
        : item.behavior === 'door_attack_delay'
          ? '❄'
          : '✚';
  return action(
    'build',
    (upgrade ? '升级' : '安装') + item.name + (upgrade ? '至 ' + target + '级' : ''),
    details(effect(g, item, l) + (item.unique ? ' · 每位玩家限一件' : ''), l.requirements, offer),
    price(g, l.cost),
    symbol,
    !offer.enabled,
    item.id,
  );
}
export function gridMenuView(g: State, cell: number) {
  const rid = roomAt(g.map, cell),
    room = g.dorms[rid],
    me = g.players[g.you];
  if (!room) return '';
  const prop = room.props.find((p) => p.cell === cell),
    mine = room.owner === g.you;
  const item = prop ? g.catalog.items[prop.kind] : undefined;
  const title =
    cell === room.nest
      ? '罐头窝'
      : cell === room.door
        ? room.doorName + (room.closed ? ' · 已关闭' : room.hp <= 0 ? ' · 已破坏' : ' · 敞开')
        : item
          ? item.name
          : '空地格';
  let body = '',
    description = mine
      ? '在这个格子安装道具，记得为猫猫留出通道。'
      : room.owner < 0
        ? '店长不在，找到罐头窝就能在这里安家。'
        : g.players[room.owner].name + ' 的猫店';
  if (cell === room.nest) {
    description = mine
      ? '已经安家，持续产出。可以躺下休息，也可以起身在屋内活动。'
      : room.owner < 0
        ? '走到罐头窝安家后，店门会自动关闭，罐头开始持续产出。'
        : g.players[room.owner].name + ' 的罐头窝';
    if (room.owner < 0 || mine) {
      if (!me.sleeping)
        body += action(
          'nest',
          mine ? '躺回罐头窝' : '进入罐头窝',
          mine ? '回窝休息，收入保持不变' : '走到窝里安家，自动关门并持续赚罐头',
          mine ? '躺下' : '去安家',
          '☾',
        );
      if (mine) {
        const next = g.catalog.nests[me.bed - 1].nextLevel;
        const l = next ? g.catalog.nests[next - 1] : null;
        const currency = l ? g.catalog.currencies.find((c) => c.id === l.currency)!.name : '';
        body += action(
          'bed',
          l ? '升级罐头窝至 ' + next + '级' : '罐头窝 · 已满级',
          l
            ? details(
                '每 ' + l.intervalMs / 1000 + ' 秒产出 ' + l.amount + ' ' + currency,
                l.requirements,
                g.offers.nest,
              )
            : '已达最高等级',
          l ? price(g, l.cost) : '满级',
          '▱',
          !g.offers.nest.enabled,
        );
        if (me.sleeping) body += action('move', '起身活动', '起身后点击屋内空格走动，收入不变', '起床', '↗');
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
      room.maxHp;
    body +=
      '<div class="health-meter"><i style="width:' +
      Math.max(0, (100 * room.hp) / room.maxHp) +
      '%"></i></div>';
    if (mine) {
      const next = g.catalog.doors[room.level - 1].nextStage,
        d = next ? g.catalog.doors[next - 1] : null;
      body += action(
        'door',
        d ? room.doorName + ' → ' + d.name : room.doorName + ' · 已满级',
        d ? details('耐久提升至 ' + d.maxHp, d.requirements, g.offers.door) : '已达最高阶段',
        d ? price(g, d.cost) : '满级',
        '▥',
        !g.offers.door.enabled,
      );
    }
    if (room.owner >= 0 && me.room >= 0) {
      const r = g.catalog.repair;
      body += action(
        'repair',
        '修补店门',
        details('恢复 ' + r.amount + ' 耐久 · ' + r.cooldown + ' 秒冷却', [], room.repairOffer),
        price(g, r.cost),
        '✚',
        !room.repairOffer.enabled,
      );
    }
    if (!room.closed && (room.owner < 0 || mine))
      body += action('move', '走到入口', '从入口进出猫店', '移动', '↗');
  } else if (prop && item) {
    if (item.behavior === 'pickup') {
      const l = item.levels[prop.level - 1],
        reward = price(g, [{ currency: item.currency, amount: l.amount }]);
      body += action('move', '拾取' + item.name, '走到这个格子，获得 ' + reward, '+' + l.amount, '▣');
    } else if (item.behavior === 'obstacle') {
      description = '货架挡住了这个格子，猫猫会绕开它行走。';
    } else if (mine) {
      description = effect(g, item, item.levels[prop.level - 1]) + (item.unique ? ' · 每位玩家限一件' : '');
      body += itemButton(g, item, item.levels[prop.level - 1].nextLevel, true);
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
      for (const [category, label] of [
        ['currency', '货币产出型'],
        ['attack', '攻击型'],
        ['utility', '功能型'],
      ]) {
        const items = Object.values(g.catalog.items).filter((i) => i.buildable && i.category === category);
        if (!items.length) continue;
        body += '<div class="item-category">' + label + '</div>';
        for (const i of items) body += itemButton(g, i, 1, false);
      }
    }
  }
  if (!me.alive) body = '';
  return (
    '<div class="grid-menu-header"><h3>' +
    e(title) +
    '</h3><button data-do="close-grid" aria-label="关闭格子菜单">×</button></div><p>' +
    e(description) +
    '</p>' +
    body +
    '<div class="tile-caption">' +
    (rid + 1) +
    ' 号猫店 · 网格 (' +
    (cell % g.map.width) +
    ', ' +
    Math.floor(cell / g.map.width) +
    ') · ' +
    room.area +
    ' 格面积</div>'
  );
}
