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
| Team Space only | no |
| HTTP | POST /v1/computers/chrome/type |
| MCP tool | chrome_type (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  inMyChrome?: boolean;
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
  downloads?: Array<{
      name: string;
      path: string;
      fileId?: string;
      note?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
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
    "inMyChrome": true,
    "ref": "e12",
    "submit": true,
    "tabId": "example",
    "text": "example"
  },
  "output": {
    "downloads": [
      {
        "fileId": "fil_a1b2c3",
        "name": "example",
        "note": "example",
        "path": "Downloads/report.pdf"
      }
    ],
    "heldId": "example",
    "ok": true
  }
}
```
