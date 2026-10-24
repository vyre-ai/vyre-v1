# computers.chrome.click

Click an element by ref or by coordinates

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
| HTTP | POST /v1/computers/chrome/click |
| MCP tool | chrome_click (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  ref?: string;
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
};
```

## Output

```ts
type Out = {
  ok: boolean;
  heldId?: string;
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
    "button": "left",
    "computerId": "cmt_a1b2c3",
    "ref": "e12",
    "tabId": "example",
    "x": 1,
    "y": 1
  },
  "output": {
    "heldId": "example",
    "ok": true
  }
}
```
