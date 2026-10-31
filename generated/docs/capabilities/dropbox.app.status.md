# dropbox.app.status

Whether the Dropbox app is set up on this server, its key, the address Dropbox sends people back to, and whether change notices can be verified (the address to give Dropbox for them)

| | |
|---|---|
| Module | dropbox |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/dropbox/app/status |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  configured: boolean;
  appKey?: string;
  vaultItem?: string;
  redirectUri?: string;
  webhooks?: boolean;
  webhookUri?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "appKey": "example",
    "configured": true,
    "redirectUri": "example",
    "vaultItem": "example",
    "webhookUri": "example",
    "webhooks": true
  }
}
```
