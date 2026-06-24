---
"@xmtp/convos-cli": patch
---

Fix `normalizeMessageContent` so a reply that carries a non-text payload renders its display string instead of a raw JSON dump of the decoded content. A reply containing a remote attachment now renders `reply to "…": [remote attachment: photo.jpg (… bytes) https://…]` rather than serializing the attachment envelope — which leaked the AES key material (secret/salt/nonce) into the message text. Inline attachments, reactions, and other nested content types render through the same path.
