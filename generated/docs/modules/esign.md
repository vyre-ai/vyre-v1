# E-signature (esign)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (13)

- [esign.cancel](../capabilities/esign.cancel.md): Cancel an envelope; every signer link stops working at once
- [esign.fetch_signed](../capabilities/esign.fetch_signed.md): Fetch the signed PDF and audit certificate into the record folder as a new version
- [esign.health](../capabilities/esign.health.md): Probe: the default signing service is ready (built-in signing always is)
- [esign.hook](../capabilities/esign.hook.md): Inbound provider webhook: sent, viewed, signed, declined
- [esign.list](../capabilities/esign.list.md): List envelopes, newest first
- [esign.provider_set](../capabilities/esign.provider_set.md): Choose the default provider; Automations do not change
- [esign.providers](../capabilities/esign.providers.md): Signing services and which is the default; built-in signing is always ready
- [esign.remind](../capabilities/esign.remind.md): Give a signer a new link (the old one stops working) and email it when the Space can
- [esign.send](../capabilities/esign.send.md): Send a PDF for signature. Built-in signing needs no account: it returns one link per signer to copy and emails them when the Space has a sending mailbox
- [esign.signer_act](../capabilities/esign.signer_act.md): Public: sign, decline or take a copy, by a signing link
- [esign.signer_doc](../capabilities/esign.signer_doc.md): Public: the PDF a signer signs, for a live link only
- [esign.signer_view](../capabilities/esign.signer_view.md): Public: open a signing link. Records the open and returns what the signer sees
- [esign.status](../capabilities/esign.status.md): Envelope status: who has opened and signed

## Events (5)

- [signature.cancelled](../events/signature.cancelled.md): The sender cancelled an envelope; every link stopped working
- [signature.declined](../events/signature.declined.md): A signer declined
- [signature.sent](../events/signature.sent.md): An envelope was sent for signature
- [signature.signed](../events/signature.signed.md): All signers signed; the signed PDF and audit certificate were saved as a new version
- [signature.viewed](../events/signature.viewed.md): A signer opened the envelope
