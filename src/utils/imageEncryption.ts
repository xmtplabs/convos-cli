/**
 * AES-256-GCM image encryption for Convos per-conversation profiles.
 *
 * Matches the iOS implementation in ConvosProfiles/Crypto/ImageEncryption.swift:
 * - HKDF-SHA256 to derive a per-image key from the group key + random salt
 * - AES-256-GCM encryption with random nonce
 * - Ciphertext format: encrypted data + 16-byte GCM auth tag (nonce stripped)
 *
 * Each group has a 32-byte encryption key stored in
 * ConversationCustomMetadata.imageEncryptionKey (appData field 4).
 */

import { webcrypto } from "node:crypto";

const HKDF_INFO = new TextEncoder().encode("ConvosImageV1");
const SALT_LENGTH = 32;
const NONCE_LENGTH = 12;

export interface EncryptedPayload {
  /** AES-GCM ciphertext with appended auth tag (nonce NOT prepended) */
  ciphertext: Uint8Array;
  /** 32-byte HKDF salt for key derivation */
  salt: Uint8Array;
  /** 12-byte AES-GCM nonce */
  nonce: Uint8Array;
}

/**
 * Generate a new 32-byte AES-256 group key.
 */
export function generateGroupKey(): Uint8Array {
  return webcrypto.getRandomValues(new Uint8Array(32));
}

/**
 * Derive a per-image AES-256 key from the group key and salt using HKDF-SHA256.
 *
 * Matches iOS: HKDF<SHA256>.deriveKey(inputKeyMaterial: groupKey, salt: salt, info: "ConvosImageV1", outputByteCount: 32)
 */
async function deriveKey(
  groupKey: Uint8Array,
  salt: Uint8Array,
): Promise<webcrypto.CryptoKey> {
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    groupKey,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return webcrypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: HKDF_INFO,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt image data using AES-256-GCM.
 *
 * @param imageData - Plaintext image data (JPEG, PNG, etc.)
 * @param groupKey - 32-byte group encryption key
 * @returns Encrypted payload with ciphertext, salt, and nonce
 */
export async function encryptImage(
  imageData: Uint8Array,
  groupKey: Uint8Array,
): Promise<EncryptedPayload> {
  if (groupKey.length !== 32) {
    throw new Error(`Invalid group key length: expected 32, got ${groupKey.length}`);
  }

  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const nonce = webcrypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  const derivedKey = await deriveKey(groupKey, salt);

  // AES-GCM encrypt — result is ciphertext + 16-byte auth tag
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    derivedKey,
    imageData,
  );

  return {
    ciphertext: new Uint8Array(encrypted),
    salt,
    nonce,
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 *
 * @param ciphertext - Encrypted data with appended auth tag (no nonce prefix)
 * @param groupKey - 32-byte group encryption key
 * @param salt - 32-byte HKDF salt used during encryption
 * @param nonce - 12-byte AES-GCM nonce used during encryption
 * @returns Decrypted plaintext image data
 */
export async function decryptImage(
  ciphertext: Uint8Array,
  groupKey: Uint8Array,
  salt: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  if (groupKey.length !== 32) {
    throw new Error(`Invalid group key length: expected 32, got ${groupKey.length}`);
  }
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Invalid salt length: expected ${SALT_LENGTH}, got ${salt.length}`);
  }
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`Invalid nonce length: expected ${NONCE_LENGTH}, got ${nonce.length}`);
  }

  const derivedKey = await deriveKey(groupKey, salt);

  const decrypted = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    derivedKey,
    ciphertext,
  );

  return new Uint8Array(decrypted);
}

/**
 * Download image data from a URL.
 */
export async function fetchImageData(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
