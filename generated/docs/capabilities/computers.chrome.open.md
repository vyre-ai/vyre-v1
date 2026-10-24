# computers.chrome.open

Open a URL, reusing the open tab by default (never one tab per step)

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
| HTTP | POST /v1/computers/chrome/open |
| MCP tool | chrome_open (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  url: string;
  newTab?: boolean;
};
```

## Output

```ts
type Out = {
  tabId: string;
  url: string;
  title: string;
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
    "newTab": true,
    "url": "https://example.com"
  },
  "output": {
    "tabId": "example",
    "title": "example",
    "url": "example"
  }
}
```
