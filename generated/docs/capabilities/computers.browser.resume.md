# computers.browser.resume

Resume a paused agent browser: the call that waits goes on. Whoever paused it or an admin may

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.watch |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/computers/browser/resume |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  stopped?: boolean;
};
```

## Output

```ts
type Out = {
  profile: {
    agentId: string;
    running: boolean;
    tabs: number;
    busy: boolean;
    viewers: number;
    lastActiveAt?: number;
    state: "running" | "asleep" | "waiting" | "error";
    line?: string;
    takeoverBy?: string;
    pausedBy?: string;
    held?: {
      count: number;
      first?: {
        holdId: string;
        taskId: string;
        what: string;
        mayAnswer: boolean;
      };
    };
    paired: boolean;
    access: "owner" | "admin" | "viewer";
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "stopped": true
  },
  "output": {
    "profile": {
      "access": "owner",
      "agentId": "agt_a1b2c3",
      "busy": true,
      "held": {
        "count": 1,
        "first": {
          "holdId": "hld_a1b2c3",
          "mayAnswer": true,
          "taskId": "tsk_a1b2c3",
          "what": "example"
        }
      },
      "lastActiveAt": 1760000000000,
      "line": "example",
      "paired": true,
      "pausedBy": "usr_a1b2c3",
      "running": true,
      "state": "running",
      "tabs": 1,
      "takeoverBy": "usr_a1b2c3",
      "viewers": 1
    }
  }
}
```
