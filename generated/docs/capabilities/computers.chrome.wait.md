# computers.chrome.wait

Wait for a load, text, selector, network idle or a time

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/chrome/wait |
| MCP tool | chrome_wait (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  until: "load" | "text" | "selector" | "network_idle" | "time";
  value?: string;
  timeoutMs?: number;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  waitedMs: number;
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
    "tabId": "example",
    "timeoutMs": 100,
    "until": "load",
    "value": "example"
  },
  "output": {
    "ok": true,
    "waitedMs": 1
  }
}
```
