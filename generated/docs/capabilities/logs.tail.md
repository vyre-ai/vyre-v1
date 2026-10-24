# logs.tail

Live tail of logs (stream opens over the live connection)

| | |
|---|---|
| Module | logs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.logs |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/logs/tail |
| MCP tool | logs_tail (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person?: string;
  agent?: string;
  place?: string;
  recordId?: string;
  runId?: string;
  traceId?: string;
  cap?: string;
  level?: "debug" | "info" | "warn" | "error";
  result?: string;
  sinceMs?: number;
  untilMs?: number;
};
```

## Output

```ts
type Out = {
  streamId: string;
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
    "agent": "example",
    "cap": "example",
    "level": "debug",
    "person": "example",
    "place": "example",
    "recordId": "rec_a1b2c3",
    "result": "example",
    "runId": "run_a1b2c3",
    "sinceMs": 1760000000000,
    "traceId": "0123456789abcdef0123456789abcdef",
    "untilMs": 1760000000000
  },
  "output": {
    "streamId": "example"
  }
}
```
