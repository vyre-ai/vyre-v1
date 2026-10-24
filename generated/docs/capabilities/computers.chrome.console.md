# computers.chrome.console

Read the page console messages

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
| HTTP | POST /v1/computers/chrome/console |
| MCP tool | chrome_console (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  tabId?: string;
  level?: "log" | "warn" | "error";
  limit?: number;
};
```

## Output

```ts
type Out = {
  messages: Array<{
      level: string;
      text: string;
      at: number;
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
    "level": "log",
    "limit": 1,
    "tabId": "example"
  },
  "output": {
    "messages": [
      {
        "at": 1760000000000,
        "level": "example",
        "text": "example"
      }
    ]
  }
}
```
