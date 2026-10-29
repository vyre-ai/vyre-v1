# logs.client_upload

Upload the device ring-buffer log keyed by trace id, with the timing samples the device measured against the performance budgets (queued while offline, sent on reconnect)

| | |
|---|---|
| Module | logs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/logs/client_upload |
| MCP tool | none |
| CLI | none |
| Emits | client_log.uploaded |

## Input

```ts
type In = {
  device: string;
  entries: Array<{
      at: number;
      traceId?: string;
      level: "debug" | "info" | "warn" | "error";
      msg: string;
      attrs?: Record<string, unknown>;
    }>;
  samples?: Array<{
      budgetId: string;
      value: number;
      at: number;
      traceId?: string;
      attrs?: Record<string, unknown>;
    }>;
};
```

## Output

```ts
type Out = {
  accepted: number;
  sampled?: number;
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
    "device": "dev_a1b2c3",
    "entries": [
      {
        "at": 1760000000000,
        "attrs": {},
        "level": "debug",
        "msg": "example",
        "traceId": "0123456789abcdef0123456789abcdef"
      }
    ],
    "samples": [
      {
        "at": 1760000000000,
        "attrs": {},
        "budgetId": "startup",
        "traceId": "0123456789abcdef0123456789abcdef",
        "value": 1
      }
    ]
  },
  "output": {
    "accepted": 1,
    "sampled": 1
  }
}
```
