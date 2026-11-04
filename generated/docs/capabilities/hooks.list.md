# hooks.list

List hooks: the Space's, yours, and an agent's or one chat's. Each has a plain line, when it runs, what it does and who made it. Use this before you add one

| | |
|---|---|
| Module | hooks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/hooks/list |
| MCP tool | hooks_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope?: "space" | "person" | "agent" | "chat" | "run";
  threadId?: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  hooks: Array<{
      id: string;
      scope: "space" | "person" | "agent" | "chat" | "run";
      event: "session.start" | "prompt.submit" | "tool.before" | "tool.after" | "outward.before" | "turn.end" | "helper.start" | "helper.end";
      kind: "command" | "check" | "action";
      matcher: string;
      line: string;
      paused: boolean;
      madeBy: string;
      madeByKind: "admin" | "person" | "agent";
      threadId?: string;
      agentId?: string;
      helpers: boolean;
      timeoutSec: number;
      createdAt: number;
      updatedAt: number;
      spec: unknown;
      mine: boolean;
      allowed: Array<{
          id: string;
          what: string;
          by: string;
          createdAt: number;
        }>;
      canChange: boolean;
      endedAt?: number;
    }>;
  agentHooks: boolean;
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
    "agentId": "agt_a1b2c3",
    "scope": "space",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "agentHooks": true,
    "hooks": [
      {
        "agentId": "agt_a1b2c3",
        "allowed": [
          {
            "by": "example",
            "createdAt": 1760000000000,
            "id": "alw_a1b2c3",
            "what": "example"
          }
        ],
        "canChange": true,
        "createdAt": 1760000000000,
        "endedAt": 1760000000000,
        "event": "session.start",
        "helpers": true,
        "id": "hok_a1b2c3",
        "kind": "command",
        "line": "example",
        "madeBy": "example",
        "madeByKind": "admin",
        "matcher": "example",
        "mine": true,
        "paused": true,
        "scope": "space",
        "spec": {},
        "threadId": "thr_a1b2c3",
        "timeoutSec": 1,
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
