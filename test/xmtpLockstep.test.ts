import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard the @xmtp/node-sdk <-> @xmtp/node-bindings pairing.
 *
 * libxmtp's inbox-id derivation lives in the native @xmtp/node-bindings addon,
 * and each @xmtp/node-sdk release is built against exactly one bindings build.
 * Mixing a node-sdk with the wrong bindings makes inbox-id derivation and
 * validation disagree, which surfaces at runtime as
 * "Inbox ID doesn't match nonce & address" identity failures.
 *
 * Nightlies of both packages are published together from a single libxmtp
 * commit, so the pins are in lockstep exactly when they share the same
 * `nightly.<date>.<hash>` suffix. Renovate bumps them as one grouped PR
 * (see .github/renovate.json); this test fails if anything desyncs them.
 */
const NIGHTLY_SUFFIX = /-(nightly\.\d{8}\.[0-9a-f]+)$/;

describe("xmtp node-sdk / node-bindings lockstep", () => {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
  ) as { devDependencies: Record<string, string> };
  const nodeSdk = pkg.devDependencies["@xmtp/node-sdk"];
  const nodeBindings = pkg.devDependencies["@xmtp/node-bindings"];

  it("pins both packages to nightlies", () => {
    expect(
      NIGHTLY_SUFFIX.test(nodeSdk),
      `@xmtp/node-sdk ${nodeSdk} is not a nightly pin`,
    ).toBe(true);
    expect(
      NIGHTLY_SUFFIX.test(nodeBindings),
      `@xmtp/node-bindings ${nodeBindings} is not a nightly pin`,
    ).toBe(true);
  });

  it("pins nightlies from the same libxmtp commit", () => {
    const sdkSuffix = NIGHTLY_SUFFIX.exec(nodeSdk)?.[1];
    const bindingsSuffix = NIGHTLY_SUFFIX.exec(nodeBindings)?.[1];
    expect(
      bindingsSuffix,
      `@xmtp/node-sdk ${nodeSdk} and @xmtp/node-bindings ${nodeBindings} ` +
        "must be nightlies from the same libxmtp commit (matching " +
        "nightly.<date>.<hash> suffix); a skewed pair breaks inbox-id " +
        'derivation with "Inbox ID doesn\'t match nonce & address"',
    ).toBe(sdkSuffix);
  });
});
