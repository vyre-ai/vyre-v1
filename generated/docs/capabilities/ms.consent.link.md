# ms.consent.link

The admin consent link to open as a tenant admin, with the application permissions it grants

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ms/consent/link |
| MCP tool | ms_consent_link (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  tenantId?: string;
};
```

## Output

```ts
type Out = {
  url: string;
  permissions: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "tenantId": "example"
  },
  "output": {
    "permissions": [
      "example"
    ],
    "url": "example"
  }
}
```
