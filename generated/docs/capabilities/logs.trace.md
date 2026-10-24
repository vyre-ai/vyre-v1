# logs.trace

Trace view: logs, spans and events joined by one trace id

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
| HTTP | POST /v1/logs/trace |
| MCP tool | logs_trace (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  traceId: string;
};
```

## Output

```ts
type Out = {
  logs: Array<{
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
  spans: Array<{
      traceId: string;
      spanId: string;
      parent?: string;
      name: string;
      at: number;
      durUs: number;
      attrs?: Record<string, unknown>;
    }>;
  events: Array<{
      seq: number;
      type: string;
      at: number;
      actor: string;
      entity?: string;
    }>;
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
    "traceId": "0123456789abcdef0123456789abcdef"
  },
  "output": {
    "events": [
      {
        "actor": "example",
        "at": 1760000000000,
        "entity": "example",
        "seq": 1,
        "type": "example"
      }
    ],
    "logs": [
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
    "spans": [
      {
        "at": 1,
        "attrs": {},
        "durUs": 1,
        "name": "example",
        "parent": "example",
        "spanId": "example",
        "traceId": "0123456789abcdef0123456789abcdef"
      }
    ]
  }
}
```
