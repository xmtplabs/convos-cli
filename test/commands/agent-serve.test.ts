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
