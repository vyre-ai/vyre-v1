# dropbox.receive_webhook

Record a verified Dropbox change notice once; it names the accounts that changed

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/dropbox/receive_webhook |
| MCP tool | none |
| CLI | none |
| Emits | dropbox.changes_received |

## Input

```ts
type In = {
  eventId: string;
  accounts: Array<string>;
  at: number;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
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
    "accounts": [
      "example"
    ],
    "at": 1760000000000,
    "eventId": "example"
  },
  "output": {
    "accepted": true
  }
}
```
