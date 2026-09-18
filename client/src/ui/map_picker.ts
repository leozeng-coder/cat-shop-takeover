import type { MapOption } from '../types';
import { escapeHtml } from './format';

export function mapPickerView(maps: MapOption[], selected: string, action: string, disabled = false) {
  const button = (id: string, name: string, detail: string) =>
    `<button class="map-choice ${selected === id ? 'selected' : ''}" data-do="${action}" data-map-id="${escapeHtml(id)}" aria-pressed="${selected === id}" ${disabled ? 'disabled' : ''}><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></button>`;
  return `<div class="map-options" role="group" aria-label="选择地图">
    ${button('', '随机街区', '让猫猫决定今晚去哪儿')}
    ${maps.map((map) => button(map.id, map.name, `${map.width}×${map.height} 格 · ${map.minRooms === map.maxRooms ? map.minRooms : map.minRooms + '–' + map.maxRooms} 间猫店`)).join('')}
  </div>`;
}
