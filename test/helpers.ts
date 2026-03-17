import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";

const CLI_PATH = resolve(import.meta.dirname, "../bin/run.js");
const TEST_DIR = resolve(import.meta.dirname, "../.test-data");

/** Temporary home directory for the current test suite, isolated from ~/.convos */
let _testHome: string | undefined;

/**
 * Get (or create) an isolated Convos home directory for the current test run.
 * Call `cleanupTestHome()` in afterAll/afterEach to remove it.
 */
export function getTestHome(): string {
  if (!_testHome) {
    _testHome = mkdtempSync(join(tmpdir(), "convos-test-home-"));
  }
  return _testHome;
}

/**
 * Remove the temporary test home directory.
 */
export function cleanupTestHome(): void {
  if (_testHome) {
    rmSync(_testHome, { recursive: true, force: true });
    _testHome = undefined;
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a CLI command in an isolated test home directory.
 * Automatically injects `--home <testHome>` unless the args already contain `--home`.
 */
export async function runCommand(
  args: string[],
  options: { env?: Record<string, string>; timeout?: number } = {},
): Promise<RunResult> {
  const homeArgs = args.includes("--home") ? [] : ["--home", getTestHome()];
  const result = await execa("node", [CLI_PATH, ...args, ...homeArgs], {
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
