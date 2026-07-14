import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AttachmentCodec,
  RemoteAttachmentCodec,
} from "@xmtp/content-type-remote-attachment";
import { Client, IdentifierKind, LogLevel } from "@xmtp/node-sdk";
import type { ClientOptions } from "@xmtp/node-sdk";
import { ProfileUpdateCodec, ProfileSnapshotCodec } from "./profileMessages.js";
import { JoinRequestCodec } from "./joinRequest.js";
import { TypingIndicatorCodec } from "./typingIndicator.js";
import { ExplodeSettingsCodec } from "./explodeSettings.js";
import { ConnectionPayloadCodec } from "./connectionPayload.js";
import { ConnectionInvocationCodec } from "./connectionInvocation.js";
import { ConnectionInvocationResultCodec } from "./connectionInvocationResult.js";
import { ConnectionEventCodec } from "./connectionEvent.js";
import { CapabilityRequestCodec } from "./capabilityRequest.js";
import { CapabilityRequestResultCodec } from "./capabilityRequestResult.js";
import { CloudConnectionGrantRequestCodec } from "./cloudConnectionGrantRequest.js";
import { ThinkingCodec } from "./thinking.js";
import { ThinkingControlCodec } from "./thinkingControl.js";
import { toHexBytes, hexToBytes } from "./xmtp.js";
import { privateKeyToAccount } from "viem/accounts";
import type { ConvosConfig } from "./config.js";
import type { Identity } from "./identities.js";
import { createIdentityStore, DEFAULT_CONVOS_HOME } from "./identities.js";

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

/** Process-wide cache: one XMTP client per (home, env). */
const clientCache = new Map<string, Promise<Client<any>>>();

function cacheKey(homeDir: string, env: string): string {
  return `${homeDir}::${env}`;
}

/**
 * Get the XMTP client for this install's singleton identity.
 * Creates the identity and registers the client on first call;
 * returns the cached client on subsequent calls within the process.
 *
 * Per ADR 011: one XMTP inbox per install, shared across all conversations.
 *
 * @param config - Convos configuration
 * @param homeDir - Convos home directory (default: $CONVOS_HOME or ~/.convos)
 */
export async function getClient(
  config: ConvosConfig,
  homeDir?: string,
): Promise<Client<any>> {
  const resolvedHome = homeDir ?? DEFAULT_CONVOS_HOME;
  const store = createIdentityStore(resolvedHome);
  const env = config.env ?? "dev";
  const key = cacheKey(resolvedHome, env);

  const cached = clientCache.get(key);
  if (cached) return cached;

  // .then(onSuccess, onError) doesn't catch throws from onSuccess — so a
  // post-build store.load/update failure would leave a rejected promise
  // permanently cached. Chain .then().catch() so any throw clears the entry.
  const promise = buildClient(store.loadOrUpsert(), config, resolvedHome)
    .then((client) => {
      if (!store.load()?.inboxId) {
        store.update({ inboxId: client.inboxId });
      }
      return client;
    })
    .catch((error) => {
      clientCache.delete(key);
      throw error;
    });

  clientCache.set(key, promise);
  return promise;
}

/**
 * Get the singleton identity and its XMTP client together.
 * Convenience for commands that need both.
 */
export async function getIdentityAndClient(
  config: ConvosConfig,
  homeDir?: string,
): Promise<{ identity: Identity; client: Client<any> }> {
  const client = await getClient(config, homeDir);
  const identity = createIdentityStore(homeDir).load();
  if (!identity) {
    throw new Error("Identity was unexpectedly missing after client creation");
  }
  return { identity, client };
}

async function buildClient(
  identity: Identity,
  config: ConvosConfig,
  homeDir?: string,
): Promise<Client<any>> {
  const store = createIdentityStore(homeDir);
  const env = config.env ?? "dev";
  const dbPath = store.getDbPath(env);

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

  // ClientOptions is a discriminated union `(NetworkOptions | { backend }) & ...`
  // in node-sdk >=6.0; pass the network-arm options as a typed value so `env`
  // and `gatewayHost` survive the type system.
  const options: ClientOptions = {
    env,
    codecs: [
      new AttachmentCodec(),
      new RemoteAttachmentCodec(),
      new ProfileUpdateCodec() as any,
      new ProfileSnapshotCodec() as any,
      new JoinRequestCodec() as any,
      new TypingIndicatorCodec() as any,
      new ExplodeSettingsCodec() as any,
      new ConnectionPayloadCodec() as any,
      new ConnectionInvocationCodec() as any,
      new ConnectionInvocationResultCodec() as any,
      new ConnectionEventCodec() as any,
      new CapabilityRequestCodec() as any,
      new CapabilityRequestResultCodec() as any,
      new CloudConnectionGrantRequestCodec() as any,
      new ThinkingCodec() as any,
      new ThinkingControlCodec() as any,
    ],
    dbEncryptionKey: toHexBytes(identity.dbEncryptionKey),
    dbPath,
    gatewayHost: config.gatewayHost,
    loggingLevel: config.logLevel ? LOG_LEVELS[config.logLevel] : undefined,
    structuredLogging: config.structuredLogging,
    appVersion: config.appVersion ?? DEFAULT_APP_VERSION,
  };

  return Client.create(signer, options);
}
