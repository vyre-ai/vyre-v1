# dropbox.files.longpoll

Wait for the next change after a cursor (30 to 480 seconds); answers whether there is one and how long to wait before asking again

| | |
|---|---|
| Module | dropbox |
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
| HTTP | POST /v1/dropbox/files/longpoll |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  cursor: string;
  timeoutSeconds?: number;
};
```

## Output

```ts
type Out = {
  changes: boolean;
  backoffSeconds?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "cursor": "example",
    "timeoutSeconds": 30
  },
  "output": {
    "backoffSeconds": 1,
    "changes": true
  }
}
```
