import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTestHome, getTestHome, runCommand } from "../helpers.js";
import { join } from "node:path";

afterAll(() => {
  cleanupTestHome();
});

describe("init", () => {
  it("generates config and writes to file", async () => {
    const testHome = getTestHome();
    const result = await runCommand(["init", "--force"]);

    expect(result.exitCode).toBe(0);

    const content = await readFile(join(testHome, ".env"), "utf-8");
    // Convos init writes CONVOS_ENV, not XMTP_WALLET_KEY
    expect(content).toContain("CONVOS_ENV=dev");
  });

  it("outputs to stdout with --stdout flag", async () => {
    const result = await runCommand(["init", "--stdout"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CONVOS_ENV=");
  });
});
