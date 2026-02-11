import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { execa } from "execa";

const CLI_PATH = resolve(import.meta.dirname, "../bin/run.js");
const TEST_DIR = resolve(import.meta.dirname, "../.test-data");

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  args: string[],
  options: { env?: Record<string, string>; timeout?: number } = {},
): Promise<RunResult> {
  const result = await execa("node", [CLI_PATH, ...args], {
    env: { ...process.env, ...options.env },
    reject: false,
    timeout: options.timeout ?? 30000,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

export function parseJsonOutput<T>(output: string): T {
  return JSON.parse(output) as T;
}

export function getTestEnvPath(): string {
  return join(TEST_DIR, `.env-${randomBytes(8).toString("hex")}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
