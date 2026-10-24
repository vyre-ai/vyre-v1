# computers.chrome.status

Status of Vyre for Chrome in this computer: connected, paused by Esc, held items

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
| HTTP | POST /v1/computers/chrome/status |
| MCP tool | chrome_status (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
};
```

## Output

```ts
type Out = {
  connected: boolean;
  paused: boolean;
  held: Array<string>;
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
    "computerId": "cmt_a1b2c3"
  },
  "output": {
    "connected": true,
    "held": [
      "example"
    ],
    "paused": true
  }
}
```
