import type { CharacterAsset } from "./types";

export type CharacterRole = "cats" | "managers";
export function characterRole(character: CharacterAsset): CharacterRole {
  return character.profile === "shop_manager" ? "managers" : "cats";
}
export function characterName(character: CharacterAsset) {
  return (
    character.name ||
    (
      { cat_orange: "元气橘猫", shop_manager: "便利店店长" } as Record<
        string,
        string
      >
    )[character.id] ||
    character.id
  );
}
