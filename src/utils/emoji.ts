/**
 * EmojiSelector — deterministic emoji generation from a seed string.
 * Matches the iOS implementation (ConvosCore/Utilities/EmojiSelector.swift).
 *
 * Algorithm: SHA-256(seed) → first byte mod emoji count → emoji
 */

import { createHash } from "node:crypto";

export const EMOJIS: readonly string[] = [
  // Objects
  "🥫", "🎸", "🎨", "🎯", "🎪", "🎭", "🎬", "🎤", "🎧", "🎹",
  "🎺", "🎻", "🪘", "🪗", "🎲", "🎮", "🧩", "🪀", "🪁", "🧸",
  "🪆", "🔮", "🧿", "🪬", "🎰", "🛸", "🚀", "⚓️", "🧲", "💎",
  // Nature
  "🌵", "🌊", "🍄", "🌸", "🌈", "🌻", "🌴", "🌲", "🍀", "🌾",
  "🪻", "🪷", "🪹", "🪺", "🌙", "⭐️", "🌍", "🔥", "💧", "🌪️",
  // Animals
  "🦊", "🐙", "🦋", "🐢", "🦩", "🦄", "🐋", "🦈", "🦑", "🐠",
  "🦜", "🦚", "🦢", "🦉", "🦇", "🐝", "🐌", "🦎", "🐲", "🦕",
  // Food
  "🍕", "🌮", "🍩", "🍦", "🥑", "🍎", "🍋", "🍇", "🥝", "🍒",
  "🧁", "🍰", "🍪", "🥨", "🥐", "🧀", "🥗", "🍜", "🍣", "🥟",
] as const;

/**
 * Generate a deterministic emoji for a given identifier string.
 * Uses SHA-256 hash, first byte mod emoji count — matching iOS exactly.
 */
export function emojiForIdentifier(identifier: string): string {
  const hash = createHash("sha256").update(identifier, "utf-8").digest();
  const index = hash[0] % EMOJIS.length;
  return EMOJIS[index];
}
