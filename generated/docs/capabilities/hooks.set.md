# hooks.set

Add or change a hook that runs at an event (before a tool, before anything leaves Vyre, a message, a turn end, a helper) as a command, a check or one action. For yourself: scope agent, chat or run. It can stop something, add a note or run its own action; never skip a rule

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
| HTTP | POST /v1/hooks/set |
| MCP tool | hooks_set (agents) |
| CLI | none |
| Emits | hook.changed |

## Input

```ts
type In = {
  id?: string;
  scope: "space" | "person" | "agent" | "chat" | "run";
  event: "session.start" | "prompt.submit" | "tool.before" | "tool.after" | "outward.before" | "turn.end" | "helper.start" | "helper.end";
  kind: "command" | "check" | "action";
  matcher?: string;
  command?: string;
  args?: Array<string>;
  instruction?: string;
  cap?: string;
  input?: unknown;
  timeoutSec?: number;
  summary?: string;
  threadId?: string;
  agentId?: string;
  helpers?: boolean;
  paused?: boolean;
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
    canChange: boolean;
    endedAt?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.limit
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "args": [
      "example"
    ],
    "cap": "chat.post",
    "command": "example",
    "event": "session.start",
    "helpers": true,
    "id": "example",
    "input": {},
    "instruction": "The address must be in Contacts",
    "kind": "command",
    "matcher": "mail.send",
    "paused": true,
    "scope": "space",
    "summary": "before any email, check the address is in Contacts",
    "threadId": "thr_a1b2c3",
    "timeoutSec": 1
  },
  "output": {
    "hook": {
      "agentId": "agt_a1b2c3",
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
