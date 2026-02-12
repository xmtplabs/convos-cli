import type { XmtpEnv } from "@xmtp/node-sdk";

/**
 * Convos-specific config. The per-identity wallet/db keys are not here —
 * they live in each Identity. This holds global settings only.
 */
export interface ConvosConfig {
  env?: XmtpEnv;
  logLevel?: string;
  structuredLogging?: boolean;
  gatewayHost?: string;
  appVersion?: string;
  uploadProvider?: string;
  uploadProviderToken?: string;
  uploadProviderGateway?: string;
}
