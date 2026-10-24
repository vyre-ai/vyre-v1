# esign.status

Envelope status

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
  status: "sent" | "viewed" | "signed" | "declined" | "cancelled";
  signers: Array<{
      name: string;
      status: "sent" | "viewed" | "signed" | "declined" | "cancelled";
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
    "signers": [
      {
        "name": "example",
        "status": "sent"
      }
    ],
    "status": "sent"
  }
}
```
