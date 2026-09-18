import { characterLibrary } from '../characters/character_library';
import { characterKey, type CharacterOption, type CharacterSelection } from '../characters/types';
import { escapeHtml } from './format';

export function characterPortrait(selection: CharacterSelection) {
  const card = characterLibrary.card(selection);
  return card
    ? `<img class="character-portrait" src="${escapeHtml(card.portrait)}" alt="${escapeHtml(card.name)}" draggable="false" />`
    : '<span class="character-placeholder" aria-label="猫猫">🐾</span>';
}
export function characterPickerView(
  options: CharacterOption[],
  selected: CharacterSelection | null,
  action: string,
  disabled = false,
) {
  const cards = options.flatMap((option) => option.skins.map((skin) => ({ character: option.id, skin })));
  return `<div class="character-options" role="group" aria-label="选择你的猫猫">${cards
    .map((selection) => {
      const card = characterLibrary.card(selection);
      const active = selected && characterKey(selected) === characterKey(selection);
      return `<button class="character-option ${active ? 'active' : ''}" data-do="${action}" data-character="${escapeHtml(selection.character)}" data-skin="${escapeHtml(selection.skin)}" aria-label="${escapeHtml(card?.name ?? '猫猫加载中')}" aria-pressed="${!!active}" ${disabled || !card ? 'disabled' : ''}>${characterPortrait(selection)}<span>${escapeHtml(card?.name ?? '加载中…')}</span><i aria-hidden="true">${active ? '✓' : ''}</i></button>`;
    })
    .join('')}</div>`;
}
