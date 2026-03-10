import { createHmac, createHash } from "node:crypto";
import type { ConvosConfig } from "./config.js";

export interface UploadProvider {
  name: string;
  upload(data: Uint8Array, filename: string, mimeType: string): Promise<string>;
}

// ─── Pinata Provider ───

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

class PinataProvider implements UploadProvider {
  name = "pinata";
  #jwt: string;
  #gateway: string;

  constructor(jwt: string, gateway?: string) {
    this.#jwt = jwt;
    this.#gateway =
      gateway?.replace(/\/$/, "") ?? "https://gateway.pinata.cloud";
  }

  async upload(
    data: Uint8Array,
    filename: string,
    _mimeType: string,
  ): Promise<string> {
    const formData = new FormData();
    formData.append("file", new Blob([data]), filename);

    const response = await fetch(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#jwt}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pinata upload failed (${response.status}): ${text}`);
    }

    const result = (await response.json()) as PinataResponse;
    return `${this.#gateway}/ipfs/${result.IpfsHash}`;
  }
}

// ─── S3 Provider (AWS Signature V4, zero deps) ───

/**
 * S3-compatible upload provider using manual AWS Signature V4 signing.
 * Works with AWS S3, MinIO, Cloudflare R2, and other S3-compatible services.
 *
 * Objects are uploaded with `public-read` ACL so they can be accessed by URL.
 *
 * Config:
 *   CONVOS_UPLOAD_PROVIDER=s3
 *   CONVOS_UPLOAD_PROVIDER_TOKEN=<accessKeyId>:<secretAccessKey>
 *   CONVOS_S3_BUCKET=my-bucket
 *   CONVOS_S3_REGION=us-east-1 (default)
 *   CONVOS_S3_ENDPOINT=https://s3.us-east-1.amazonaws.com (optional, for S3-compat services)
 *   CONVOS_UPLOAD_PROVIDER_GATEWAY=https://my-bucket.s3.us-east-1.amazonaws.com (optional, public URL prefix)
 */
class S3Provider implements UploadProvider {
  name = "s3";
  #accessKeyId: string;
  #secretAccessKey: string;
  #bucket: string;
  #region: string;
  #endpoint: string;
  #gateway: string;

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    bucket: string,
    region: string = "us-east-1",
    endpoint?: string,
    gateway?: string,
  ) {
    this.#accessKeyId = accessKeyId;
    this.#secretAccessKey = secretAccessKey;
    this.#bucket = bucket;
    this.#region = region;
    this.#endpoint = endpoint?.replace(/\/$/, "")
      ?? `https://s3.${region}.amazonaws.com`;
    this.#gateway = gateway?.replace(/\/$/, "")
      ?? `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  async upload(
    data: Uint8Array,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    const key = filename;
    const url = `${this.#endpoint}/${this.#bucket}/${key}`;

    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8); // YYYYMMDD
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); // YYYYMMDDTHHmmssZ

    const payloadHash = sha256Hex(data);
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const canonicalUri = parsedUrl.pathname;

    // Canonical headers (sorted)
    const headers: Record<string, string> = {
      "content-type": mimeType,
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };

    const signedHeaderKeys = Object.keys(headers).sort();
    const signedHeaders = signedHeaderKeys.join(";");
    const canonicalHeaders = signedHeaderKeys
      .map((k) => `${k}:${headers[k]}\n`)
      .join("");

    // Canonical request
    const canonicalRequest = [
      "PUT",
      canonicalUri,
      "", // no query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // String to sign
    const credentialScope = `${dateStamp}/${this.#region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");

    // Signing key
    const signingKey = getSignatureKey(
      this.#secretAccessKey,
      dateStamp,
      this.#region,
      "s3",
    );

    // Signature
    const signature = hmacHex(signingKey, stringToSign);

    // Authorization header
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.#accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...headers,
        Authorization: authorization,
      },
      body: data,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`S3 upload failed (${response.status}): ${text}`);
    }

    return `${this.#gateway}/${key}`;
  }
}

// ─── AWS Sigv4 Helpers ───

