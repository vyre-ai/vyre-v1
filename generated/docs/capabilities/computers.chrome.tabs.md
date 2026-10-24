# computers.chrome.tabs

List, use, open or close tabs

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
| HTTP | POST /v1/computers/chrome/tabs |
| MCP tool | chrome_tabs (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  action: "list" | "use" | "new" | "close";
  tabId?: string;
  url?: string;
};
```

## Output

```ts
type Out = {
  tabs: Array<{
      tabId: string;
      url: string;
      title: string;
      active: boolean;
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
    "action": "list",
    "computerId": "cmt_a1b2c3",
    "tabId": "example",
    "url": "example"
  },
  "output": {
    "tabs": [
      {
        "active": true,
        "tabId": "example",
        "title": "example",
        "url": "example"
      }
    ]
  }
}
```
