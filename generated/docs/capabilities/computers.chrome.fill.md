# computers.chrome.fill

Fill form fields; values may be #Handle.field references that the computer vault filler substitutes at the last moment

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
| HTTP | POST /v1/computers/chrome/fill |
| MCP tool | chrome_fill (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  fields: Array<{
      ref: string;
      value: string;
    }>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  filled: number;
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
    "fields": [
      {
        "ref": "e12",
        "value": "example"
      }
    ],
    "tabId": "example"
  },
  "output": {
    "filled": 1,
    "ok": true
  }
}
```
