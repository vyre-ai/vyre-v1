# hooks.fire

System: ask what the hooks say about one event. The engine, the tool session and the CLI shim call it; it returns a block with its reason, notes for the model, and how many ran. Hooks that fail or run out of time never block

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/hooks/fire |
| MCP tool | none |
| CLI | none |
| Emits | hook.blocked |

## Input

```ts
type In = {
  event: "session.start" | "prompt.submit" | "tool.before" | "tool.after" | "outward.before" | "turn.end" | "helper.start" | "helper.end";
  agentId: string;
  threadId: string;
  asker?: string;
  turnId?: string;
  threadKind?: string;
  engine?: string;
  source?: "engine" | "tools" | "cli";
  tool?: string;
  cap?: string;
  input?: unknown;
  output?: unknown;
  ok?: boolean;
  prompt?: string;
  title?: string;
};
```

## Output

```ts
type Out = {
  block: {
    reason: string;
    hookId: string;
    by: string;
    scope: string;
    next?: Array<{
        label: string;
        ask: string;
      }>;
  } | null;
  notes: Array<string>;
  ran: number;
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
    "asker": "usr_a1b2c3",
    "cap": "example",
    "engine": "example",
    "event": "session.start",
    "input": {},
    "ok": true,
    "output": {},
    "prompt": "example",
    "source": "engine",
    "threadId": "thr_a1b2c3",
    "threadKind": "example",
    "title": "example",
    "tool": "example",
    "turnId": "example"
  },
  "output": {
    "block": {
      "by": "example",
      "hookId": "example",
      "next": [
        {
          "ask": "example",
          "label": "example"
        }
      ],
      "reason": "example",
      "scope": "example"
    },
    "notes": [
      "example"
    ],
    "ran": 1
  }
}
```
