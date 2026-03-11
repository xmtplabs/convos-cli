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
  /** S3 bucket name (for s3 upload provider) */
  s3Bucket?: string;
  /** S3 region (for s3 upload provider, default: us-east-1) */
  s3Region?: string;
  /** S3-compatible endpoint URL (for MinIO, R2, etc.) */
  s3Endpoint?: string;
  /** Convos API key (for convos-api upload provider) */
  convosApiKey?: string;
  /** Convos API base URL (default: derived from env) */
  convosApiBaseUrl?: string;
}
