# computers.browser.pause

Pause an agent's browser: its next browser call waits, spending nothing, until you resume; a take-over, a stop or half an hour also end it. Who may take over may pause

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
| HTTP | POST /v1/computers/browser/pause |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "profile": {
      "access": "owner",
      "agentId": "agt_a1b2c3",
      "busy": true,
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
