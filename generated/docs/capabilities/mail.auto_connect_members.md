# mail.auto_connect_members

Create Pending mail connections for every mapped member when delegation is set and auto-connect is on (one notice each)

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/auto_connect_members |
| MCP tool | none |
| CLI | none |
| Emits | mailbox.connected |

## Input

```ts
type In = {
  provider: "google" | "microsoft";
  members: Array<{
      userId: string;
      email: string;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  created: number;
  notified: number;
  skipped: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "members": [
      {
        "email": "maya@example.com",
        "userId": "usr_a1b2c3"
      }
    ],
    "provider": "google"
  },
  "output": {
    "created": 1,
    "notified": 1,
    "skipped": 1
  }
}
```
