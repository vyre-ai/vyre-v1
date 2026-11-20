# E-signature (esign)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (14)

- [esign.cancel](../capabilities/esign.cancel.md): Cancel an envelope; every signer link stops
- [esign.fetch_signed](../capabilities/esign.fetch_signed.md): Save the signed PDF to Files
- [esign.health](../capabilities/esign.health.md): Probe: the default signing service is ready (built-in signing always is)
- [esign.hook](../capabilities/esign.hook.md): Inbound provider webhook: sent, viewed, signed, declined
- [esign.list](../capabilities/esign.list.md): List envelopes
- [esign.provider_set](../capabilities/esign.provider_set.md): Choose the default provider; Automations do not change
- [esign.providers](../capabilities/esign.providers.md): Signing services and the default
- [esign.remind](../capabilities/esign.remind.md): New link for a signer; the old one stops
- [esign.send](../capabilities/esign.send.md): Send a PDF for signature
- [esign.signer_act](../capabilities/esign.signer_act.md): Public: sign, decline or take a copy, by a signing link
- [esign.signer_doc](../capabilities/esign.signer_doc.md): Public: the PDF a signer signs, for a live link only
- [esign.signer_view](../capabilities/esign.signer_view.md): Public: open a signing link. Records the open and returns what the signer sees
- [esign.status](../capabilities/esign.status.md): Envelope status and signers
- [esign.verify](../capabilities/esign.verify.md): Is this file sealed, unchanged since, and sealed by this Space

## Events (6)

- [signature.cancelled](../events/signature.cancelled.md): The sender cancelled an envelope; every link stopped working
- [signature.declined](../events/signature.declined.md): A signer declined
- [signature.expired](../events/signature.expired.md): An envelope was not signed in time; every link stopped working
- [signature.sent](../events/signature.sent.md): An envelope was sent for signature
- [signature.signed](../events/signature.signed.md): All signers signed; the signed PDF and audit certificate were saved as a new version
- [signature.viewed](../events/signature.viewed.md): A signer opened the envelope
