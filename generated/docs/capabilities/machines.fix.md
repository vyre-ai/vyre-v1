# machines.fix

Press a Doctor Fix on a machine: clear old caches, stop idle engine sessions, or restart a service. The host runs it; an admin for the Space server and servers, the owner for their own computer. Audited

| | |
|---|---|
| Module | machines |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/machines/fix |
| MCP tool | machines_fix (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  machineId: string;
  fix: "clear_caches" | "stop_idle" | "restart_service";
  service?: string;
};
```

## Output

```ts
type Out = {
  state: "done" | "failed";
  detail: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "fix": "clear_caches",
    "machineId": "example",
    "service": "example"
  },
  "output": {
    "detail": "example",
    "state": "done"
  }
}
```
