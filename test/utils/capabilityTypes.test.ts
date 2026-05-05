import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITY_SUBJECTS,
  allowsReadFederation,
  capabilitySubjectDisplayName,
  type CapabilitySubject,
} from "../../src/utils/capabilityTypes.js";
import {
  ALL_CONNECTION_CAPABILITIES,
  isWriteCapability,
} from "../../src/utils/connectionTypes.js";

describe("CapabilitySubject enumeration", () => {
  it("lists the ten v1 subjects with the documented raws", () => {
    expect(ALL_CAPABILITY_SUBJECTS).toEqual([
      "calendar",
      "contacts",
      "tasks",
      "mail",
      "photos",
      "fitness",
      "music",
      "location",
      "home",
      "screen_time",
    ]);
  });

  it("opts only fitness in to read federation", () => {
    for (const subject of ALL_CAPABILITY_SUBJECTS) {
      expect(allowsReadFederation(subject)).toBe(subject === "fitness");
    }
  });

  it("returns a user-visible display name for every subject", () => {
    const expected: Record<CapabilitySubject, string> = {
      calendar: "Calendar",
      contacts: "Contacts",
      tasks: "Tasks",
      mail: "Mail",
      photos: "Photos",
      fitness: "Fitness",
      music: "Music",
      location: "Location",
      home: "Home",
      screen_time: "Screen Time",
    };
    for (const subject of ALL_CAPABILITY_SUBJECTS) {
      expect(capabilitySubjectDisplayName(subject)).toBe(expected[subject]);
    }
  });
});

describe("ConnectionCapability enumeration", () => {
  it("lists the four verbs with snake_case write raws", () => {
    expect(ALL_CONNECTION_CAPABILITIES).toEqual([
      "read",
      "write_create",
      "write_update",
      "write_delete",
    ]);
  });

  it("classifies isWriteCapability correctly", () => {
    expect(isWriteCapability("read")).toBe(false);
    expect(isWriteCapability("write_create")).toBe(true);
    expect(isWriteCapability("write_update")).toBe(true);
    expect(isWriteCapability("write_delete")).toBe(true);
  });
});
