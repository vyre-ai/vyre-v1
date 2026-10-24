# computers.chrome.act

Act on an element or key: click, hover, press, select, scroll, check; a send, post or payment is held and returns an id

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
| HTTP | POST /v1/computers/chrome/act |
| MCP tool | chrome_act (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  ref?: string;
  action: "click" | "double_click" | "hover" | "press" | "select" | "scroll" | "check" | "uncheck" | "focus";
  value?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  heldId?: string;
  snapshot?: string;
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
    "action": "click",
    "computerId": "cmt_a1b2c3",
    "ref": "e12",
    "tabId": "example",
    "value": "example"
  },
  "output": {
    "heldId": "example",
    "ok": true,
    "snapshot": "example"
  }
}
```
