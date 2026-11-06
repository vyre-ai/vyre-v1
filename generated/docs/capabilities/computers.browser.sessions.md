# computers.browser.sessions

The sites an agent's browser is signed in to (cookies the profile holds), by site, never a value. Wakes the browser when it is asleep. Only for a browser you may watch

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/computers/browser/sessions |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
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
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
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
