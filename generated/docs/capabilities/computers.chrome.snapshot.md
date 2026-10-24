# computers.chrome.snapshot

Read the page as an accessibility tree with element refs; prefer this over screenshots

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.use |
| Grant level | view |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/chrome/snapshot |
| MCP tool | chrome_snapshot (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  selector?: string;
  format?: "tree" | "text";
};
```

## Output

```ts
type Out = {
  url: string;
  title: string;
  tree: string;
  truncated: boolean;
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
    "format": "tree",
    "selector": "example",
    "tabId": "example"
  },
  "output": {
    "title": "example",
    "tree": "example",
    "truncated": true,
    "url": "example"
  }
}
```
