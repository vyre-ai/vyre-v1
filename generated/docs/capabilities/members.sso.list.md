# members.sso.list

List SSO providers set for this Space

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/members/sso/list |
| MCP tool | members_sso_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  providers: Array<{
      key: "google" | "microsoft" | "okta";
      title: string;
      issuer: string;
      clientId: string;
      clientSecretHandle: string;
      enabled: boolean;
      domainHint?: string;
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

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "providers": [
      {
        "clientId": "example",
        "clientSecretHandle": "#Dana_Lawmatics",
        "domainHint": "example",
        "enabled": true,
        "issuer": "https://example.com",
        "key": "google",
        "title": "example"
      }
    ]
  }
}
```
