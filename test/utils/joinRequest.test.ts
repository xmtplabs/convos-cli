import { describe, it, expect } from "vitest";
import {
  JoinRequestCodec,
  ContentTypeJoinRequest,
  isJoinRequestMessage,
  getJoinRequestContent,
  type JoinRequestContent,
  type JoinRequestProfile,
} from "../../src/utils/joinRequest.js";

const codec = new JoinRequestCodec();

function mockMessage(contentType: any, content?: any) {
  return { contentType, content } as any;
}

// ─── Content Type ───

describe("ContentTypeJoinRequest", () => {
  it("has correct content type", () => {
    expect(ContentTypeJoinRequest).toEqual({
      authorityId: "convos.org",
      typeId: "join_request",
      versionMajor: 1,
      versionMinor: 0,
    });
  });
});

// ─── Codec ───

describe("JoinRequestCodec", () => {
  it("round-trips slug-only join request", () => {
    const original: JoinRequestContent = { inviteSlug: "abc123-invite-slug" };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);

    expect(decoded.inviteSlug).toBe("abc123-invite-slug");
    expect(decoded.profile).toBeUndefined();
    expect(decoded.metadata).toBeUndefined();
  });

  it("round-trips join request with profile", () => {
    const original: JoinRequestContent = {
      inviteSlug: "slug-123",
      profile: { name: "Alice", imageURL: "https://example.com/alice.jpg" },
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);

    expect(decoded.inviteSlug).toBe("slug-123");
    expect(decoded.profile?.name).toBe("Alice");
    expect(decoded.profile?.imageURL).toBe("https://example.com/alice.jpg");
  });

  it("round-trips join request with agent memberKind", () => {
    const original: JoinRequestContent = {
      inviteSlug: "agent-slug",
      profile: { name: "Bot", memberKind: "agent" },
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);

    expect(decoded.profile?.name).toBe("Bot");
    expect(decoded.profile?.memberKind).toBe("agent");
  });

  it("round-trips join request with metadata", () => {
    const original: JoinRequestContent = {
      inviteSlug: "meta-slug",
      metadata: { deviceName: "iPhone", confirmationCode: "482916" },
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);

    expect(decoded.metadata?.deviceName).toBe("iPhone");
    expect(decoded.metadata?.confirmationCode).toBe("482916");
  });

  it("round-trips join request with all fields", () => {
    const original: JoinRequestContent = {
      inviteSlug: "full-slug",
      profile: { name: "Charlie", imageURL: "https://example.com/charlie.png", memberKind: "agent" },
      metadata: { source: "cli", version: "0.4.0" },
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);

    expect(decoded.inviteSlug).toBe("full-slug");
    expect(decoded.profile?.name).toBe("Charlie");
    expect(decoded.profile?.imageURL).toBe("https://example.com/charlie.png");
    expect(decoded.profile?.memberKind).toBe("agent");
    expect(decoded.metadata?.source).toBe("cli");
    expect(decoded.metadata?.version).toBe("0.4.0");
  });

  it("fallback returns invite slug", () => {
    const content: JoinRequestContent = { inviteSlug: "fallback-slug" };
    expect(codec.fallback(content)).toBe("fallback-slug");
  });

  it("shouldPush returns true", () => {
    const content: JoinRequestContent = { inviteSlug: "test" };
    expect(codec.shouldPush(content)).toBe(true);
  });

  it("throws on empty content", () => {
    const encoded = {
      type: ContentTypeJoinRequest,
      parameters: {},
      content: new Uint8Array(0),
    } as any;
    expect(() => codec.decode(encoded)).toThrow();
  });

  it("throws on malformed JSON", () => {
    const encoded = {
      type: ContentTypeJoinRequest,
      parameters: {},
      content: new TextEncoder().encode("not valid json"),
    } as any;
    expect(() => codec.decode(encoded)).toThrow();
  });

  it("throws on missing inviteSlug", () => {
    const encoded = {
      type: ContentTypeJoinRequest,
      parameters: {},
      content: new TextEncoder().encode('{"profile":{"name":"Alice"}}'),
    } as any;
    expect(() => codec.decode(encoded)).toThrow("Missing inviteSlug");
  });

  it("ignores unknown fields (forward compatibility)", () => {
    const encoded = {
      type: ContentTypeJoinRequest,
      parameters: {},
      content: new TextEncoder().encode('{"inviteSlug":"compat-slug","futureField":true,"anotherField":42}'),
    } as any;
    const decoded = codec.decode(encoded);
    expect(decoded.inviteSlug).toBe("compat-slug");
    expect(decoded.profile).toBeUndefined();
  });
});

// ─── Message Detection ───

describe("isJoinRequestMessage", () => {
  it("detects JoinRequest messages", () => {
    const msg = mockMessage(ContentTypeJoinRequest);
    expect(isJoinRequestMessage(msg)).toBe(true);
  });

  it("does not match text messages", () => {
    const msg = mockMessage({
      authorityId: "xmtp.org",
      typeId: "text",
      versionMajor: 1,
      versionMinor: 0,
    });
    expect(isJoinRequestMessage(msg)).toBe(false);
  });

  it("does not match profile messages", () => {
    const msg = mockMessage({
      authorityId: "convos.org",
      typeId: "profile_update",
      versionMajor: 1,
      versionMinor: 0,
    });
    expect(isJoinRequestMessage(msg)).toBe(false);
  });
});

// ─── Content Extraction ───

describe("getJoinRequestContent", () => {
  it("extracts decoded JoinRequestContent (codec registered)", () => {
    const joinRequest: JoinRequestContent = {
      inviteSlug: "test-slug",
      profile: { name: "Alice", memberKind: "agent" },
    };
    const msg = mockMessage(ContentTypeJoinRequest, joinRequest);
    const result = getJoinRequestContent(msg);

    expect(result?.inviteSlug).toBe("test-slug");
    expect(result?.profile?.name).toBe("Alice");
    expect(result?.profile?.memberKind).toBe("agent");
  });

  it("extracts from raw EncodedContent (no codec)", () => {
    const joinRequest: JoinRequestContent = {
      inviteSlug: "raw-slug",
      profile: { name: "Bob" },
    };
    const encoded = codec.encode(joinRequest);
    const msg = mockMessage(ContentTypeJoinRequest, encoded);
    const result = getJoinRequestContent(msg);

    expect(result?.inviteSlug).toBe("raw-slug");
    expect(result?.profile?.name).toBe("Bob");
  });

  it("returns undefined for non-object content", () => {
    const msg = mockMessage(ContentTypeJoinRequest, "plain string");
    expect(getJoinRequestContent(msg)).toBeUndefined();
  });

  it("returns undefined for null content", () => {
    const msg = mockMessage(ContentTypeJoinRequest, null);
    expect(getJoinRequestContent(msg)).toBeUndefined();
  });

  it("returns undefined for malformed encoded content", () => {
    const msg = mockMessage(ContentTypeJoinRequest, {
      content: new TextEncoder().encode("not json"),
    });
    expect(getJoinRequestContent(msg)).toBeUndefined();
  });
});

// ─── CLI default memberKind ───

describe("CLI join request defaults", () => {
  it("CLI should set memberKind to agent by default", () => {
    // This documents the expected behavior: CLI join requests
    // include memberKind: "agent" so the creator knows this is a bot
    const joinRequest: JoinRequestContent = {
      inviteSlug: "test-slug",
      profile: {
        name: "Claude",
        memberKind: "agent",
      },
    };
    const encoded = codec.encode(joinRequest);
    const decoded = codec.decode(encoded);

    expect(decoded.profile?.memberKind).toBe("agent");
  });
});
