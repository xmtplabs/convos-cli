import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Client, IdentifierKind, LogLevel } from "@xmtp/node-sdk";
import { toHexBytes, hexToBytes } from "./xmtp.js";
import { privateKeyToAccount } from "viem/accounts";
import type { ConvosConfig } from "./config.js";
import type { Identity } from "./identities.js";
import { createIdentityStore } from "./identities.js";

const LOG_LEVELS: Record<string, LogLevel> = {
  off: LogLevel.Off,
  error: LogLevel.Error,
  warn: LogLevel.Warn,
  info: LogLevel.Info,
  debug: LogLevel.Debug,
  trace: LogLevel.Trace,
};

/**
 * Create an XMTP client for a specific Convos identity.
 * Each conversation gets its own identity and client (ADR 002).
 */
export async function createClientForIdentity(
  identity: Identity,
  config: ConvosConfig,
): Promise<Client> {
  const store = createIdentityStore();
  const env = config.env ?? "dev";
  const dbPath = store.getDbPath(identity.id, env);

  const account = privateKeyToAccount(identity.walletKey as `0x${string}`);

  const signer = {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifierKind: IdentifierKind.Ethereum,
      identifier: account.address.toLowerCase(),
    }),
    signMessage: async (message: string) => {
      const signature = await account.signMessage({ message });
      return hexToBytes(signature);
    },
  };

  await mkdir(dirname(dbPath), { recursive: true });

  const client = await Client.create(signer, {
    env,
    dbEncryptionKey: toHexBytes(identity.dbEncryptionKey),
    dbPath,
    gatewayHost: config.gatewayHost,
    loggingLevel: config.logLevel ? LOG_LEVELS[config.logLevel] : undefined,
    structuredLogging: config.structuredLogging,
    disableDeviceSync: true, // Per ADR 002: each conversation is independent
    appVersion: config.appVersion ?? "convos-cli/0.1.0",
  });

  // Cache the inbox ID on the identity
  if (!identity.inboxId) {
    store.update(identity.id, { inboxId: client.inboxId });
  }

  return client;
}
