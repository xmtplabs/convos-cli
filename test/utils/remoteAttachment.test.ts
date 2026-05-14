import { describe, expect, it } from "vitest";
import {
  extractMultiRemoteAttachment,
  extractRemoteAttachment,
} from "../../src/utils/remoteAttachment.js";

const SECRET = new Uint8Array([1, 2, 3, 4]);
const SALT = new Uint8Array([5, 6, 7, 8]);
const NONCE = new Uint8Array([9, 10, 11, 12]);

const SECRET_B64 = Buffer.from(SECRET).toString("base64");
const SALT_B64 = Buffer.from(SALT).toString("base64");
const NONCE_B64 = Buffer.from(NONCE).toString("base64");

function singleMessage(content: any): any {
  return {
    contentType: {
      authorityId: "xmtp.org",
      typeId: "remoteStaticAttachment",
      versionMajor: 1,
      versionMinor: 0,
    },
    content,
  };
}

function multiMessage(content: any): any {
  return {
    contentType: {
      authorityId: "xmtp.org",
      typeId: "multiRemoteStaticAttachment",
      versionMajor: 1,
      versionMinor: 0,
    },
    content,
  };
}

describe("extractRemoteAttachment", () => {
  it("re-encodes secret/salt/nonce as base64 and preserves the rest", () => {
    const out = extractRemoteAttachment(
      singleMessage({
        url: "https://example.com/a.jpg",
        contentDigest: "sha256:abc",
        scheme: "https",
        secret: SECRET,
        salt: SALT,
        nonce: NONCE,
        contentLength: 1234,
        filename: "a.jpg",
      }),
    );
    expect(out).toEqual({
      url: "https://example.com/a.jpg",
      contentDigest: "sha256:abc",
      scheme: "https",
      secret: SECRET_B64,
      salt: SALT_B64,
      nonce: NONCE_B64,
      contentLength: 1234,
      filename: "a.jpg",
    });
  });

  it("omits filename when absent", () => {
    const out = extractRemoteAttachment(
      singleMessage({
        url: "u",
        contentDigest: "d",
        scheme: "https",
        secret: SECRET,
        salt: SALT,
        nonce: NONCE,
        contentLength: 0,
      }),
    );
    expect(out).not.toHaveProperty("filename");
  });

  it("returns undefined for non-RemoteAttachment messages", () => {
    const textMessage = {
      contentType: { authorityId: "xmtp.org", typeId: "text" },
      content: "hi",
    } as any;
    expect(extractRemoteAttachment(textMessage)).toBeUndefined();
  });

  it("returns undefined when content is missing", () => {
    expect(extractRemoteAttachment(singleMessage(null))).toBeUndefined();
    expect(extractRemoteAttachment(singleMessage(undefined))).toBeUndefined();
  });
});

describe("extractMultiRemoteAttachment", () => {
  it("re-encodes each attachment's byte fields as base64", () => {
    const out = extractMultiRemoteAttachment(
      multiMessage({
        attachments: [
          {
            url: "https://example.com/a.jpg",
            contentDigest: "sha256:a",
            scheme: "https",
            secret: SECRET,
            salt: SALT,
            nonce: NONCE,
            contentLength: 100,
            filename: "a.jpg",
          },
          {
            url: "https://example.com/b.png",
            contentDigest: "sha256:b",
            scheme: "https",
            secret: SECRET,
            salt: SALT,
            nonce: NONCE,
            // contentLength omitted on this one — RemoteAttachmentInfo allows
            // it to be optional, unlike single RemoteAttachment.
          },
        ],
      }),
    );
    expect(out).toEqual({
      attachments: [
        {
          url: "https://example.com/a.jpg",
          contentDigest: "sha256:a",
          scheme: "https",
          secret: SECRET_B64,
          salt: SALT_B64,
          nonce: NONCE_B64,
          contentLength: 100,
          filename: "a.jpg",
        },
        {
          url: "https://example.com/b.png",
          contentDigest: "sha256:b",
          scheme: "https",
          secret: SECRET_B64,
          salt: SALT_B64,
          nonce: NONCE_B64,
        },
      ],
    });
  });

  it("returns an empty attachments array when given one", () => {
    const out = extractMultiRemoteAttachment(multiMessage({ attachments: [] }));
    expect(out).toEqual({ attachments: [] });
  });

  it("returns undefined for non-MultiRemoteAttachment messages", () => {
    expect(
      extractMultiRemoteAttachment({
        contentType: { authorityId: "xmtp.org", typeId: "text" },
        content: "hi",
      } as any),
    ).toBeUndefined();
  });

  it("returns undefined when attachments isn't an array", () => {
    expect(
      extractMultiRemoteAttachment(multiMessage({ attachments: null })),
    ).toBeUndefined();
    expect(
      extractMultiRemoteAttachment(multiMessage({})),
    ).toBeUndefined();
  });

  it("base64 round-trips back to the original byte buffer", () => {
    const out = extractMultiRemoteAttachment(
      multiMessage({
        attachments: [
          {
            url: "u",
            contentDigest: "d",
            scheme: "https",
            secret: SECRET,
            salt: SALT,
            nonce: NONCE,
            contentLength: 1,
          },
        ],
      }),
    );
    const a = out!.attachments[0];
    expect(new Uint8Array(Buffer.from(a.secret, "base64"))).toEqual(SECRET);
    expect(new Uint8Array(Buffer.from(a.salt, "base64"))).toEqual(SALT);
    expect(new Uint8Array(Buffer.from(a.nonce, "base64"))).toEqual(NONCE);
  });
});
