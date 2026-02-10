import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTestEnvPath, runCommand } from "../helpers.js";

describe("init", () => {
  it("generates config and writes to file", async () => {
    const testPath = getTestEnvPath();
    const result = await runCommand(["init", "--output", testPath]);

    expect(result.exitCode).toBe(0);

    const content = await readFile(testPath, "utf-8");
    // Convos init writes CONVOS_ENV, not XMTP_WALLET_KEY
    expect(content).toContain("CONVOS_ENV=dev");
  });

  it("outputs to stdout with --stdout flag", async () => {
    const result = await runCommand(["init", "--stdout"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CONVOS_ENV=");
  });
});
