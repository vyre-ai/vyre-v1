# members.sso.set

Add or change an OIDC provider (Google, Microsoft, Okta); the client secret is a Vault item named by handle

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/sso/set |
| MCP tool | members_sso_set (engineer) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  provider: {
    key: "google" | "microsoft" | "okta";
    title: string;
    issuer: string;
    clientId: string;
    clientSecretHandle: string;
    enabled: boolean;
    domainHint?: string;
  };
};
```

## Output

```ts
type Out = {
  provider: {
    key: "google" | "microsoft" | "okta";
    title: string;
    issuer: string;
    clientId: string;
    clientSecretHandle: string;
    enabled: boolean;
    domainHint?: string;
  };
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
  "input": {
    "provider": {
      "clientId": "example",
      "clientSecretHandle": "#Dana_Lawmatics",
      "domainHint": "example",
      "enabled": true,
      "issuer": "https://example.com",
      "key": "google",
      "title": "example"
    }
  },
  "output": {
    "provider": {
      "clientId": "example",
      "clientSecretHandle": "#Dana_Lawmatics",
      "domainHint": "example",
      "enabled": true,
      "issuer": "https://example.com",
      "key": "google",
      "title": "example"
    }
  }
}
```
