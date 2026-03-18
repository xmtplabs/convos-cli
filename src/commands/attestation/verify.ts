import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import {
  verifyAttestation,
  verifyAttestationWithJwks,
  fetchJwks,
  type Attestation,
} from "../../utils/attestation.js";

const DEFAULT_JWKS_URLS: Record<string, string> = {
  production: "https://convos.org/.well-known/agents.json",
  dev: "https://dev.convos.org/.well-known/agents.json",
};

export default class AttestationVerify extends ConvosBaseCommand {
  static description = `Verify an assistant attestation.

Checks that the Ed25519 signature is valid for the given inbox ID,
timestamp, and key. Can verify against a JWKS URL, a local JWKS
file, or a raw public key.`;

  static examples = [
    {
      command:
        '<%= config.bin %> <%= command.id %> <inbox-id> --attestation <sig> --attestation-ts <ts> --attestation-kid <kid>',
      description: "Verify against the default JWKS endpoint",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <inbox-id> --attestation <sig> --attestation-ts <ts> --public-key <base64url>',
      description: "Verify against a raw public key",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <inbox-id> --attestation <sig> --attestation-ts <ts> --attestation-kid <kid> --jwks-url https://example.com/agents.json',
      description: "Verify against a custom JWKS URL",
    },
  ];

  static args = {
    "inbox-id": Args.string({
      description: "The agent's XMTP inbox ID",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.commonFlags,
    attestation: Flags.string({
      description: "Base64url-encoded Ed25519 signature",
      required: true,
      helpValue: "<signature>",
    }),
    "attestation-ts": Flags.string({
      description: "ISO 8601 timestamp used in the attestation",
      required: true,
      helpValue: "<iso8601>",
    }),
    "attestation-kid": Flags.string({
      description: "Key ID to look up in the JWKS",
      helpValue: "<kid>",
    }),
    "public-key": Flags.string({
      description: "Base64url-encoded Ed25519 public key (skip JWKS lookup)",
      helpValue: "<base64url>",
    }),
    "jwks-url": Flags.string({
      description: "URL to fetch JWKS from (default: derived from --env)",
      helpValue: "<url>",
    }),
    "jwks-file": Flags.string({
      description: "Path to a local JWKS JSON file",
      helpValue: "<path>",
    }),
    "max-age": Flags.integer({
      description: "Maximum attestation age in seconds (default: 86400 = 24h)",
      helpValue: "<seconds>",
      default: 86400,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AttestationVerify);
    const inboxId = args["inbox-id"];
    const maxAgeMs = flags["max-age"] * 1000;

    const attestation: Attestation = {
      signature: flags.attestation,
      timestamp: flags["attestation-ts"],
      kid: flags["attestation-kid"] ?? "",
    };

    // Direct public key verification (no JWKS)
    if (flags["public-key"]) {
      const result = verifyAttestation(inboxId, attestation, flags["public-key"], maxAgeMs);
      this.output({
        inboxId,
        kid: attestation.kid || null,
        verified: result.valid,
        reason: result.reason ?? null,
      });
      return;
    }

    // JWKS verification — need a kid
    if (!attestation.kid) {
      this.error("--attestation-kid is required when verifying against JWKS (or use --public-key for direct verification)");
    }

    // Load JWKS
    let jwks;
    if (flags["jwks-file"]) {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const content = readFileSync(resolve(flags["jwks-file"]), "utf-8");
      jwks = JSON.parse(content);
    } else {
      const config = this.getConvosConfig();
      const env = config.env ?? "dev";
      const jwksUrl = flags["jwks-url"] ?? DEFAULT_JWKS_URLS[env] ?? DEFAULT_JWKS_URLS.dev;
      try {
        jwks = await fetchJwks(jwksUrl);
      } catch (error) {
        this.error(`Failed to fetch JWKS from ${jwksUrl}: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    const result = verifyAttestationWithJwks(inboxId, attestation, jwks, maxAgeMs);
    this.output({
      inboxId,
      kid: attestation.kid,
      verified: result.valid,
      reason: result.reason ?? null,
    });
  }
}
