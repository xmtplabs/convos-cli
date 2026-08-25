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
 * commit, and dev releases likewise publish both from one libxmtp run — so
 * the pins are in lockstep exactly when they share the same
 * `nightly.<date>.<hash>` or `dev.<hash>` suffix. Renovate bumps nightlies
 * as one grouped PR (see .github/renovate.json) and libxmtp's dev-release
 * automation opens dev bumps the same way; this test fails if anything
 * desyncs them.
 */
const PRERELEASE_SUFFIX = /-(nightly\.\d{8}\.[0-9a-f]+|dev\.[0-9a-f]+)$/;

describe("xmtp node-sdk / node-bindings lockstep", () => {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
  ) as { devDependencies: Record<string, string> };
  const nodeSdk = pkg.devDependencies["@xmtp/node-sdk"];
  const nodeBindings = pkg.devDependencies["@xmtp/node-bindings"];

  it("pins both packages to a nightly or dev build", () => {
    expect(
      PRERELEASE_SUFFIX.test(nodeSdk),
      `@xmtp/node-sdk ${nodeSdk} is not a nightly or dev pin`,
    ).toBe(true);
    expect(
      PRERELEASE_SUFFIX.test(nodeBindings),
      `@xmtp/node-bindings ${nodeBindings} is not a nightly or dev pin`,
    ).toBe(true);
  });

  it("pins builds from the same libxmtp commit", () => {
    const sdkSuffix = PRERELEASE_SUFFIX.exec(nodeSdk)?.[1];
    const bindingsSuffix = PRERELEASE_SUFFIX.exec(nodeBindings)?.[1];
    expect(
      bindingsSuffix,
      `@xmtp/node-sdk ${nodeSdk} and @xmtp/node-bindings ${nodeBindings} ` +
        "must come from the same libxmtp commit (matching " +
        "nightly.<date>.<hash> or dev.<hash> suffix); a skewed pair breaks inbox-id " +
        'derivation with "Inbox ID doesn\'t match nonce & address"',
    ).toBe(sdkSuffix);
  });
});
