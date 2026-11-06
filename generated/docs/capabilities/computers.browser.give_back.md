# computers.browser.give_back

Give an agent's browser back to the agent; the person who has the controls or an admin may

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.take_over |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/computers/browser/give_back |
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
    takeoverBy?: string;
    paired: boolean;
    access: "owner" | "admin";
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
      "paired": true,
      "running": true,
      "tabs": 1,
      "takeoverBy": "usr_a1b2c3",
      "viewers": 1
    }
  }
}
```
