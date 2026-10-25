# health.machine

Probe: CPU load, memory and disk of the server as the host last reported them (Console Overview tiles)

| | |
|---|---|
| Module | health |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/health/machine |
| MCP tool | health_machine (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
  detail?: string;
  latencyMs?: number;
  machine?: {
    cpuPercent?: number;
    memoryUsedBytes?: number;
    memoryTotalBytes?: number;
    diskFreeBytes?: number;
    diskTotalBytes?: number;
  };
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
  "input": {},
  "output": {
    "detail": "example",
    "latencyMs": 1,
    "machine": {
      "cpuPercent": 1,
      "diskFreeBytes": 1,
      "diskTotalBytes": 1,
      "memoryTotalBytes": 1,
      "memoryUsedBytes": 1
    },
    "state": "healthy"
  }
}
```
