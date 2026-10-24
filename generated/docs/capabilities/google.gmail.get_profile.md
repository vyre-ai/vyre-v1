# google.gmail.get_profile

Gmail profile of the member (address, history id)

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/google/gmail/get_profile |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
};
```

## Output

```ts
type Out = {
  emailAddress: string;
  historyId: string;
  messagesTotal?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3"
  },
  "output": {
    "emailAddress": "maya@example.com",
    "historyId": "example",
    "messagesTotal": 1
  }
}
```
