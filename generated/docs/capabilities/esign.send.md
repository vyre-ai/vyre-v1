# esign.send

Send a file from the record folder for signature, signer fields mapped from the record

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.shared_send |
| Grant level | use |
| Risk | high |
| Resource | file (/fileId) |
| Gate | signature_send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/esign/send |
| MCP tool | esign_send (files) |
| CLI | none |
| Emits | signature.sent |

## Input

```ts
type In = {
  fileId: string;
  recordId?: string;
  signers: Array<{
      name: string;
      email: string;
      order?: number;
    }>;
  provider?: "documenso" | "dropbox_sign" | "docusign";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  envelopeId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "provider": "documenso",
    "recordId": "rec_a1b2c3",
    "signers": [
      {
        "email": "example",
        "name": "example",
        "order": 1
      }
    ]
  },
  "output": {
    "envelopeId": "env_a1b2c3"
  }
}
```
