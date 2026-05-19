/**
 * JSON-safe extractors for XMTP's native remote-attachment content types.
 *
 * Native bindings hand `secret`/`salt`/`nonce` to JS as `Uint8Array`s.
 * `JSON.stringify` turns those into `{}` (or an indexed-object dump on
 * some Node versions), which is useless to a downstream agent. These
 * helpers re-encode the byte fields as **base64**, matching the encoding
 * the `agent serve` `remote-attach` stdin command already uses, so an
 * agent receives and sends remote attachments through one mental model.
 *
 * Decode-only — there is no `Codec` class here because the codec is
 * registered by the underlying `@xmtp/node-bindings` library and the
 * SDK already decodes these messages into the typed objects below.
 * These helpers just normalize them to a stable wire shape.
 */

import {
  isMultiRemoteAttachment,
  isRemoteAttachment,
  type DecodedMessage,
  type MultiRemoteAttachment,
  type RemoteAttachment,
  type RemoteAttachmentInfo,
} from "@xmtp/node-sdk";

/** JSON-safe view of a single `RemoteAttachmentInfo`. */
export interface RemoteAttachmentInfoJson {
  url: string;
  contentDigest: string;
  scheme: string;
  /** base64 of the encryption secret. */
  secret: string;
  /** base64 of the encryption salt. */
  salt: string;
  /** base64 of the encryption nonce. */
  nonce: string;
  contentLength?: number;
  filename?: string;
}

/** JSON-safe view of a `RemoteAttachment` message payload. */
export type RemoteAttachmentJson = RemoteAttachmentInfoJson;

/** JSON-safe view of a `MultiRemoteAttachment` message payload. */
export interface MultiRemoteAttachmentJson {
  attachments: RemoteAttachmentInfoJson[];
}

function toBase64(bytes: Uint8Array | undefined | null): string {
  if (!bytes) return "";
  return Buffer.from(bytes).toString("base64");
}

function toJson(info: RemoteAttachmentInfo): RemoteAttachmentInfoJson {
  return {
    url: info.url,
    contentDigest: info.contentDigest,
    scheme: info.scheme,
    secret: toBase64(info.secret),
    salt: toBase64(info.salt),
    nonce: toBase64(info.nonce),
    ...(info.contentLength !== undefined && info.contentLength !== null && {
      contentLength: info.contentLength,
    }),
    ...(info.filename && { filename: info.filename }),
  };
}

/**
 * If the message is a single `xmtp.org/remoteStaticAttachment:1.0`, return
 * the JSON-safe extraction; otherwise undefined.
 */
export function extractRemoteAttachment(
  message: DecodedMessage,
): RemoteAttachmentJson | undefined {
  if (!isRemoteAttachment(message)) return undefined;
  const content = message.content as RemoteAttachment | undefined;
  if (!content || typeof content !== "object") return undefined;
  return toJson(content);
}

/**
 * If the message is a `xmtp.org/multiRemoteStaticAttachment:1.0`, return
 * the JSON-safe extraction; otherwise undefined.
 */
export function extractMultiRemoteAttachment(
  message: DecodedMessage,
): MultiRemoteAttachmentJson | undefined {
  if (!isMultiRemoteAttachment(message)) return undefined;
  const content = message.content as MultiRemoteAttachment | undefined;
  if (!content || !Array.isArray(content.attachments)) return undefined;
  return {
    attachments: content.attachments.map(toJson),
  };
}
