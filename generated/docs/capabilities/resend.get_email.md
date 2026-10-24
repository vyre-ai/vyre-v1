# resend.get_email

Look up the delivery status of a sent email

| | |
|---|---|
| Module | resend |
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
| HTTP | POST /v1/resend/get_email |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  providerId: string;
};
```

## Output

```ts
type Out = {
  status: string;
  lastEvent?: "sent" | "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed" | "delayed";
  at?: number;
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
    "providerId": "example"
  },
  "output": {
    "at": 1760000000000,
    "lastEvent": "sent",
    "status": "example"
  }
}
```
