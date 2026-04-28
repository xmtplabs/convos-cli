import { describe, expect, it, vi, afterEach } from "vitest";
import { type AgentCommand } from "../../src/commands/agent/serve.js";
import AgentServe from "../../src/commands/agent/serve.js";
import { encodeExplodeSettings } from "../../src/utils/explodeSettings.js";
import { parseAppData, serializeAppData } from "../../src/utils/metadata.js";
import { SortDirection } from "@xmtp/node-sdk";

// ─── encodeExplodeSettings ───

describe("encodeExplodeSettings", () => {
  it("produces a payload that round-trips through JSON decode", () => {
    const date = new Date("2025-06-01T12:30:00Z");
    const encoded = encodeExplodeSettings(date);
    const payload = JSON.parse(new TextDecoder().decode(encoded.content));
    expect(payload).toEqual({ expiresAt: "2025-06-01T12:30:00.000Z" });
  });

  it("uses the convos.org/explode_settings:1.0 content type", () => {
    const encoded = encodeExplodeSettings(new Date());
    expect(encoded.type).toEqual({
      authorityId: "convos.org",
      typeId: "explode_settings",
      versionMajor: 1,
      versionMinor: 0,
    });
  });

  it("includes the date in the fallback text", () => {
    const date = new Date("2025-12-25T00:00:00Z");
    const encoded = encodeExplodeSettings(date);
    expect(encoded.fallback).toContain("2025-12-25T00:00:00.000Z");
  });
});

// ─── Test harness for private methods ───

function createTestAgent() {
  const agent = Object.create(AgentServe.prototype) as any;
  agent.streams = [];
  agent.shutdownResolve = undefined;
  agent.heartbeatInterval = undefined;
  agent.lastMessageTimestampNs = 0n;
  agent.lastDmTimestampNs = 0n;
  agent.recentMessageIds = new Set();
  agent.isCatchingUpMessages = false;
  agent.isMessagesCatchupPending = false;
  agent.isCatchingUpDms = false;
  agent.isDmsCatchupPending = false;
  agent.commandQueue = Promise.resolve();

  const events: Record<string, unknown>[] = [];
  agent.emit = (event: Record<string, unknown>) => events.push(event);
  agent.emitError = (message: string, details?: Record<string, unknown>) =>
    events.push({ event: "error", message, ...details });
  agent.getConvosConfig = () => ({ env: "dev" });
  agent.getConvosHome = () => "/tmp/convos-test";

  return { agent, events };
}

