# logs.query

Search logs by person, agent, place, record, run or trace (ids and metadata only)

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
| HTTP | POST /v1/logs/query |
| MCP tool | logs_query (engineer) |
| CLI | vyre logs |
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
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      id: number;
      at: number;
      level: "debug" | "info" | "warn" | "error";
      traceId?: string;
      spanId?: string;
      actor?: string;
      onBehalf?: string;
      runId?: string;
      place?: string;
      cap?: string;
      entity?: string;
      entityId?: string;
      result?: string;
      durMs?: number;
      costMicros?: number;
      label?: number;
      msg: string;
      attrs?: Record<string, unknown>;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "level": "debug",
    "limit": 1,
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
    "next": "example",
    "rows": [
      {
        "actor": "example",
        "at": 1760000000000,
        "attrs": {},
        "cap": "example",
        "costMicros": 1,
        "durMs": 1,
        "entity": "example",
        "entityId": "example",
        "id": 1,
        "label": 1,
        "level": "debug",
        "msg": "example",
        "onBehalf": "example",
        "place": "example",
        "result": "example",
        "runId": "run_a1b2c3",
        "spanId": "example",
        "traceId": "0123456789abcdef0123456789abcdef"
      }
    ],
    "total": 1
  }
}
```
