# computers.chrome.batch

Run several Chrome steps in one call; stops at the first held item

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/chrome/batch |
| MCP tool | chrome_batch (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  steps: Array<{
      tool: string;
      args: Record<string, unknown>;
    }>;
};
```

## Output

```ts
type Out = {
  results: Array<{
      tool: string;
      ok: boolean;
      result?: unknown;
      heldId?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- timeout.deadline
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3",
    "steps": [
      {
        "args": {},
        "tool": "example"
      }
    ],
    "tabId": "example"
  },
  "output": {
    "results": [
      {
        "heldId": "example",
        "ok": true,
        "result": {},
        "tool": "example"
      }
    ]
  }
}
```
