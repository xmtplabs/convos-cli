import { Args, Flags } from "@oclif/core";
import { ConvosBaseCommand } from "../../baseCommand.js";
import {
  signAttestation,
  generateAttestationKeyPair,
  buildJwks,
} from "../../utils/attestation.js";

export default class AttestationGenerate extends ConvosBaseCommand {
  static description = `Generate a test attestation for an agent inbox ID.

Creates an Ed25519 key pair, signs an attestation for the given inbox ID,
and outputs the attestation fields, the private key (for re-signing),
and a JWKS containing the public key (for verification).

This is intended for local testing — in production, the backend signs
attestations and hosts the JWKS endpoint.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <inbox-id>",
      description: "Generate an attestation for an inbox ID",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <inbox-id> --kid my-key-2026",
      description: "Generate with a custom key ID",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <inbox-id> --json",
      description: "Output as JSON for scripting",
    },
  ];

  static args = {
    "inbox-id": Args.string({
      description: "The agent's XMTP inbox ID (hex string)",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.commonFlags,
    kid: Flags.string({
      description: "Key ID for the attestation",
      helpValue: "<kid>",
      default: "convos-agents-test",
    }),
    "private-key": Flags.string({
      description: "Ed25519 private key in PEM format (re-use an existing key instead of generating one)",
      helpValue: "<pem>",
    }),
    timestamp: Flags.string({
      description: "ISO 8601 timestamp to use (default: now)",
      helpValue: "<iso8601>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AttestationGenerate);
    const inboxId = args["inbox-id"];

    let privateKeyPem: string;
    let publicKey: string;
    let kid = flags.kid;

    if (flags["private-key"]) {
      // Re-use existing key — extract public key
      const { createPrivateKey } = await import("node:crypto");
      const pk = createPrivateKey(flags["private-key"]);
      const pubDer = pk.export({ type: "spki", format: "der" }) as Buffer;

      // This doesn't work — need to derive public from private differently
      // Use createPublicKey from the private key
      const { createPublicKey } = await import("node:crypto");
      const pub = createPublicKey(pk);
      const pubDer2 = pub.export({ type: "spki", format: "der" }) as Buffer;
      publicKey = pubDer2.subarray(12).toString("base64url");
      privateKeyPem = flags["private-key"];
    } else {
      const keyPair = generateAttestationKeyPair(kid);
      privateKeyPem = keyPair.privateKeyPem;
      publicKey = keyPair.publicKey;
      kid = keyPair.kid;
    }

    const attestation = signAttestation(inboxId, privateKeyPem, kid, flags.timestamp);
    const jwks = buildJwks([{ publicKey, kid }]);

    this.output({
      inboxId,
      attestation: attestation.signature,
      attestationTs: attestation.timestamp,
      attestationKid: attestation.kid,
      privateKeyPem,
      jwks,
      metadata: {
        attestation: attestation.signature,
        attestation_ts: attestation.timestamp,
        attestation_kid: attestation.kid,
      },
    });
  }
}
