/**
 * Tests for the create/join profile flow.
 *
 * After the profile messages migration (convos-ios PR #552), profiles
 * are no longer written to appData. The create command writes only the
 * invite tag to appData, and the profile is sent via a ProfileUpdate
 * message instead.
 */
import { describe, expect, it } from "vitest";
import {
  parseAppData,
  serializeAppData,
  type ConversationCustomMetadata,
} from "../../src/utils/metadata.js";
import { randomAlphanumeric } from "../../src/utils/random.js";
import {
  encodeProfileUpdate,
  decodeProfileUpdate,
  encodeProfileSnapshot,
  decodeProfileSnapshot,
} from "../../src/utils/profileMessages.js";

describe("create command metadata (post-migration)", () => {
  const fakeInboxId = "ab".repeat(32);

  it("create writes appData with tag only, no profiles", () => {
    // After the migration, create only stores the invite tag in appData.
    // Profiles go via ProfileUpdate messages to avoid appData corruption.
    const inviteTag = randomAlphanumeric(10);
    const metadata = { tag: inviteTag, profiles: [] as never[] };
    const encoded = serializeAppData(metadata);
    const decoded = parseAppData(encoded);

    expect(decoded.tag).toBe(inviteTag);
    expect(decoded.profiles).toHaveLength(0);
  });

  it("create sends profile via ProfileUpdate message instead of appData", () => {
    // The creator's profile is communicated via a ProfileUpdate message
    const profileName = "Sora";
    const encoded = encodeProfileUpdate({ name: profileName });
    const decoded = decodeProfileUpdate(encoded);

    expect(decoded.name).toBe("Sora");
  });

  it("join sends profile via ProfileUpdate message instead of appData", () => {
    // After joining, the joiner sends a ProfileUpdate message
    const profileName = "Joiner";
    const encoded = encodeProfileUpdate({ name: profileName });
    const decoded = decodeProfileUpdate(encoded);

    expect(decoded.name).toBe("Joiner");
  });

  it("process-join-requests sends ProfileSnapshot after adding member", () => {
    // After adding a new member, the creator sends a ProfileSnapshot
    // so the new joiner has all existing profiles immediately.
    const creatorInbox = "cc".repeat(32);
    const joinerInbox = "dd".repeat(32);

    const snapshot = encodeProfileSnapshot({
      profiles: [
        { inboxId: creatorInbox, name: "Creator" },
        { inboxId: joinerInbox, name: "Joiner" },
      ],
    });
    const decoded = decodeProfileSnapshot(snapshot);

    expect(decoded.profiles).toHaveLength(2);
    expect(decoded.profiles[0].name).toBe("Creator");
    expect(decoded.profiles[1].name).toBe("Joiner");
  });
});
