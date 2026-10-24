# computers.chrome.net

Read network requests of the tab with timing; bodies are masked by the vault scrubber

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
| HTTP | POST /v1/computers/chrome/net |
| MCP tool | chrome_net (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  filter?: string;
  bodies?: boolean;
  limit?: number;
};
```

## Output

```ts
type Out = {
  requests: Array<{
      method: string;
      url: string;
      status?: number;
      ms?: number;
      body?: string;
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
    "bodies": true,
    "computerId": "cmt_a1b2c3",
    "filter": "example",
    "limit": 1,
    "tabId": "example"
  },
  "output": {
    "requests": [
      {
        "body": "example",
        "method": "example",
        "ms": 1,
        "status": 1,
        "url": "example"
      }
    ]
  }
}
```
