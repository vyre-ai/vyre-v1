# computers.hosts

The machines an agent computer can run on for you: this computer or the Space server when its container runtime answers, and each server you added that has Docker. Nothing about agent computers is offered until one can run them

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/computers/hosts |
| MCP tool | computers_hosts (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  available: boolean;
  hosts: Array<{
      hostId: string;
      kind: "this" | "space" | "server";
      name: string;
      online: boolean;
      canRun: boolean;
      runs: number;
      reason?: string;
    }>;
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
  "input": {},
  "output": {
    "available": true,
    "hosts": [
      {
        "canRun": true,
        "hostId": "example",
        "kind": "this",
        "name": "example",
        "online": true,
        "reason": "example",
        "runs": 1
      }
    ]
  }
}
```
