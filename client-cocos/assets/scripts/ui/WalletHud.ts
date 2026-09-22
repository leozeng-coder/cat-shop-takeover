import { Color, Label, Node, UITransform, VerticalTextAlignment } from 'cc';
import { SharedArt } from '../art/SharedArt';
import type { GameState } from '../model/GameTypes';
import { UI_COLORS, UiSkin } from './UiSkin';

const ICONS: Record<string, string> = { cans: 'can', dried_fish: 'fish' };

export class WalletHud {
  readonly node: Node;
  private readonly skin: UiSkin;
  private signature = '';
  private readonly amounts = new Map<string, Label>();

  constructor(parent: Node, private readonly art: SharedArt) {
    this.skin = new UiSkin(art);
    this.node = new Node('Wallet');
    this.node.layer = parent.layer;
    this.node.setParent(parent);
    this.node.addComponent(UITransform).setContentSize(280, 48);
  }

  update(state: GameState): void {
    const currencies = state.catalog.currencies;
    const key = currencies.map((entry) => `${entry.id}:${entry.symbol}`).join('|');
    if (key !== this.signature) {
      this.signature = key;
      this.amounts.clear();
      for (const child of [...this.node.children]) child.destroy();
      const width = 280 / Math.max(1, currencies.length);
      currencies.forEach((currency, index) => {
        const card = new Node(`Currency-${currency.id}`);
        card.layer = this.node.layer;
        card.setParent(this.node);
        card.setPosition(-140 + width * (index + 0.5), 0);
        card.addComponent(UITransform).setContentSize(width - 6, 46);
        this.skin.surface(card, 'hud');
        const icon = ICONS[currency.id];
        if (icon) this.skin.image(card, 'CurrencyIcon', this.art.ui(icon), -width / 2 + 26, 0, 30);
        const amountNode = new Node('Amount');
        amountNode.layer = card.layer;
        amountNode.setParent(card);
        amountNode.setPosition(icon ? 17 : 0, 0);
        amountNode.addComponent(UITransform).setContentSize(width - (icon ? 54 : 16), 36);
        const label = amountNode.addComponent(Label);
        label.fontSize = 23;
        label.lineHeight = 28;
        label.isBold = true;
        label.verticalAlign = VerticalTextAlignment.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        label.color = new Color(UI_COLORS.text);
        this.amounts.set(currency.id, label);
      });
    }
    for (const currency of currencies) {
      const amount = Math.floor(state.players[state.you].wallet[currency.id] ?? 0);
      this.amounts.get(currency.id)!.string = `${ICONS[currency.id] ? '' : currency.symbol + ' '}${amount}`;
    }
  }
}
