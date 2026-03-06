import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AttachmentCodec,
  RemoteAttachmentCodec,
} from "@xmtp/content-type-remote-attachment";
import { Client, IdentifierKind, LogLevel } from "@xmtp/node-sdk";
import { ProfileUpdateCodec, ProfileSnapshotCodec } from "./profileMessages.js";
import { JoinRequestCodec } from "./joinRequest.js";
import { toHexBytes, hexToBytes } from "./xmtp.js";
import { privateKeyToAccount } from "viem/accounts";
import type { ConvosConfig } from "./config.js";
import type { Identity } from "./identities.js";
import { createIdentityStore } from "./identities.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"),
) as { version: string };
const DEFAULT_APP_VERSION = `convos-cli/${pkg.version}`;

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
): Promise<Client<any>> {
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
    codecs: [
      new AttachmentCodec(),
      new RemoteAttachmentCodec(),
      new ProfileUpdateCodec() as any,
      new ProfileSnapshotCodec() as any,
      new JoinRequestCodec() as any,
    ],
    dbEncryptionKey: toHexBytes(identity.dbEncryptionKey),
    dbPath,
    gatewayHost: config.gatewayHost,
    loggingLevel: config.logLevel ? LOG_LEVELS[config.logLevel] : undefined,
    structuredLogging: config.structuredLogging,
    disableDeviceSync: true, // Per ADR 002: each conversation is independent
    appVersion: config.appVersion ?? DEFAULT_APP_VERSION,
  });

  // Cache the inbox ID on the identity
  if (!identity.inboxId) {
    store.update(identity.id, { inboxId: client.inboxId });
  }

  return client;
}
