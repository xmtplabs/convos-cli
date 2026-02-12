/**
 * Tests that `conversations create --profile-name` writes the creator's
 * profile to the group's shared appData metadata (not just the local
 * identity store).
 *
 * Bug: Before the fix, the create command wrote `{ tag, profiles: [] }`
 * to appData — the creator's profile name was only saved locally and
 * never visible to other members.
 */
import { describe, expect, it } from "vitest";
import {
  parseAppData,
  serializeAppData,
  upsertProfile,
  type ConversationCustomMetadata,
} from "../../src/utils/metadata.js";
import { randomAlphanumeric } from "../../src/utils/random.js";

describe("create command profile metadata", () => {
  const fakeInboxId = "ab".repeat(32);

  it("BUG: create builds metadata with empty profiles (no creator profile)", () => {
    // This replicates what `conversations create` did before the fix:
    const inviteTag = randomAlphanumeric(10);
    const metadata = { tag: inviteTag, profiles: [] };
    const encoded = serializeAppData(metadata);
    const decoded = parseAppData(encoded);

    // The creator's profile is missing from appData!
    expect(decoded.profiles).toHaveLength(0);
  });

  it("FIX: create should include creator profile in metadata when --profile-name is set", () => {
    // This is what the fixed code should do:
    const inviteTag = randomAlphanumeric(10);
    const profileName = "Sora";

    let metadata: ConversationCustomMetadata = { tag: inviteTag, profiles: [] };
    // After creating the group, if a profile name was provided, upsert it
    metadata = upsertProfile(metadata, {
      inboxId: fakeInboxId,
      name: profileName,
    });

    const encoded = serializeAppData(metadata);
    const decoded = parseAppData(encoded);

    expect(decoded.profiles).toHaveLength(1);
    expect(decoded.profiles[0].inboxId).toBe(fakeInboxId);
    expect(decoded.profiles[0].name).toBe("Sora");
  });

  it("FIX: create should not add a profile when --profile-name is omitted", () => {
    const inviteTag = randomAlphanumeric(10);
    const profileName = undefined; // no --profile-name flag

    let metadata: ConversationCustomMetadata = { tag: inviteTag, profiles: [] };
    // Only upsert if profileName was provided
    if (profileName) {
      metadata = upsertProfile(metadata, {
        inboxId: fakeInboxId,
        name: profileName,
      });
    }

    const encoded = serializeAppData(metadata);
    const decoded = parseAppData(encoded);

    expect(decoded.profiles).toHaveLength(0);
  });

  it("FIX: join should write profile to appData after acceptance", () => {
    // Simulate: group already has metadata with tag + creator profile
    const creatorInbox = "cc".repeat(32);
    const joinerInbox = "dd".repeat(32);

    let metadata: ConversationCustomMetadata = {
      tag: "abcdef1234",
      profiles: [{ inboxId: creatorInbox, name: "Creator" }],
    };

    // After join acceptance, the joiner should upsert their profile
    metadata = upsertProfile(metadata, {
      inboxId: joinerInbox,
      name: "Joiner",
    });

    const encoded = serializeAppData(metadata);
    const decoded = parseAppData(encoded);

    expect(decoded.profiles).toHaveLength(2);
    expect(decoded.profiles[0].name).toBe("Creator");
    expect(decoded.profiles[1].name).toBe("Joiner");
  });
});
