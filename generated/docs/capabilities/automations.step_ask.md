# automations.step_ask

System: a chat post set to ask passes the Gate here first. It does nothing itself

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | post |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/step_ask |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  act: "post";
  threadId?: string;
  text?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "act": "post",
    "idempotencyKey": "idem_1",
    "text": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
