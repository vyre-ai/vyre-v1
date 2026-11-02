# mcp.oauth.request

An app that asked to join this Space: what it calls itself and where it goes, for the Allow sheet

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mcp/oauth/request |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  request: {
    requestId: string;
    clientName: string;
    redirectHost?: string;
    spaceName: string;
    match: string;
    expiresAt: number;
    rejoins: boolean;
    canSetup?: boolean;
  };
};
```

## Errors

- auth.expired
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "requestId": "oar_a1b2c3"
  },
  "output": {
    "request": {
      "requestId": "oar_a1b2c3",
      "clientName": "Claude Code",
      "spaceName": "Northwind",
      "match": "4821",
      "expiresAt": 1760000300000,
      "rejoins": false
    }
  }
}
```