function sha256Hex(data: Uint8Array | string): string {
  const hash = createHash("sha256");
  hash.update(typeof data === "string" ? data : Buffer.from(data));
  return hash.digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function hmacHex(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

// ─── Convos API Provider ───

/**
 * Upload provider that uses the Convos backend's presigned URL endpoint.
 * Same flow as iOS — authenticates with an API key to get a JWT, then
 * uses the JWT to get a presigned S3 upload URL.
 *
 * Config:
 *   CONVOS_UPLOAD_PROVIDER=convos-api
 *   CONVOS_API_KEY=<api-key>
 *   CONVOS_API_BASE_URL=https://api.dev.convos.xyz/api (optional, derived from XMTP env)
 */
class ConvosApiProvider implements UploadProvider {
  name = "convos-api";
  #apiKey: string;
  #baseUrl: string;
  #jwt: string | undefined;

  constructor(apiKey: string, baseUrl: string) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async authenticate(): Promise<string> {
    if (this.#jwt) return this.#jwt;

    const response = await fetch(`${this.#baseUrl}/v2/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.#apiKey,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Convos API auth failed (${response.status}): ${text}`);
    }

    const result = (await response.json()) as { token: string };
    this.#jwt = result.token;
    return result.token;
  }

  async upload(
    data: Uint8Array,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    const jwt = await this.authenticate();

    // Step 1: Get presigned URL
    const params = new URLSearchParams({
      contentType: mimeType,
      filename,
    });

    const presignedResponse = await fetch(
      `${this.#baseUrl}/v2/attachments/presigned?${params}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );

    if (presignedResponse.status === 401) {
      // JWT expired — re-authenticate and retry once
      this.#jwt = undefined;
      const newJwt = await this.authenticate();
      const retryResponse = await fetch(
        `${this.#baseUrl}/v2/attachments/presigned?${params}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${newJwt}`,
          },
        },
      );
      if (!retryResponse.ok) {
        const text = await retryResponse.text();
        throw new Error(`Convos API presigned URL failed (${retryResponse.status}): ${text}`);
      }
      return this.uploadToPresigned(await retryResponse.json() as PresignedUrlResponse, data, mimeType);
    }

    if (!presignedResponse.ok) {
      const text = await presignedResponse.text();
      throw new Error(`Convos API presigned URL failed (${presignedResponse.status}): ${text}`);
    }

    return this.uploadToPresigned(await presignedResponse.json() as PresignedUrlResponse, data, mimeType);
  }

  private async uploadToPresigned(
    presigned: PresignedUrlResponse,
    data: Uint8Array,
    mimeType: string,
  ): Promise<string> {
    // Step 2: Upload to S3 via presigned URL
    const s3Response = await fetch(presigned.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
      body: data,
    });

    if (!s3Response.ok) {
      const text = await s3Response.text();
      throw new Error(`S3 upload via presigned URL failed (${s3Response.status}): ${text}`);
    }

    return presigned.assetUrl;
  }
}

interface PresignedUrlResponse {
  objectKey: string;
  uploadUrl: string;
  assetUrl: string;
}

// ─── Provider Factory ───

/** Default Convos API base URLs per XMTP environment */
const CONVOS_API_BASE_URLS: Record<string, string> = {
  dev: "https://api.dev.convos.xyz/api",
  production: "https://api.convos.xyz/api",
  local: "http://localhost:4000/api",
};

interface UploadConfig {
  uploadProvider?: string;
  uploadProviderToken?: string;
  uploadProviderGateway?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  convosApiKey?: string;
  convosApiBaseUrl?: string;
  env?: string;
}

const PROVIDER_FACTORIES = {
  pinata: (config: UploadConfig) => {
    if (!config.uploadProviderToken) {
      throw new Error(
        "Pinata requires a JWT token. Set CONVOS_UPLOAD_PROVIDER_TOKEN or use --upload-provider-token.",
      );
    }
    return new PinataProvider(
      config.uploadProviderToken,
      config.uploadProviderGateway,
    );
  },
  "convos-api": (config: UploadConfig) => {
    const apiKey = config.convosApiKey ?? config.uploadProviderToken;
    if (!apiKey) {
      throw new Error(
        "Convos API requires an API key. Set CONVOS_API_KEY or CONVOS_UPLOAD_PROVIDER_TOKEN.",
      );
    }
    const baseUrl = config.convosApiBaseUrl
      ?? (config.env ? CONVOS_API_BASE_URLS[config.env] : undefined)
      ?? CONVOS_API_BASE_URLS.dev;
    return new ConvosApiProvider(apiKey, baseUrl);
  },
  s3: (config: UploadConfig) => {
    if (!config.uploadProviderToken) {
      throw new Error(
        "S3 requires credentials. Set CONVOS_UPLOAD_PROVIDER_TOKEN=<accessKeyId>:<secretAccessKey>.",
      );
    }
    const [accessKeyId, ...secretParts] = config.uploadProviderToken.split(":");
    const secretAccessKey = secretParts.join(":");
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3 token must be in format <accessKeyId>:<secretAccessKey>.",
      );
    }
    if (!config.s3Bucket) {
      throw new Error(
        "S3 requires a bucket name. Set CONVOS_S3_BUCKET.",
      );
    }
    return new S3Provider(
      accessKeyId,
      secretAccessKey,
      config.s3Bucket,
      config.s3Region ?? "us-east-1",
      config.s3Endpoint,
      config.uploadProviderGateway,
    );
  },
} satisfies Record<string, (config: UploadConfig) => UploadProvider>;

type ProviderName = keyof typeof PROVIDER_FACTORIES;

function isProviderName(name: string): name is ProviderName {
  return Object.hasOwn(PROVIDER_FACTORIES, name);
}

export function getUploadProvider(config: UploadConfig): UploadProvider | null {
  if (!config.uploadProvider) {
    return null;
  }

  if (!isProviderName(config.uploadProvider)) {
    const available = Object.keys(PROVIDER_FACTORIES).join(", ");
    throw new Error(
      `Unknown upload provider: ${config.uploadProvider}. Available: ${available}`,
    );
  }

  return PROVIDER_FACTORIES[config.uploadProvider](config);
}

/** Max size for inline attachments (bytes). Files larger than this
 *  are automatically sent as remote attachments when a provider is configured. */
export const INLINE_ATTACHMENT_MAX_BYTES = 1_000_000;
