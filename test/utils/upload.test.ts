import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getUploadProvider } from "../../src/utils/upload.js";

describe("getUploadProvider", () => {
  it("returns null when no provider configured", () => {
    expect(getUploadProvider({})).toBeNull();
  });

  it("throws for unknown provider", () => {
    expect(() => getUploadProvider({ uploadProvider: "unknown" })).toThrow(
      "Unknown upload provider: unknown",
    );
  });

  it("creates pinata provider with token", () => {
    const provider = getUploadProvider({
      uploadProvider: "pinata",
      uploadProviderToken: "test-jwt",
    });
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("pinata");
  });

  it("throws when pinata has no token", () => {
    expect(() =>
      getUploadProvider({ uploadProvider: "pinata" }),
    ).toThrow("Pinata requires a JWT token");
  });

  it("creates s3 provider with valid config", () => {
    const provider = getUploadProvider({
      uploadProvider: "s3",
      uploadProviderToken: "AKID:secret",
      s3Bucket: "my-bucket",
      s3Region: "us-west-2",
    });
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("s3");
  });

  it("s3 defaults region to us-east-1", () => {
    const provider = getUploadProvider({
      uploadProvider: "s3",
      uploadProviderToken: "AKID:secret",
      s3Bucket: "my-bucket",
    });
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("s3");
  });

  it("throws when s3 has no token", () => {
    expect(() =>
      getUploadProvider({ uploadProvider: "s3", s3Bucket: "b" }),
    ).toThrow("S3 requires credentials");
  });

  it("throws when s3 token is malformed", () => {
    expect(() =>
      getUploadProvider({
        uploadProvider: "s3",
        uploadProviderToken: "no-colon",
        s3Bucket: "b",
      }),
    ).toThrow("S3 token must be in format");
  });

  it("throws when s3 has no bucket", () => {
    expect(() =>
      getUploadProvider({
        uploadProvider: "s3",
        uploadProviderToken: "AKID:secret",
      }),
    ).toThrow("S3 requires a bucket name");
  });

  it("s3 token supports secrets with colons", () => {
    // Secret access keys can contain special characters
    const provider = getUploadProvider({
      uploadProvider: "s3",
      uploadProviderToken: "AKID:secret:with:colons",
      s3Bucket: "my-bucket",
    });
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("s3");
  });
});

describe("S3Provider upload", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends PUT with Sigv4 Authorization header", async () => {
    let capturedRequest: { url: string; method: string; headers: Record<string, string> } | undefined;

    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedRequest = {
        url: url.toString(),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(
          Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v as string]),
        ),
      };
      return new Response("", { status: 200 });
    }) as any;

    const provider = getUploadProvider({
      uploadProvider: "s3",
      uploadProviderToken: "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      s3Bucket: "test-bucket",
      s3Region: "us-east-1",
    });

    const data = new TextEncoder().encode("hello world");
    const url = await provider!.upload(data, "test.enc", "application/octet-stream");

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest!.method).toBe("PUT");
    expect(capturedRequest!.url).toContain("test-bucket/test.enc");
    expect(capturedRequest!.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    expect(capturedRequest!.headers["x-amz-content-sha256"]).toBeDefined();
    expect(capturedRequest!.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(capturedRequest!.headers["content-type"]).toBe("application/octet-stream");

    expect(url).toBe("https://test-bucket.s3.us-east-1.amazonaws.com/test.enc");
  });

  it("uses custom gateway for public URL", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as any;

    const provider = getUploadProvider({
      uploadProvider: "s3",
      uploadProviderToken: "AKID:secret",
      s3Bucket: "test-bucket",
      s3Region: "us-east-1",
      uploadProviderGateway: "https://cdn.example.com",
    });

    const url = await provider!.upload(new Uint8Array(0), "file.enc", "application/octet-stream");
    expect(url).toBe("https://cdn.example.com/file.enc");
  });

  it("uses custom endpoint for S3-compatible services", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      capturedUrl = url.toString();
      return new Response("", { status: 200 });
    }) as any;

    const provider = getUploadProvider({
      uploadProvider: "s3",
      uploadProviderToken: "AKID:secret",
      s3Bucket: "test-bucket",
      s3Region: "auto",
      s3Endpoint: "https://minio.local:9000",
    });

    await provider!.upload(new Uint8Array(0), "file.enc", "application/octet-stream");
    expect(capturedUrl).toBe("https://minio.local:9000/test-bucket/file.enc");
  });

  it("throws on non-200 response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("<Error>Access Denied</Error>", { status: 403 }),
    ) as any;

    const provider = getUploadProvider({
      uploadProvider: "s3",
      uploadProviderToken: "AKID:secret",
      s3Bucket: "test-bucket",
    });

    await expect(
      provider!.upload(new Uint8Array(0), "file.enc", "application/octet-stream"),
    ).rejects.toThrow("S3 upload failed (403)");
  });
});
