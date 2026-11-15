# terminal.keys

Press keys in a session as a person at a keyboard does: text, a named key (Enter, Tab, Up, C-c, F5 ...) or a paste as one write, raw through tmux; for a person who holds the keyboard. Never stored or logged: what is typed at a hidden prompt does not reach the stored log, other viewers or the agent

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | terminal (/terminalId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/terminal/keys |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  terminalId: string;
  keys: Array<{
      text?: string;
      key?: string;
      paste?: string;
    }>;
  lease: string;
  seq: number;
  capture?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  screen?: {
    text: string;
    cols: number;
    rows: number;
    cursor: {
      x: number;
      y: number;
    } | null;
    history: number;
    hidden: boolean;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "capture": true,
    "idempotencyKey": "idem_1",
    "keys": [
      {
        "key": "example",
        "paste": "example",
        "text": "example"
      }
    ],
    "lease": "example",
    "seq": 1,
    "terminalId": "trm_a1b2c3"
  },
  "output": {
    "ok": true,
    "screen": {
      "cols": 1,
      "cursor": {
        "x": 1,
        "y": 1
      },
      "hidden": true,
      "history": 1,
      "rows": 1,
      "text": "example"
    }
  }
}
```
