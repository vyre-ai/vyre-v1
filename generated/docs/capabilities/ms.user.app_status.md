# ms.user.app_status

Whether a Microsoft OAuth app is set up for signing in to your own Outlook, and the redirect address to give Microsoft for it

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/user/app_status |
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
  clientId?: string;
  vaultItem?: string;
  redirectUri?: string;
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
    "clientId": "example",
    "configured": true,
    "redirectUri": "example",
    "vaultItem": "example"
  }
}
```
