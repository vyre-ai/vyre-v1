# computers.chrome.type

Type text into the focused element or a ref; secrets only as #Handle.field references

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
| HTTP | POST /v1/computers/chrome/type |
| MCP tool | chrome_type (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  ref?: string;
  text: string;
  submit?: boolean;
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
    "computerId": "cmt_a1b2c3",
    "ref": "e12",
    "submit": true,
    "tabId": "example",
    "text": "example"
  },
  "output": {
    "heldId": "example",
    "ok": true
  }
}
```
