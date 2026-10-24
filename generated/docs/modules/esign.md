# E-signature (esign)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (9)

- [esign.cancel](../capabilities/esign.cancel.md): Cancel an envelope
- [esign.fetch_signed](../capabilities/esign.fetch_signed.md): Fetch the signed PDF and audit certificate into the record folder as a new version
- [esign.health](../capabilities/esign.health.md): Probe: the provider answers (Documenso container health)
- [esign.hook](../capabilities/esign.hook.md): Inbound provider webhook: sent, viewed, signed, declined
- [esign.list](../capabilities/esign.list.md): List envelopes
- [esign.provider_set](../capabilities/esign.provider_set.md): Choose the default provider; Automations do not change
- [esign.providers](../capabilities/esign.providers.md): Providers and which is the default (Documenso, unmodified container)
- [esign.send](../capabilities/esign.send.md): Send a file from the record folder for signature, signer fields mapped from the record
- [esign.status](../capabilities/esign.status.md): Envelope status

## Events (4)

- [signature.declined](../events/signature.declined.md): A signer declined
- [signature.sent](../events/signature.sent.md): An envelope was sent for signature
- [signature.signed](../events/signature.signed.md): All signers signed; the signed PDF and audit certificate were saved as a new version
- [signature.viewed](../events/signature.viewed.md): A signer opened the envelope
