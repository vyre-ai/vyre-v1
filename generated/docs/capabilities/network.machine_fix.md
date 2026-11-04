# network.machine_fix

Press a Doctor Fix on a machine: clear old caches, stop idle engine sessions, or restart a service. The host runs it; an admin for the Space server and servers it holds, the owner for their own computer. Audited

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/machine_fix |
| MCP tool | network_machine_fix (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  serverId: string;
  fix: "clear_caches" | "stop_idle" | "restart_service";
  service?: string;
};
```

## Output

```ts
type Out = {
  queued: boolean;
  commandId: number;
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
    "serverId": "srv_local",
    "service": "example"
  },
  "output": {
    "commandId": 1,
    "queued": true
  }
}
```
