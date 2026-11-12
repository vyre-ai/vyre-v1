# computers.chrome.state

URL, title and load state of a tab

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
| Team Space only | no |
| HTTP | POST /v1/computers/chrome/state |
| MCP tool | chrome_state (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  inMyChrome?: boolean;
  tabId?: string;
};
```

## Output

```ts
type Out = {
  url: string;
  title: string;
  loading: boolean;
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
    "tabId": "example"
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
    "loading": true,
    "title": "example",
    "url": "example"
  }
}
```
