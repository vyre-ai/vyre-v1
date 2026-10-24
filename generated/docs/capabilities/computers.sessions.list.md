# computers.sessions.list

Signed-in browser sessions on the profile disk (listed under Sessions and devices)

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/sessions/list |
| MCP tool | computers_sessions_list (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId: string;
};
```

## Output

```ts
type Out = {
  sessions: Array<{
      site: string;
      signedInAs?: string;
      since: number;
      lastSeen: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
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
    "sessions": [
      {
        "lastSeen": 1760000000000,
        "signedInAs": "example",
        "since": 1760000000000,
        "site": "app.example.com"
      }
    ]
  }
}
```