function mockGroup(overrides: Record<string, any> = {}) {
  return {
    id: "conv-123",
    appData: serializeAppData({ tag: "original-tag", profiles: [] }),
    updateName: vi.fn(),
    updateAppData: vi.fn(),
    updatePermission: vi.fn(),
    send: vi.fn(),
    sendText: vi.fn().mockResolvedValue("msg-1"),
    sendReply: vi.fn().mockResolvedValue("msg-2"),
    sendReaction: vi.fn().mockResolvedValue("msg-3"),
    sendAttachment: vi.fn(),
    sendRemoteAttachment: vi.fn(),
    members: vi.fn().mockResolvedValue([
      { inboxId: "self" },
      { inboxId: "other-1" },
      { inboxId: "other-2" },
    ]),
    removeMembers: vi.fn(),
    sync: vi.fn(),
    messages: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function mockIdentity() {
  return {
    id: "id-1",
    walletKey: "0x" + "ab".repeat(32),
    dbEncryptionKey: "0x" + "cd".repeat(32),
  } as any;
}

// ─── catchUpMessages: the interesting logic ───

describe("catchUpMessages", () => {
  it("skips entirely when sinceNs is 0 (no prior messages seen)", async () => {
    const { agent } = createTestAgent();
    const group = mockGroup();

    await agent.catchUpMessages(group, { inboxId: "self" }, 0n);

    expect(group.sync).not.toHaveBeenCalled();
  });

  it("filters out own messages and non-displayable messages", async () => {
    const { agent, events } = createTestAgent();
    const t = new Date("2025-06-01T12:00:00Z");
    const group = mockGroup({
      messages: vi.fn().mockResolvedValue([
        // own message — should be skipped
        {
          id: "m1",
          senderInboxId: "self",
          contentType: { authorityId: "xmtp.org", typeId: "text" },
          content: "mine",
          sentAt: t,
        },
        // non-displayable (unknown authority) — should be skipped
        {
          id: "m2",
          senderInboxId: "other",
          contentType: { authorityId: "custom.org", typeId: "binary" },
          content: {},
          sentAt: t,
        },
        // valid message — should be emitted
        {
          id: "m3",
          senderInboxId: "other",
          contentType: { authorityId: "xmtp.org", typeId: "text" },
          content: "hello",
          sentAt: t,
        },
      ]),
    });

    await agent.catchUpMessages(group, { inboxId: "self" }, 1n);

    const msgs = events.filter((e) => e.event === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("m3");
    expect(msgs[0].catchup).toBe(true);
  });

  it("advances the watermark to the latest caught-up message", async () => {
    const { agent } = createTestAgent();
    const t1 = new Date("2025-06-01T12:00:00Z");
    const t2 = new Date("2025-06-01T12:05:00Z");
    const group = mockGroup({
      messages: vi.fn().mockResolvedValue([
        {
          id: "m1",
          senderInboxId: "other",
          contentType: { authorityId: "xmtp.org", typeId: "text" },
          content: "first",
          sentAt: t1,
        },
        {
          id: "m2",
          senderInboxId: "other",
          contentType: { authorityId: "xmtp.org", typeId: "text" },
          content: "second",
          sentAt: t2,
        },
      ]),
    });

    await agent.catchUpMessages(group, { inboxId: "self" }, 1n);

    // Should track the later timestamp
    expect(agent.lastMessageTimestampNs).toBe(
      BigInt(t2.getTime()) * 1_000_000n,
    );
  });

  it("queries with sentAfterNs and ascending order", async () => {
    const { agent } = createTestAgent();
    const group = mockGroup();
    const sinceNs = 12345678n;

    await agent.catchUpMessages(group, { inboxId: "self" }, sinceNs);

    expect(group.messages).toHaveBeenCalledWith({
      sentAfterNs: sinceNs,
      direction: SortDirection.Ascending,
    });
  });
});

// ─── handleCommand: explode branching ───

describe("handleCommand explode", () => {
  it("immediate explode filters self out of member removal", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();
    const client = { inboxId: "self" };
    const identity = mockIdentity();
    agent.shutdown = vi.fn();

    const mockStore = { remove: vi.fn() };
    vi.spyOn(
      await import("../../src/utils/identities.js"),
      "createIdentityStore",
    ).mockReturnValue(mockStore as any);

    await agent.handleCommand(
      { type: "explode" } as AgentCommand,
      group,
      client,
      identity,
    );

    // Should only remove others, not self
    expect(group.removeMembers).toHaveBeenCalledWith(["other-1", "other-2"]);
    const sent = events.find((e) => e.type === "explode");
    expect(sent!.membersRemoved).toBe(2);

    vi.restoreAllMocks();
  });

  it("immediate explode with only self skips removeMembers entirely", async () => {
    const { agent } = createTestAgent();
    const group = mockGroup({
      members: vi.fn().mockResolvedValue([{ inboxId: "self" }]),
    });
    agent.shutdown = vi.fn();

    const mockStore = { remove: vi.fn() };
    vi.spyOn(
      await import("../../src/utils/identities.js"),
      "createIdentityStore",
    ).mockReturnValue(mockStore as any);

    await agent.handleCommand(
      { type: "explode" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.removeMembers).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("immediate explode triggers shutdown, scheduled does not", async () => {
    const { agent } = createTestAgent();
    const group = mockGroup({
      members: vi.fn().mockResolvedValue([{ inboxId: "self" }]),
    });
    agent.shutdown = vi.fn();

    const mockStore = { remove: vi.fn() };
    vi.spyOn(
      await import("../../src/utils/identities.js"),
      "createIdentityStore",
    ).mockReturnValue(mockStore as any);

    await agent.handleCommand(
      { type: "explode" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    expect(agent.shutdown).toHaveBeenCalledTimes(1);

    agent.shutdown.mockClear();

    const future = new Date(Date.now() + 86_400_000).toISOString();
    await agent.handleCommand(
      { type: "explode", scheduled: future } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    expect(agent.shutdown).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("rejects invalid and past scheduled dates", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      { type: "explode", scheduled: "garbage" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    expect(events.at(-1)!.message).toMatch(/Invalid scheduled date/);

    await agent.handleCommand(
      {
        type: "explode",
        scheduled: new Date(Date.now() - 86_400_000).toISOString(),
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    expect(events.at(-1)!.message).toMatch(/must be in the future/);

    // Neither should have sent anything
    expect(group.send).not.toHaveBeenCalled();
  });

  it("appData update failure during explode is non-fatal", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup({
      updateAppData: vi.fn().mockRejectedValue(new Error("boom")),
      members: vi.fn().mockResolvedValue([{ inboxId: "self" }]),
    });
    agent.shutdown = vi.fn();

    const mockStore = { remove: vi.fn() };
    vi.spyOn(
      await import("../../src/utils/identities.js"),
      "createIdentityStore",
    ).mockReturnValue(mockStore as any);

    await agent.handleCommand(
      { type: "explode" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    // Should still complete: send message + shutdown
    expect(group.send).toHaveBeenCalled();
    expect(agent.shutdown).toHaveBeenCalled();
    // No error event — the catch is silent
    expect(events.filter((e) => e.event === "error")).toHaveLength(0);

    vi.restoreAllMocks();
  });
});

// ─── handleCommand: lock/unlock tag rotation ───

describe("handleCommand lock/unlock", () => {
  it("lock rotates the tag in appData and preserves other metadata", async () => {
    const { agent } = createTestAgent();
    const existingAppData = serializeAppData({
      tag: "original-tag",
      profiles: [{ inboxId: "someone", name: "Alice" }],
    });
    const group = mockGroup({ appData: existingAppData });

    await agent.handleCommand(
      { type: "lock" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    const written = parseAppData(group.updateAppData.mock.calls[0][0]);
    expect(written.tag).not.toBe("original-tag");
    expect(written.tag).toHaveLength(10);
    // profiles are preserved through the round-trip
    expect(written.profiles).toHaveLength(1);
    expect(written.profiles[0].name).toBe("Alice");
  });

  it("lock and unlock produce different tags each call", async () => {
    const { agent } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      { type: "lock" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    const lockTag = parseAppData(group.updateAppData.mock.calls[0][0]).tag;

    group.updateAppData.mockClear();
    await agent.handleCommand(
      { type: "unlock" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    const unlockTag = parseAppData(group.updateAppData.mock.calls[0][0]).tag;

    expect(lockTag).not.toBe("original-tag");
    expect(unlockTag).not.toBe("original-tag");
    expect(lockTag).not.toBe(unlockTag);
  });
});

// ─── heartbeat timing ───

describe("heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disabled when interval <= 0", () => {
    const { agent } = createTestAgent();
    agent.startHeartbeat(0, "conv-123");
    expect(agent.heartbeatInterval).toBeUndefined();

    agent.startHeartbeat(-5, "conv-123");
    expect(agent.heartbeatInterval).toBeUndefined();
  });

  it("emits at the right cadence and includes stream count", () => {
    vi.useFakeTimers();
    const { agent, events } = createTestAgent();
    agent.streams = [1, 2] as any; // 2 fake streams

    agent.startHeartbeat(10, "conv-abc");

    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(10_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "heartbeat",
      conversationId: "conv-abc",
      activeStreams: 2,
    });

    vi.advanceTimersByTime(25_000); // 2.5 more intervals
    expect(events).toHaveLength(3); // total: 1 + 2

    clearInterval(agent.heartbeatInterval);
  });

  it("shutdown clears the heartbeat", () => {
    vi.useFakeTimers();
    const { agent, events } = createTestAgent();

    agent.startHeartbeat(1, "conv-123");
    agent.shutdown(); // should clear

    vi.advanceTimersByTime(5_000);
    expect(events).toHaveLength(0); // nothing emitted after shutdown
  });
});

// ─── catchUpDmJoinRequests ───

describe("catchUpDmJoinRequests", () => {
  it("skips entirely when sinceNs is 0", async () => {
    const { agent } = createTestAgent();
    const client = {
      inboxId: "self",
      conversations: { sync: vi.fn(), list: vi.fn() },
    };

    await agent.catchUpDmJoinRequests(client, mockIdentity(), "conv-123", 0n);

    expect(client.conversations.sync).not.toHaveBeenCalled();
  });

  it("scheduleDmJoinRequestsCatchup coalesces concurrent restarts", () => {
    const { agent } = createTestAgent();
    // Simulate an in-flight catchup
    agent.isCatchingUpDms = true;
    agent.lastDmTimestampNs = 1000n;
    const client = {
      inboxId: "self",
      conversations: { sync: vi.fn(), list: vi.fn() },
    };

    agent.scheduleDmJoinRequestsCatchup(client, mockIdentity(), "conv-123");

    // Second restart during an active run should mark pending, not start work.
    expect(agent.isDmsCatchupPending).toBe(true);
    expect(client.conversations.sync).not.toHaveBeenCalled();
  });
});

// ─── message deduplication ───

describe("message deduplication", () => {
  it("trackMessageId returns false for duplicates", () => {
    const { agent } = createTestAgent();
    expect(agent.trackMessageId("msg-1")).toBe(true);
    expect(agent.trackMessageId("msg-2")).toBe(true);
    expect(agent.trackMessageId("msg-1")).toBe(false); // duplicate
  });

  it("evicts oldest IDs when exceeding MAX_RECENT_IDS", () => {
    const { agent } = createTestAgent();
    // Fill to the limit
    for (let i = 0; i < 1000; i++) {
      agent.trackMessageId(`msg-${i}`);
    }
    expect(agent.recentMessageIds.size).toBe(1000);

    // Adding one more should evict the oldest (msg-0)
    agent.trackMessageId("msg-new");
    expect(agent.recentMessageIds.size).toBe(1000);
    expect(agent.recentMessageIds.has("msg-0")).toBe(false);
    expect(agent.recentMessageIds.has("msg-1")).toBe(true);
    expect(agent.recentMessageIds.has("msg-new")).toBe(true);
  });

  it("catchUpMessages skips messages already emitted by live stream", async () => {
    const { agent, events } = createTestAgent();
    const t = new Date("2025-06-01T12:00:00Z");

    // Simulate live stream already emitted this message
    agent.trackMessageId("already-seen");

    const group = mockGroup({
      messages: vi.fn().mockResolvedValue([
        {
          id: "already-seen",
          senderInboxId: "other",
          contentType: { authorityId: "xmtp.org", typeId: "text" },
          content: "dup",
          sentAt: t,
        },
        {
          id: "new-msg",
          senderInboxId: "other",
          contentType: { authorityId: "xmtp.org", typeId: "text" },
          content: "fresh",
          sentAt: t,
        },
      ]),
    });

    await agent.catchUpMessages(group, { inboxId: "self" }, 1n);

    const msgs = events.filter((e) => e.event === "message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("new-msg");
  });
});

// ─── catchup scheduler coalescing ───

describe("scheduleMessagesCatchup", () => {
  it("coalesces a second restart during an in-flight catchup", () => {
    const { agent } = createTestAgent();
    agent.isCatchingUpMessages = true;
    agent.lastMessageTimestampNs = 1000n;
    const group = mockGroup();

    agent.scheduleMessagesCatchup(group, { inboxId: "self" });

    expect(agent.isMessagesCatchupPending).toBe(true);
    expect(group.sync).not.toHaveBeenCalled();
  });

  it("clears the running flag after completion", async () => {
    const { agent } = createTestAgent();
    agent.lastMessageTimestampNs = 1000n;
    const group = mockGroup();

    agent.scheduleMessagesCatchup(group, { inboxId: "self" });
    // Let the scheduled IIFE run
    await new Promise((resolve) => setImmediate(resolve));

    expect(agent.isCatchingUpMessages).toBe(false);
  });

  it("clears the running flag even after errors", async () => {
    const { agent } = createTestAgent();
    agent.lastMessageTimestampNs = 1000n;
    const group = mockGroup({
      sync: vi.fn().mockRejectedValue(new Error("boom")),
    });

    agent.scheduleMessagesCatchup(group, { inboxId: "self" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(agent.isCatchingUpMessages).toBe(false);
  });
});

// ─── handleCommand: connection-invoke ───

describe("handleCommand connection-invoke", () => {
  it("encodes and sends a ConnectionInvocation with the expected wire shape", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup({ send: vi.fn().mockResolvedValue("msg-7") });

    await agent.handleCommand(
      {
        type: "connection-invoke",
        kind: "calendar",
        action: "create_event",
        invocationId: "req-1",
        arguments: {
          title: { type: "string", value: "Team sync" },
          isAllDay: { type: "bool", value: false },
        },
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).toHaveBeenCalledTimes(1);
    const encoded = group.send.mock.calls[0][0];
    expect(encoded.type).toEqual({
      authorityId: "convos.org",
      typeId: "connection_invocation",
      versionMajor: 1,
      versionMinor: 0,
    });
    const payload = JSON.parse(new TextDecoder().decode(encoded.content));
    expect(payload.invocationId).toBe("req-1");
    expect(payload.kind).toBe("calendar");
    expect(payload.action.name).toBe("create_event");
    expect(payload.action.arguments).toEqual({
      title: { type: "string", value: "Team sync" },
      isAllDay: { type: "bool", value: false },
    });

    const sent = events.find((e) => e.event === "sent" && e.type === "connection-invoke");
    expect(sent).toBeDefined();
    expect(sent!.invocationId).toBe("req-1");
    expect(sent!.id).toBe("msg-7");
  });

  it("auto-generates an invocationId when none is supplied", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup({ send: vi.fn().mockResolvedValue("msg-8") });

    await agent.handleCommand(
      {
        type: "connection-invoke",
        kind: "contacts",
        action: "create_contact",
        arguments: {},
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    const sent = events.find((e) => e.event === "sent");
    expect(sent!.invocationId).toMatch(/^agent-[0-9a-f]{8}$/);
  });

  it("rejects unknown ConnectionKind raw values", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      {
        type: "connection-invoke",
        kind: "telepathy",
        action: "create_event",
        arguments: {},
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).not.toHaveBeenCalled();
    expect(events.at(-1)!.event).toBe("error");
    expect(events.at(-1)!.message).toMatch(/'kind' must be one of/);
  });

  it("rejects malformed argument values without sending", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      {
        type: "connection-invoke",
        kind: "calendar",
        action: "create_event",
        arguments: { bad: { type: "uint64", value: 1 } },
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).not.toHaveBeenCalled();
    expect(events.at(-1)!.event).toBe("error");
    expect(events.at(-1)!.message).toMatch(/unknown type tag/);
  });

  it("requires kind and action", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      { type: "connection-invoke" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    expect(events.at(-1)!.message).toMatch(/'kind' field/);

    await agent.handleCommand(
      { type: "connection-invoke", kind: "health" } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );
    expect(events.at(-1)!.message).toMatch(/'action' field/);

    expect(group.send).not.toHaveBeenCalled();
  });

  it("rejects an invalid issuedAt timestamp", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      {
        type: "connection-invoke",
        kind: "calendar",
        action: "create_event",
        arguments: {},
        issuedAt: "garbage",
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).not.toHaveBeenCalled();
    expect(events.at(-1)!.message).toMatch(/Invalid 'issuedAt'/);
  });
});

// ─── handleCommand: capability-request ───

describe("handleCommand capability-request", () => {
  it("encodes and sends a CapabilityRequest with the expected wire shape", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup({ send: vi.fn().mockResolvedValue("msg-cap-1") });

    await agent.handleCommand(
      {
        type: "capability-request",
        subject: "calendar",
        capability: "read",
        rationale: "To summarize your week",
        requestId: "req-cap-1",
        preferredProviders: ["device.calendar"],
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).toHaveBeenCalledTimes(1);
    const encoded = group.send.mock.calls[0][0];
    expect(encoded.type).toEqual({
      authorityId: "convos.org",
      typeId: "capability_request",
      versionMajor: 1,
      versionMinor: 0,
    });
    const payload = JSON.parse(new TextDecoder().decode(encoded.content));
    expect(payload).toEqual({
      version: 1,
      requestId: "req-cap-1",
      subject: "calendar",
      capability: "read",
      rationale: "To summarize your week",
      preferredProviders: ["device.calendar"],
    });

    const sent = events.find((e) => e.event === "sent" && e.type === "capability-request");
    expect(sent).toBeDefined();
    expect(sent!.id).toBe("msg-cap-1");
    expect(sent!.requestId).toBe("req-cap-1");
  });

  it("auto-generates a requestId when none is supplied", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup({ send: vi.fn().mockResolvedValue("msg-cap-2") });

    await agent.handleCommand(
      {
        type: "capability-request",
        subject: "fitness",
        capability: "read",
        rationale: "To summarize training",
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    const sent = events.find((e) => e.event === "sent");
    expect(sent!.requestId).toMatch(/^agent-[0-9a-f]{8}$/);
  });

  it("rejects unknown subjects", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      {
        type: "capability-request",
        subject: "telepathy",
        capability: "read",
        rationale: "x",
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).not.toHaveBeenCalled();
    expect(events.at(-1)!.event).toBe("error");
    expect(events.at(-1)!.message).toMatch(/'subject' must be one of/);
  });

  it("rejects unknown capabilities", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      {
        type: "capability-request",
        subject: "calendar",
        capability: "write_admin",
        rationale: "x",
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).not.toHaveBeenCalled();
    expect(events.at(-1)!.message).toMatch(/'capability' must be one of/);
  });

  it("requires a non-empty rationale", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      {
        type: "capability-request",
        subject: "calendar",
        capability: "read",
        rationale: "",
      } as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).not.toHaveBeenCalled();
    expect(events.at(-1)!.message).toMatch(/non-empty 'rationale'/);
  });

  it("rejects malformed preferredProviders", async () => {
    const { agent, events } = createTestAgent();
    const group = mockGroup();

    await agent.handleCommand(
      {
        type: "capability-request",
        subject: "fitness",
        capability: "read",
        rationale: "x",
        preferredProviders: ["composio.strava", 7],
      } as unknown as AgentCommand,
      group,
      { inboxId: "self" },
      mockIdentity(),
    );

    expect(group.send).not.toHaveBeenCalled();
    expect(events.at(-1)!.message).toMatch(/preferredProviders/);
  });
});

// ─── routeConvosContentType: inbound silent-codec → structured event ───

describe("routeConvosContentType", () => {
  const conv = (id = "conv-123") => ({ id }) as any;
  const sentAt = new Date("2026-04-28T12:00:00.000Z");

  function mockDecoded(typeId: string, content: any, overrides: any = {}) {
    return {
      id: `msg-${typeId}-${Math.random().toString(36).slice(2, 8)}`,
      senderInboxId: "other",
      contentType: { authorityId: "convos.org", typeId, versionMajor: 1, versionMinor: 0 },
      content,
      sentAt,
      ...overrides,
    } as any;
  }

  it("emits connection_payload for ConnectionPayload, with envelope and source", () => {
    const { agent, events } = createTestAgent();
    const payload = {
      id: "11111111-1111-1111-1111-111111111111",
      schemaVersion: 1,
      source: "calendar",
      capturedAt: 721_692_800,
      body: { type: "calendar", data: { summary: "2 events today" } },
    };
    const message = mockDecoded("connection_payload", payload);

    const handled = agent.routeConvosContentType(message, conv(), false);

    expect(handled).toBe(true);
    const evt = events.find((e) => e.event === "connection_payload");
    expect(evt).toMatchObject({
      event: "connection_payload",
      id: message.id,
      envelopeId: payload.id,
      senderInboxId: "other",
      conversationId: "conv-123",
      source: "calendar",
      schemaVersion: 1,
      capturedAt: 721_692_800,
      body: payload.body,
      sentAt: sentAt.toISOString(),
    });
    expect(evt!.catchup).toBeUndefined();
  });

  it("emits connection_invocation for an inbound ConnectionInvocation", () => {
    const { agent, events } = createTestAgent();
    const invocation = {
      id: "AABBCCDD-EEFF-1122-3344-556677889900",
      schemaVersion: 1,
      invocationId: "agent-1-001",
      kind: "calendar",
      action: { name: "create_event", arguments: {} },
      issuedAt: 0,
    };
    const message = mockDecoded("connection_invocation", invocation);

    expect(agent.routeConvosContentType(message, conv(), false)).toBe(true);
    const evt = events.find((e) => e.event === "connection_invocation");
    expect(evt).toMatchObject({
      event: "connection_invocation",
      invocationId: "agent-1-001",
      kind: "calendar",
      action: invocation.action,
    });
  });

  it("emits connection_result with errorMessage when present", () => {
    const { agent, events } = createTestAgent();
    const result = {
      id: "DDEEFF00-1122-3344-5566-778899AABBCC",
      schemaVersion: 1,
      invocationId: "agent-1-001",
      kind: "calendar",
      actionName: "create_event",
      status: "execution_failed",
      result: {},
      errorMessage: "EventKit returned: …",
      completedAt: 0,
    };
    const message = mockDecoded("connection_invocation_result", result);

    expect(agent.routeConvosContentType(message, conv(), false)).toBe(true);
    const evt = events.find((e) => e.event === "connection_result");
    expect(evt).toMatchObject({
      event: "connection_result",
      invocationId: "agent-1-001",
      status: "execution_failed",
      errorMessage: "EventKit returned: …",
    });
  });

  it("omits errorMessage on a successful result", () => {
    const { agent, events } = createTestAgent();
    const result = {
      id: "DDEEFF00-1122-3344-5566-778899AABBCC",
      schemaVersion: 1,
      invocationId: "ok-1",
      kind: "calendar",
      actionName: "create_event",
      status: "success",
      result: { eventId: { type: "string", value: "evt-1" } },
      completedAt: 0,
    };
    const message = mockDecoded("connection_invocation_result", result);

    agent.routeConvosContentType(message, conv(), false);
    const evt = events.find((e) => e.event === "connection_result");
    expect(evt!.errorMessage).toBeUndefined();
    expect(evt!.result).toEqual({ eventId: { type: "string", value: "evt-1" } });
  });

  it("emits capability_request, including the preferredProviders hint", () => {
    const { agent, events } = createTestAgent();
    const request = {
      version: 1,
      requestId: "req-1",
      subject: "fitness",
      capability: "read",
      rationale: "Summarize training",
      preferredProviders: ["composio.strava", "composio.fitbit"],
    };
    const message = mockDecoded("capability_request", request);

    expect(agent.routeConvosContentType(message, conv(), false)).toBe(true);
    const evt = events.find((e) => e.event === "capability_request");
    expect(evt).toMatchObject({
      event: "capability_request",
      requestId: "req-1",
      subject: "fitness",
      capability: "read",
      rationale: "Summarize training",
      preferredProviders: ["composio.strava", "composio.fitbit"],
    });
  });

  it("emits capability_result echoing the persisted providers", () => {
    const { agent, events } = createTestAgent();
    const result = {
      version: 1,
      requestId: "req-1",
      status: "approved",
      subject: "calendar",
      capability: "read",
      providers: ["device.calendar"],
    };
    const message = mockDecoded("capability_request_result", result);

    expect(agent.routeConvosContentType(message, conv(), false)).toBe(true);
    const evt = events.find((e) => e.event === "capability_result");
    expect(evt).toMatchObject({
      event: "capability_result",
      requestId: "req-1",
      status: "approved",
      providers: ["device.calendar"],
    });
  });

  it("flags catchup events with catchup: true", () => {
    const { agent, events } = createTestAgent();
    const message = mockDecoded("connection_payload", {
      id: "11111111-1111-1111-1111-111111111112",
      schemaVersion: 1,
      source: "calendar",
      capturedAt: 0,
      body: { type: "calendar", data: { summary: "x" } },
    });

    agent.routeConvosContentType(message, conv(), true);
    expect(events[0]!.catchup).toBe(true);
  });

  it("dedupes across live ↔ catchup so a message id only emits once", () => {
    const { agent, events } = createTestAgent();
    const message = mockDecoded("connection_payload", {
      id: "11111111-1111-1111-1111-111111111113",
      schemaVersion: 1,
      source: "calendar",
      capturedAt: 0,
      body: { type: "calendar", data: { summary: "x" } },
    });

    agent.routeConvosContentType(message, conv(), false);
    agent.routeConvosContentType(message, conv(), true);

    expect(events.filter((e) => e.event === "connection_payload")).toHaveLength(1);
  });

  it("advances lastMessageTimestampNs so subsequent catchup queries skip the same message", () => {
    const { agent } = createTestAgent();
    const message = mockDecoded("capability_request_result", {
      version: 1,
      requestId: "req-1",
      status: "approved",
      subject: "calendar",
      capability: "read",
      providers: ["device.calendar"],
    });

    agent.routeConvosContentType(message, conv(), false);

    expect(agent.lastMessageTimestampNs).toBe(BigInt(sentAt.getTime()) * 1_000_000n);
  });

  it("emits typing on the live stream but skips it on catchup", () => {
    const { agent, events } = createTestAgent();
    const message = mockDecoded("typing_indicator", { isTyping: true });

    agent.routeConvosContentType(message, conv(), false);
    expect(events.find((e) => e.event === "typing")).toBeDefined();

    events.length = 0;
    agent.routeConvosContentType(message, conv(), true);
    expect(events.find((e) => e.event === "typing")).toBeUndefined();
  });

  it("emits explode_notice and tags catchup runs", () => {
    const { agent, events } = createTestAgent();
    const expiresAt = "2026-05-01T00:00:00.000Z";
    const message = mockDecoded("explode_settings", { expiresAt });

    agent.routeConvosContentType(message, conv(), true);
    const evt = events.find((e) => e.event === "explode_notice");
    expect(evt).toMatchObject({ event: "explode_notice", expiresAt, catchup: true });
  });

  it("returns false for content types it doesn't know about", () => {
    const { agent } = createTestAgent();
    const message = {
      id: "msg-text",
      senderInboxId: "other",
      contentType: { authorityId: "xmtp.org", typeId: "text", versionMajor: 1, versionMinor: 0 },
      content: "hello",
      sentAt,
    } as any;

    expect(agent.routeConvosContentType(message, conv(), false)).toBe(false);
  });

  it("emits profile_update with the changed fields and skips unset ones", () => {
    const { agent, events } = createTestAgent();
    const message = mockDecoded("profile_update", {
      name: "Alice (she/her)",
      memberKind: 1,
      metadata: {
        timezone: { type: "string", value: "America/Los_Angeles" },
      },
    });

    expect(agent.routeConvosContentType(message, conv(), false)).toBe(true);
    const evt = events.find((e) => e.event === "profile_update");
    expect(evt).toMatchObject({
      event: "profile_update",
      id: message.id,
      senderInboxId: "other",
      conversationId: "conv-123",
      name: "Alice (she/her)",
      memberKind: 1,
      metadata: {
        timezone: { type: "string", value: "America/Los_Angeles" },
      },
      sentAt: sentAt.toISOString(),
    });
    expect(evt!.encryptedImage).toBeUndefined();
  });

  it("profile_update with only encryptedImage carries just that field", () => {
    const { agent, events } = createTestAgent();
    const encryptedImage = {
      url: "https://example.com/blob",
      salt: "AAAA",
      nonce: "BBBB",
    };
    const message = mockDecoded("profile_update", { encryptedImage });

    agent.routeConvosContentType(message, conv(), false);
    const evt = events.find((e) => e.event === "profile_update");
    expect(evt).toMatchObject({ encryptedImage });
    expect(evt!.name).toBeUndefined();
    expect(evt!.metadata).toBeUndefined();
    expect(evt!.memberKind).toBeUndefined();
  });

  it("profile_update with empty metadata object omits the metadata field", () => {
    const { agent, events } = createTestAgent();
    const message = mockDecoded("profile_update", { name: "Bob", metadata: {} });

    agent.routeConvosContentType(message, conv(), false);
    const evt = events.find((e) => e.event === "profile_update");
    expect(evt!.name).toBe("Bob");
    expect(evt!.metadata).toBeUndefined();
  });

  it("profile_update flags catchup runs", () => {
    const { agent, events } = createTestAgent();
    const message = mockDecoded("profile_update", { name: "Carol" });

    agent.routeConvosContentType(message, conv(), true);
    expect(events[0]!.catchup).toBe(true);
  });

  it("clearing a name (empty string) is preserved on profile_update", () => {
    const { agent, events } = createTestAgent();
    const message = mockDecoded("profile_update", { name: "" });

    agent.routeConvosContentType(message, conv(), false);
    const evt = events.find((e) => e.event === "profile_update");
    expect(evt!.name).toBe("");
  });
});
