# engine.crew.message

Send a message to a teammate in its own thread; a teammate that stopped picks up where it left off

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/message |
| MCP tool | crew_message (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  jobId: string;
  body: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sent: boolean;
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
    "body": "example",
    "idempotencyKey": "idem_1",
    "jobId": "example"
  },
  "output": {
    "sent": true
  }
}
```
