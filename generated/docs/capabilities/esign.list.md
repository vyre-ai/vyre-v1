# esign.list

List envelopes

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
| HTTP | POST /v1/esign/list |
| MCP tool | esign_list (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordId?: string;
};
```

## Output

```ts
type Out = {
  envelopes: Array<{
      envelopeId: string;
      title: string;
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
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "envelopes": [
      {
        "envelopeId": "env_a1b2c3",
        "status": "sent",
        "title": "example"
      }
    ]
  }
}
```
