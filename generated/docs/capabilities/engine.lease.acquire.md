# engine.lease.acquire

Take the lease on a thread (compare and set; heartbeat every 5 s, expires after 20 s)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/lease/acquire |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  holder: string;
  kind: "turn" | "wait";
};
```

## Output

```ts
type Out = {
  acquired: boolean;
  expiresAt: number;
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
    "holder": "host:spc_a1b2c3",
    "kind": "turn",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "acquired": true,
    "expiresAt": 1760000000000
  }
}
```
