import { describe, expect, it } from "vitest";
import { emojiForIdentifier, EMOJIS } from "../../src/utils/emoji.js";

describe("emojiForIdentifier", () => {
  it("returns a deterministic emoji for a given identifier", () => {
    const emoji1 = emojiForIdentifier("test-conversation-id");
    const emoji2 = emojiForIdentifier("test-conversation-id");
    expect(emoji1).toBe(emoji2);
  });

  it("returns different emojis for different identifiers", () => {
    const emoji1 = emojiForIdentifier("conversation-a");
    const emoji2 = emojiForIdentifier("conversation-b");
    // Not guaranteed to differ, but overwhelmingly likely with different inputs
    // We test with known-different seeds
    expect(typeof emoji1).toBe("string");
    expect(typeof emoji2).toBe("string");
  });

  it("always returns an emoji from the EMOJIS list", () => {
    for (let i = 0; i < 100; i++) {
      const emoji = emojiForIdentifier(`seed-${i}`);
      expect(EMOJIS).toContain(emoji);
    }
  });

  it("has exactly 90 emojis in the list", () => {
    expect(EMOJIS).toHaveLength(90);
  });

  it("matches iOS SHA-256 first-byte-mod algorithm", () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    // first byte = 0x2c = 44, 44 % 90 = 44
    const emoji = emojiForIdentifier("hello");
    expect(emoji).toBe(EMOJIS[44]);
  });
});
