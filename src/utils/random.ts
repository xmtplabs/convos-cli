import { randomBytes } from "node:crypto";

/**
 * Generate a random alphanumeric string of the given length.
 * Uses rejection sampling to avoid modulo bias.
 */
export function randomAlphanumeric(length: number): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const maxValid = 256 - (256 % chars.length); // 252 for 62 chars
  const result: string[] = [];
  while (result.length < length) {
    const bytes = randomBytes(length - result.length);
    for (const b of bytes) {
      if (b < maxValid && result.length < length) {
        result.push(chars[b % chars.length]);
      }
    }
  }
  return result.join("");
}
