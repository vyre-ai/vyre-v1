# state.counts

My badges: for each scope how many things have something unread (not done, not muted) and how many entries that is

| | |
|---|---|
| Module | state |
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
| HTTP | POST /v1/state/counts |
| MCP tool | state_counts (meta, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scopes?: Array<string>;
};
```

## Output

```ts
type Out = {
  counts: Array<{
      scope: string;
      things: number;
      entries: number;
    }>;
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
    "scopes": [
      "mailbox:mbx_a1b2c3"
    ]
  },
  "output": {
    "counts": [
      {
        "entries": 1,
        "scope": "mailbox:mbx_a1b2c3",
        "things": 1
      }
    ]
  }
}
```
