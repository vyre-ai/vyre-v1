# computers.chrome.sources

List scripts, requests and storage a page uses (to work out backend calls for a recipe)

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
| HTTP | POST /v1/computers/chrome/sources |
| MCP tool | chrome_sources (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
};
```

## Output

```ts
type Out = {
  scripts: Array<string>;
  endpoints: Array<{
      method: string;
      url: string;
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
    "computerId": "cmt_a1b2c3",
    "tabId": "example"
  },
  "output": {
    "endpoints": [
      {
        "method": "example",
        "url": "example"
      }
    ],
    "scripts": [
      "example"
    ]
  }
}
```
