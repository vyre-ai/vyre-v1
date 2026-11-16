# esign.status

Envelope status and signers

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/esign/status |
| MCP tool | esign_status (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  envelopeId: string;
};
```

## Output

```ts
type Out = {
  status: "sent" | "viewed" | "signed" | "declined" | "cancelled" | "expired";
  expiresAt?: number;
  declinedReason?: string;
  signedFileId?: string;
  finalSha256?: string;
  sealed?: boolean;
  sealFingerprint?: string;
  signers: Array<{
      name: string;
      email?: string;
      status: "sent" | "viewed" | "signed" | "declined" | "cancelled" | "expired";
      order?: number;
      openedAt?: number;
      signedAt?: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "envelopeId": "env_a1b2c3"
  },
  "output": {
    "declinedReason": "example",
    "expiresAt": 1760000000000,
    "finalSha256": "example",
    "sealFingerprint": "example",
    "sealed": true,
    "signedFileId": "fil_a1b2c3",
    "signers": [
      {
        "email": "example",
        "name": "example",
        "openedAt": 1760000000000,
        "order": 1,
        "signedAt": 1760000000000,
        "status": "sent"
      }
    ],
    "status": "sent"
  }
}
```
