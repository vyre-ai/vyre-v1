# browser.chrome.act

Press a button on a Chrome card: send what is held, do not send it, watch the agent's tab, or take it over

| | |
|---|---|
| Module | browser |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/browser/chrome/act |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  action: "send" | "drop" | "watch" | "takeover";
  agentId: string;
  heldId?: string;
  edits?: {
    to?: string;
    subject?: string;
    message?: string;
  };
  threadId?: string;
  summary?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  done: boolean;
  already?: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "action": "send",
    "agentId": "agt_a1b2c3",
    "edits": {
      "message": "example",
      "subject": "example",
      "to": "example"
    },
    "heldId": "hld_a1b2c3",
    "idempotencyKey": "idem_1",
    "summary": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "already": true,
    "done": true
  }
}
```
