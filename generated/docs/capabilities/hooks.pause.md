# hooks.pause

Pause a hook, or turn it back on

| | |
|---|---|
| Module | hooks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/hooks/pause |
| MCP tool | none |
| CLI | none |
| Emits | hook.changed |

## Input

```ts
type In = {
  id: string;
  paused: boolean;
  threadId?: string;
};
```

## Output

```ts
type Out = {
  hook: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "id": "example",
    "paused": true,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "hook": {
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
  }
}
```
