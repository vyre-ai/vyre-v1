# computers.browser.profiles

The agent browsers in this Space's browser that you may watch: running or asleep, tabs, whether the agent is using it, and who has the controls

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/computers/browser/profiles |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  profiles: Array<{
      agentId: string;
      running: boolean;
      tabs: number;
      busy: boolean;
      viewers: number;
      lastActiveAt?: number;
      takeoverBy?: string;
      paired: boolean;
      access: "owner" | "admin";
    }>;
  maxRunning: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "maxRunning": 1,
    "profiles": [
      {
        "access": "owner",
        "agentId": "agt_a1b2c3",
        "busy": true,
        "lastActiveAt": 1760000000000,
        "paired": true,
        "running": true,
        "tabs": 1,
        "takeoverBy": "usr_a1b2c3",
        "viewers": 1
      }
    ]
  }
}
```
