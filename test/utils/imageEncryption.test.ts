import { describe, it, expect } from "vitest";
import {
  encryptImage,
  decryptImage,
  generateGroupKey,
} from "../../src/utils/imageEncryption.js";

describe("imageEncryption", () => {
  const sampleImage = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, // JPEG header bytes
    ...Array.from({ length: 100 }, (_, i) => i % 256),
  ]);

  it("generateGroupKey returns 32 bytes", () => {
    const key = generateGroupKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("generates unique keys", () => {
    const key1 = generateGroupKey();
    const key2 = generateGroupKey();
    expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
  });

  it("encrypts and decrypts image data", async () => {
    const groupKey = generateGroupKey();
    const encrypted = await encryptImage(sampleImage, groupKey);

    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.salt.length).toBe(32);
    expect(encrypted.nonce.length).toBe(12);

    // Ciphertext should be different from plaintext
    expect(Buffer.from(encrypted.ciphertext).equals(Buffer.from(sampleImage))).toBe(false);

    // Decrypt should produce the original
    const decrypted = await decryptImage(
      encrypted.ciphertext,
      groupKey,
      encrypted.salt,
      encrypted.nonce,
    );
    expect(Buffer.from(decrypted)).toEqual(Buffer.from(sampleImage));
  });

  it("produces unique salt and nonce per encryption", async () => {
    const groupKey = generateGroupKey();
    const enc1 = await encryptImage(sampleImage, groupKey);
    const enc2 = await encryptImage(sampleImage, groupKey);

    // salt and nonce should differ
    expect(Buffer.from(enc1.salt).equals(Buffer.from(enc2.salt))).toBe(false);
    expect(Buffer.from(enc1.nonce).equals(Buffer.from(enc2.nonce))).toBe(false);

    // But both should decrypt to the same plaintext
    const dec1 = await decryptImage(enc1.ciphertext, groupKey, enc1.salt, enc1.nonce);
    const dec2 = await decryptImage(enc2.ciphertext, groupKey, enc2.salt, enc2.nonce);
    expect(Buffer.from(dec1)).toEqual(Buffer.from(sampleImage));
    expect(Buffer.from(dec2)).toEqual(Buffer.from(sampleImage));
  });

  it("fails to decrypt with wrong group key", async () => {
    const groupKey = generateGroupKey();
    const wrongKey = generateGroupKey();
    const encrypted = await encryptImage(sampleImage, groupKey);

    await expect(
      decryptImage(encrypted.ciphertext, wrongKey, encrypted.salt, encrypted.nonce),
    ).rejects.toThrow();
  });

  it("fails to decrypt with wrong salt", async () => {
    const groupKey = generateGroupKey();
    const encrypted = await encryptImage(sampleImage, groupKey);
    const wrongSalt = new Uint8Array(32).fill(0xaa);

    await expect(
      decryptImage(encrypted.ciphertext, groupKey, wrongSalt, encrypted.nonce),
    ).rejects.toThrow();
  });

  it("fails to decrypt with wrong nonce", async () => {
    const groupKey = generateGroupKey();
    const encrypted = await encryptImage(sampleImage, groupKey);
    const wrongNonce = new Uint8Array(12).fill(0xbb);

    await expect(
      decryptImage(encrypted.ciphertext, groupKey, encrypted.salt, wrongNonce),
    ).rejects.toThrow();
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const groupKey = generateGroupKey();
    const encrypted = await encryptImage(sampleImage, groupKey);

    // Tamper with ciphertext
    const tampered = new Uint8Array(encrypted.ciphertext);
    tampered[0] ^= 0xff;

    await expect(
      decryptImage(tampered, groupKey, encrypted.salt, encrypted.nonce),
    ).rejects.toThrow();
  });

  it("rejects invalid group key length", async () => {
    const shortKey = new Uint8Array(16);
    await expect(encryptImage(sampleImage, shortKey)).rejects.toThrow("Invalid group key length");
  });

  it("rejects invalid salt length on decrypt", async () => {
    const groupKey = generateGroupKey();
    const encrypted = await encryptImage(sampleImage, groupKey);
    const shortSalt = new Uint8Array(16);

    await expect(
      decryptImage(encrypted.ciphertext, groupKey, shortSalt, encrypted.nonce),
    ).rejects.toThrow("Invalid salt length");
  });

  it("rejects invalid nonce length on decrypt", async () => {
    const groupKey = generateGroupKey();
    const encrypted = await encryptImage(sampleImage, groupKey);
    const shortNonce = new Uint8Array(8);

    await expect(
      decryptImage(encrypted.ciphertext, groupKey, encrypted.salt, shortNonce),
    ).rejects.toThrow("Invalid nonce length");
  });

  it("handles empty image data", async () => {
    const groupKey = generateGroupKey();
    const empty = new Uint8Array(0);
    const encrypted = await encryptImage(empty, groupKey);

    // GCM with empty plaintext produces only the 16-byte auth tag
    expect(encrypted.ciphertext.length).toBe(16);

    const decrypted = await decryptImage(
      encrypted.ciphertext,
      groupKey,
      encrypted.salt,
      encrypted.nonce,
    );
    expect(decrypted.length).toBe(0);
  });

  it("handles large image data", async () => {
    const groupKey = generateGroupKey();
    // 1MB image
    const largeImage = new Uint8Array(1024 * 1024);
    for (let i = 0; i < largeImage.length; i++) {
      largeImage[i] = i % 256;
    }

    const encrypted = await encryptImage(largeImage, groupKey);
    const decrypted = await decryptImage(
      encrypted.ciphertext,
      groupKey,
      encrypted.salt,
      encrypted.nonce,
    );
    expect(Buffer.from(decrypted)).toEqual(Buffer.from(largeImage));
  });
});
