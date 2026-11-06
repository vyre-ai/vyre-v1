# computers.chrome.tabs

List, find, use, open or close tabs. find looks for tabs already open for a site (in the person's own Chrome: their open tabs); use works in one; a tab that was not yours to begin with is never closed

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
| HTTP | POST /v1/computers/chrome/tabs |
| MCP tool | chrome_tabs (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  inMyChrome?: boolean;
  action: "list" | "use" | "find" | "new" | "close";
  tabId?: string;
  url?: string;
  site?: string;
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
    "inMyChrome": true,
    "site": "mail.google.com",
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
